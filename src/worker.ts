// Worker entry. Instantiates the engine synchronously from the bytes the host
// transferred (never by URL) and runs the shared message loop.
import type { InitOutput, SyncInitInput } from "./generated/web/ontomark_wasm";
import * as glue from "./generated/web/ontomark_wasm";

const initSync: (module: { module: SyncInitInput }) => InitOutput = glue.initSync;
const WasmEngine: typeof glue.WasmEngine = glue.WasmEngine;
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
