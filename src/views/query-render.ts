// Rendering of a SPARQL result into an Obsidian element, shared by the query
// view and the in-note `ontomark-sparql` block so both show the same table.
import type { QueryResult, WireTerm } from "../protocol";
import { compactIri } from "./entity-view";

/** Cell text for a term, with the full IRI or datatype as the hover title. */
export function termText(t: WireTerm): { text: string; title?: string } {
  if (t.type === "iri") return { text: compactIri(t.value), title: t.value };
  if (t.type === "bnode") return { text: `_:${t.value}` };
  return { text: t.value, title: t.lang ? `@${t.lang}` : t.datatype };
}

/** Render `r` into `out` (emptied first): a boolean for ASK, otherwise a table, a row count and a truncation notice. */
export function renderQueryResult(out: HTMLElement, r: QueryResult): void {
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
