// Rewriting of an in-note SPARQL query before it runs: `__THIS__` becomes the
// IRI of the note the block lives in, `[[Note]]` becomes the IRI of that note,
// and a leading `# dataset: inferred` comment picks the dataset.
//
// The idea and the token names follow Cristian Vasquez's Dot Triples plugin
// (https://github.com/cristianvasquez/dot-triples-plugin, MIT), where a
// `dot-sparql` block rewrites `__THIS__` and `[[Note]]` before querying. The
// implementation here is independent and differs in one respect its README
// lists as a known defect: replacement there also touches quoted strings and
// comments; here a small scanner skips string literals, `<IRI>` tokens and
// comments, so `"[[not a link]]"` and `# see __THIS__` stay as written.
//
// No Obsidian import: this module is pure so it can be unit-tested under Node.
import type { DatasetSelection } from "./protocol";

/** A reference the query makes to a note. */
export type NoteReference = { kind: "this" } | { kind: "link"; target: string };

/** Where a reference sits in the source and what it names. */
export interface ReferenceSpan {
  start: number;
  end: number;
  ref: NoteReference;
}

/** The scan of one block: references in query code and the dataset directive, if any. */
export interface SparqlScan {
  spans: ReferenceSpan[];
  dataset: DatasetSelection | null;
}

const DATASETS: ReadonlySet<string> = new Set(["asserted", "inferred", "combined"]);
const DIRECTIVE = /^#\s*dataset\s*:\s*([a-z]+)\s*$/i;

/**
 * Scan `source` for `__THIS__`, `[[links]]` and a `# dataset:` directive,
 * ignoring string literals, `<IRI>` tokens and the body of comments.
 */
export function scanSparql(source: string): SparqlScan {
  const spans: ReferenceSpan[] = [];
  let dataset: DatasetSelection | null = null;
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    // Comments run to end of line. A directive is a comment whose whole text
    // is `dataset: <name>`; the first one wins.
    if (c === "#") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      const m = DIRECTIVE.exec(source.slice(i, j));
      if (m && dataset === null) {
        const name = m[1].toLowerCase();
        if (DATASETS.has(name)) dataset = name as DatasetSelection;
      }
      i = j;
      continue;
    }
    // String literals: long forms first, then short; backslash escapes.
    if (c === '"' || c === "'") {
      const long = source.startsWith(c.repeat(3), i);
      const quote = long ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source.startsWith(quote, j)) {
          j += quote.length;
          break;
        }
        j++;
      }
      i = j;
      continue;
    }
    // `<...>` with no whitespace inside is an IRI token; otherwise `<` is the operator.
    if (c === "<") {
      let j = i + 1;
      while (j < n && !/[\s<>"{}|^`\\]/.test(source[j])) j++;
      if (j < n && source[j] === ">") {
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    if (source.startsWith("__THIS__", i)) {
      spans.push({ start: i, end: i + 8, ref: { kind: "this" } });
      i += 8;
      continue;
    }
    if (c === "[" && source[i + 1] === "[") {
      const close = source.indexOf("]]", i + 2);
      if (close > i) {
        const inner = source.slice(i + 2, close);
        // `[[Note|alias]]` and `[[Note#Heading]]` both name the note; the
        // engine has no heading IRIs, so the fragment is dropped.
        const target = inner.split("|")[0].split("#")[0].trim();
        if (target.length > 0) spans.push({ start: i, end: close + 2, ref: { kind: "link", target } });
        i = close + 2;
        continue;
      }
    }
    i++;
  }
  return { spans, dataset };
}

/** Result of a rewrite: the query to run, or the references that could not be resolved. */
export type Rewrite =
  | { ok: true; sparql: string; dataset: DatasetSelection }
  | { ok: false; unresolved: NoteReference[]; dataset: DatasetSelection };

/**
 * Replace every reference with `<iri>` as `resolve` reports it. A reference
 * `resolve` returns `null` for is collected and the rewrite fails as a whole,
 * so a query never runs against a half-substituted pattern.
 */
export function rewriteSparql(source: string, resolve: (ref: NoteReference) => string | null, fallback: DatasetSelection = "asserted"): Rewrite {
  const { spans, dataset } = scanSparql(source);
  const chosen = dataset ?? fallback;
  const unresolved: NoteReference[] = [];
  let out = "";
  let last = 0;
  for (const span of spans) {
    const iri = resolve(span.ref);
    if (iri === null) {
      unresolved.push(span.ref);
      continue;
    }
    out += source.slice(last, span.start) + `<${iri}>`;
    last = span.end;
  }
  if (unresolved.length > 0) return { ok: false, unresolved, dataset: chosen };
  out += source.slice(last);
  return { ok: true, sparql: out, dataset: chosen };
}

/** One line naming what could not be resolved, for the block's error text. */
export function describeUnresolved(refs: NoteReference[]): string {
  const parts = refs.map((r) => (r.kind === "this" ? "__THIS__ (this note is not an ontology entity: it needs `type: class`, `individual` or `property`)" : `[[${r.target}]] (no such entity note)`));
  return `Unresolved: ${parts.join("; ")}`;
}
