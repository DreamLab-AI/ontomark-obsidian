import { describe, expect, it } from "vitest";
import { describeUnresolved, rewriteSparql, scanSparql } from "../src/sparql-rewrite";
import type { NoteReference } from "../src/sparql-rewrite";

const IRIS: Record<string, string> = {
  "\u0000this": "urn:ontomark:page:People/Rex",
  "link:Dog": "urn:ontomark:page:Ontology/Dog",
  "link:Animal": "urn:ontomark:page:Ontology/Animal",
};
const resolve = (ref: NoteReference): string | null => IRIS[ref.kind === "this" ? "\u0000this" : `link:${ref.target}`] ?? null;

describe("scanSparql", () => {
  it("finds __THIS__ and [[links]] in query code, keeping their positions", () => {
    const src = "SELECT ?p WHERE { __THIS__ ?p [[Dog]] }";
    const { spans, dataset } = scanSparql(src);
    expect(dataset).toBeNull();
    expect(spans.map((s) => [src.slice(s.start, s.end), s.ref])).toEqual([
      ["__THIS__", { kind: "this" }],
      ["[[Dog]]", { kind: "link", target: "Dog" }],
    ]);
  });

  it("drops the alias and heading of a link and names the note", () => {
    const { spans } = scanSparql("SELECT * WHERE { [[Dog|the dog]] ?p [[Animal#Taxonomy]] }");
    expect(spans.map((s) => s.ref)).toEqual([
      { kind: "link", target: "Dog" },
      { kind: "link", target: "Animal" },
    ]);
  });

  it("ignores string literals, comments and IRI tokens (the Dot Triples known defect)", () => {
    const src = [
      "# about __THIS__ and [[Dog]]",
      'SELECT ?x WHERE { ?x rdfs:comment "see [[Dog]] or __THIS__" ;',
      "  <urn:example:[[not-a-link]]> '__THIS__' ;",
      '  rdfs:label """[[Animal]]""" .',
      "  __THIS__ ?p ?x }",
    ].join("\n");
    const { spans } = scanSparql(src);
    expect(spans.map((s) => s.ref)).toEqual([{ kind: "this" }]);
  });

  it("does not mistake a less-than operator for an IRI", () => {
    const { spans } = scanSparql("SELECT ?x WHERE { __THIS__ ?p ?x . FILTER(?x < 3 && ?x > [[Dog]]) }");
    // `[[Dog]]` in a FILTER is nonsense SPARQL, but the scanner's job is only
    // to find it; `< 3 && ?x >` must not swallow it as an IRI.
    expect(spans.map((s) => s.ref)).toEqual([{ kind: "this" }, { kind: "link", target: "Dog" }]);
  });

  it("reads a dataset directive from a comment and takes the first one", () => {
    expect(scanSparql("# dataset: combined\nSELECT * WHERE {}").dataset).toBe("combined");
    expect(scanSparql("#dataset:Inferred\n# dataset: asserted\nSELECT * WHERE {}").dataset).toBe("inferred");
    expect(scanSparql("# dataset: everything\nSELECT * WHERE {}").dataset).toBeNull();
    expect(scanSparql("# the dataset: combined one\nSELECT * WHERE {}").dataset).toBeNull();
  });
});

describe("rewriteSparql", () => {
  it("substitutes <iri> for every reference and keeps the rest byte for byte", () => {
    const r = rewriteSparql("# dataset: inferred\nSELECT ?p WHERE {\n  __THIS__ ?p [[Dog|a dog]] .\n}", resolve);
    expect(r).toEqual({
      ok: true,
      dataset: "inferred",
      sparql: "# dataset: inferred\nSELECT ?p WHERE {\n  <urn:ontomark:page:People/Rex> ?p <urn:ontomark:page:Ontology/Dog> .\n}",
    });
  });

  it("falls back to the caller's dataset when the block names none", () => {
    expect(rewriteSparql("ASK { __THIS__ ?p ?o }", resolve).dataset).toBe("asserted");
    expect(rewriteSparql("ASK { __THIS__ ?p ?o }", resolve, "combined").dataset).toBe("combined");
  });

  it("fails as a whole when any reference is unresolved, listing each once", () => {
    const r = rewriteSparql("SELECT * WHERE { [[Nobody]] ?p [[Dog]] . [[Nobody]] ?q __THIS__ }", (ref) => (ref.kind === "link" && ref.target === "Dog" ? "urn:d" : null));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unresolved).toEqual([{ kind: "link", target: "Nobody" }, { kind: "link", target: "Nobody" }, { kind: "this" }]);
    const text = describeUnresolved([...new Map(r.unresolved.map((u) => [JSON.stringify(u), u])).values()]);
    expect(text).toBe("Unresolved: [[Nobody]] (no such entity note); __THIS__ (this note is not an ontology entity: it needs `type: class`, `individual` or `property`)");
  });

  it("leaves a query with no references untouched", () => {
    const src = "SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class> }";
    expect(rewriteSparql(src, resolve)).toEqual({ ok: true, dataset: "asserted", sparql: src });
  });
});
