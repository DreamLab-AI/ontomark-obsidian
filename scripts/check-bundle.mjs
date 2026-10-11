// Static EXP-11 check of the built plugin: no network-capable API, no
// URL-based wasm loading, and the engine is embedded. Exit 1 on any finding.
import { readFileSync, statSync } from "node:fs";

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
  ["requestUrl", /\brequestUrl\b/],
  ["node network modules", /require\(\s*["'](?:node:)?(?:https?|net|tls|dns|dgram|http2|child_process)["']\s*\)/],
  ["electron net", /\bnet\.request\b/],
];
const findings = [];
for (const [name, re] of forbidden) {
  const m = re.exec(src);
  if (m) findings.push(`${name} at offset ${m.index}: …${src.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ")}…`);
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

console.log(JSON.stringify({ file, bytes: statSync(file).size, urls: [...urls].sort(), embedded_wasm: embedded, embedded_worker: workerEmbedded, findings }, null, 2));
process.exit(findings.length ? 1 : 0);
