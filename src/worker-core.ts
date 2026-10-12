// The engine worker's message loop, independent of how the worker is hosted.
//
// `classify` runs as a stepped loop: between reasoner steps the loop yields to
// the event loop, so mutations and cancels queued by the host are handled
// before the next step. A mutation advances the engine's generation, which
// makes the next step answer `stale`; a cancel ends the loop at once. Neither
// needs SharedArrayBuffer (EXP-06).

import type { EngineResponse, HostToWorker, WorkerToHost } from "./protocol";

export interface EngineLike {
  handle(request: string): string;
}

export type Post = (message: WorkerToHost) => void;

export interface WorkerCoreOptions {
  /** Instantiate the engine from wasm bytes (synchronously; no fetch). */
  makeEngine: (wasm: ArrayBuffer) => EngineLike;
  /** Yield to the event loop between classify steps. */
  yieldNow?: () => Promise<void>;
}

const defaultYield = (): Promise<void> => new Promise((resolve) => self.setTimeout(resolve, 0));

export function createWorkerCore(post: Post, options: WorkerCoreOptions): (msg: HostToWorker) => void {
  const yieldNow = options.yieldNow ?? defaultYield;
  let engine: EngineLike | null = null;
  let epoch = 0;
  const cancelled = new Set<number>();
  let dead = false;

  const call = (request: object): EngineResponse => {
    if (!engine) throw new Error("engine not initialised");
    return JSON.parse(engine.handle(JSON.stringify(request))) as EngineResponse;
  };

  const reply = (id: number, response: EngineResponse): void => {
    post({ v: 1, epoch, id, op: "reply", response });
  };

  const fatal = (id: number, err: unknown): void => {
    // A wasm trap leaves the instance in an undefined state: refuse further work
    // and let the host respawn and replay.
    dead = true;
    post({ v: 1, epoch, id, op: "fatal", message: err instanceof Error ? err.message : String(err) });
  };

  const classify = async (id: number, generation: number, budget: number): Promise<void> => {
    try {
      let res = call({ kind: "classify_start", generation, budget });
      for (;;) {
        const result = res.result as { status?: string; steps?: number; total?: number | null } | undefined;
        if (!res.ok || result?.status === "done") {
          reply(id, res);
          return;
        }
        post({ v: 1, epoch, id, op: "progress", generation, steps: result?.steps ?? 0, total: result?.total ?? null });
        await yieldNow();
        if (dead) return;
        if (cancelled.has(id)) {
          cancelled.delete(id);
          reply(id, { ok: false, generation, error: { code: "cancelled", message: "classification cancelled by the host" } });
          return;
        }
        res = call({ kind: "classify_step", generation, budget });
      }
    } catch (err) {
      fatal(id, err);
    }
  };

  return (msg: HostToWorker): void => {
    if (msg.v !== 1) return;
    if (dead) return;
    if (msg.op === "init") {
      try {
        engine = options.makeEngine(msg.wasm);
        epoch = msg.epoch;
        reply(msg.id, { ok: true, generation: 0, result: { epoch } });
      } catch (err) {
        epoch = msg.epoch;
        fatal(msg.id, err);
      }
      return;
    }
    if (msg.epoch !== epoch) return;
    switch (msg.op) {
      case "engine":
        try {
          reply(msg.id, call(msg.request));
        } catch (err) {
          fatal(msg.id, err);
        }
        return;
      case "cancel":
        cancelled.add(msg.target);
        return;
      case "classify":
        void classify(msg.id, msg.generation, msg.budget);
        return;
    }
  };
}
