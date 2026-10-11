// Two-pass bundle. Pass 1: the worker (engine glue + worker loop) as an IIFE
// string. Pass 2: main.js with the worker source and the wasm bytes inlined,
// so the installed plugin is main.js + manifest.json + styles.css and loads
// nothing by URL (EXP-11).
import esbuild from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";

const production = process.argv[2] === "production";
mkdirSync("dist", { recursive: true });

const worker = await esbuild.build({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: production,
  legalComments: "none",
  // The glue's async `__wbg_init` (fetch + import.meta.url) is parsed, then
  // tree-shaken: the worker calls only `initSync` with transferred bytes.
  // scripts/check-bundle.mjs proves no fetch/import.meta survives.
  logOverride: { "empty-import-meta": "silent" },
});
const workerSource = worker.outputFiles[0].text;

const inline = {
  name: "ontomark-inline",
  setup(build) {
    build.onResolve({ filter: /^virtual:worker-source$/ }, () => ({ path: "worker-source", namespace: "ontomark" }));
    build.onLoad({ filter: /.*/, namespace: "ontomark" }, () => ({
      contents: `export default ${JSON.stringify(workerSource)};`,
      loader: "js",
    }));
  },
};

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/main.js",
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  loader: { ".wasm": "binary" },
  plugins: [inline],
  minify: production,
  sourcemap: production ? false : "inline",
  legalComments: "none",
  logLevel: "info",
});
copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("styles.css", "dist/styles.css");
