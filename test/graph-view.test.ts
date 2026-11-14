// The graph view's use of the layout, at every place it changes the graph the
// renderer shows: first mount, refresh, Neighbourhood, All nodes and the entity
// list. The renderer is a double that, like the real one, throws when
// `setPositions` does not match the graph it holds; the engine is a fake
// simulation behind the real shared driver. The Obsidian API is the offline
// e2e's shim. Real Obsidian and the real WebAssembly engine are not involved.
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => createRequire(import.meta.url)("./e2e/obsidian-shim.cjs"));

const h = vi.hoisted(() => {
  const log: string[] = [];
  const state = {
    options: null as null | Record<string, (...a: any[]) => void>,
    graph: { nodes: [] as { id: string }[], edges: [] as unknown[] },
    setGraphs: [] as { nodes: number; options: unknown }[],
    positions: 0,
    destroyed: 0,
    mounts: 0,
    loads: [] as number[],
    pins: [] as unknown[],
    unpins: 0,
    disposed: 0,
    engineRequests: 0,
    failEngine: false,
    gate: null as null | Promise<void>,
  };
  return { log, state };
});

vi.mock("@dreamlab-ai/ontomark-graph", async (importActual) => {
  const actual = await importActual<typeof import("@dreamlab-ai/ontomark-graph")>();
  return {
    ...actual,
    mountGraph: (_el: unknown, graph: typeof h.state.graph, options: Record<string, (...a: any[]) => void>) => {
      h.state.mounts++;
      h.state.options = options;
      h.state.graph = graph;
      h.log.push(`mount(${graph.nodes.length})`);
      return {
        setGraph(next: typeof h.state.graph, o: unknown) {
          h.state.graph = next;
          h.state.setGraphs.push({ nodes: next.nodes.length, options: o });
          h.log.push(`renderer.setGraph(${next.nodes.length})`);
        },
        setPositions(xy: Float32Array) {
          if (xy.length !== 2 * h.state.graph.nodes.length) throw new Error(`setPositions ${xy.length} for ${h.state.graph.nodes.length}`);
          h.state.positions++;
        },
        setSelection() {},
        setOptions() {},
        fit() {},
        zoomBy() {},
        getState: () => ({ selected: null, zoom: 1, nodes: h.state.graph.nodes.length, edges: 0 }),
        destroy() {
          h.state.destroyed++;
          h.log.push("renderer.destroy");
        },
      };
    },
  };
});

vi.mock("../src/layout-engine", () => ({
  loadVowlEngine: async () => {
    h.state.engineRequests++;
    if (h.state.gate) await h.state.gate;
    if (h.state.failEngine) throw new Error("WebAssembly.compile failed");
    let count = 0;
    let ticks = 0;
    return {
      load(input: { count: number }) {
        count = input.count;
        ticks = 0;
        h.state.loads.push(input.count);
        h.log.push(`engine.load(${input.count})`);
      },
      tick() {
        ticks++;
      },
      finished: () => ticks >= 2,
      read(out: Float32Array) {
        for (let i = 0; i < count * 2; i++) out[i] = i;
      },
      pin(i: number, x: number, y: number) {
        h.state.pins.push([i, x, y]);
        return true;
      },
      unpin() {
        h.state.unpins++;
        return true;
      },
      reheat() {},
      dispose() {
        h.state.disposed++;
        h.log.push("engine.dispose");
      },
    };
  },
}));

import { GraphView } from "../src/views/graph-view";
import type OntomarkPlugin from "../src/main";
import type { ChangeEvent } from "../src/api";

interface FakeEl {
  attrs: Record<string, string | undefined>;
  textContent: string;
  find(pred: (el: FakeEl) => boolean): FakeEl | null;
  findAll(pred: (el: FakeEl) => boolean): FakeEl[];
  click(): Promise<unknown>;
  dispatch(type: string): Promise<unknown>;
}

const entity = (name: string, parents: string[] = []) => ({ iri: `urn:${name}`, label: name, kind: "class", parents: parents.map((p) => `urn:${p}`), path: `${name}.md` });
const index = { entities: [entity("Animal"), entity("Dog", ["Animal"]), entity("Cat", ["Animal"]), entity("Fish", ["Animal"]), entity("Rock")], classification: null };

function fakePlugin() {
  const listeners = new Set<(e: ChangeEvent) => void>();
  return {
    ready: Promise.resolve(),
    api: { index: async () => index },
    subscribe: (l: (e: ChangeEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit: (e: ChangeEvent) => listeners.forEach((l) => l(e)),
    runClassify: async () => undefined,
  };
}

async function open() {
  const plugin = fakePlugin();
  const view = new GraphView({ app: {} } as never, plugin as unknown as OntomarkPlugin);
  const root = (view as unknown as { contentEl: FakeEl }).contentEl;
  const action = (name: string) => root.find((e) => e.attrs["data-ontomark-action"] === name)!;
  const node = (id: string) => root.find((e) => e.attrs["data-ontomark-node"] === id)!;
  const status = () => (view as unknown as { statusEl: FakeEl }).statusEl.textContent;
  await view.onOpen();
  return { view, plugin, root, action, node, status };
}

/** Let the engine load and run every layout slice. */
const settle = () => vi.advanceTimersByTimeAsync(500);

beforeEach(() => {
  vi.useFakeTimers();
  h.log.length = 0;
  Object.assign(h.state, { options: null, setGraphs: [], positions: 0, destroyed: 0, mounts: 0, loads: [], pins: [], unpins: 0, disposed: 0, engineRequests: 0, failEngine: false, gate: null });
  h.state.graph = { nodes: [], edges: [] };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("graph view layout", () => {
  it("does not touch the engine until the view has a graph, then loads it once", async () => {
    const plugin = fakePlugin();
    const view = new GraphView({ app: {} } as never, plugin as unknown as OntomarkPlugin);
    expect(h.state.engineRequests).toBe(0);
    await view.onOpen();
    await settle();
    expect(h.state.engineRequests).toBe(1);
    plugin.emit({ type: "indexed" } as ChangeEvent);
    await settle();
    expect(h.state.engineRequests).toBe(1);
    await view.onClose();
  });

  it("lays out the mounted graph and feeds the renderer positions of the right length", async () => {
    const { view } = await open();
    await settle();
    expect(h.state.loads).toEqual([5]);
    expect(h.state.positions).toBeGreaterThan(0);
    await view.onClose();
  });

  it("wires drags to pin and unpin", async () => {
    const { view } = await open();
    await settle();
    const dog = h.state.graph.nodes.findIndex((n) => n.id === "urn:Dog");
    h.state.options!.onDragStart!({ id: "urn:Dog", label: "Dog" }, { x: 3, y: 4 });
    h.state.options!.onDrag!({ id: "urn:Dog", label: "Dog" }, { x: 5, y: 6 });
    h.state.options!.onDragEnd!({ id: "urn:Dog", label: "Dog" }, { x: 5, y: 6 });
    expect(h.state.pins).toEqual([[dog, 3, 4], [dog, 5, 6]]);
    expect(h.state.unpins).toBe(1);
    await view.onClose();
  });

  it("gives the layout the same graph as the renderer at every call site, keeping positions", async () => {
    const { view, plugin, action, node } = await open();
    await settle();
    const fail = vi.spyOn(console, "warn");
    const agree = () => {
      expect(h.state.loads.at(-1)).toBe(h.state.graph.nodes.length);
    };

    // Neighbourhood of Dog: Dog and Animal.
    h.state.options!.onSelect!({ id: "urn:Dog", label: "Dog" });
    await action("graph-focus").click();
    expect(h.state.graph.nodes.map((n) => n.id).sort()).toEqual(["urn:Animal", "urn:Dog"]);
    agree();
    expect(h.state.setGraphs.at(-1)!.options).toEqual({ preserveViewport: false, preservePositions: true });
    await settle();

    // All nodes restores the full graph in both.
    await action("graph-all").click();
    expect(h.state.graph.nodes).toHaveLength(5);
    agree();
    await settle();

    // Narrow, then pick from the entity list: the full graph returns, viewport kept.
    await action("graph-focus").click();
    await settle();
    await node("urn:Cat").click();
    expect(h.state.graph.nodes).toHaveLength(5);
    agree();
    expect(h.state.setGraphs.at(-1)!.options).toEqual({ preserveViewport: true, preservePositions: true });
    await settle();

    // A reindex while a neighbourhood is shown refreshes to the full graph in both.
    await action("graph-focus").click();
    plugin.emit({ type: "classified" } as ChangeEvent);
    await settle();
    expect(h.state.graph.nodes).toHaveLength(5);
    agree();
    expect(h.state.setGraphs.at(-1)!.options).toEqual({ preserveViewport: false, preservePositions: true });
    await settle();

    // Excluding inferred edges re-requests the graph through refresh as well.
    expect(h.state.mounts).toBe(1);
    expect(fail).not.toHaveBeenCalled();
    fail.mockRestore();
    await view.onClose();
  });

  it("orders each update renderer first, then layout", async () => {
    const { view, action } = await open();
    await settle();
    h.state.options!.onSelect!({ id: "urn:Dog", label: "Dog" });
    h.log.length = 0;
    await action("graph-focus").click();
    expect(h.log).toEqual(["renderer.setGraph(2)", "engine.load(2)"]);
    await view.onClose();
  });

  it("closing destroys the layout before the renderer and stops all work", async () => {
    const { view } = await open();
    await settle();
    h.log.length = 0;
    await view.onClose();
    expect(h.log).toEqual(["engine.dispose", "renderer.destroy"]);
    const positions = h.state.positions;
    await settle();
    expect(h.state.positions).toBe(positions);
  });

  it("closing while the engine is still loading disposes it on arrival and never lays out", async () => {
    let release!: () => void;
    h.state.gate = new Promise<void>((resolve) => (release = resolve));
    const { view } = await open();
    await view.onClose();
    expect(h.state.disposed).toBe(0);
    release();
    await settle();
    expect(h.state.disposed).toBe(1);
    expect(h.state.loads).toEqual([]);
    expect(h.state.positions).toBe(0);
  });

  it("an engine that cannot start leaves the graph drawn and says so in the status line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.state.failEngine = true;
    const { view, action, status } = await open();
    await settle();
    expect(h.state.mounts).toBe(1);
    expect(status()).toContain("5 entities");
    expect(status()).toContain("layout unavailable");
    // The toolbar still works on the seed positions.
    h.state.options!.onSelect!({ id: "urn:Dog", label: "Dog" });
    await action("graph-focus").click();
    expect(h.state.graph.nodes).toHaveLength(2);
    await action("graph-all").click();
    expect(h.state.graph.nodes).toHaveLength(5);
    expect(h.state.loads).toEqual([]);
    await view.onClose();
    warn.mockRestore();
  });

  it("reopening the view starts a fresh layout", async () => {
    const first = await open();
    await settle();
    await first.view.onClose();
    h.state.loads.length = 0;
    await first.view.onOpen();
    await settle();
    expect(h.state.loads).toEqual([5]);
    await first.view.onClose();
  });
});
