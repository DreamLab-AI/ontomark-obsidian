# Content-bound review engine adoption — 15 November 2026

Consumes Ontomark v0.9.0, source f9ba200b8051dc3a1f5e26ff2e001d5fc2905426,
with the release archive digest recorded in engine.json. The generated declaration
includes the read-only review_binding export. This does not add a certification UI
or automatically attach a review stamp. VisionFlow ADR-2024 and Ontomark ADR-OM-013
own the contract.

Validation: CI-mode build (including declaration drift gate), 121 unit tests,
native-fixture replay through Node and browser WASM, bundle boundary check and
offline execution. The consumer transcript retains its excluded-folder fixture and changes only
engine version strings; exclusion behaviour remains asserted separately from the
producer's native transcript. Existing npm audit reports two moderate
transitive advisories; dependencies are unchanged by this engine adoption.
