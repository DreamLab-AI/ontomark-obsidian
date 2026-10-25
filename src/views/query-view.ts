import { ItemView, Notice } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { OntomarkError } from "../client";
import type { DatasetSelection, QueryResult } from "../protocol";
import type OntomarkPlugin from "../main";
import { renderQueryResult } from "./query-render";
import { pickTemplate } from "../jev";
import { compileTemplate, mentionedEntities, templateOffers } from "../query-templates";

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

    // Jev option (OB-02-S1-01). Not created at all unless the user turned it on.
    if (this.plugin.jevConfig().enabled) this.renderAsk(el);

    el.createDiv({
      cls: "ontomark-help",
      text: "Supported: SELECT, ASK, CONSTRUCT, OPTIONAL, UNION, FILTER, ORDER BY, LIMIT. Refused: UPDATE, SERVICE, FROM.",
    });
    this.resultsEl = el.createDiv({ cls: "ontomark-results" });
  }

  override async onClose(): Promise<void> {
    // nothing to release
  }

  /** The "ask in words" row: Jev picks a template; the query is compiled here and only filled in, never run. */
  private renderAsk(el: HTMLElement): void {
    const row = el.createDiv({ cls: "ontomark-actions" });
    const input = row.createEl("input", {
      cls: "ontomark-ask-input",
      attr: { type: "text", placeholder: "Ask in words, e.g. what are the subclasses of Animal", "data-ontomark": "ask" },
    });
    const button = row.createEl("button", { text: "Suggest query (Jev)", attr: { "data-ontomark-action": "ask" } });
    button.addEventListener("click", () => {
      void this.suggest(input.value.trim());
    });
  }

  /** Fill the textarea with a compiled template for `question`; on any fallback leave the panel as it was. */
  async suggest(question: string): Promise<void> {
    const cfg = this.plugin.jevConfig();
    if (!cfg.enabled || !question) return;
    try {
      const entities = await this.plugin.api.entities();
      const offers = mentionedEntities(question, entities).map((e) => ({ iri: e.iri, label: e.label, kind: e.kind }));
      const picked = await pickTemplate(cfg, this.plugin.jevDeps(), question, templateOffers(), offers);
      if (!picked.ok) {
        new Notice(`Ontomark: Jev could not suggest a query (${picked.reason}). Write the SPARQL as before.`);
        return;
      }
      const sparql = compileTemplate(picked.value.templateId, picked.value.entityIri, entities);
      if (sparql === null) {
        new Notice("Ontomark: Jev could not suggest a query (unresolved-target). Write the SPARQL as before.");
        return;
      }
      this.textarea.value = sparql;
      this.datasetSelect.value = picked.value.dataset;
      new Notice("Ontomark: query suggested by Jev. Read it, then press Run.");
    } catch (err) {
      this.plugin.reportError(err);
    }
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
