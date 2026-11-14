// The renderer/layout sequencing used by the graph view, with the real shared
// driver (`createLayout`), a fake simulation and a manual scheduler. No
// Obsidian and no WebAssembly: what is under test is the order of calls, the
// agreement of node counts between renderer and layout, teardown, and the
// fallback when the engine is missing or fails.
import { describe, expect, it, vi } from "vitest";
import type { GraphData, GraphNode } from "@dreamlab-ai/ontomark-graph";
import type { LayoutEngine, LayoutInput } from "@dreamlab-ai/ontomark-graph/layout";
import { GraphLayoutController, LAYOUT_UNAVAILABLE } from "../src/graph-layout";
import type { LayoutRenderer } from "../src/graph-layout";

const ring = (n: number, prefix = "n"): GraphData => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, label: `${prefix}${i}` })),
  edges: Array.from({ length: n }, (_, i) => ({ source: `${prefix}${i}`, target: `${prefix}${(i + 1) % n}` })),
});
const subset = (g: GraphData, ids: string[]): GraphData => ({
  nodes: g.nodes.filter((n) => ids.includes(n.id)),
  edges: g.edges.filter((e) => ids.includes(e.source) && ids.includes(e.target)),
});

/** A simulation that settles after `settleAfter` ticks and records everything it is asked. */
function fakeEngine(options: { settleAfter?: number; throwOnTick?: boolean; log?: string[] } = {}) {
  const { settleAfter = 3, throwOnTick = false, log = [] } = options;
  const state = { loads: [] as LayoutInput[], pins: [] as [number, number, number][], unpins: [] as number[], disposed: 0, ticks: 0, count: 0 };
  const engine: LayoutEngine = {
    load(input) {
      state.loads.push(input);
      state.count = input.count;
      state.ticks = 0;
      log.push(`engine.load(${input.count})`);
    },
    tick() {
      if (throwOnTick) throw new Error("simulation trapped");
      state.ticks++;
    },
    finished: () => state.ticks >= settleAfter,
    read(out) {
      for (let i = 0; i < state.count; i++) {
        out[2 * i] = i * 10 + state.ticks;
        out[2 * i + 1] = -i * 10;
      }
    },
    pin(i, x, y) {
      state.pins.push([i, x, y]);
      return true;
    },
    unpin(i) {
      state.unpins.push(i);
      return true;
    },
    reheat() {
      state.ticks = 0;
    },
    dispose() {
      state.disposed++;
      log.push("engine.dispose");
    },
  };
  return { engine, state };
}

/** A renderer that, like the real one, refuses positions that do not match the graph it shows. */
function fakeRenderer(log: string[] = []) {
  const state = { nodes: 0, setGraphs: [] as { graph: GraphData; options: unknown }[], positions: 0, fits: 0, throwOnPositions: false };
  const renderer: LayoutRenderer = {
    setGraph(graph, options) {
      state.nodes = graph.nodes.length;
      state.setGraphs.push({ graph, options });
      log.push(`renderer.setGraph(${graph.nodes.length})`);
    },
    setPositions(xy) {
      if (state.throwOnPositions) throw new Error("renderer rejected positions");
      if (xy.length !== 2 * state.nodes) throw new Error(`setPositions length ${xy.length} for ${state.nodes} nodes`);
      state.positions++;
    },
    fit() {
      state.fits++;
    },
  };
  return { renderer, state };
}

/** A scheduler the test advances by hand; `frames()` runs everything queued, including what that schedules. */
function manualClock() {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    layoutOptions: {
      schedule: (fn: () => void) => {
        const h = next++;
        queue.set(h, fn);
        return h;
      },
      cancel: (h: number) => void queue.delete(h),
      now: () => 0,
    },
    frames(limit = 50) {
      for (let i = 0; i < limit && queue.size; i++) {
        const [h, fn] = [...queue][0]!;
        queue.delete(h);
        fn();
      }
    },
    pending: () => queue.size,
  };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const node = (id: string): GraphNode => ({ id, label: id });

function rig(engineOptions: Parameters<typeof fakeEngine>[0] = {}, log: string[] = []) {
  const clock = manualClock();
  const eng = fakeEngine({ ...engineOptions, log });
  const rend = fakeRenderer(log);
  const unavailable: string[] = [];
  const loadEngine = vi.fn(async () => eng.engine);
  const controller = new GraphLayoutController({ loadEngine, onUnavailable: (m) => unavailable.push(m), layoutOptions: clock.layoutOptions });
  /** What the view does on its first graph: mount the renderer with it, then bind. */
  const start = (graph: GraphData) => {
    rend.renderer.setGraph(graph);
    controller.bind(rend.renderer, graph);
  };
  return { clock, eng, rend, unavailable, loadEngine, controller, log, start };
}

describe("graph layout controller", () => {
  it("loads the engine on the first bind only, never on construction", async () => {
    const r = rig();
    expect(r.loadEngine).not.toHaveBeenCalled();
    const g = ring(6);
    r.start(g);
    r.start(g);
    await flush();
    expect(r.loadEngine).toHaveBeenCalledTimes(1);
  });

  it("lays out the graph the renderer shows and feeds it positions of the right length", async () => {
    const r = rig();
    const g = ring(6);
    r.start(g);
    await flush();
    expect(r.eng.state.loads.map((l) => l.count)).toEqual([6]);
    r.clock.frames();
    expect(r.rend.state.positions).toBeGreaterThan(0);
    expect(r.unavailable).toEqual([]);
  });

  it("show: renderer first, then the layout, with the same graph, keeping positions", async () => {
    const log: string[] = [];
    const r = rig({}, log);
    const full = ring(8);
    r.start(full);
    await flush();
    r.clock.frames();
    log.length = 0;
    const near = subset(full, ["n0", "n1", "n2"]);
    r.controller.show(near);
    expect(log).toEqual(["renderer.setGraph(3)", "engine.load(3)"]);
    expect(r.rend.state.setGraphs.at(-1)!.options).toEqual({ preserveViewport: false, preservePositions: true });
    r.clock.frames();
    r.controller.show(full, { preserveViewport: true });
    expect(log.slice(-2)).toEqual(["renderer.setGraph(8)", "engine.load(8)"]);
    expect(r.rend.state.setGraphs.at(-1)!.options).toEqual({ preserveViewport: true, preservePositions: true });
    // No snapshot ever reached the renderer with the wrong length: nothing failed.
    r.clock.frames();
    expect(r.unavailable).toEqual([]);
  });

  it("an engine that arrives late lays out the graph shown now, not the one shown at bind", async () => {
    const clock = manualClock();
    const eng = fakeEngine();
    const rend = fakeRenderer();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const controller = new GraphLayoutController({ loadEngine: async () => (await gate, eng.engine), layoutOptions: clock.layoutOptions });
    const full = ring(7);
    rend.renderer.setGraph(full);
    controller.bind(rend.renderer, full);
    controller.show(subset(full, ["n0", "n1", "n2", "n3"]));
    release();
    await flush();
    expect(eng.state.loads.map((l) => l.count)).toEqual([4]);
    clock.frames();
    expect(rend.state.positions).toBeGreaterThan(0);
  });

  it("destroy stops the layout (disposing the engine) and later calls do nothing", async () => {
    const log: string[] = [];
    const r = rig({}, log);
    const g = ring(5);
    r.start(g);
    await flush();
    r.controller.destroy();
    expect(r.eng.state.disposed).toBe(1);
    expect(r.clock.pending()).toBe(0);
    const before = log.length;
    r.controller.show(ring(3));
    r.controller.dragStart(node("n0"), { x: 1, y: 2 });
    r.controller.drag(node("n0"), { x: 1, y: 2 });
    r.controller.dragEnd(node("n0"));
    r.controller.destroy();
    expect(log.length).toBe(before);
    expect(r.eng.state.disposed).toBe(1);
  });

  it("an engine that finishes loading after destroy is disposed and never used", async () => {
    const clock = manualClock();
    const eng = fakeEngine();
    const rend = fakeRenderer();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const makeLayout = vi.fn();
    const controller = new GraphLayoutController({ loadEngine: async () => (await gate, eng.engine), makeLayout, layoutOptions: clock.layoutOptions });
    controller.bind(rend.renderer, ring(5));
    controller.destroy();
    release();
    await flush();
    expect(eng.state.disposed).toBe(1);
    expect(makeLayout).not.toHaveBeenCalled();
    expect(eng.state.loads).toEqual([]);
    expect(rend.state.positions).toBe(0);
  });

  it("an engine load that fails after destroy is silent", async () => {
    const unavailable: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let fail!: (e: Error) => void;
    const controller = new GraphLayoutController({ loadEngine: () => new Promise((_, reject) => (fail = reject)), onUnavailable: (m) => unavailable.push(m) });
    controller.bind(fakeRenderer().renderer, ring(3));
    controller.destroy();
    fail(new Error("compile failed"));
    await flush();
    expect(unavailable).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a failed engine load leaves the renderer working and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unavailable: string[] = [];
    const rend = fakeRenderer();
    const controller = new GraphLayoutController({ loadEngine: async () => { throw new Error("WebAssembly is disabled"); }, onUnavailable: (m) => unavailable.push(m) });
    const g = ring(4);
    controller.bind(rend.renderer, g);
    await flush();
    controller.show(subset(g, ["n0", "n1"]));
    controller.show(g, { preserveViewport: true });
    controller.dragStart(node("n0"), { x: 0, y: 0 });
    controller.dragEnd(node("n0"));
    expect(unavailable).toEqual([LAYOUT_UNAVAILABLE]);
    expect(rend.state.setGraphs).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a synchronous throw from loadEngine falls back the same way", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unavailable: string[] = [];
    const controller = new GraphLayoutController({ loadEngine: () => { throw new Error("no WebAssembly"); }, onUnavailable: (m) => unavailable.push(m) });
    expect(() => controller.bind(fakeRenderer().renderer, ring(3))).not.toThrow();
    expect(unavailable).toEqual([LAYOUT_UNAVAILABLE]);
    warn.mockRestore();
  });

  it("a simulation that throws mid-run stops the layout, disposes it and keeps the view", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = rig({ throwOnTick: true });
    const g = ring(5);
    r.start(g);
    await flush();
    r.clock.frames();
    expect(r.unavailable).toEqual([LAYOUT_UNAVAILABLE]);
    expect(r.eng.state.disposed).toBe(1);
    expect(() => r.controller.show(subset(g, ["n0", "n1"]))).not.toThrow();
    expect(r.rend.state.nodes).toBe(2);
    expect(r.eng.state.loads).toHaveLength(1);
    warn.mockRestore();
  });

  it("a renderer that rejects the positions degrades instead of looping", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = rig();
    r.rend.state.throwOnPositions = true;
    r.start(ring(5));
    await flush();
    r.clock.frames();
    expect(r.unavailable).toEqual([LAYOUT_UNAVAILABLE]);
    expect(r.clock.pending()).toBe(0);
    warn.mockRestore();
  });

  it("a graph the driver rejects degrades without throwing out of show", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = rig();
    const g = ring(3);
    r.start(g);
    await flush();
    const bad: GraphData = { nodes: [node("a"), node("a")], edges: [] };
    expect(() => r.controller.show(bad)).not.toThrow();
    expect(r.unavailable).toEqual([LAYOUT_UNAVAILABLE]);
    warn.mockRestore();
  });

  it("pins the dragged node at the pointer and releases it", async () => {
    const r = rig({ settleAfter: 100 });
    const g = ring(5);
    r.start(g);
    await flush();
    r.clock.frames(2);
    r.controller.dragStart(node("n3"), { x: 12, y: -4 });
    r.controller.drag(node("n3"), { x: 15, y: -6 });
    r.controller.dragEnd(node("n3"));
    expect(r.eng.state.pins).toEqual([[3, 12, -4], [3, 15, -6]]);
    expect(r.eng.state.unpins).toEqual([3]);
  });

  it("fits the view while the layout settles, until the reader interacts", async () => {
    const r = rig({ settleAfter: 1000 });
    r.start(ring(5));
    await flush();
    r.clock.frames(3);
    const fitting = r.rend.state.fits;
    expect(fitting).toBeGreaterThan(0);
    r.controller.interacted();
    r.clock.frames(3);
    expect(r.rend.state.fits).toBe(fitting);
    // A new viewport (not a preserved one) resumes fitting; a preserved one does not.
    r.controller.show(ring(5, "m"), { preserveViewport: true });
    r.clock.frames(2);
    expect(r.rend.state.fits).toBe(fitting);
    r.controller.show(ring(5, "k"));
    r.clock.frames(2);
    expect(r.rend.state.fits).toBeGreaterThan(fitting);
  });

  it("stops fitting once the layout settles", async () => {
    const r = rig({ settleAfter: 2 });
    r.start(ring(5));
    await flush();
    r.clock.frames();
    const fits = r.rend.state.fits;
    r.controller.show(ring(5), { preserveViewport: true });
    r.clock.frames();
    expect(r.rend.state.fits).toBe(fits);
  });
});
