// The vowl-wasm 0.4.0 layout parameters end to end: the real WebAssembly module,
// loaded through the plugin's own `loadVowlEngine`, must report every
// parameter the Graph layout settings send as supported (`version` has to reach
// `vowlEngine` for that), and with the recommended values the layout must
// actually separate nodes. Also the settings' defaults, ranges and repair.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { createLayout, RECOMMENDED_LAYOUT_PARAMS } from "@dreamlab-ai/ontomark-graph/layout";
import type { LayoutEngine, LayoutParams } from "@dreamlab-ai/ontomark-graph/layout";
import type { GraphData } from "@dreamlab-ai/ontomark-graph";

vi.mock("obsidian", () => createRequire(import.meta.url)("./e2e/obsidian-shim.cjs"));
// esbuild embeds these bytes in main.js with its binary loader; here they are read from the installed package.
vi.mock("@dreamlab-ai/vowl-wasm/vowl_wasm_bg.wasm", () => ({
  default: new Uint8Array(readFileSync(createRequire(import.meta.url).resolve("@dreamlab-ai/vowl-wasm/vowl_wasm_bg.wasm"))),
}));

import { loadVowlEngine, vowlModule } from "../src/layout-engine";
import { DEFAULT_SETTINGS, graphLayoutParams, graphLayoutProblem, normaliseSettings } from "../src/settings";

const PARAM_KEYS = ["collideRadius", "collideStrength", "collideIterations", "componentGravity"];

/** A star of `n` leaves around a hub, plus `islands` isolated nodes: crowded without collision. */
function crowd(n: number, islands: number): GraphData {
  const nodes = [{ id: "hub", label: "hub" }, ...Array.from({ length: n + islands }, (_, i) => ({ id: `n${i}`, label: `n${i}` }))];
  return { nodes, edges: Array.from({ length: n }, (_, i) => ({ source: "hub", target: `n${i}` })) };
}

/** Run a layout to rest synchronously and return the closest distance between any two nodes. */
function settledMinDistance(engine: LayoutEngine, graph: GraphData, params?: LayoutParams): number {
  const queue: (() => void)[] = [];
  let latest = new Float32Array(0);
  let settled = false;
  const layout = createLayout(engine, {
    ...(params ? { params } : {}),
    onPositions: (xy) => { latest = xy.slice(); },
    onSettled: () => { settled = true; },
    onError: (error) => { throw error; },
    schedule: (callback) => queue.push(callback),
    cancel: () => {},
    frameBudgetMs: 1e9,
    maxTicksPerFrame: 1e6,
  });
  layout.setGraph(graph);
  for (let i = 0; queue.length && i < 10_000; i++) queue.shift()!();
  layout.destroy();
  expect(settled).toBe(true);
  let min = Infinity;
  for (let a = 0; a < graph.nodes.length; a++)
    for (let b = a + 1; b < graph.nodes.length; b++)
      min = Math.min(min, Math.hypot(latest[2 * a] - latest[2 * b], latest[2 * a + 1] - latest[2 * b + 1]));
  return min;
}

describe("vowl-wasm 0.4.0 through the plugin's engine loader", () => {
  it("passes the module's version, so every Graph layout parameter is supported", async () => {
    expect(typeof vowlModule.version).toBe("function");
    const engine = await loadVowlEngine();
    expect(vowlModule.version()).toMatch(/^0\.4\./);
    for (const key of PARAM_KEYS) expect(engine.supportedParams).toContain(key);
    expect(engine.setParams(graphLayoutParams(DEFAULT_SETTINGS))).toEqual({ applied: PARAM_KEYS, ignored: [] });
    engine.dispose?.();
  });

  it("separates crowded nodes with the recommended parameters and leaves the old layout without them", async () => {
    const graph = crowd(40, 6);
    const without = settledMinDistance(await loadVowlEngine(), graph);
    const withParams = settledMinDistance(await loadVowlEngine(), graph, graphLayoutParams(DEFAULT_SETTINGS));
    // Collision radius 21: no two node centres closer than one radius once settled
    // (collisionStrength 0.7 resolves most, not all, of each overlap per pass).
    expect(withParams).toBeGreaterThanOrEqual(RECOMMENDED_LAYOUT_PARAMS.collideRadius);
    expect(withParams).toBeGreaterThan(without);
  });
});

describe("Graph layout settings", () => {
  it("default to ontomark-graph's recommended parameters", () => {
    expect(graphLayoutParams(DEFAULT_SETTINGS)).toEqual({ ...RECOMMENDED_LAYOUT_PARAMS });
    expect(graphLayoutParams(normaliseSettings(null))).toEqual({ ...RECOMMENDED_LAYOUT_PARAMS });
  });

  it("keep saved values in range and repair the rest to the defaults", () => {
    const kept = normaliseSettings({ graphCollideRadius: 0, graphCollideStrength: 1, graphCollideIterations: 16, graphComponentGravity: 0 });
    expect(graphLayoutParams(kept)).toEqual({ collideRadius: 0, collideStrength: 1, collideIterations: 16, componentGravity: 0 });
    const repaired = normaliseSettings({ graphCollideRadius: -1, graphCollideStrength: 2, graphCollideIterations: 2.5, graphComponentGravity: "0.5" } as never);
    expect(graphLayoutParams(repaired)).toEqual({ ...RECOMMENDED_LAYOUT_PARAMS });
  });

  it("validate the text controls", () => {
    expect(graphLayoutProblem("graphCollideRadius", "14")).toBeUndefined();
    expect(graphLayoutProblem("graphCollideRadius", "201")).toBe("enter a number from 0 to 200");
    expect(graphLayoutProblem("graphCollideIterations", "0")).toBe("enter a whole number from 1 to 16");
    expect(graphLayoutProblem("graphCollideIterations", "2.5")).toBe("enter a whole number from 1 to 16");
    expect(graphLayoutProblem("graphCollideStrength", "")).toBe("enter a number from 0 to 1");
    expect(graphLayoutProblem("graphComponentGravity", "0.1")).toBeUndefined();
  });
});
