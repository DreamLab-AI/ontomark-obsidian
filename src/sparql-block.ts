// The `ontomark-sparql` fenced block: a SPARQL query written in a note, run
// against the local graph and rendered as a table in reading view, re-run
// when the index or classification changes.
//
// After Dot Triples by Cristian Vasquez (https://github.com/cristianvasquez/dot-triples-plugin,
// MIT), whose `dot-sparql` blocks showed the shape; see ADR-OBS-004.
import { MarkdownRenderChild } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import { OntomarkError } from "./client";
import type { QueryResult } from "./protocol";
import type OntomarkPlugin from "./main";
import { describeUnresolved, rewriteSparql, scanSparql } from "./sparql-rewrite";
import type { NoteReference } from "./sparql-rewrite";
import { renderQueryResult } from "./views/query-render";

export const SPARQL_BLOCK = "ontomark-sparql";

/** Delay before a block re-runs after the graph changed, so a burst of edits runs once. */
const RERUN_DELAY_MS = 400;

export class SparqlBlock extends MarkdownRenderChild {
  lastResult: QueryResult | null = null;
  lastError: string | null = null;
  /** Resolves when the run started by `onload` has rendered; tests await it. */
  ready: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private rerun: number | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: OntomarkPlugin,
    private readonly source: string,
    private readonly sourcePath: string,
  ) {
    super(containerEl);
  }

  override onload(): void {
    this.containerEl.addClass("ontomark-block");
    this.unsubscribe = this.plugin.api.onChange((e) => {
      if (e.type !== "indexed" && e.type !== "classified") return;
      if (this.rerun !== null) window.clearTimeout(this.rerun);
      this.rerun = window.setTimeout(() => {
        this.rerun = null;
        this.ready = this.run();
      }, RERUN_DELAY_MS);
    });
    this.ready = this.run();
  }

  override onunload(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.rerun !== null) window.clearTimeout(this.rerun);
    this.rerun = null;
  }

  /** Resolve the block's references, run the query and render the outcome. */
  async run(): Promise<void> {
    const el = this.containerEl;
    try {
      const iris = await this.resolveReferences();
      const rewrite = rewriteSparql(this.source, (ref) => iris.get(keyOf(ref)) ?? null);
      if (!rewrite.ok) {
        this.fail(describeUnresolved(rewrite.unresolved));
        return;
      }
      const limit = this.plugin.settings.queryLimit;
      let result: QueryResult;
      try {
        result = await this.plugin.api.query(rewrite.sparql, rewrite.dataset, limit, `sparql-block:${this.sourcePath}`);
      } catch (err) {
        if (!(err instanceof OntomarkError) || err.code !== "not_classified") throw err;
        await this.plugin.api.classify();
        result = await this.plugin.api.query(rewrite.sparql, rewrite.dataset, limit, `sparql-block:${this.sourcePath}`);
      }
      this.lastResult = result;
      this.lastError = null;
      renderQueryResult(el, result);
    } catch (err) {
      const code = err instanceof OntomarkError ? err.code : "error";
      const message = err instanceof Error ? err.message : String(err);
      this.fail(`${code}: ${message}`);
    }
  }

  private fail(text: string): void {
    this.lastResult = null;
    this.lastError = text;
    this.containerEl.empty();
    this.containerEl.createDiv({ text, cls: "ontomark-error" });
  }

  /**
   * IRIs for every reference the block makes. `__THIS__` is the entity whose
   * note holds the block; a link resolves the way Obsidian resolves it from
   * this note, then to the entity indexed at that path.
   */
  private async resolveReferences(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const refs = scanSparql(this.source).spans.map((s) => s.ref);
    for (const ref of refs) {
      const key = keyOf(ref);
      if (out.has(key)) continue;
      const path = ref.kind === "this" ? this.sourcePath : this.plugin.app.metadataCache.getFirstLinkpathDest(ref.target, this.sourcePath)?.path;
      if (!path) continue;
      const entity = await this.plugin.api.entityForPath(path);
      if (entity) out.set(key, entity.iri);
    }
    return out;
  }
}

function keyOf(ref: NoteReference): string {
  return ref.kind === "this" ? "\u0000this" : `link:${ref.target}`;
}

/** Register the block processor; one `SparqlBlock` per fenced block, owned by the renderer. */
export function registerSparqlBlock(plugin: OntomarkPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor(SPARQL_BLOCK, (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    ctx.addChild(new SparqlBlock(el, plugin, source, ctx.sourcePath));
  });
}
