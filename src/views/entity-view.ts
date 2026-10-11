import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { OntomarkError } from "../client";
import type { Entity, EntityKind, IndexResult } from "../protocol";
import type OntomarkPlugin from "../main";

export const ENTITY_VIEW = "ontomark-entities";

/** Compact display form of an IRI: its last path or fragment segment. */
export function compactIri(iri: string): string {
  const m = /[#/]([^#/]+)[#/]?$/.exec(iri);
  return m ? m[1] : iri;
}

const SECTIONS: { kind: EntityKind; title: string }[] = [
  { kind: "class", title: "Classes" },
  { kind: "individual", title: "Individuals" },
  { kind: "property", title: "Properties" },
];

/** Side panel listing the indexed entities, inferred superclasses and diagnostics. */
export class EntityView extends ItemView {
  lastRendered: IndexResult | null = null;
  private unsubscribe: (() => void) | null = null;
  private progressText = "";
  private progressEl: { setText(s: string): void } | null = null;
  private token = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: OntomarkPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return ENTITY_VIEW;
  }
  getDisplayText(): string {
    return "Ontology";
  }
  override getIcon(): string {
    return "network";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("ontomark-view");
    this.unsubscribe = this.plugin.subscribe((e) => {
      if (e.type === "progress") {
        this.progressText = `Classifying: step ${e.steps}${e.total !== null ? ` of ${e.total}` : ""}`;
        this.progressEl?.setText(this.progressText);
        return;
      }
      this.progressText = "";
      void this.render();
    });
    await this.render();
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async render(): Promise<void> {
    const mine = ++this.token;
    let index: IndexResult;
    try {
      index = await this.plugin.api.index("entity-view");
    } catch (err) {
      if (mine !== this.token) return;
      if (err instanceof OntomarkError && (err.code === "stale" || err.code === "superseded")) return;
      this.renderError(err);
      return;
    }
    if (mine !== this.token) return;
    this.lastRendered = index;
    this.draw(index);
  }

  private renderError(err: unknown): void {
    if (this.lastRendered) return;
    const el = this.contentEl;
    el.empty();
    const code = err instanceof OntomarkError ? err.code : "error";
    const message = err instanceof Error ? err.message : String(err);
    el.createDiv({ text: `${code}: ${message}`, cls: "ontomark-error" });
  }

  private draw(index: IndexResult): void {
    const el = this.contentEl;
    el.empty();
    const status = this.plugin.api.status();

    const header = el.createDiv({ cls: "ontomark-header" });
    header.createDiv({
      cls: "ontomark-status",
      text: `Generation ${status.generation} · profile ${index.profile} · reasoner ${index.reasoner.id} ${index.reasoner.version}`,
    });
    if (!index.reasoner.el_complete) {
      header.createDiv({
        cls: "ontomark-warning",
        text: `Reasoner is not OWL 2 EL complete: ${index.reasoner.note}`,
      });
    }
    const cls = index.classification;
    if (cls && !cls.complete) {
      const warn = header.createDiv({ cls: "ontomark-warning", attr: { "data-ontomark": "incomplete" } });
      const why: string[] = [];
      if (cls.unsupported.length > 0) why.push(`${cls.unsupported.length} axiom(s) not used`);
      if (cls.policy === "relevant") why.push("complete policy ran out of budget; named subsumptions only");
      warn.createDiv({ text: `Classification is incomplete: ${why.join("; ")}.` });
      const list = warn.createEl("ul");
      for (const u of cls.unsupported) list.createEl("li", { text: u.reason });
    }
    const actions = header.createDiv({ cls: "ontomark-actions" });
    const classify = actions.createEl("button", { text: "Classify", cls: "mod-cta", attr: { "data-ontomark-action": "classify" } });
    const refresh = actions.createEl("button", { text: "Refresh", attr: { "data-ontomark-action": "refresh" } });
    classify.addEventListener("click", () => {
      void this.plugin.runClassify();
    });
    refresh.addEventListener("click", () => {
      void this.render();
    });
    const progress = header.createDiv({ cls: "ontomark-progress", text: this.progressText });
    this.progressEl = progress;

    const labels = new Map<string, string>();
    for (const e of index.entities) labels.set(e.iri, e.label);
    const labelOf = (iri: string): string => labels.get(iri) ?? compactIri(iri);

    const unsat = new Set(index.classification?.unsatisfiable ?? []);
    const inferred = new Map<string, string[]>();
    if (index.classification) {
      for (const s of index.classification.subsumptions) {
        if (s.told) continue;
        const list = inferred.get(s.sub) ?? [];
        if (!list.includes(s.sup)) list.push(s.sup);
        inferred.set(s.sub, list);
      }
    }

    for (const section of SECTIONS) {
      const items = index.entities.filter((e) => e.kind === section.kind);
      el.createEl("h4", { text: `${section.title} (${items.length})`, cls: "ontomark-section-title" });
      const list = el.createDiv({ cls: "ontomark-list" });
      if (items.length === 0) list.createDiv({ text: "None", cls: "ontomark-empty" });
      for (const entity of items) this.drawItem(list, entity, labelOf, inferred.get(entity.iri) ?? [], unsat.has(entity.iri));
    }

    el.createEl("h4", { text: `Diagnostics (${index.diagnostics.length})`, cls: "ontomark-section-title" });
    const diag = el.createDiv({ cls: "ontomark-diagnostics" });
    if (index.diagnostics.length === 0) diag.createDiv({ text: "None", cls: "ontomark-empty" });
    for (const d of index.diagnostics) {
      const line = d.span ? d.span.line : 1;
      diag.createDiv({
        text: `${d.path}:${line} ${d.message}`,
        cls: `ontomark-diagnostic ontomark-${d.severity}`,
      });
    }

    const plain = Math.max(0, index.documents - index.entities.length);
    el.createDiv({
      cls: "ontomark-plain",
      text: `${plain} of ${index.documents} documents are plain notes: used for navigation only, never as axioms.`,
    });
  }

  private drawItem(
    parent: { createDiv(o?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLElement },
    entity: Entity,
    labelOf: (iri: string) => string,
    inferredParents: string[],
    unsatisfiable: boolean,
  ): void {
    const item = parent.createDiv({ cls: "ontomark-item", attr: { "data-iri": entity.iri } });
    const link = item.createSpan({ text: entity.label, cls: "ontomark-link" });
    link.addEventListener("click", () => {
      void this.app.workspace.openLinkText(entity.path, "", false);
    });
    if (unsatisfiable) item.createSpan({ text: "unsatisfiable", cls: "ontomark-badge ontomark-badge-unsat" });
    if (entity.parents.length > 0) {
      item.createSpan({ text: ` ⊑ ${entity.parents.map(labelOf).join(", ")}`, cls: "ontomark-parents" });
    }
    for (const sup of inferredParents) {
      const row = item.createDiv({ cls: "ontomark-inferred" });
      row.createSpan({ text: "inferred", cls: "ontomark-badge ontomark-badge-inferred" });
      row.createSpan({ text: ` ⊑ ${labelOf(sup)}` });
    }
  }
}
