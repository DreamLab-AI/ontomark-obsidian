---
id: ADR-OBS-001
title: "consume the Ontomark graph"
date: 2026-10-11
decision_status: accepted
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: "ebf8fd6e2b3ee854cc8225ca06dff039de2e218c"
verified_paths: []
owner: jjohare
review_trigger: "a change to how the plugin consumes the Ontomark engine and graph package, or to the checksum-pinned release contract"
repo: ontomark-obsidian
---

# ADR-OBS-001: consume the Ontomark graph

Status mapping 2026-10-31: the record's only status text is `Status: Accepted — 2026-10-11` and it states no implementation or activation, so the lowest values (`none`, `inactive`) are taken. That is the absence of a statement, not a claim that the plugin does not consume the graph (the record describes a released Linux ZIP). Owner to set the real values.

Verification 2026-10-31: `verified_commit` is this record's own last-modified commit, recorded when the record was moved onto the estate ledger format. It is not a re-verification of the code the record describes, and `verified_paths` is empty, so the staleness gate is not yet armed for this record.


Ontomark owns reusable ontology parsing, reasoning, graph rendering and the NGG1 codec. This separate plugin repository owns Obsidian commands, vault events, view lifecycle, note opening and guarded edits. It consumes a checksum-pinned engine and an immutable shared graph package, and bundles both into its offline deployment.

The graph adapts the typed engine index without minting additional identities or turning prose links into ontology assertions. Classification remains explicit, incomplete reasoning remains visible, and inferred edges are dashed. The publisher uses the same renderer with its own stores, layout worker and navigation.

The Linux ZIP includes ready-to-install runtime files and dependency notices. Node and Rust are build tools; users need only Obsidian. Community distribution stays in this repository, avoiding the compiler workspace and estate-specific infrastructure.

See [Ontomark’s accepted decision](https://github.com/DreamLab-AI/ontomark/blob/main/docs/adr/ADR-OM-002-shared-graph-and-obsidian-boundary.md), [desktop acceptance](../desktop-acceptance.md) and [upstream attribution](https://github.com/DreamLab-AI/ontomark/blob/main/docs/UPSTREAMS.md).
