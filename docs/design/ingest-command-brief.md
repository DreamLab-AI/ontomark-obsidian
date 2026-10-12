# "Extract from this note": implementation brief (2026-10-12)

Status: locked after reading the plugin and the engine at ontomark `v0.2.0`
(engine.json → tag v0.2.0, source 8a3b6ccb). Implements ADR-OBS-003 §1–5.
Scope: one command, one setting group, one network call site, one new modal,
and the two isolated runs. Nothing else in the plugin changes behaviour.

## The engine contract (Rust is the source of truth; mirror it, do not redesign)

Two read requests, already in the engine and reported by `version`:

```
{ kind: "ingest_plan",   generation, path, options? }
  → { request: ModelRequest }            // what the host sends to a model
{ kind: "ingest_accept", generation, path, request, responses, options? }
  → { path, candidates: Candidates, preview: PatchProposal | null }
```

`ModelRequest` = `{ contract: "ontomark-ingest/facts/1", note: NoteRef,
instructions: string, keys: KeySpec[], chunks: Chunk[], response_schema: JSON }`.
The host posts `instructions` + each chunk's text to the model and collects one
`ModelResponse = { chunk: number, assertions: { key, value, evidence }[] }` per
chunk answered. The model never sees identifiers; it proposes names and quotes.

`Candidates` = `{ document, digest, patch?, accepted: CandidateAssertion[],
withheld: Withheld[], diagnostics }`. `CandidateAssertion` carries `key,
predicate, written, grounded?, tier?, datatype?, evidence: EvidenceSpan[]`
where `EvidenceSpan = { chunk, span: {byte_start, byte_end}, utf16: {start,
end}, quote }`. `Withheld` carries `chunk, key, value, reason: WithholdReason,
evidence?`. `WithholdReason` is a tagged enum (`ungrounded`, `unknown_key`,
`no_evidence`, `conflicting_value`, `already_present`, `ambiguous`, …): render
its tag verbatim; never invent prose for it.

`preview` is exactly the `PatchProposal` shape `propose_patch` returns, so the
existing `api.applyPatch(preview, confirm)` guard applies it unchanged: the
write happens only if the file still holds `base_text`.

Both kinds are reads: `send()` classifies anything not in `MUTATIONS` as a
read, so they pass through the generation guard and `stale` applies.

## Files

1. `src/protocol.ts`: add the two `EngineRequest` variants and the result types
   above (`ModelRequest`, `ModelResponse`, `Candidates`, `CandidateAssertion`,
   `Withheld`, `WithholdReason` as `{ t: string } & Record<string, unknown>`,
   `EvidenceSpan`, `IngestAcceptResult`). Keep names identical to the Rust.
2. `src/client.ts`: `ingestPlan(path)` and `ingestAccept(path, request,
   responses)`; thin `send` wrappers like `describe`.
3. `src/settings.ts`: a new group **"Assisted ingest (optional, uses the
   network)"**:
   - `ingestEndpoint: string` (default `""`). Empty = feature off; the command
     is still registered but refuses with a Notice naming the setting.
   - `ingestModel: string` (default `""`), passed as the `model` field.
   - The API key is **per session**: a `SecretInput` field that is held in
     memory on the plugin instance (`plugin.ingestKey`), never written to
     `data.json`, cleared on unload. The settings tab shows "set for this
     session" / "not set". ADR-OBS-003 §2.
   - Update the privacy paragraph: "Everything runs locally … Assisted ingest
     is the one exception: when you set an endpoint below, the text of the
     note you choose is sent to that endpoint and nowhere else."
4. `src/ingest-transport.ts` (NEW, the only network module): one exported
   `callModel(endpoint, key, model, request: ModelRequest): Promise<ModelResponse[]>`
   using Obsidian's `requestUrl` exactly once. OpenAI-compatible chat
   completions: system = `request.instructions`, one user message per chunk
   (`chunks[i].text`), `response_format: { type: "json_object" }`, and parse
   the JSON per chunk into `ModelResponse`. Malformed JSON for a chunk →
   that chunk is dropped with a diagnostic, not a throw; a non-2xx → throw
   `OntomarkError("model_unavailable", …)`. Bound: 60 s timeout; refuse
   `request.chunks.length > 64`. No retries. **No other file may import or
   name `requestUrl`.**
5. `src/views/ingest-modal.ts` (NEW): `IngestModal` showing, top to bottom:
   - the diff (reuse `diffLineClass` from `diff-modal.ts`);
   - **Accepted** list: `key ← written`, grounding tier, and the quote(s) as
     blockquotes; clicking a quote selects that `utf16` range in the active
     editor if the note is open (`editor.setSelection`), so evidence is
     visible in the source;
   - **Withheld** list: `key: value` with the reason tag and quote if any;
   - buttons `Apply` (mod-cta, disabled when `preview` is null) and `Cancel`.
   `confirmIngest(app, result): Promise<boolean>` mirrors `confirmWithDiff`.
6. `src/main.ts`: command `extract-facts`, "Extract facts from this note":
   ```
   file = active file or Notice
   if !settings.ingestEndpoint → Notice("Ontomark: set an ingest endpoint in settings first.")
   if !this.ingestKey → Notice("Ontomark: enter the API key for this session in settings.")
   guard(async () => {
     const { request } = await api.ingestPlan(file.path);
     const responses = await callModel(endpoint, key, model, request);   // the ONE network call
     const result = await api.ingestAccept(file.path, request, responses);
     if (!result.preview) { show modal anyway (withheld-only), return }
     announce(await api.applyPatch(result.preview, () => confirmIngest(app, result)));
   })
   ```
   `api.ts` gets `ingestPlan` / `ingestAccept` pass-throughs. Cancellation:
   closing the modal declines; an edit to the note between plan and apply is
   refused by `applyPatch`'s `base_text` check (existing behaviour).

## The offline contract, mechanically

7. `scripts/check-bundle.mjs`: keep every forbidden token. Change the
   `requestUrl` rule only: it may appear **exactly once** in the bundle, and
   that occurrence must be inside the inlined `ingest-transport` module
   (esbuild keeps a `// src/ingest-transport.ts` banner; assert the match
   offset lies between that banner and the next `// src/` banner). Two
   occurrences, or one elsewhere, is a finding. Add the endpoint setting's
   default (`""`) as the only allowed non-namespace URL source: no URL
   literal may appear (the endpoint is user-supplied at runtime).
8. `test/e2e/offline.e2e.cjs` (EXP-11): unchanged assertions, and add: with no
   endpoint set, `executeCommand("extract-facts")` produces the refusing
   Notice and `runtime.attempts.length === 0`. The shim's tripwire must also
   deny `requestUrl` on the `obsidian` module mock so a call would be
   recorded.
9. `test/e2e/ingest.e2e.cjs` (NEW): endpoint set to `http://127.0.0.1:1/v1`
   (nothing listens) and a stub `requestUrl` that records `{url}` and returns
   a canned two-chunk response built from the fixture note. Assert: exactly
   one recorded call, its URL equals the setting, `candidates.accepted` is
   non-empty, the preview applies, a second run yields `already_present`
   withheld entries and no patch, and with the stub throwing a 503 the
   command surfaces `model_unavailable` and writes nothing.
10. `test/client.test.ts`: `ingestPlan`/`ingestAccept` are reads (stale after a
    mutation).

## Not in scope (ADR-OBS-003 leaves these for release)

- `manifest.json` description and README "Offline by default…" amendment:
  written at release, after the installed-Obsidian acceptance passes.
- Proposal-not-Apply for estate vaults: open decision, not built.
- Mobile.

## Acceptance

`npm run build` (tsc + esbuild) clean; `npm test`, `npm run test:wasm`,
`npm run test:offline`, the new ingest e2e, and `npm run check:bundle` all
green. `check:bundle` output lists exactly one `requestUrl` at an offset inside
the transport module and zero URL literals.
