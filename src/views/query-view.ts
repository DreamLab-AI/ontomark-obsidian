import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { OntomarkError } from "../client";
import type { DatasetSelection, QueryResult, WireTerm } from "../protocol";
import type OntomarkPlugin from "../main";
import { compactIri } from "./entity-view";

export const QUERY_VIEW = "ontomark-query";

export const DEFAULT_QUERY = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT ?class ?label WHERE {
  ?class a owl:Class .
  OPTIONAL { ?class rdfs:label ?label }
}
ORDER BY ?label
LIMIT 50`;

function termText(t: WireTerm): { text: string; title?: string } {
  if (t.type === "iri") return { text: compactIri(t.value), title: t.value };
  if (t.type === "bnode") return { text: `_:${t.value}` };
  return { text: t.value, title: t.lang ? `@${t.lang}` : t.datatype };
}

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
      this.renderResult(result);
    } catch (err) {
      const code = err instanceof OntomarkError ? err.code : "error";
      const message = err instanceof Error ? err.message : String(err);
      this.lastResult = null;
      this.lastError = `${code}: ${message}`;
      this.resultsEl.empty();
      this.resultsEl.createDiv({ text: this.lastError, cls: "ontomark-error" });
    }
  }

  private renderResult(r: QueryResult): void {
    const out = this.resultsEl;
    out.empty();
    if (r.form === "ask") {
      out.createDiv({ text: r.boolean ? "true" : "false", cls: "ontomark-ask" });
      return;
    }
    const table = out.createEl("table", { cls: "ontomark-table" });
    const head = table.createEl("tr");
    const cell = (row: { createEl: HTMLElement["createEl"] }, t: WireTerm | undefined): void => {
      if (!t) {
        row.createEl("td", { text: "" });
        return;
      }
      const { text, title } = termText(t);
      row.createEl("td", { text, attr: title ? { title } : {} });
    };
    if (r.form === "select") {
      for (const v of r.variables) head.createEl("th", { text: v });
      for (const binding of r.rows) {
        const tr = table.createEl("tr");
        for (const v of r.variables) cell(tr, binding[v]);
      }
    } else {
      for (const h of ["subject", "predicate", "object"]) head.createEl("th", { text: h });
      for (const [s, p, o] of r.triples) {
        const tr = table.createEl("tr");
        cell(tr, s);
        cell(tr, p);
        cell(tr, o);
      }
    }
    const count = r.form === "select" ? r.rows.length : r.triples.length;
    out.createDiv({ text: `${count} row${count === 1 ? "" : "s"}`, cls: "ontomark-count" });
    if (r.truncated) {
      out.createDiv({ text: "Truncated: more results exist than the row limit allows.", cls: "ontomark-warning" });
    }
  }
}
