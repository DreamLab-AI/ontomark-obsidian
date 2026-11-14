// The force-layout engine for the graph view: the vowl-wasm simulation, with its
// WebAssembly bytes embedded in main.js by esbuild's binary loader, so nothing
// is fetched at run time. Only the graph view imports this module, and only
// through a dynamic import when the view first has a graph to lay out, so a
// user who never opens the graph neither decodes nor compiles the bytes.
//
// Three choices keep the bundle free of URL loading (scripts/check-bundle.mjs
// proves it): the module is compiled here from bytes the plugin holds, glue is
// initialised with `initSync`, and only the named exports are imported, so the
// glue's default initialiser (`fetch` and `import.meta.url`) is tree-shaken.
import { encodeNgg1, initSync, ngg1Constants, NggExplorer } from "@dreamlab-ai/vowl-wasm";
import wasmBytes from "@dreamlab-ai/vowl-wasm/vowl_wasm_bg.wasm";
import { vowlEngine } from "@dreamlab-ai/ontomark-graph/layout";
import type { LayoutEngine } from "@dreamlab-ai/ontomark-graph/layout";

let compiled: Promise<WebAssembly.Module> | null = null;

/** Compile the embedded module and return a fresh simulation. Rejects if WebAssembly is unavailable or compilation fails. */
export async function loadVowlEngine(): Promise<LayoutEngine> {
  // One compilation serves every graph view; a failure is not cached, so the next view retries.
  compiled ??= WebAssembly.compile(wasmBytes.slice()).catch((error: unknown) => {
    compiled = null;
    throw error;
  });
  const module = await compiled;
  initSync({ module }); // returns at once when an earlier call already initialised the glue
  return vowlEngine({ NggExplorer, encodeNgg1, ngg1Constants });
}
