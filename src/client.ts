// Host-side client for the engine worker.
//
// Owns the generation counter and worker epoch (see guard.ts), a mirror of the
// files last sent (so a respawned worker is replayed to exactly the state the
// host believes current), per-request timeouts and the respawn path. Results
// that fail the guard are rejected with an OntomarkError instead of being
// returned, so callers never render stale data.

import { GenerationGuard } from "./guard";
import {
  MUTATIONS,
  type ClassifyDone,
  type DatasetSelection,
  type DescribeResult,
  type EngineRequest,
  type EngineResponse,
  type FileText,
  type HostToWorker,
  type IndexResult,
  type IngestAcceptResult,
  type IngestAcceptWire,
  type IngestPlanResult,
  type ModelRequest,
  type ModelResponse,
  type PatchOp,
  type PatchProposal,
  type ProfileId,
  type QueryResult,
  type WorkerLike,
  type WorkerToHost,
} from "./protocol";

export class OntomarkError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OntomarkError";
  }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ClientOptions {
  /** Create a fresh worker. */
  spawn: () => WorkerLike;
  /** A fresh copy of the wasm bytes (it is transferred to each worker). */
  wasmBytes: () => ArrayBuffer;
  /** Per-kind timeouts in ms; a timeout terminates and respawns the worker. */
  timeouts?: Partial<Record<"default" | "query" | "classify", number>>;
  /** Reasoner work units per classify step. */
  budget?: number;
  onProgress?: (p: { generation: number; steps: number; total: number | null }) => void;
  onRestart?: (reason: string, epoch: number) => void;
  /** Called once when restarts exceed the cap and the client stops respawning. */
  onFailed?: (reason: string) => void;
  /** Most automatic restarts allowed within `restartWindowMs` (default 3 in 60 s). */
  maxRestarts?: number;
  restartWindowMs?: number;
  /** Clock for the restart cap (tests). */
  now?: () => number;
  timers?: Timers;
}

interface Pending {
  kind: string;
  channel: string | null;
  epoch: number;
  read: boolean;
  resolve: (value: unknown) => void;
  reject: (err: OntomarkError) => void;
  timer: unknown;
}

const CLASSIFY_CHANNEL = "classify";

/**
 * The window whose timers we should use. Obsidian's `activeWindow` keeps a
 * popout window's timers on that window; under Node (tests) there is no
 * window, and `globalThis` carries the same functions.
 */
function timerHost(): Pick<Window, "setTimeout" | "clearTimeout"> {
  return typeof activeWindow !== "undefined" ? activeWindow : (globalThis as unknown as Window);
}

const defaultTimers: Timers = {
  set: (fn, ms) => timerHost().setTimeout(fn, ms),
  clear: (h) => timerHost().clearTimeout(h as number),
};

export class OntomarkClient {
  readonly guard = new GenerationGuard();
  private worker: WorkerLike | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private files = new Map<string, string>();
  private profile: ProfileId = "generic";
  private activeClassify: number | null = null;
  private activeClassifyGeneration = -1;
  private activeClassifyPromise: Promise<ClassifyDone> | null = null;
  private disposed = false;
  private failedReason: string | null = null;
  private restarts: number[] = [];
  private readonly timers: Timers;
  private readonly timeouts: Record<"default" | "query" | "classify", number>;

  constructor(private readonly options: ClientOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.timeouts = { default: 30_000, query: 15_000, classify: 120_000, ...options.timeouts };
  }

  get generation(): number {
    return this.guard.generation;
  }

  get epoch(): number {
    return this.guard.epoch;
  }

  get profileId(): ProfileId {
    return this.profile;
  }

  /** Paths currently indexed (the host mirror). */
  get paths(): string[] {
    return [...this.files.keys()].sort();
  }

  /** The text last sent for `path`, if indexed. */
  textOf(path: string): string | undefined {
    return this.files.get(path);
  }

  /** Spawn the worker and load `files` under `profile`. */
  async start(files: FileText[], profile: ProfileId): Promise<void> {
    this.files = new Map(files.map((f) => [f.path, f.text]));
    this.profile = profile;
    this.guard.bump();
    await this.spawnAndLoad();
  }

  /** `true` once restarts exceeded the cap; every request then rejects with `engine_failed`. */
  get failed(): boolean {
    return this.failedReason !== null;
  }

  async upsert(path: string, text: string): Promise<void> {
    this.files.set(path, text);
    await this.mutate((generation) => ({ kind: "upsert", generation, path, text }));
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    await this.mutate((generation) => ({ kind: "remove", generation, path }));
  }

  async rename(from: string, to: string): Promise<void> {
    const text = this.files.get(from);
    this.files.delete(from);
    if (text !== undefined) this.files.set(to, text);
    await this.mutate((generation) => ({ kind: "rename", generation, from, to }));
  }

  async setProfile(profile: ProfileId): Promise<void> {
    this.profile = profile;
    await this.mutate((generation) => ({ kind: "set_profile", generation, profile }));
  }

  /** @param channel consumer channel: a newer request on it supersedes older ones (see guard.ts). */
  index(channel?: string): Promise<IndexResult> {
    return this.send({ kind: "index", generation: this.generation }, channel) as Promise<IndexResult>;
  }

  describe(iri: string): Promise<DescribeResult> {
    return this.send({ kind: "describe", generation: this.generation, iri }) as Promise<DescribeResult>;
  }

  frontmatter(path: string): Promise<unknown> {
    return this.send({ kind: "frontmatter", generation: this.generation, path });
  }

  query(sparql: string, dataset: DatasetSelection = "asserted", limit?: number, channel?: string): Promise<QueryResult> {
    return this.send({ kind: "query", generation: this.generation, sparql, dataset, limit }, channel) as Promise<QueryResult>;
  }

  proposePatch(path: string, baseDigest: string, ops: PatchOp[]): Promise<PatchProposal> {
    return this.send({
      kind: "propose_patch",
      generation: this.generation,
      path,
      base_digest: baseDigest,
      ops,
    }) as Promise<PatchProposal>;
  }

  /** Plan an assisted-ingest request for `path` (a read: the engine never contacts a model). */
  ingestPlan(path: string): Promise<IngestPlanResult> {
    return this.send({ kind: "ingest_plan", generation: this.generation, path }) as Promise<IngestPlanResult>;
  }

  /**
   * Turn the model's `responses` into guarded candidates. The engine's `preview`
   * lacks the fields the host already knows; they are filled in here so
   * `OntomarkApi.applyPatch` can take it unchanged.
   */
  async ingestAccept(path: string, request: ModelRequest, responses: ModelResponse[]): Promise<IngestAcceptResult> {
    const wire = (await this.send({
      kind: "ingest_accept",
      generation: this.generation,
      path,
      request,
      responses,
    })) as IngestAcceptWire;
    const p = wire.preview;
    return {
      path: wire.path,
      candidates: wire.candidates,
      preview: p
        ? {
            path: wire.path,
            base_digest: `sha256:${wire.candidates.digest}`,
            base_text: p.base_text,
            new_text: p.new_text,
            new_digest: p.new_digest,
            diff: p.diff,
            edits: p.edits,
            preserved_bytes: 0, // not reported by ingest_accept
            no_op: p.edits.length === 0,
          }
        : null,
    };
  }

  version(): Promise<unknown> {
    return this.send({ kind: "version" });
  }

  /**
   * Classify the current generation in the worker's stepped loop. A request for
   * the generation already being classified joins that run; a run for an older
   * generation is cancelled (its result could never be accepted anyway).
   */
  classify(): Promise<ClassifyDone> {
    if (this.activeClassify !== null && this.activeClassifyGeneration === this.generation && this.activeClassifyPromise) {
      return this.activeClassifyPromise;
    }
    this.cancelClassify();
    const id = this.nextId++;
    const generation = this.generation;
    this.activeClassify = id;
    this.activeClassifyGeneration = generation;
    const promise = this.dispatch(id, "classify", true, this.timeouts.classify, CLASSIFY_CHANNEL, {
      v: 1,
      epoch: this.epoch,
      id,
      op: "classify",
      generation,
      budget: this.options.budget ?? 20_000,
    }) as Promise<ClassifyDone>;
    this.activeClassifyPromise = promise;
    return promise;
  }

  /** Ask the worker to stop the running classify (cooperative; the guard discards it regardless). */
  cancelClassify(): void {
    if (this.activeClassify !== null && this.worker) {
      this.post({ v: 1, epoch: this.epoch, id: this.nextId++, op: "cancel", target: this.activeClassify });
    }
    this.activeClassify = null;
    this.activeClassifyPromise = null;
  }

  /** Terminate the worker and reject everything outstanding. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.killWorker();
    this.rejectAll("disposed", "the client was disposed");
  }

  /**
   * Terminate and respawn, replaying the mirror at the current generation.
   * More than `maxRestarts` within `restartWindowMs` puts the client in the
   * failed state instead of respawning again (a page that traps the engine
   * every time must not cause an endless respawn loop).
   */
  async restart(reason: string): Promise<void> {
    if (this.disposed || this.failedReason !== null) return;
    this.killWorker();
    this.rejectAll("worker_restarted", `worker restarted: ${reason}`);
    const now = (this.options.now ?? Date.now)();
    const windowMs = this.options.restartWindowMs ?? 60_000;
    this.restarts = this.restarts.filter((t) => now - t < windowMs);
    this.restarts.push(now);
    if (this.restarts.length > (this.options.maxRestarts ?? 3)) {
      this.failedReason = `too many restarts (last: ${reason})`;
      this.options.onFailed?.(this.failedReason);
      return;
    }
    const ready = this.spawnAndLoad();
    this.options.onRestart?.(reason, this.epoch);
    await ready;
  }

  /** Test hook and internal entry point for every worker message. */
  handleMessage(msg: WorkerToHost): void {
    const p = this.pending.get(msg.id);
    if (msg.op === "progress") {
      if (p && msg.epoch === this.epoch && msg.generation === this.generation && this.guard.isLatest(CLASSIFY_CHANNEL, msg.id)) {
        this.options.onProgress?.({ generation: msg.generation, steps: msg.steps, total: msg.total });
      }
      return;
    }
    if (msg.epoch !== this.epoch) return; // dead epoch: never resolves anything
    if (!p || p.epoch !== msg.epoch) return;
    if (msg.op === "fatal") {
      this.finish(msg.id);
      p.reject(new OntomarkError("worker_fatal", msg.message));
      void this.restart(`fatal: ${msg.message}`).catch(() => undefined);
      return;
    }
    this.finish(msg.id);
    const res: EngineResponse = msg.response;
    if (!p.read) {
      if (res.ok) {
        p.resolve(res.result);
      } else {
        p.reject(new OntomarkError(res.error?.code ?? "error", res.error?.message ?? "mutation failed"));
        // The engine and the mirror disagree: rebuild from the mirror.
        if (!this.disposed) void this.restart(`mutation refused: ${res.error?.code}`).catch(() => undefined);
      }
      return;
    }
    if (!res.ok) {
      p.reject(new OntomarkError(res.error?.code ?? "error", res.error?.message ?? "request failed"));
      return;
    }
    const verdict = this.guard.judge(msg.epoch, p.channel, msg.id, res.generation);
    if (verdict.accept) p.resolve(res.result);
    else p.reject(new OntomarkError(verdict.reason === "stale_generation" ? "stale" : verdict.reason, `discarded: ${verdict.reason}`));
  }

  // ---- internals ----

  private snapshot(): FileText[] {
    return [...this.files.entries()].map(([path, text]) => ({ path, text }));
  }

  private async mutate(build: (generation: number) => EngineRequest): Promise<void> {
    const generation = this.guard.bump();
    this.cancelClassify();
    await this.send(build(generation));
  }

  /**
   * Spawn a worker and post `init` and the mirror `load` back to back before
   * awaiting either: the worker handles messages in order, so the replay is in
   * place before any mutation or read posted after this call (EXP-06).
   */
  private spawnAndLoad(): Promise<void> {
    const init = this.spawn();
    const load = this.send({ kind: "load", generation: this.generation, profile: this.profile, files: this.snapshot() });
    return Promise.all([init, load]).then(() => undefined);
  }

  private spawn(): Promise<unknown> {
    if (this.disposed) return Promise.reject(new OntomarkError("disposed", "the client was disposed"));
    const epoch = this.guard.newEpoch();
    const worker = this.options.spawn();
    this.worker = worker;
    worker.onmessage = (ev) => this.handleMessage(ev.data);
    worker.onerror = (ev) => {
      if (this.worker !== worker) return;
      const message = ev instanceof Error ? ev.message : (ev.message ?? "worker error");
      void this.restart(`worker error: ${message}`).catch(() => undefined);
    };
    const id = this.nextId++;
    const wasm = this.options.wasmBytes();
    return this.dispatch(id, "init", false, this.timeouts.default, null, { v: 1, epoch, id, op: "init", wasm }, [wasm]);
  }

  private send(request: EngineRequest, channel?: string): Promise<unknown> {
    const id = this.nextId++;
    const read = !MUTATIONS.has(request.kind) && request.kind !== "version";
    const timeout = request.kind === "query" ? this.timeouts.query : this.timeouts.default;
    return this.dispatch(id, request.kind, read, timeout, read ? (channel ?? null) : null, {
      v: 1,
      epoch: this.epoch,
      id,
      op: "engine",
      request,
    });
  }

  /** Track a request and post it; a post failure rejects that request instead of throwing. */
  private dispatch(
    id: number,
    kind: string,
    read: boolean,
    timeoutMs: number,
    channel: string | null,
    msg: HostToWorker,
    transfer?: Transferable[],
  ): Promise<unknown> {
    const promise = this.track(id, kind, read, timeoutMs, channel);
    if (this.pending.has(id)) {
      try {
        this.post(msg, transfer);
      } catch (err) {
        const p = this.pending.get(id);
        this.finish(id);
        p?.reject(err instanceof OntomarkError ? err : new OntomarkError("post_failed", String(err)));
      }
    }
    return promise;
  }

  private track(id: number, kind: string, read: boolean, timeoutMs: number, channel: string | null): Promise<unknown> {
    if (this.disposed) return Promise.reject(new OntomarkError("disposed", "the client was disposed"));
    if (this.failedReason !== null) return Promise.reject(new OntomarkError("engine_failed", this.failedReason));
    if (channel !== null) this.guard.issued(channel, id);
    return new Promise((resolve, reject) => {
      const timer = this.timers.set(() => {
        if (!this.pending.has(id)) return;
        this.finish(id);
        reject(new OntomarkError("timeout", `${kind} exceeded ${timeoutMs} ms; worker restarted`));
        void this.restart(`timeout in ${kind}`).catch(() => undefined);
      }, timeoutMs);
      this.pending.set(id, { kind, channel, epoch: this.epoch, read, resolve, reject, timer });
    });
  }

  private finish(id: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.timers.clear(p.timer);
    this.pending.delete(id);
    if (this.activeClassify === id) {
      this.activeClassify = null;
      this.activeClassifyPromise = null;
    }
  }

  private rejectAll(code: string, message: string): void {
    for (const [id, p] of [...this.pending]) {
      this.finish(id);
      p.reject(new OntomarkError(code, message));
    }
    this.activeClassify = null;
    this.activeClassifyPromise = null;
  }

  private killWorker(): void {
    const w = this.worker;
    this.worker = null;
    if (w) {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    }
  }

  private post(msg: HostToWorker, transfer?: Transferable[]): void {
    if (!this.worker) throw new OntomarkError("no_worker", "worker is not running");
    this.worker.postMessage(msg, transfer);
  }
}
