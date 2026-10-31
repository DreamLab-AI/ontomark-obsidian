---
id: ADR-OBS-004
title: "SPARQL in a note, after Dot Triples"
date: 2026-10-13
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: "6dd648b2068377077d9118c4e678479d5fe64eb1"
verified_paths: []
owner: jjohare
review_trigger: "a change to the ontomark-sparql fence, the rewriting rules, or Dot Triples' licence"
repo: ontomark-obsidian
---

# ADR-OBS-004: SPARQL in a note, after Dot Triples

- Decision status: accepted (owner request: "adopt the good stuff with attribution")
- Implementation status: active in 0.3.0. `src/sparql-rewrite.ts` (pure rewriting), `src/sparql-block.ts` (the `ontomark-sparql` fence), `src/views/query-render.ts` (table shared with the query view). Unit tests `test/sparql-rewrite.test.ts`; offline end-to-end checks in `test/e2e/offline.e2e.cjs` (EXP-13).
- Related: [ADR-OBS-001](ADR-OBS-001-shared-graph.md) (the plugin owns Obsidian surfaces, the engine owns semantics); engine [ADR-OM-006](https://github.com/DreamLab-AI/ontomark/blob/main/docs/adr/ADR-OM-006-dot-triples-interop.md) (the bridge and the wider decision).

Status mapping 2026-10-31: the record's `Implementation status: active in 0.3.0` is not a checker value. `activation_status: live` follows its word "active"; `implementation_status: partial` is the conservative reading because the record does not say "complete". Owner to confirm.

Verification 2026-10-31: `verified_commit` is this record's own last-modified commit, recorded when the record was moved onto the estate ledger format. It is not a re-verification of the code the record describes, and `verified_paths` is empty, so the staleness gate is not yet armed for this record.

## Context

Cristian Vasquez's [Dot Triples plugin](https://github.com/cristianvasquez/dot-triples-plugin) (MIT) renders a `dot-sparql` fenced block in a note as a live SPARQL result, rewriting `__THIS__` to the current note and `[[Note]]` to that note's IRI first. Ontomark had a SPARQL view only: a panel with a textarea. A query worth keeping belongs in the note it is about.

## Decision

1. An `ontomark-sparql` fenced block runs its query against the local graph and renders the result where the block is, in reading view, with the same table as the query view. It re-runs, debounced, when the index or classification changes, and stops listening when the renderer discards it.
2. Before running, `__THIS__` becomes the IRI of the entity whose note holds the block, and `[[Note]]`, `[[Note|alias]]` or `[[Note#Heading]]` becomes the IRI of the entity Obsidian resolves that link to from this note. The fragment is dropped; the engine has no heading IRIs.
3. A leading comment `# dataset: asserted|inferred|combined` picks the dataset; the default is asserted. The query stays valid SPARQL everywhere, so it can be pasted into the view or any other engine unchanged.
4. Rewriting skips string literals, `<IRI>` tokens and comment bodies. Dot Triples' own README lists "SPARQL replacement also affects quoted strings and comments" as a known defect; this implementation does not share it.
5. A reference that does not resolve fails the whole block with a reason naming it. A plain note using `__THIS__` is told it is not an ontology entity and what key would make it one. Nothing runs against a half-substituted pattern.
6. The block uses the same query path, row cap and refusals (no UPDATE, SERVICE or FROM) as the view, and the same offline contract: it makes no network request.

## Not adopted

Inline `key :: value` fields. They are Dot Triples' Dataview-shaped input and would make prose assert, which Ontomark refuses by design so that a diff is the whole review. The engine repository publishes a bridge (`bridges/dot-triples/`) so a vault read by both tools yields one graph instead.

## Attribution

The idea and the two token names are Cristian Vasquez's; the implementation here is independent and no source was copied. `THIRD-PARTY-NOTICES.md` and `NOTICE` carry the method attribution, and the README's "Further afield" links both of his repositories.
