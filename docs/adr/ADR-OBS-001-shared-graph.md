# ADR-OBS-001: consume the Ontomark graph

Status: Accepted — 2026-10-11

Ontomark owns reusable ontology parsing, reasoning, graph rendering and the NGG1 codec. This separate plugin repository owns Obsidian commands, vault events, view lifecycle, note opening and guarded edits. It consumes a checksum-pinned engine and an immutable shared graph package, and bundles both into its offline deployment.

The graph adapts the typed engine index without minting additional identities or turning prose links into ontology assertions. Classification remains explicit, incomplete reasoning remains visible, and inferred edges are dashed. The publisher uses the same renderer with its own stores, layout worker and navigation.

The Linux ZIP includes ready-to-install runtime files and dependency notices. Node and Rust are build tools; users need only Obsidian. Community distribution stays in this repository, avoiding the compiler workspace and estate-specific infrastructure.

See [Ontomark’s accepted decision](https://github.com/DreamLab-AI/ontomark/blob/main/docs/adr/ADR-OM-002-shared-graph-and-obsidian-boundary.md), [desktop acceptance](../desktop-acceptance.md) and [upstream attribution](https://github.com/DreamLab-AI/ontomark/blob/main/docs/UPSTREAMS.md).
