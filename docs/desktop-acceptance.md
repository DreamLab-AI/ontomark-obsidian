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

Raw MCP receipts are in [evidence](evidence/). The [query screenshot](evidence/desktop-query.png) shows the reloaded plugin. Settings, keyboard navigation, other desktop versions and mobile have not received a full acceptance pass. The independent offline shim test separately checks the plugin under `docker --network none`; the desktop run did not block Obsidian's own update requests.
