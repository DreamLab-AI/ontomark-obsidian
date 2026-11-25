# Engine 0.10.0 adoption — 25 November 2026

Consumes Ontomark v0.10.0, source fa173a183e65a29944becb6eb4d55b52b9ba6b06,
with the release archive digest recorded in engine.json
(78cb7f99f0873165408ab0c08e2f6e433c681307dd8e6ff571312b9cd88ae905).
The generated declaration (`src/generated/web/ontomark_wasm.d.ts`) is byte-identical to
the 0.9.0 one: the wasm surface is unchanged (`WasmEngine`, `review_binding`, `version`).

The consumer transcript changes only the engine version string (`0.9.0` to `0.10.0`,
6 lines); re-blessed with `ONTOMARK_BLESS=1` and checked to be identical to the previous
golden once the version is substituted back.

## Write path: unchanged, and why

Ontomark 0.10.0 ships the `ontomark-write` crate for the CLI, but the released wasm
engine does not depend on it and exposes no write request. The plugin therefore keeps its
own guarded patch path (`propose_patch`: frontmatter, parent and type edits shown as a diff
and applied through the normal reviewed-edit route). That path does not apply the write
engine's vocabulary validation or stamps. It is not wired to the new engine.

To change this, a future Ontomark release must: (1) make `ontomark-wasm` depend on
`ontomark-write` with `default-features = false`; (2) add engine request kinds
`configure_write` and `write` that forward to `ontomark_write::wire::execute`; (3) ship a
new engine archive. The plugin then adds the protocol types, client methods, a plan
applier over `vault.process`, vocabulary and operator settings, and write UI.

Validation: CI-mode build, 132 unit tests, native-fixture replay through Node and browser
WASM, bundle boundary check, offline execution. Dependencies unchanged.
