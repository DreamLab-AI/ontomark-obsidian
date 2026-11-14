# VOWL browser release upstream attribution

This inventory binds the planned `vowl-wasm` 0.2.3 browser release to tag `v0.2.3`, source `756f49f5ab7bac9a97b3701157bb923da34abe22`, features `ngg1,interaction` and target `wasm32-unknown-unknown`. The reviewed diff changes only this crate's version in Cargo.lock and adds no third-party source or dependencies, so the package table and complete notices carry forward from 0.2.2. The official release workflow still requires rustc 1.99.0 and wasm-pack 0.15.0; the local rustc 1.99.1 candidate is test evidence, not that pinned release. [Full notices](../THIRD-PARTY-NOTICES.md) accompany the package. Existing frozen release assets remain unchanged; this inventory does not claim publication of 0.2.3.

## Authors and lineage

- [WebVOWL](https://github.com/VisualDataWeb/WebVOWL), by Vincent Link, Steffen Lohmann, Eduard Marbach, Stefan Negru and Vitalis Wiens: origin of the VOWL notation and ontology JSON shape. This crate is a clean-room implementation; the original MIT notice remains in LICENSE and the companion.
- [Nalgebra](https://github.com/dimforge/nalgebra), by Sébastien Crozet and contributors, and nalgebra-macros by Andreas Longva, Sébastien Crozet and contributors: linear algebra. The 0.32.6 Cargo metadata declares BSD-3-Clause, while its packaged/source licence is Apache-2.0. We retain the actual Apache licence and inherited BSD notice. The macros crate’s packaged licence is a parent-file reference, resolved to the full parent notice.
- [Wide](https://github.com/Lokathor/wide), [safe_arch](https://github.com/Lokathor/safe_arch) and [bytemuck](https://github.com/Lokathor/bytemuck), by Daniel “Lokathor” Gee and contributors: SIMD and data representation. Wide ships its actual Zlib notice; it replaces the scanner’s generic MIT fallback.
- [wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen) and contributors: browser bindings and generated JavaScript glue.
- [Petgraph](https://github.com/petgraph/petgraph) and contributors: graph structures. [Serde](https://github.com/serde-rs/serde), by David Tolnay, Erick Tryzelaar and contributors: serialisation.
- [Ontomark NGG1](https://github.com/DreamLab-AI/ontomark), by DreamLab AI and contributors: the shared tier codec. Its actual packaged licence and inherited NOTICE are retained.

## Frozen dependency inventory

Versions, authors, licence expressions and repositories come from the frozen Cargo metadata. The source link for each registry package returns its exact published source archive. Build/procedural-macro dependencies are conservatively included; dev dependencies and native-only parallel features are excluded.

| Package | Version | Declared licence | Authors | Repository / exact source |
| --- | --- | --- | --- | --- |
| approx | 0.5.1 | `Apache-2.0` | Brendan Zabarauskas &lt;bjzaba@yahoo.com.au&gt; | [Repository](https://github.com/brendanzab/approx) / [Source](https://crates.io/api/v1/crates/approx/0.5.1/download) |
| autocfg | 1.5.1 | `Apache-2.0 OR MIT` | Josh Stone &lt;cuviper@gmail.com&gt; | [Repository](https://github.com/cuviper/autocfg) / [Source](https://crates.io/api/v1/crates/autocfg/1.5.1/download) |
| bumpalo | 3.20.3 | `MIT OR Apache-2.0` | Nick Fitzgerald &lt;fitzgen@gmail.com&gt; | [Repository](https://github.com/fitzgen/bumpalo) / [Source](https://crates.io/api/v1/crates/bumpalo/3.20.3/download) |
| bytemuck | 1.25.2 | `Zlib OR Apache-2.0 OR MIT` | Lokathor &lt;zefria@gmail.com&gt; | [Repository](https://github.com/Lokathor/bytemuck) / [Source](https://crates.io/api/v1/crates/bytemuck/1.25.2/download) |
| cfg-if | 1.0.4 | `MIT OR Apache-2.0` | Alex Crichton &lt;alex@alexcrichton.com&gt; | [Repository](https://github.com/rust-lang/cfg-if) / [Source](https://crates.io/api/v1/crates/cfg-if/1.0.4/download) |
| equivalent | 1.0.2 | `Apache-2.0 OR MIT` | See upstream contributor history | [Repository](https://github.com/indexmap-rs/equivalent) / [Source](https://crates.io/api/v1/crates/equivalent/1.0.2/download) |
| fixedbitset | 0.4.2 | `MIT OR Apache-2.0` | bluss | [Repository](https://github.com/petgraph/fixedbitset) / [Source](https://crates.io/api/v1/crates/fixedbitset/0.4.2/download) |
| futures-core | 0.3.34 | `MIT OR Apache-2.0` | See upstream contributor history | [Repository](https://github.com/rust-lang/futures-rs) / [Source](https://crates.io/api/v1/crates/futures-core/0.3.34/download) |
| futures-task | 0.3.34 | `MIT OR Apache-2.0` | See upstream contributor history | [Repository](https://github.com/rust-lang/futures-rs) / [Source](https://crates.io/api/v1/crates/futures-task/0.3.34/download) |
| futures-util | 0.3.34 | `MIT OR Apache-2.0` | See upstream contributor history | [Repository](https://github.com/rust-lang/futures-rs) / [Source](https://crates.io/api/v1/crates/futures-util/0.3.34/download) |
| hashbrown | 0.17.1 | `MIT OR Apache-2.0` | See upstream contributor history | [Repository](https://github.com/rust-lang/hashbrown) / [Source](https://crates.io/api/v1/crates/hashbrown/0.17.1/download) |
| indexmap | 2.14.2 | `Apache-2.0 OR MIT` | See upstream contributor history | [Repository](https://github.com/indexmap-rs/indexmap) / [Source](https://crates.io/api/v1/crates/indexmap/2.14.2/download) |
| itoa | 1.0.18 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/itoa) / [Source](https://crates.io/api/v1/crates/itoa/1.0.18/download) |
| js-sys | 0.3.105 | `MIT OR Apache-2.0` | The wasm-bindgen Developers | [Repository](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/js-sys) / [Source](https://crates.io/api/v1/crates/js-sys/0.3.105/download) |
| matrixmultiply | 0.3.11 | `MIT OR Apache-2.0` | bluss, R. Janis Goldschmidt | [Repository](https://github.com/bluss/matrixmultiply/) / [Source](https://crates.io/api/v1/crates/matrixmultiply/0.3.11/download) |
| memchr | 2.8.3 | `Unlicense OR MIT` | Andrew Gallant &lt;jamslam@gmail.com&gt;, bluss | [Repository](https://github.com/BurntSushi/memchr) / [Source](https://crates.io/api/v1/crates/memchr/2.8.3/download) |
| nalgebra | 0.32.6 | `BSD-3-Clause` | Sébastien Crozet &lt;developer@crozet.re&gt; | [Repository](https://github.com/dimforge/nalgebra) / [Source](https://crates.io/api/v1/crates/nalgebra/0.32.6/download) |
| nalgebra-macros | 0.2.2 | `Apache-2.0` | Andreas Longva, Sébastien Crozet &lt;developer@crozet.re&gt; | [Repository](https://github.com/dimforge/nalgebra) / [Source](https://crates.io/api/v1/crates/nalgebra-macros/0.2.2/download) |
| num-complex | 0.4.6 | `MIT OR Apache-2.0` | The Rust Project Developers | [Repository](https://github.com/rust-num/num-complex) / [Source](https://crates.io/api/v1/crates/num-complex/0.4.6/download) |
| num-integer | 0.1.47 | `MIT OR Apache-2.0` | The Rust Project Developers | [Repository](https://github.com/rust-num/num-integer) / [Source](https://crates.io/api/v1/crates/num-integer/0.1.47/download) |
| num-rational | 0.4.2 | `MIT OR Apache-2.0` | The Rust Project Developers | [Repository](https://github.com/rust-num/num-rational) / [Source](https://crates.io/api/v1/crates/num-rational/0.4.2/download) |
| num-traits | 0.2.19 | `MIT OR Apache-2.0` | The Rust Project Developers | [Repository](https://github.com/rust-num/num-traits) / [Source](https://crates.io/api/v1/crates/num-traits/0.2.19/download) |
| once_cell | 1.21.4 | `MIT OR Apache-2.0` | Aleksey Kladov &lt;aleksey.kladov@gmail.com&gt; | [Repository](https://github.com/matklad/once_cell) / [Source](https://crates.io/api/v1/crates/once_cell/1.21.4/download) |
| ontomark-ngg1 | 0.1.0 | `MIT OR Apache-2.0` | DreamLab AI | [Repository](https://github.com/DreamLab-AI/ontomark) / [Source](https://crates.io/api/v1/crates/ontomark-ngg1/0.1.0/download) |
| paste | 1.0.15 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/paste) / [Source](https://crates.io/api/v1/crates/paste/1.0.15/download) |
| petgraph | 0.6.5 | `MIT OR Apache-2.0` | bluss, mitchmindtree | [Repository](https://github.com/petgraph/petgraph) / [Source](https://crates.io/api/v1/crates/petgraph/0.6.5/download) |
| pin-project-lite | 0.2.17 | `Apache-2.0 OR MIT` | See upstream contributor history | [Repository](https://github.com/taiki-e/pin-project-lite) / [Source](https://crates.io/api/v1/crates/pin-project-lite/0.2.17/download) |
| proc-macro2 | 1.0.107 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt;, Alex Crichton &lt;alex@alexcrichton.com&gt; | [Repository](https://github.com/dtolnay/proc-macro2) / [Source](https://crates.io/api/v1/crates/proc-macro2/1.0.107/download) |
| quote | 1.0.47 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/quote) / [Source](https://crates.io/api/v1/crates/quote/1.0.47/download) |
| rawpointer | 0.2.1 | `MIT OR Apache-2.0` | bluss | [Repository](https://github.com/bluss/rawpointer/) / [Source](https://crates.io/api/v1/crates/rawpointer/0.2.1/download) |
| rustversion | 1.0.23 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/rustversion) / [Source](https://crates.io/api/v1/crates/rustversion/1.0.23/download) |
| safe_arch | 0.7.4 | `Zlib OR Apache-2.0 OR MIT` | Lokathor &lt;zefria@gmail.com&gt; | [Repository](https://github.com/Lokathor/safe_arch) / [Source](https://crates.io/api/v1/crates/safe_arch/0.7.4/download) |
| serde | 1.0.229 | `MIT OR Apache-2.0` | Erick Tryzelaar &lt;erick.tryzelaar@gmail.com&gt;, David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/serde-rs/serde) / [Source](https://crates.io/api/v1/crates/serde/1.0.229/download) |
| serde-wasm-bindgen | 0.6.5 | `MIT` | Ingvar Stepanyan &lt;me@rreverser.com&gt; | [Repository](https://github.com/RReverser/serde-wasm-bindgen) / [Source](https://crates.io/api/v1/crates/serde-wasm-bindgen/0.6.5/download) |
| serde_core | 1.0.229 | `MIT OR Apache-2.0` | Erick Tryzelaar &lt;erick.tryzelaar@gmail.com&gt;, David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/serde-rs/serde) / [Source](https://crates.io/api/v1/crates/serde_core/1.0.229/download) |
| serde_derive | 1.0.229 | `MIT OR Apache-2.0` | Erick Tryzelaar &lt;erick.tryzelaar@gmail.com&gt;, David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/serde-rs/serde) / [Source](https://crates.io/api/v1/crates/serde_derive/1.0.229/download) |
| serde_json | 1.0.151 | `MIT OR Apache-2.0` | Erick Tryzelaar &lt;erick.tryzelaar@gmail.com&gt;, David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/serde-rs/json) / [Source](https://crates.io/api/v1/crates/serde_json/1.0.151/download) |
| simba | 0.8.1 | `Apache-2.0` | sebcrozet &lt;developer@crozet.re&gt; | [Repository](https://github.com/dimforge/simba) / [Source](https://crates.io/api/v1/crates/simba/0.8.1/download) |
| slab | 0.4.12 | `MIT` | Carl Lerche &lt;me@carllerche.com&gt; | [Repository](https://github.com/tokio-rs/slab) / [Source](https://crates.io/api/v1/crates/slab/0.4.12/download) |
| syn | 2.0.119 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/syn) / [Source](https://crates.io/api/v1/crates/syn/2.0.119/download) |
| syn | 3.0.5 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/syn) / [Source](https://crates.io/api/v1/crates/syn/3.0.5/download) |
| thiserror | 1.0.69 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/thiserror) / [Source](https://crates.io/api/v1/crates/thiserror/1.0.69/download) |
| thiserror-impl | 1.0.69 | `MIT OR Apache-2.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/thiserror) / [Source](https://crates.io/api/v1/crates/thiserror-impl/1.0.69/download) |
| typenum | 1.20.1 | `MIT OR Apache-2.0` | See upstream contributor history | [Repository](https://github.com/paholg/typenum) / [Source](https://crates.io/api/v1/crates/typenum/1.20.1/download) |
| unicode-ident | 1.0.24 | `(MIT OR Apache-2.0) AND Unicode-3.0` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/unicode-ident) / [Source](https://crates.io/api/v1/crates/unicode-ident/1.0.24/download) |
| vowl-wasm | 0.2.3 | `MIT` | See upstream contributor history | [Repository](https://github.com/DreamLab-AI/vowl-wasm) |
| wasm-bindgen | 0.2.128 | `MIT OR Apache-2.0` | The wasm-bindgen Developers | [Repository](https://github.com/wasm-bindgen/wasm-bindgen) / [Source](https://crates.io/api/v1/crates/wasm-bindgen/0.2.128/download) |
| wasm-bindgen-macro | 0.2.128 | `MIT OR Apache-2.0` | The wasm-bindgen Developers | [Repository](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/macro) / [Source](https://crates.io/api/v1/crates/wasm-bindgen-macro/0.2.128/download) |
| wasm-bindgen-macro-support | 0.2.128 | `MIT OR Apache-2.0` | The wasm-bindgen Developers | [Repository](https://github.com/wasm-bindgen/wasm-bindgen/tree/main/crates/macro-support) / [Source](https://crates.io/api/v1/crates/wasm-bindgen-macro-support/0.2.128/download) |
| wasm-bindgen-shared | 0.2.128 | `MIT OR Apache-2.0` | The wasm-bindgen Developers | [Repository](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/shared) / [Source](https://crates.io/api/v1/crates/wasm-bindgen-shared/0.2.128/download) |
| web-sys | 0.3.105 | `MIT OR Apache-2.0` | The wasm-bindgen Developers | [Repository](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/web-sys) / [Source](https://crates.io/api/v1/crates/web-sys/0.3.105/download) |
| wide | 0.7.33 | `Zlib OR Apache-2.0 OR MIT` | Lokathor &lt;zefria@gmail.com&gt; | [Repository](https://github.com/Lokathor/wide) / [Source](https://crates.io/api/v1/crates/wide/0.7.33/download) |
| zmij | 1.0.23 | `MIT` | David Tolnay &lt;dtolnay@gmail.com&gt; | [Repository](https://github.com/dtolnay/zmij) / [Source](https://crates.io/api/v1/crates/zmij/1.0.23/download) |

## Build and standard-library credits

The [hosted release run](https://github.com/DreamLab-AI/vowl-wasm/actions/runs/38173452255) records Rust 1.99.0 (`b940084d7eb6a299eb4bfeb8e34901bc051e7ac4`), [wasm-pack](https://github.com/drager/wasm-pack) 0.15.0, Node 24.21.0 and npm 11.19.0. wasm-bindgen 0.2.128 is pinned by the frozen Cargo lockfile. wasm-opt is disabled in the package metadata; no npm runtime libraries are declared in the tarball’s package.json. These build tools are credited separately from the embedded runtime.

The Rust standard library and compiler-builtins are absent from the application Cargo graph. The companion preserves the full compiler-builtins 0.1.160 notice and the official copyright collection accompanying the same Rust 1.99.0 source revision. That conservative collection covers 141 dependency records and 65 distinct complete notice texts, including other targets/build dependencies; those entries do not assert that all code is linked into this WASM release. The general Rust terms are MIT OR Apache-2.0, with recorded exceptions and `MIT AND Apache-2.0 WITH LLVM-exception AND (MIT OR Apache-2.0)` for compiler-builtins. [Rust source](https://github.com/rust-lang/rust/tree/b940084d7eb6a299eb4bfeb8e34901bc051e7ac4) and [copyright explanation](https://github.com/rust-lang/rust/blob/b940084d7eb6a299eb4bfeb8e34901bc051e7ac4/COPYRIGHT).

## Verification and maintenance

Audit date: 2026-10-11. `cargo-about` 0.9.2 ran with `--locked --features "ngg1 interaction" --target wasm32-unknown-unknown --fail`, excluding dev dependencies. Its 53 package/version pairs exactly match an independent `cargo tree --locked --target wasm32-unknown-unknown --features ngg1,interaction --edges normal,build` inventory. Raw Cargo metadata unifies a dev-only num-traits/libm feature; that extra dependency is absent from the normal/build tree and the hosted WASM compilation, and is not counted in this release closure.

All 24 scanner licence groups are accounted for. Generic fallbacks were replaced with Wide’s actual packaged Zlib notice, Nalgebra’s inherited BSD notice and the actual parent Apache licence for nalgebra-macros. Selected packaged licences were checked independently; additional texts and package NOTICE files are preserved in full. Nalgebra’s original BSD notice was confirmed unchanged immediately before the recorded upstream switch to Apache terms.

Frozen Cargo.lock SHA-256: `e3135d1bc8557a81af6af232c1ce893c7a8099d8a8c41538110dda9f52ff3aa9`. Target-filtered Cargo metadata SHA-256: `127173803cb956a89842807c5d74aede44dfb514ddf3cdc588a045ba13f10611`.

The notice companion corrects this specific frozen browser distribution. Future source, lockfile, feature, target or toolchain changes require a fresh inventory and notice review before packaging. Existing published crates and pinned tarballs cannot be rewritten by this addendum.

## Guard for future browser packages

The release workflow runs the private Rust tool in
`tools/release-inventory` before building and again before packaging.
`docs/release-inventory.json` binds the reviewed notices to the crate version,
release tag, WASM target/features, exact compiler and wasm-pack versions,
source/configuration files, Cargo lock and notice digests. Any drift fails the
release until the new closure and full notices have been reviewed. The tool
uses RustCrypto SHA-256, Serde and TOML parsing; it is a build tool, excluded
from the browser dependency inventory.

After validation, the tool copies the full notice and this source inventory
into `pkg` and adds both names to the explicit npm `files` allowlist. The
workflow checks `npm pack --dry-run --json` for both entries before packing,
and publishes the full notice/checksum separately too. Existing browser
release assets cause a refusal before rebuilding; the original 0.2.0 tarball
continues to use its independently attached notice companion.

For a future release, audit its new Cargo closure and sysroot, review updated
notices and source URLs, then record the reviewed hashes/version/profile in
the machine inventory. Updating only hashes to bypass a mismatch does not
constitute that review. The frozen 0.2.0 inventory remains evidence for its
own release, not an automatic claim about a later version.
