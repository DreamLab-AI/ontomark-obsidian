# Obsidian screenshots

These unedited screenshots show the Ontomark plugin 0.3.3 (engine 0.2.2, `whelk-el` 0.2.2) in Obsidian 1.14.4 on Linux. The scratch vault uses the repository's synthetic test notes, including a deliberate unsatisfiable class and an unsupported property range, plus four notes (Fox, Lynx, Renard, Wolf) left by the assisted-ingest acceptance runs. No private estate corpus is shown.

- `graph.png`, `ontology-panel.png`, `sparql.png`: the vault as it is. The panel lists 12 classes and the SPARQL view returns 12 class rows.
- `ontology-panel-diagnostics.png`, `sparql-in-note.png`: taken with two extra temporary notes, removed afterwards. `Ontology/Jackal.md` writes `subclass-of` as a single quoted link to show the info-level note; `Notes/Rex types.md` holds the `ontomark-sparql` block.
- `ingest-modal.png`: the assisted-ingest diff from the 2026-10-12 acceptance run (plugin 0.2.x). The modal has not changed since.

The graph uses the pinned shared renderer and the engine recorded in `engine.json`. Screenshots were captured over raw Chrome DevTools Protocol against the running Obsidian renderer. Runtime validation is documented in [desktop acceptance](../desktop-acceptance.md).
