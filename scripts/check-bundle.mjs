// Static EXP-11 check of the built plugin: no network-capable API, no
// URL-based wasm loading, and the engine is embedded. Exit 1 on any finding.
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const file = process.argv[2] ?? "dist/main.js";
const src = readFileSync(file, "utf8");
const forbidden = [
  ["fetch(", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["WebSocket", /\bWebSocket\b/],
  ["EventSource", /\bEventSource\b/],
  ["sendBeacon", /sendBeacon/],
  ["importScripts", /importScripts\s*\(/],
  ["import.meta", /import\.meta/],
  ["node network modules", /require\(\s*["'](?:node:)?(?:https?|net|tls|dns|dgram|http2|child_process)["']\s*\)/],
  ["electron net", /\bnet\.request\b/],
  // Obsidian exports `request` beside `requestUrl`. After bundling, an
  // external-module call looks like `(0, X.request)(…)` or `X.request(…)`.
  // `\.request\b` alone would flag `this.request` in the views, so the
  // call-shaped forms are matched instead.
  ["obsidian request()", /\(0,\s*[\w$]+\.request\)\s*\(/],
  ["obsidian request() (direct)", /\b[\w$]+\.request\s*\(/],
];
const findings = [];
for (const [name, re] of forbidden) {
  const m = re.exec(src);
  if (m) findings.push(`${name} at offset ${m.index}: …${src.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ")}…`);
}
// The one network primitive (ADR-OBS-003): named exactly once, inside the
// ingest-transport module. A minified bundle has no `// src/` banners, so the
// count is checked on the shipped file and the module locality on an
// unminified in-memory build of the same sources.
const netRe = /\brequestUrl\b/g;
const netHits = [...src.matchAll(netRe)].length;
if (netHits !== 1) findings.push(`requestUrl appears ${netHits} times in the bundle (exactly 1 allowed)`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stub = {
  name: "stub-worker-source",
  setup(build) {
    build.onResolve({ filter: /^virtual:worker-source$/ }, () => ({ path: "w", namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default '';", loader: "js" }));
  },
};
const probe = await esbuild.build({
  entryPoints: [resolve(root, "src/main.ts")],
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  loader: { ".wasm": "binary" },
  plugins: [stub],
  minify: false,
  legalComments: "none",
  logLevel: "silent",
});
const unmin = probe.outputFiles[0].text;
const hits = [...unmin.matchAll(netRe)].map((m) => m.index);
const banner = unmin.indexOf("// src/ingest-transport.ts");
const nextBanner = banner < 0 ? -1 : unmin.indexOf("\n// src/", banner + 1);
const netLocation = { module: "src/ingest-transport.ts", offsets: hits, inside: false };
if (banner < 0) findings.push("ingest-transport module banner not found in the unminified build");
else {
  const end = nextBanner < 0 ? unmin.length : nextBanner;
  netLocation.inside = hits.length === 1 && hits[0] > banner && hits[0] < end;
  if (!netLocation.inside) findings.push(`requestUrl is not confined to src/ingest-transport.ts (offsets ${hits.join(", ")}; module spans ${banner}-${end})`);
}
// URLs: only RDF/OWL namespace IRIs (identifiers, never dereferenced) are allowed.
const allowedUrl = /^https?:\/\/(www\.w3\.org\/|purl\.org\/dc\/|xmlns\.com\/foaf\/)/;
const urls = new Set(src.match(/https?:\/\/[^\s"'`\\)<>]+/g) ?? []);
for (const u of urls) if (!allowedUrl.test(u)) findings.push(`URL literal: ${u}`);
// The engine must be embedded: wasm magic in an inlined base64 string.
const wasmMagicB64 = "AGFzbQ"; // base64 of \0asm
const embedded = src.includes(wasmMagicB64);
if (!embedded) findings.push("embedded wasm not found");
const workerEmbedded = src.includes("classify_start");
if (!workerEmbedded) findings.push("embedded worker source not found");

console.log(JSON.stringify({ file, bytes: statSync(file).size, urls: [...urls].sort(), request_url: { in_bundle: netHits, ...netLocation }, embedded_wasm: embedded, embedded_worker: workerEmbedded, findings }, null, 2));
process.exit(findings.length ? 1 : 0);
