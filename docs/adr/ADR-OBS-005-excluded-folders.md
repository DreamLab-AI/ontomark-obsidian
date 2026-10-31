---
id: ADR-OBS-005
title: "Excluded folders are the host's job"
date: 2026-10-17
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: "7b4f545ecfc75ae530c3b7a37edc401b5dbc9a28"
verified_paths: []
owner: jjohare
review_trigger: "a change to the excluded-folders setting, its default, or its matching rules"
repo: ontomark-obsidian
---

# ADR-OBS-005: Excluded folders are the host's job

- Decision status: accepted (owner request: generalise the plugin for ordinary vaults)
- Implementation status: active in 0.3.5. `src/excludes.ts` (pure rules), `src/main.ts` (applied at the initial index and on every vault event), `src/settings.ts` (the `Excluded folders` control). Unit tests `test/excludes.test.ts`; offline end-to-end checks in `test/e2e/offline.e2e.cjs`.
- Related: [ADR-OBS-001](ADR-OBS-001-shared-graph.md) (the plugin owns Obsidian surfaces, the engine owns semantics); engine [ADR-OM-007](https://github.com/DreamLab-AI/ontomark/blob/main/docs/adr/ADR-OM-007-flat-obsidian-vaults.md) (flat vaults and the compiler's built-in excluded-folder list).

Status mapping 2026-10-31: the record's `Implementation status: active in 0.3.5` is not a checker value. `activation_status: live` follows its word "active"; `implementation_status: partial` is the conservative reading because the record does not say "complete". Owner to confirm.

Verification 2026-10-31: `verified_commit` is this record's own last-modified commit, recorded when the record was moved onto the estate ledger format. It is not a re-verification of the code the record describes, and `verified_paths` is empty, so the staleness gate is not yet armed for this record.

## Context

Until 0.3.4 the plugin handed every `.md` file in the vault to the engine. Ordinary vaults keep a `templates/` folder, and a Templater template whose frontmatter says `type: <% tp.file.title %>` was read as an entity declaration: a bogus entity or a validation diagnostic, depending on the placeholder. The same happened to notes the user had already hidden from Obsidian through **Settings → Files and links → Excluded files**. The ontomark command-line compiler fixed this on its side in 0.3.0 with a built-in list (`templates`, `bases`, `assets`, `journals`). The wasm engine deliberately did not: it indexes whatever it is given and leaves the choice of what to give it to the host.

## Decision

1. A plugin setting, **Excluded folders**, lists top-level vault folders the engine never sees. The default is `templates`. Names are matched without regard to case against the first path segment only: `templates/Daily.md` is excluded, `templates.md` and `Notes/templates/x.md` are not. Entries containing `/`, `\` or `..` are refused by the control's validation.
2. Obsidian's own **Excluded files** (`userIgnoreFilters` in `<configDir>/app.json`) are honoured as well, with Obsidian's semantics: each entry is a case-sensitive path prefix, or a regular expression when wrapped in slashes. Reading the file is fail-open: no file, bad JSON or no key means no extra filter, and a read that fails for another reason keeps the filters already loaded. There is no public event for a change to `app.json`, so it is read when the layout is ready and again whenever the settings tab saves; when the filters have changed since the last read, that save reindexes. A change made in Obsidian's own settings therefore takes effect at the next Ontomark settings save, reindex or plugin reload.
3. The rules apply at every point a path crosses into the engine: the initial index skips excluded files; `create` and `modify` events on them are ignored; a rename into an excluded folder removes the page. `delete` and a rename out of an excluded folder are decided by what the engine holds, not by the rules: removing a path the engine never indexed is a no-op, and renaming from one indexes the target, so a page the rules came to exclude after it was indexed is still removed or moved rather than orphaned. A change to the setting reindexes the vault, so the engine ends up holding exactly the non-excluded set.
4. The rules live in a pure module with no Obsidian import, so they are unit-tested directly, and the host applies them.

## Why host-side

The engine cannot know what a folder means in a given vault: `templates` is a convention, not a format. Obsidian already lets the user say which files are not part of the vault, and the plugin should agree with that rather than ship a second, slightly different list. Putting the decision in the host also keeps the engine's contract simple (index what you are given) and identical between the plugin and the command-line compiler, which applies the same kind of filter before calling it.

## Not adopted

Reading a note's content to guess whether it is a template (unexpanded `<% %>` or `{{ }}` placeholders). Heuristics on content would exclude real notes that document templating, and a folder rule is what users already have.
