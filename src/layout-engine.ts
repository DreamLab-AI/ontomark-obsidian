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
//
// `version` must travel with the simulation: ontomark-graph reads it to decide
// which `setParam` keys the bundle has, and without it the vowl-wasm 0.4.0
// collision and component-gravity settings would be ignored.
import { encodeNgg1, initSync, ngg1Constants, NggExplorer, version } from "@dreamlab-ai/vowl-wasm";
import wasmBytes from "@dreamlab-ai/vowl-wasm/vowl_wasm_bg.wasm";
import { vowlEngine } from "@dreamlab-ai/ontomark-graph/layout";
import type { VowlLayoutEngine } from "@dreamlab-ai/ontomark-graph/layout";

/** The parts of the glue that `vowlEngine` uses, `version` included. Usable once the glue is initialised. */
export const vowlModule = { NggExplorer, encodeNgg1, ngg1Constants, version };

let compiled: Promise<WebAssembly.Module> | null = null;

/** Compile the embedded module and return a fresh simulation. Rejects if WebAssembly is unavailable or compilation fails. */
export async function loadVowlEngine(): Promise<VowlLayoutEngine> {
  // One compilation serves every graph view; a failure is not cached, so the next view retries.
  compiled ??= WebAssembly.compile(wasmBytes.slice()).catch((error: unknown) => {
    compiled = null;
    throw error;
  });
  const module = await compiled;
  initSync({ module }); // returns at once when an earlier call already initialised the glue
  return vowlEngine(vowlModule);
}
