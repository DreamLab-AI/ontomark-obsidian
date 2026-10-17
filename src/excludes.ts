// Which vault paths the engine never sees. Pure functions, no Obsidian import,
// so the rules are unit-testable; `main.ts` applies them at the host boundary
// (initial index and every vault event). The wasm engine indexes whatever it
// is handed and leaves exclusion to the host on purpose: a Templater template
// whose frontmatter says `type: <% tp.file.title %>` must not become an entity.

/** The folders excluded out of the box: the one every template plugin uses. */
export const DEFAULT_EXCLUDED_FOLDERS: readonly string[] = ["templates"];

/** One entry of Obsidian's "Excluded files" setting (`userIgnoreFilters` in `app.json`). */
export type IgnoreFilter = { kind: "prefix"; prefix: string } | { kind: "regex"; regex: RegExp };

/**
 * Parse the text of `<configDir>/app.json` into ignore filters. Fail-open:
 * a missing or unreadable file, bad JSON, no `userIgnoreFilters` key or an
 * entry of the wrong shape yields no filter rather than an error. An entry
 * wrapped in slashes (`/regex/`) is a regular expression; anything else is a
 * case-sensitive path prefix, the way Obsidian itself treats them (`Folder/`
 * covers the folder, `Notes/Secret.md` one file).
 */
export function parseIgnoreFilters(appJsonText: string | null | undefined): IgnoreFilter[] {
  if (!appJsonText) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(appJsonText);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const raw = (parsed as Record<string, unknown>).userIgnoreFilters;
  if (!Array.isArray(raw)) return [];
  const filters: IgnoreFilter[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (entry.length >= 2 && entry.startsWith("/") && entry.endsWith("/")) {
      try {
        filters.push({ kind: "regex", regex: new RegExp(entry.slice(1, -1)) });
      } catch {
        // an invalid pattern excludes nothing
      }
      continue;
    }
    filters.push({ kind: "prefix", prefix: entry });
  }
  return filters;
}

/**
 * `true` when `path` (vault-relative, `/`-separated) must stay out of the engine.
 *
 * `excludedFolders` are top-level folder names: `templates` excludes
 * `templates/Daily.md` and `templates/sub/x.md`, not `templates.md` and not
 * `Notes/templates/x.md`. Folder names are compared without regard to case,
 * so the default covers both `templates` and `Templates`. `ignoreFilters`
 * follow Obsidian's own semantics (see `parseIgnoreFilters`).
 */
export function isExcluded(path: string, excludedFolders: readonly string[], ignoreFilters: readonly IgnoreFilter[]): boolean {
  const slash = path.indexOf("/");
  if (slash > 0) {
    const top = path.slice(0, slash).toLowerCase();
    for (const folder of excludedFolders) {
      if (folder.toLowerCase() === top) return true;
    }
  }
  for (const filter of ignoreFilters) {
    if (filter.kind === "prefix" ? path.startsWith(filter.prefix) : filter.regex.test(path)) return true;
  }
  return false;
}

/** Split the settings control's comma-separated text into trimmed, de-duplicated folder names. */
export function parseFolderList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Why `text` is not an acceptable folder list, or `undefined` when it is. */
export function folderListProblem(text: string): string | undefined {
  for (const name of parseFolderList(text)) {
    if (name.includes("/") || name.includes("\\")) return `"${name}": give a top-level folder name, not a path`;
    if (name.includes("..")) return `"${name}": folder names cannot contain ".."`;
  }
  return undefined;
}
