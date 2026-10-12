// EXP-06 acceptance: a worker result is applied only if it belongs to the
// current source. Runs the real client, the real worker loop and the real
// engine; only the Worker transport is in-process.
import { describe, expect, it } from "vitest";
import { OntomarkClient, OntomarkError } from "../src/client";
import type { WorkerToHost } from "../src/protocol";
import { InProcWorker, chainVault, readVault, tick, wasmGlue } from "./helpers";

/** Node timers for the client under test; production uses the active window's. */
const nodeTimers = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clear: (h: number) => clearTimeout(h as unknown as NodeJS.Timeout),
};

function setup(opts: { budget?: number; timeouts?: Record<string, number> } = {}) {
  const workers: InProcWorker[] = [];
  const restarts: string[] = [];
  const progress: number[] = [];
  const client = new OntomarkClient({
    timers: nodeTimers,
    spawn: () => {
      const w = new InProcWorker();
      workers.push(w);
      return w;
    },
    wasmBytes: () => new ArrayBuffer(8),
    budget: opts.budget ?? 1,
    timeouts: opts.timeouts,
    onRestart: (reason) => restarts.push(reason),
    onProgress: (p) => progress.push(p.steps),
  });
  return { client, workers, restarts, progress };
}

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof OntomarkError ? e.code : `non-ontomark: ${String(e)}`;
  }
};

describe("OntomarkClient generation guard (EXP-06)", () => {
  it("indexes, classifies and queries the fixture vault", async () => {
    const { client } = setup({ budget: 256 });
    await client.start(readVault(), "generic");
    const index = await client.index();
    expect(index.entities).toHaveLength(10);
    const done = await client.classify();
    expect(done.classification.unsatisfiable).toEqual(["urn:ontomark:page:Ontology/Catdog"]);
    const q = await client.query("ASK { ?s <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?o }", "inferred");
    expect(q).toEqual({ form: "ask", boolean: true });
    client.dispose();
  });

  it("an edit during classification discards the old run and the new generation classifies cleanly", async () => {
    const { client, progress } = setup({ budget: 500 });
    await client.start(chainVault(400), "generic");
    const first = client.classify();
    while (progress.length < 3) await tick(1); // the run is demonstrably in flight
    expect(progress.length).toBeGreaterThanOrEqual(3);
    await client.upsert("C399.md", "---\ntype: class\n---\nDetached from the chain.\n");
    expect(["stale", "cancelled"]).toContain(await code(first));
    const second = await client.classify();
    const supsOf399 = second.classification.subsumptions.filter((s) => s.sub.endsWith("C399"));
    expect(supsOf399).toEqual([]); // reflects the edit, not the old source
    client.dispose();
  });

  it("a delete during classification: the deleted page's entities never reappear", async () => {
    const { client } = setup({ budget: 500 });
    await client.start(chainVault(300), "generic");
    const first = client.classify();
    await tick(3);
    await client.remove("C150.md");
    expect(["stale", "cancelled"]).toContain(await code(first));
    const index = await client.index();
    expect(index.entities.some((e) => e.path === "C150.md")).toBe(false);
    const done = await client.classify();
    expect(done.classification.subsumptions.some((s) => s.sub.endsWith("C150") || s.sup.endsWith("C150"))).toBe(false);
    client.dispose();
  });

  it("kill and respawn during classify, then a late old-epoch result is rejected", async () => {
    const { client, workers, restarts } = setup({ budget: 500 });
    await client.start(chainVault(300), "generic");
    const oldEpoch = client.epoch;
    const first = code(client.classify());
    await tick(3);
    await client.restart("test kill");
    expect(await first).toBe("worker_restarted");
    expect(client.epoch).toBe(oldEpoch + 1);
    expect(workers[0].terminated).toBe(true);
    expect(restarts).toEqual(["test kill"]);
    // The replayed worker has the same state at the same generation.
    const index = await client.index();
    expect(index.entities).toHaveLength(300);
    // Forge a late reply from the dead epoch that answers a live request id.
    const live = client.index();
    const liveId = Math.max(...workers[1].sent.map((m) => m.id));
    const forged: WorkerToHost = {
      v: 1,
      epoch: oldEpoch,
      id: liveId,
      op: "reply",
      response: { ok: true, generation: client.generation, result: { forged: true } },
    };
    client.handleMessage(forged);
    const real = await live;
    expect((real as unknown as { forged?: boolean }).forged).toBeUndefined();
    expect(real.entities).toHaveLength(300);
    client.dispose();
  });

  it("out-of-order replies on one channel: the older query is superseded; other callers unaffected", async () => {
    const { client, workers } = setup();
    await client.start(readVault(), "generic");
    const w = workers[0];
    // Hold the worker's replies so we can deliver them in reverse order.
    const held: WorkerToHost[] = [];
    const deliver = w.onmessage!;
    w.onmessage = (ev) => held.push(ev.data);
    const older = client.query("SELECT * WHERE { ?s ?p ?o } LIMIT 1", "asserted", undefined, "view");
    const newer = client.query("SELECT * WHERE { ?s ?p ?o } LIMIT 2", "asserted", undefined, "view");
    const independent = client.index();
    while (held.length < 3) await tick(1);
    deliver({ data: held[2] });
    deliver({ data: held[1] });
    deliver({ data: held[0] });
    expect(await code(newer)).toBe("resolved");
    expect(await code(older)).toBe("superseded");
    expect(await code(independent)).toBe("resolved");
    client.dispose();
  });

  it("a read sent before a mutation but answered after it is stale, never applied", async () => {
    const { client, workers } = setup();
    await client.start(readVault(), "generic");
    const w = workers[0];
    const held: WorkerToHost[] = [];
    const deliver = w.onmessage!;
    w.onmessage = (ev) => held.push(ev.data);
    const read = client.index();
    while (held.length < 1) await tick(1);
    w.onmessage = deliver;
    await client.upsert("Welcome.md", "Edited.\n");
    deliver({ data: held[0] }); // computed at the old generation
    expect(await code(read)).toBe("stale");
    client.dispose();
  });

  it("a timeout terminates the worker, rejects with timeout and replays state", async () => {
    const workers: InProcWorker[] = [];
    const client = new OntomarkClient({
      timers: nodeTimers,
      timers: nodeTimers,
      spawn: () => {
        const w = new InProcWorker();
        // The first worker never answers queries: a runaway evaluation.
        if (workers.length === 0) w.stuckOn = (m) => m.op === "engine" && m.request.kind === "query";
        workers.push(w);
        return w;
      },
      wasmBytes: () => new ArrayBuffer(8),
      timeouts: { query: 50 },
    });
    const restarted = new Promise<void>((resolve) => {
      const orig = client.restart.bind(client);
      client.restart = async (reason: string) => {
        await orig(reason);
        resolve();
      };
    });
    await client.start(readVault(), "generic");
    const slow = client.query("SELECT * WHERE { ?s ?p ?o }");
    expect(await code(slow)).toBe("timeout");
    await restarted;
    expect(workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    // The replacement was replayed to the same generation and answers normally.
    const index = await client.index();
    expect(index.entities).toHaveLength(10);
    const q = await client.query("ASK { ?s ?p ?o }");
    expect(q).toEqual({ form: "ask", boolean: true });
    client.dispose();
  });

  it("two classify requests for the same generation share one run (no self-cancellation)", async () => {
    const { client, workers } = setup({ budget: 500 });
    await client.start(chainVault(200), "generic");
    const a = client.classify();
    const b = client.classify();
    expect(b).toBe(a);
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb).toBe(ra);
    expect(workers[0].sent.filter((m) => m.op === "classify")).toHaveLength(1);
    expect(workers[0].sent.filter((m) => m.op === "cancel")).toHaveLength(0);
    client.dispose();
  });

  it("a mutation issued while a restart is in progress lands after the replay (no empty-engine window)", async () => {
    const { client } = setup();
    await client.start(readVault(), "generic");
    // Nothing is awaited until all three are posted, as a burst of vault
    // events would do: the read must not be answered by an engine that has
    // seen the mutation but not yet the replay.
    const restarting = client.restart("race probe");
    const mutated = client.upsert("New page.md", "---\ntype: class\n---\n");
    const indexed = client.index();
    const [index] = await Promise.all([indexed, mutated, restarting]);
    expect(index.documents).toBe(readVault().length + 1);
    expect(index.entities).toHaveLength(11);
    client.dispose();
  });

  it("restarts are capped: an engine that traps every time ends in engine_failed, not a respawn loop", async () => {
    const spawned: InProcWorker[] = [];
    let clock = 0;
    const failures: string[] = [];
    const client = new OntomarkClient({
      timers: nodeTimers,
      timers: nodeTimers,
      spawn: () => {
        const w = new InProcWorker(() => {
          const inner = new wasmGlue.WasmEngine();
          return {
            handle: (r: string) => {
              if (r.includes('"kind":"index"')) throw new Error("RuntimeError: unreachable");
              return inner.handle(r);
            },
          };
        });
        spawned.push(w);
        return w;
      },
      wasmBytes: () => new ArrayBuffer(8),
      now: () => clock,
      maxRestarts: 3,
      onFailed: (r) => failures.push(r),
    });
    await client.start(readVault(), "generic");
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push(await code(client.index()));
      await tick(10);
      clock += 1000;
    }
    expect(codes.slice(0, 4)).toEqual(["worker_fatal", "worker_fatal", "worker_fatal", "worker_fatal"]);
    expect(codes.slice(4)).toEqual(["engine_failed", "engine_failed"]);
    expect(client.failed).toBe(true);
    expect(failures).toHaveLength(1);
    expect(spawned.length).toBe(4); // the first worker plus three restarts
    expect(spawned.every((w) => w.terminated || w === spawned[3])).toBe(true);
    client.dispose();
  });

  it("dispose terminates the worker and rejects pending work; later calls reject", async () => {
    const { client, workers } = setup({ budget: 500 });
    await client.start(chainVault(200), "generic");
    const running = client.classify();
    client.dispose();
    expect(await code(running)).toBe("disposed");
    expect(workers[0].terminated).toBe(true);
    expect(await code(client.index())).toBe("disposed");
  });
});

describe("assisted ingest requests (ADR-OBS-003)", () => {
  const bob = { path: "People/Bob.md", text: "---\ntype: individual\n---\nBob is a person. Bob owns Rex.\n" };

  it("ingestPlan and ingestAccept are reads: answered after a mutation they are stale, never applied", async () => {
    const { client, workers } = setup();
    await client.start([...readVault(), bob], "generic");
    const { request } = await client.ingestPlan(bob.path);
    for (const run of [() => client.ingestPlan(bob.path), () => client.ingestAccept(bob.path, request, [])]) {
      const w = workers[0];
      const held: WorkerToHost[] = [];
      const deliver = w.onmessage!;
      w.onmessage = (ev) => held.push(ev.data);
      const read = run();
      while (held.length < 1) await tick(1);
      w.onmessage = deliver;
      await client.upsert("Welcome.md", `Edited ${held.length} ${Math.random()}.\n`);
      deliver({ data: held[0] }); // computed at the old generation
      expect(await code(read)).toBe("stale");
    }
    client.dispose();
  });

  it("plan, accept and apply: the preview is a full PatchProposal and withheld reasons keep the engine's tag", async () => {
    const { client } = setup({ budget: 256 });
    await client.start([...readVault(), bob], "generic");
    const { request, digest } = await client.ingestPlan(bob.path);
    expect(request.contract).toBe("ontomark-ingest/facts/1");
    expect(digest.startsWith("sha256:")).toBe(true);
    const responses = [
      {
        chunk: request.chunks[0].index,
        assertions: [
          { key: "instance-of", value: "Person", evidence: "Bob is a person" },
          { key: "no-such-key", value: "x", evidence: "Bob" },
        ],
      },
    ];
    const result = await client.ingestAccept(bob.path, request, responses);
    expect(result.candidates.accepted.map((a) => a.written)).toEqual(["[[Person]]"]);
    expect(result.candidates.accepted[0].evidence[0].quote).toBe("Bob is a person");
    expect(result.candidates.withheld[0].reason.reason).toBe("unknown_key");
    expect(result.candidates.withheld[0].evidence).toBeNull();
    const p = result.preview!;
    expect(p.path).toBe(bob.path);
    expect(p.base_text).toBe(bob.text);
    expect(p.no_op).toBe(false);
    expect(p.new_text).toContain("instance-of:");
    // Applied for real, the same ask again grounds nothing new and writes no patch.
    await client.upsert(bob.path, p.new_text);
    const again = await client.ingestAccept(bob.path, (await client.ingestPlan(bob.path)).request, responses);
    expect(again.candidates.accepted).toEqual([]);
    expect(again.candidates.withheld.find((w) => w.key === "instance-of")?.reason.reason).toBe("already_present");
    expect(again.preview).toBeNull();
    client.dispose();
  });
});
