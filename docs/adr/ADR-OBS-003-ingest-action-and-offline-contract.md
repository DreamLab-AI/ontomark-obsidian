---
id: ADR-OBS-003
title: "one ingest action, and what it does to the offline contract"
date: 2026-10-12
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: ""
verified_paths: []
owner: jjohare
review_trigger: "the open question on the proposal route is answered, or ontomark-ingest ships in a released engine the plugin pins"
repo: ontomark-obsidian
---

# ADR-OBS-003: one ingest action, and what it does to the offline contract

- Implementation status: none in this plugin. The shared core it would call landed in Ontomark as `ontomark-ingest` at [`582cfa0`](https://github.com/DreamLab-AI/ontomark/commit/582cfa0) ([ADR-OM-003](https://github.com/DreamLab-AI/ontomark/blob/main/docs/adr/ADR-OM-003-native-assisted-ingest.md)); it is not yet in a released engine.
- Related: [ADR-OBS-002](ADR-OBS-002-assisted-ingest-boundary-and-estate-notes.md) (boundary and estate notes, which this ADR narrows to a plugin decision), [ADR-OBS-001](ADR-OBS-001-shared-graph.md)

## Context

The plugin's manifest says "Offline", its README says it makes no network requests, and its release gate (Ontomark EXP-11) runs the built plugin under `--network none` with a tripwire on any socket, DNS, `fetch` or XHR. ADR-OBS-002 proposed an optional assisted-ingest action driven by a configured model. Those two facts collide: a model call is a network call. The engine side is now settled: `ontomark-ingest` never calls a model and returns a request the host must send. So the decision left is the plugin's, and it is about the network, the credential and the user's control, not about extraction.

## Decision

1. **One command, off by default.** "Ontomark: propose values from this note" appears only when a model endpoint is configured in settings. With no endpoint the command is absent, not disabled; the plugin behaves exactly as released today.
2. **The plugin is the only party that touches the network.** It sends the engine's `ModelRequest` to the configured endpoint, receives JSON, and passes it back through `accept`. The worker and the WASM engine stay network-free; the request/response boundary is the only new `requestUrl` call site, in one module, so the offline tripwire can allow-list it by path when, and only when, the setting is on.
3. **The offline contract is amended, not quietly broken.** The manifest description drops "Offline" in favour of "Offline by default; an optional, user-configured model endpoint is contacted only by the ingest command". The README gains a section naming what is sent (the note's chunks, its entity label, the allowed keys and the instructions; never other notes, never the vault path, never the credential) and to where (only the endpoint the user typed).
4. **Credential handling.** The endpoint URL lives in plugin settings. The API key is not written to `data.json` in the first release: the user is prompted for it per session and it is held in memory only. A stored-secret option, if ever added, needs its own decision and a visible warning that Obsidian plugin data is plaintext.
5. **Nothing is written without the user.** The command shows `Candidates` as the existing diff preview: accepted values with their evidence quotes highlighted, withheld values with their reasons and suggestions. Apply is the existing guarded path and is undoable with Obsidian's undo. A stale note (the user edited while waiting) is reported and nothing is applied. Model output never edits in the background.
6. **Dependencies.** This needs an Ontomark engine prerelease exposing `plan` and `accept` through `ontomark-wasm`, an `engine.json` repin with its digest and licence inventory, and the plugin's bundle check to confirm the only network call site is the configured-endpoint module.

## Gates before the command ships

- EXP-11 and the 40-check network-isolated shim pass unchanged with no endpoint configured.
- A second, explicit isolated run with an endpoint configured proves exactly one outbound destination, the configured one, and nothing when the command is not invoked.
- Installed-Obsidian acceptance on a plain vault covers: evidence spans highlight the right text (including non-ASCII); a repeat run proposes nothing new; an edit during the model call yields the stale-revision message and no change; cancellation; undo after apply; and a clear message when the endpoint is unreachable or returns malformed JSON.
- The README, manifest and third-party notices are updated in the same release.

## Consequences

Users who never configure an endpoint see no change. Users who do get a reviewed, evidence-backed proposal step with no second parser, identity scheme or reasoner in the plugin. Mobile remains unsupported. Ontology growth (new classes or properties) is out of scope here as it is in the core.

## Amendment (2026-10-12): redirects and the one-destination promise

Obsidian's `requestUrl` follows HTTP redirects and exposes neither the final URL nor a
way to refuse them. The one-destination guarantee therefore rests on the endpoint
contract rather than on the transport: the setting must be an absolute `http(s)` URL
with no embedded credentials or fragment (`endpointProblem` in `src/ingest-transport.ts`;
checked in the settings tab and again before every run), and a 3xx answer is treated as
`model_unavailable` instead of being followed. A host that redirects is a misconfiguration
the user is told to fix by typing the final URL. The bundle check guards `requestUrl` and
`request` call sites; it is a guard against honest mistakes, not a proof against a
deliberately obfuscated call, and this record says so.


## Source clarification (2026-10-21)

The implementation now exists in `src/main.ts` and `src/ingest-transport.ts` and ships with plugin 0.3.6; the proposal's initial implementation and activation labels above describe its original date. The release pins engine v0.4.0 in `engine.json`. The registered command is “Extract facts from this note”.

The redirect amendment describes an endpoint requirement, not an enforced destination guarantee. `requestUrl` may follow a redirect before returning a response. Rejecting a returned 3xx cannot prevent that earlier hop, and the plugin does not observe the final URL. A configured credential is sent in the HTTP authorisation header, while remaining absent from the model prompt. Installed-desktop redirect behaviour remains unverified in `docs/desktop-acceptance.md`.
