// Sequencing between the graph renderer and its layout driver, with no Obsidian
// or DOM dependency so it can be tested alone. The renderer's `setPositions`
// throws unless the positions match the graph it currently shows, so every
// graph change goes through `show`: renderer first, then the layout, with the
// same graph and node order. An engine that is slow to load, fails to load or
// fails later never breaks the view; the renderer keeps the positions it has.
import { createLayout } from "@dreamlab-ai/ontomark-graph/layout";
import type { Layout, LayoutEngine, LayoutOptions } from "@dreamlab-ai/ontomark-graph/layout";
import type { GraphData, GraphNode } from "@dreamlab-ai/ontomark-graph";

/** The parts of the shared renderer's view this controller drives. */
export interface LayoutRenderer {
  setGraph(graph: GraphData, options?: { preserveViewport?: boolean; preservePositions?: boolean }): void;
  setPositions(positions: Float32Array): void;
  fit(): void;
}

export interface GraphLayoutOptions {
  /** Produce the simulation. Called once, on the first `bind`. */
  loadEngine: () => Promise<LayoutEngine>;
  /** Called with a short message when the layout is unavailable; the view then keeps the renderer's own positions. */
  onUnavailable?: (message: string) => void;
  /** Test seams: the driver factory and its scheduler. */
  makeLayout?: (engine: LayoutEngine, options: LayoutOptions) => Layout;
  layoutOptions?: Pick<LayoutOptions, "schedule" | "cancel" | "now" | "frameBudgetMs" | "maxTicksPerFrame">;
}

export const LAYOUT_UNAVAILABLE = "layout unavailable, nodes keep their starting positions";

export class GraphLayoutController {
  private renderer: LayoutRenderer | null = null;
  private graph: GraphData | null = null;
  private layout: Layout | null = null;
  private started = false;
  private destroyed = false;
  private failed = false;
  /** True from a new viewport until the layout settles or the reader moves the view. */
  private autoFit = false;
  constructor(private readonly options: GraphLayoutOptions) {}

  /** Attach the mounted renderer, which already shows `graph`, and start loading the engine (once). */
  bind(renderer: LayoutRenderer, graph: GraphData): void {
    if (this.destroyed) return;
    this.renderer = renderer;
    this.graph = graph;
    this.autoFit = true;
    if (this.started) return;
    this.started = true;
    let loading: Promise<LayoutEngine>;
    try {
      loading = this.options.loadEngine();
    } catch (error) {
      this.fail(error);
      return;
    }
    loading.then(
      (engine) => this.engineReady(engine),
      (error) => this.fail(error),
    );
  }

  /** Show `graph` in the renderer and lay it out. Renderer first, then the layout, in the same call. */
  show(graph: GraphData, view: { preserveViewport?: boolean } = {}): void {
    if (this.destroyed || !this.renderer) return;
    this.graph = graph;
    this.renderer.setGraph(graph, { preserveViewport: view.preserveViewport === true, preservePositions: true });
    if (!view.preserveViewport) this.autoFit = true;
    this.lay(graph);
  }

  /** The reader panned, zoomed or dragged: stop fitting the view as the layout moves. */
  interacted(): void {
    this.autoFit = false;
  }

  dragStart(node: GraphNode, position: { x: number; y: number }): void {
    this.autoFit = false;
    this.layout?.pin(node.id, position.x, position.y);
  }
  drag(node: GraphNode, position: { x: number; y: number }): void {
    this.layout?.pin(node.id, position.x, position.y);
  }
  dragEnd(node: GraphNode): void {
    this.layout?.unpin(node.id);
  }

  /** Stop the layout, then forget the renderer, which the caller destroys next. An engine still loading is disposed when it arrives. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const layout = this.layout;
    this.layout = null;
    this.renderer = null;
    this.graph = null;
    layout?.destroy();
  }

  private engineReady(engine: LayoutEngine): void {
    if (this.destroyed) {
      // The view closed while the engine was starting.
      try { engine.dispose?.(); } catch { /* the engine is being discarded */ }
      return;
    }
    try {
      const make = this.options.makeLayout ?? createLayout;
      this.layout = make(engine, {
        ...this.options.layoutOptions,
        onPositions: (positions) => {
          const renderer = this.renderer;
          if (this.destroyed || !renderer) return;
          renderer.setPositions(positions);
          if (this.autoFit) renderer.fit();
        },
        onSettled: () => { this.autoFit = false; },
        onError: (error) => this.fail(error),
      });
    } catch (error) {
      try { engine.dispose?.(); } catch { /* the engine is being discarded */ }
      this.fail(error);
      return;
    }
    if (this.graph) this.lay(this.graph);
  }

  private lay(graph: GraphData): void {
    const layout = this.layout;
    if (!layout) return;
    try {
      layout.setGraph(graph);
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (this.destroyed || this.failed) return;
    this.failed = true;
    const layout = this.layout;
    this.layout = null;
    try { layout?.destroy(); } catch { /* already stopped */ }
    console.warn("Ontomark graph layout unavailable:", error);
    this.options.onUnavailable?.(LAYOUT_UNAVAILABLE);
  }
}
