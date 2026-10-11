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
