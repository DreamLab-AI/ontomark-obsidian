# Desktop acceptance

The extracted plugin source `eabf487` passed installed Obsidian 1.14.4 checks on Linux, using a scratch vault containing this repository's synthetic fixtures. The engine came from `v0.1.0-rc.1`, source `21cd9ff`, verified by the SHA-256 in `engine.json`.

Automation used Chrome DevTools MCP against Obsidian's Electron renderer in the browser sidecar. No Obsidian API shim was used for these checks.

| Check | Observed result |
| --- | --- |
| Embedded Blob worker | Initialised successfully; generation 1, epoch 1. |
| Index | 13 documents, 10 entities, 47 asserted triples. |
| Classification | Inferred parents and an unsatisfiable class displayed. Unsupported property range correctly marked incomplete. |
| Query UI | Default SELECT returned seven class rows. |
| Diff preview | Rendered the proposed frontmatter addition; file remained unchanged before Apply. |
| Apply | Real `vault.process` wrote exactly the proposed bytes and preserved the original body. |
| Concurrent edit | Returned `source_changed`; later file bytes remained intact. |
| Unload/reload | Old API refused calls; a fresh instance indexed 13 notes and returned eight class rows after the test edit. |
| Console | No errors or warnings during the tested operations. |

Raw MCP receipts are in [evidence](evidence/). The [query screenshot](evidence/desktop-query.png) shows the reloaded plugin. Settings, other desktop versions and mobile have not received a full acceptance pass. The independent offline shim test separately checks the plugin under `docker --network none`; the desktop run did not block Obsidian's own update requests.

## Shared graph acceptance

The graph consumer pins `@dreamlab-ai/ontomark-graph` 0.1.0 from the immutable Ontomark release `ontomark-graph-v0.1.0` (SHA-256 `de491e2d7d947503d3c49c140193c88a9d17cfec5fbb334166002049c8d56aa5`). The same package is consumed by Narrative Goldmine. Installed Obsidian 1.14.4 checks passed with 11 synthetic entities and 17 edges, including 9 inferred edges.

| Check | Result |
| --- | --- |
| Keyboard | ArrowLeft from no selection chooses the last entity; ArrowRight wraps to the first. |
| Search | Dog search narrowed the accessible list to 2 matches; clicking selected its stable IRI. |
| Zoom and focus | Zoom increased scale; neighbourhood reduced to 6 nodes; All nodes restored 11. |
| Inference filter | Disabling inference removed every inferred edge; enabling restored 9. |
| Note activation | Enter opened `Ontology/Animal.md` through the real Obsidian workspace. |
| Cleanup | Closing removed the canvas and cleared renderer/subscriber; reopening rendered successfully. |
| Console | No errors or warnings during the tested operations. |

[Raw graph receipt](evidence/desktop-graph-acceptance.log) and [screenshot](evidence/desktop-graph.png) record the scratch vault. [Red keyboard witness](evidence/desktop-graph-arrowleft-red.log) demonstrates the selection defect before its fix. This is runtime evidence for this synthetic fixture, separate from the network-isolated shim.

The [README screenshots](screenshots/README.md) were captured from the installed plugin, with the sidebar collapsed to show each view clearly. Production npm audit reports zero findings; build dependencies retain two moderate advisories through the Obsidian development SDK. These are separate from the installed bundle, and an independent security-agent review was unavailable.

## Assisted ingest acceptance (2026-10-12)

Plugin source `46c3c66` (engine `v0.2.0`, source `8a3b6cc`, verified by the SHA-256 in `engine.json`) on installed Obsidian 1.14.4 Linux, same scratch vault, driven over raw CDP against the Electron renderer. The model endpoint was a local fixed-answer stub inside the sidecar, so every byte the plugin sent and received is on record; no external service was involved. Covers the gates in [ADR-OBS-003](adr/ADR-OBS-003-ingest-action-and-offline-contract.md).

| Check | Observed result |
| --- | --- |
| Plan | `ingestPlan` on a real class note: one chunk, six class-appropriate keys (no `instance-of`), evidence-bearing note block. No network. |
| Session key | Entered through settings; `data.json` provably does not contain it. Cleared on unload. |
| One call, one destination | The stub logged exactly one request, to the typed URL verbatim, bearer present (`evidence/desktop-ingest-stub-requests.jsonl`). |
| Modal | Diff adding `subclass-of: [[Animal]]`, the accepted fact with its grounding tier and quote, and two refusals named (`ungrounded` for an invented class, `evidence_not_found` for a quote not in the note). `screenshots/ingest-modal.png`. |
| Apply | Real `vault.process` wrote exactly the proposed bytes; body preserved; one Notice; modal closed. |
| Repeat run | The written fact returned as `already_present`; the two refusals persisted; one request. |
| Stale edit | Editing the note between plan and accept refused with the digest mismatch; nothing written. |
| Unreachable endpoint | `model_unavailable` Notice carrying `net::ERR_CONNECTION_REFUSED`; file unchanged; no modal. |
| Malformed JSON | Chunk dropped with its Notice; modal reported nothing grounded; file unchanged. |
| Non-ASCII span | A quote past an em dash and guillemets was located; clicking it selected exactly that text in the editor (UTF-16 offsets correct). `evidence/desktop-ingest-nonascii.png`. |
| Cancel on unload | With a 4 s slow stub: a second invocation mid-run was refused; disabling the plugin mid-request left exactly one request on the stub and none after; key cleared. |
| Undo | Obsidian's editor undo restored the pre-apply text on disk. |

Not covered: a real remote model, redirects from the endpoint, mobile. The manifest and README release amendment remains deferred to the release commit.
