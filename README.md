# Ontomark for Obsidian

## What it is

Ontomark treats typed Markdown pages as an ontology. Pages whose frontmatter declares a `type` become classes, individuals or properties; the plugin indexes them, runs a local reasoner, answers SPARQL queries and proposes reviewed frontmatter edits. It needs no special vault layout or prior knowledge of any particular corpus.

## Install

This repository contains the Obsidian plugin. The portable Rust engine is maintained separately in [Ontomark](https://github.com/DreamLab-AI/ontomark). You do not need the other DreamLab repositories to install or build the plugin.

1. Download [ontomark-obsidian-0.1.0.zip](https://github.com/DreamLab-AI/ontomark-obsidian/releases/download/0.1.0/ontomark-obsidian-0.1.0.zip) from the [release](https://github.com/DreamLab-AI/ontomark-obsidian/releases/tag/0.1.0).
2. Extract it into `<vault>/.obsidian/plugins/`. It creates `ontomark/main.js`, `ontomark/manifest.json` and `ontomark/styles.css`, with the licence notices.
3. In Obsidian, open Settings → Community plugins and enable Ontomark. Reload Obsidian if it was open during installation.

The ZIP is ready to use on Linux, including CachyOS. No Node, npm, Rust, system WASM library or internet connection is needed at runtime. The engine is already embedded in `main.js`. Desktop acceptance was run in Obsidian 1.14.4; mobile is not supported.

Individual `main.js`, `manifest.json` and `styles.css` files are also attached to the release for manual installation and Obsidian's community plugin tooling. A SHA-256 receipt accompanies the ZIP.

## Quickstart on any vault

Create `Animal.md`:

```markdown
---
type: class
title: Animal
---
```

Create `Dog.md`:

```markdown
---
type: class
subclass-of: ["[[Animal]]"]
---
```

Open the graph with the ribbon icon or "Open ontology graph". Use "Open ontology panel" for the class list. Both pages appear under Classes, and Dog lists Animal as its parent. Run "Classify now" to add inferred superclasses.

## Generic profile keys

| Key | Meaning |
| --- | --- |
| `type` | `class`, `individual` or `property` |
| `title` | Label of the entity (defaults to the page name) |
| `aliases` | Alternative labels |
| `iri` | Explicit IRI (otherwise derived from the page path) |
| `subclass-of` / `is-a` | Superclass links |
| `equivalent-to` | Equivalent classes |
| `disjoint-with` | Disjoint classes |
| `instance-of` | Class an individual belongs to |
| `domain` | Property domain |
| `range` | Property range |
| `subproperty-of` | Parent property |

Any other frontmatter key becomes an annotation. Wikilinks in prose are never axioms: pages without a `type` are plain notes, used for navigation only.

## Features

- **Explorable graph**: pan, zoom, search, select, focus on a neighbourhood and open notes. Asserted edges are solid and inferred edges dashed. Circles, squares and diamonds distinguish classes, individuals and properties. Run Classify to add inference; incomplete classification is shown. Both this plugin and Narrative Goldmine use [Ontomark’s shared graph package](https://github.com/DreamLab-AI/ontomark/tree/main/packages/graph).
- **Panel**: classes, individuals and properties with their told parents, inferred superclasses (badged), unsatisfiable classes, diagnostics and a count of plain notes.
- **Reasoning**: classification runs locally, in a background worker, and is cancelled by any edit.
- **SPARQL view**: SELECT, ASK and CONSTRUCT over the asserted, inferred or combined dataset.
- **Guarded edits with diff preview**: "Make this note a class / individual / property" and "Add parent to this note" show a diff first. Nothing is written unless you press Apply, and the write is refused if the file changed in the meantime.

## Privacy and offline

Ontomark makes no network requests and needs no account or database. The WebAssembly engine is embedded in `main.js`; the worker is created from an in-memory blob.

## Limits

- **Desktop only; mobile is not supported** (`isDesktopOnly: true`).
- Reasoning is OWL 2 EL (`ontomark-reason` over `whelk-el`). Constructs outside EL, or in EL but not implemented (for example property ranges), are refused whole, never weakened; the panel lists them and marks the classification incomplete. Individuals are typed from the class hierarchy; there is no ABox reasoning beyond that.
- Classification first runs the complete policy within a budget; if a large vault exceeds it, it falls back to the `relevant` policy (named subsumptions unchanged, unsatisfiability through dropped existentials not propagated) and says so.
- SPARQL (Oxigraph's parser and evaluator over an in-memory graph): SELECT, ASK and CONSTRUCT with basic graph patterns, property paths, joins, OPTIONAL, UNION, MINUS, FILTER (including EXISTS), BIND, VALUES, GRAPH, sub-selects, GROUP BY with aggregates, ORDER BY, DISTINCT, LIMIT/OFFSET. Refused with a message: UPDATE, SERVICE (anywhere in the query), FROM/FROM NAMED, DESCRIBE and extension functions. Choose the default graph with the asserted / inferred / combined selector; the asserted and inferred graphs are also named `<urn:ontomark:graph:asserted>` and `<urn:ontomark:graph:inferred>`. Results are capped by the row-limit setting.
- Queries have a time limit, enforced by restarting the worker; the index is rebuilt from the notes after a restart.
- Classification reports the full set of entailed subsumptions. That is cheap for ordinary taxonomies (wide and a few levels deep) but grows quadratically with depth: a single chain of 3,000 classes entails about 4.5 million subsumptions and does not finish within the two-minute classify limit. No size or latency budget is promised yet. One measurement, for orientation only (wasm under Node 22 on the build host, a 9,258-page vault): load 1.9 s, index 1.2 s, classify 1.7 s (complete policy, 86,970 subsumptions), first query about 0.3 s while the query store is built, then a few milliseconds per query; about 1.3 GB resident.
- Cancel-on-edit is cooperative: the worker checks between reasoner steps, and a result for an older generation is discarded on arrival whatever happens. A single long query cannot be interrupted except by the timeout restart.

## Optional: estate profile

The "Estate corpus profile" (Settings, Ontomark, Profile) reads corpora that use resource IRIs, a `public: true` gate, `is-a` and `same-as`. Leave it on Generic unless your vault follows that contract.

## Build and test

Needs Node 22 or later. The build fetches the versioned Ontomark WASM engine and verifies its pinned SHA-256; no Rust toolchain is needed. Note that `npm install` must include dev dependencies (`npm install --include=dev` if your npm config omits them).

```
npm ci --include=dev   # install the locked build dependencies
npm run build          # wasm, type-check, production bundle into dist/
npm run check:bundle   # static check of dist/main.js: no network API, engine embedded
npm test               # Vitest: generation guard and worker protocol over the real engine
npm run test:wasm      # node:test: the built wasm replays the engine script byte-identically to native
npm run test:offline   # installs dist/ into a scratch vault, runs the end-to-end driver in docker --network none
```

### What the offline test does and does not prove

`npm run test:offline` copies `dist/` into `<scratch vault>/.obsidian/plugins/ontomark/`, streams the vault and the driver into a `node` container started with `--network none`, and evaluates the installed `main.js` the way Obsidian loads a plugin. It indexes, classifies, queries (through the query view), proposes and applies a patch through the diff modal, refuses a patch whose file changed after the preview, follows delete and rename events, switches profile, unloads (worker terminated, listeners and views gone) and reloads. A tripwire records any socket, DNS, HTTP, fetch, XHR or WebSocket use in the main and worker threads; the run fails on any.

It runs against `test/e2e/obsidian-shim.cjs`, a filesystem-backed stand-in for the Obsidian API calls the plugin uses, and a `worker_threads` worker that accepts the plugin's Blob URL. It is not Obsidian. An installed Obsidian 1.14.4 acceptance run also passed on Linux in the browser sidecar: the Blob worker compiled the embedded module, indexed 13 synthetic notes, classified them, rendered diagnostic and inferred-parent panels, returned seven SPARQL rows, applied a reviewed frontmatter edit without changing its body, refused a concurrent edit through real `vault.process`, and unloaded/reloaded into a fresh working engine. No browser console errors or warnings were observed. This covers that desktop version and synthetic fixture; mobile and broad desktop compatibility remain untested.

See [desktop acceptance evidence](docs/desktop-acceptance.md) for the checks and their scope.

## Licence

MIT OR Apache-2.0. The ZIP includes [third-party notices](THIRD-PARTY-NOTICES.md). [Upstream credits and source repositories](https://github.com/DreamLab-AI/ontomark/blob/main/docs/UPSTREAMS.md) include Whelk/Whelk-rs, Oxigraph, wasm-bindgen and their dependencies. See [graph ownership](docs/adr/ADR-OBS-001-shared-graph.md) for the core/plugin boundary.
