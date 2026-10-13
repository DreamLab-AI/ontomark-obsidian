// Worker entry. Instantiates the engine synchronously from the bytes the host
// transferred (never by URL) and runs the shared message loop.
//
// `src/generated/` is fetched by the build from the pinned engine release and
// is not tracked, except the glue's type declaration, which is, so that the
// types here are real for anyone reading the repository without a build.
import { initSync, WasmEngine } from "./generated/web/ontomark_wasm";
import type { HostToWorker, WorkerToHost } from "./protocol";
import { createWorkerCore } from "./worker-core";

declare const self: {
  postMessage(msg: WorkerToHost): void;
  onmessage: ((ev: { data: HostToWorker }) => void) | null;
};

const onMessage = createWorkerCore((msg) => self.postMessage(msg), {
  makeEngine: (wasm) => {
    initSync({ module: wasm });
    return new WasmEngine();
  },
});
self.onmessage = (ev) => onMessage(ev.data);
