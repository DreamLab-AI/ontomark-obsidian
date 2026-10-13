import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { OntomarkError } from "../client";
import type { DatasetSelection, QueryResult } from "../protocol";
import type OntomarkPlugin from "../main";
import { renderQueryResult } from "./query-render";

export const QUERY_VIEW = "ontomark-query";

export const DEFAULT_QUERY = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT ?class ?label WHERE {
  ?class a owl:Class .
  OPTIONAL { ?class rdfs:label ?label }
}
ORDER BY ?label
LIMIT 50`;

/** SPARQL query panel over the local, reasoned dataset. */
export class QueryView extends ItemView {
  textarea!: HTMLTextAreaElement;
  datasetSelect!: HTMLSelectElement;
  runButton!: HTMLButtonElement;
  lastResult: QueryResult | null = null;
  lastError: string | null = null;
  private resultsEl!: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: OntomarkPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return QUERY_VIEW;
  }
  getDisplayText(): string {
    return "SPARQL";
  }
  override getIcon(): string {
    return "search-code";
  }

  override async onOpen(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass("ontomark-view");
    this.textarea = el.createEl("textarea", { cls: "ontomark-query-input", attr: { rows: "10", spellcheck: "false" } });
    this.textarea.value = DEFAULT_QUERY;

    const controls = el.createDiv({ cls: "ontomark-actions" });
    this.datasetSelect = controls.createEl("select", { cls: "dropdown", attr: { "data-ontomark": "dataset" } });
    for (const [value, label] of [
      ["asserted", "Asserted"],
      ["inferred", "Inferred"],
      ["combined", "Combined"],
    ]) {
      this.datasetSelect.createEl("option", { text: label, attr: { value } });
    }
    this.datasetSelect.value = "asserted";
    this.runButton = controls.createEl("button", { text: "Run", cls: "mod-cta", attr: { "data-ontomark-action": "run" } });
    this.runButton.addEventListener("click", () => {
      void this.run();
    });

    el.createDiv({
      cls: "ontomark-help",
      text: "Supported: SELECT, ASK, CONSTRUCT, OPTIONAL, UNION, FILTER, ORDER BY, LIMIT. Refused: UPDATE, SERVICE, FROM.",
    });
    this.resultsEl = el.createDiv({ cls: "ontomark-results" });
  }

  override async onClose(): Promise<void> {
    // nothing to release
  }

  /** Run the query in the textarea against the selected dataset. */
  async run(): Promise<void> {
    const dataset = this.datasetSelect.value as DatasetSelection;
    const sparql = this.textarea.value;
    const limit = this.plugin.settings.queryLimit;
    this.lastError = null;
    try {
      let result: QueryResult;
      try {
        result = await this.plugin.api.query(sparql, dataset, limit, "query-view");
      } catch (err) {
        if (!(err instanceof OntomarkError) || err.code !== "not_classified") throw err;
        await this.plugin.api.classify();
        result = await this.plugin.api.query(sparql, dataset, limit, "query-view");
      }
      this.lastResult = result;
      renderQueryResult(this.resultsEl, result);
    } catch (err) {
      const code = err instanceof OntomarkError ? err.code : "error";
      const message = err instanceof Error ? err.message : String(err);
      this.lastResult = null;
      this.lastError = `${code}: ${message}`;
      this.resultsEl.empty();
      this.resultsEl.createDiv({ text: this.lastError, cls: "ontomark-error" });
    }
  }
}
