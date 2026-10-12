# ADR-OBS-002: a small Obsidian surface for shared assisted ingest

- Date: 2026-10-12
- Decision status: proposed
- Implementation status: none
- Activation status: inactive
- Scope: this repository's product boundary and hand-off notes for the wider ADR fleet

## Product decision

**Ontomark for Obsidian is a limited application of Ontomark, itself one part of VisionFlow.** Keep the plugin useful to people who know Obsidian but not ontology engineering. It should explain typed notes, show one local vault graph, reason and query locally, and offer clear note-level actions. Reusable ontology logic belongs in [Ontomark](https://github.com/DreamLab-AI/ontomark); estate orchestration belongs in VisionFlow consumers. The plugin must not own a second parser, extractor, identity scheme or reasoning engine.

Assisted ingest is a future optional action: select a Markdown note and ask the shared Rust/WASM core to extract useful structure into the same vault. A model adapter may be configured separately. No Python runtime, bridge, build step, test dependency or release artefact belongs in the new path. The core plugin still works without a model. The plugin does not require an estate review queue, a multi-graph store or a publication workflow. An ingest action is user-invoked, with source-revision checks, visible diagnostics and an undoable result; model output never silently edits notes in the background. Current diff-preview edit commands remain documented as shipped behaviour, but they do not impose a mandatory approval stage on this future action.

[OntoCast](https://github.com/growgraph/ontocast) is a suitable source of methods, not a runtime dependency. Upstream 0.6.7 is Python and Apache-2.0 ([licence](https://github.com/growgraph/ontocast/blob/main/LICENSE), [package metadata](https://github.com/growgraph/ontocast/blob/main/pyproject.toml)); the reviewed main commit was `abb8d7b8d6db1a765d4f091a7423937c2cbc5d78`. Its ontology-guided extraction, graph patches, identity reconciliation and provenance are candidates for a native Rust implementation. Before any code adaptation, inventory the exact upstream files and preserve copyright and Apache-2.0 terms in source and the future distribution pack. Current Ontomark and plugin releases do not contain OntoCast code. The earlier [RDF-to-Logseq adapter](https://github.com/DreamLab-AI/knowledgeGraph/blob/main/docs/integrations/ontocast.md) is retired because it emits the old format; it is migration evidence, not an integration to reactivate.

## Where the work belongs

| Layer | Owns | Does not own |
| --- | --- | --- |
| **Ontomark core** | Portable extraction contract, evidence spans, identity resolution, typed assertions, safe document changes, native/WASM parity | Obsidian UI, model credentials, estate governance |
| **This plugin** | One-vault command and settings, note selection, status, undo and Obsidian vault events | Extraction algorithms, a second graph model, estate publication |
| **VisionFlow hosts** | Corpus vocabulary, ingestion schedules, model/provider operations, publication and any governance policy | The generic plugin's interaction model |

The first core vertical slice should use deterministic fixtures and a mock model, then prove an optional configured model adapter. It should reuse `ontomark-parse`, `ontomark-model` and `ontomark-reason`, not duplicate their logic. The plugin should expose the feature only after installed Obsidian testing on a plain vault proves source spans, repeat runs, stale edits, cancellation, undo and model-unavailable behaviour.

## Findings from the reorganisation ADR fleet

These are status notes from source and ADR review on 2026-10-12, not claims that all consumers have deployed the same generation.

| Area | Evidence and present state | Remaining work |
| --- | --- | --- |
| **Shared core** | [VisionFlow ADR-2014](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/adr/ADR-2014-shared-ontology-workspace.md) is accepted, partial and staged. [Ontomark's hand-off](https://github.com/DreamLab-AI/ontomark/blob/main/docs/HANDOFF.md) records released parser/model/reasoner/compiler, WASM engine, graph package and plugin. | Finish consumer replacement, normative estate profile migration and deletion of duplicate semantic paths. Add the native/WASM assisted-ingest design as a core ADR. |
| **Typed semantics** | [ADR-2015](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/adr/ADR-2015-typed-ontology-model-and-migration.md) is proposed, with no implementation or activation claimed. The shared compiler has an opt-in typed projection, while the legacy CLI retains compatibility semantics. | Define and test identity/property/predicate fixes, full migration deltas, rollback and corpus-wide acceptance before changing the authoritative profile. |
| **Obsidian product** | [ADR-2016](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/adr/ADR-2016-local-markdown-ontology-application.md) is accepted, partial and staged. This plugin's 0.1.0 release has local graph, supported reasoning, SPARQL and guarded edits; installed Linux desktop acceptance passed. | Complete richer editing, vocabulary/identity diagnostics and export preview if retained in product scope; establish resource budgets and broader desktop coverage. Mobile remains unsupported. Assisted ingest is unimplemented. |
| **Publisher and corpus** | [visionGraph ADR-VG-007](https://github.com/jjohare/visionGraph/blob/main/docs/adr/ADR-VG-007-shared-ontology-workspace-and-profile.md) is accepted, partial and partially active. Narrative Goldmine uses the pinned CLI, shared renderer and Rust codec. | Complete corpus-profile and collision-lint migration and any ingest consumer adapter without weakening publication boundaries. |
| **VisionClaw and Agentbox** | [VisionClaw ADR-2137](https://github.com/DreamLab-AI/VisionClaw/blob/main/docs/adr/ADR-2137-consume-shared-ontology-workspace.md) and [Agentbox ADR-2136](https://github.com/DreamLab-AI/agentbox/blob/main/docs/adr/ADR-2136-pin-the-shared-ontology-toolchain.md) remain proposed and inactive. | Replace duplicate native parser/writer/reasoner paths behind conformance tests; repin Agentbox's immutable CLI to released Ontomark and preserve its existing corpus command contract. |
| **Loom and VOWL** | [Loom ADR-142](https://github.com/DreamLab-AI/loom/blob/main/docs/design/ADR-142-consume-versioned-shared-ontology-contracts.md) is partial and inactive; shared readers are adopted, but IRI/provenance adoption and first served activation remain. [vowl-wasm ADR-001](https://github.com/DreamLab-AI/vowl-wasm/blob/main/docs/adr/ADR-001-shared-ontology-rendering-contract.md) is implemented and active for codec ownership. | Prove Loom's first served Ontomark bundle and reload identity. VOWL's npm registry publication remains a distribution task; the GitHub browser bundle is already available. |

The [Ontomark deprecation inventory](https://github.com/DreamLab-AI/ontomark/blob/main/docs/DEPRECATION.md) tracks the detailed replacement gates. The older [ontology-workspace investigation](https://github.com/jjohare/visionGraph/blob/main/planning/ontology-workspace/README.md) predates the released plugin and the owner's renewed ingest direction; its `implementation_status: none` frontmatter is historical, not a current estate status. Its description of the Logseq adapter as archived remains accurate for that adapter only.

## Drafts to carry into the higher-level ADR set

1. **Ontomark:** own a separate Rust-native, WASM-capable assisted-ingest crate or module. Specify an evidence-bearing candidate contract, host-supplied model interface, no Python dependency, upstream attribution and native/browser parity. Reuse existing semantic and patch crates.
2. **VisionFlow ADR-2014/2016:** record assisted ingest as an optional shared capability. Keep the discrete plugin to one local graph and a small user action; estate governance and multi-graph concerns stay with their hosts.
3. **visionGraph ADR-VG-007:** treat the retired Logseq adapter as migration evidence. Any new estate ingest adapter must consume the shared native contract and pass corpus vocabulary and publication checks before activation.
4. **Consumer ADRs:** add ingest-specific adapters only when VisionClaw, Agentbox or Loom actually consumes the versioned contract. Their existing migration gates remain open independently of this plugin.

These are drafts for the relevant repository owners to take forward. This ADR does not alter their accepted decisions or claim implementation of the proposed ingest feature.
