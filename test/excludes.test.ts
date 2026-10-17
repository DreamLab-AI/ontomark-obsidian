import { describe, expect, it } from "vitest";
import { folderListProblem, isExcluded, parseFolderList, parseIgnoreFilters } from "../src/excludes";

const none: never[] = [];

describe("isExcluded: excluded folders", () => {
  it("excludes notes under a top-level folder, nested paths included", () => {
    expect(isExcluded("templates/Daily.md", ["templates"], none)).toBe(true);
    expect(isExcluded("templates/sub/Deep.md", ["templates"], none)).toBe(true);
  });

  it("does not exclude a note that merely shares the folder's name", () => {
    expect(isExcluded("templates.md", ["templates"], none)).toBe(false);
    expect(isExcluded("templates", ["templates"], none)).toBe(false);
  });

  it("matches the top level only, not a same-named folder deeper down", () => {
    expect(isExcluded("Notes/templates/Daily.md", ["templates"], none)).toBe(false);
    expect(isExcluded("templatesX/Daily.md", ["templates"], none)).toBe(false);
  });

  it("ignores case of the folder name, so the default covers Templates/", () => {
    expect(isExcluded("Templates/Daily.md", ["templates"], none)).toBe(true);
    expect(isExcluded("templates/Daily.md", ["Templates"], none)).toBe(true);
  });

  it("excludes nothing when the list is empty", () => {
    expect(isExcluded("templates/Daily.md", [], none)).toBe(false);
  });
});

describe("isExcluded: Obsidian ignore filters", () => {
  it("applies a folder prefix filter, case-sensitively", () => {
    const filters = parseIgnoreFilters(JSON.stringify({ userIgnoreFilters: ["Notes/Private/"] }));
    expect(isExcluded("Notes/Private/Secret.md", [], filters)).toBe(true);
    expect(isExcluded("Notes/Private/Deep/Secret.md", [], filters)).toBe(true);
    expect(isExcluded("Notes/Privately.md", [], filters)).toBe(false);
    expect(isExcluded("notes/private/Secret.md", [], filters)).toBe(false);
    expect(isExcluded("Notes/Public.md", [], filters)).toBe(false);
  });

  it("applies a single-file prefix filter", () => {
    const filters = parseIgnoreFilters(JSON.stringify({ userIgnoreFilters: ["Notes/Secret.md"] }));
    expect(isExcluded("Notes/Secret.md", [], filters)).toBe(true);
    expect(isExcluded("Notes/Secret.md.bak", [], filters)).toBe(true); // Obsidian's own prefix semantics
    expect(isExcluded("Notes/Secret2.md", [], filters)).toBe(false);
    expect(isExcluded("Notes/Other.md", [], filters)).toBe(false);
  });

  it("applies a /regex/ filter", () => {
    const filters = parseIgnoreFilters(JSON.stringify({ userIgnoreFilters: ["/\\.draft\\.md$/"] }));
    expect(filters).toEqual([{ kind: "regex", regex: /\.draft\.md$/ }]);
    expect(isExcluded("Notes/Idea.draft.md", [], filters)).toBe(true);
    expect(isExcluded("Notes/Idea.md", [], filters)).toBe(false);
  });

  it("combines both sources", () => {
    const filters = parseIgnoreFilters(JSON.stringify({ userIgnoreFilters: ["Notes/Private/"] }));
    expect(isExcluded("templates/T.md", ["templates"], filters)).toBe(true);
    expect(isExcluded("Notes/Private/S.md", ["templates"], filters)).toBe(true);
    expect(isExcluded("Notes/Public.md", ["templates"], filters)).toBe(false);
  });
});

describe("parseIgnoreFilters is fail-open", () => {
  it("returns no filters for bad JSON, a missing key, a non-array or an empty file", () => {
    expect(parseIgnoreFilters("{ not json")).toEqual([]);
    expect(parseIgnoreFilters("{}")).toEqual([]);
    expect(parseIgnoreFilters('{"userIgnoreFilters": "Notes/"}')).toEqual([]);
    expect(parseIgnoreFilters("")).toEqual([]);
    expect(parseIgnoreFilters(null)).toEqual([]);
    expect(parseIgnoreFilters("[1,2]")).toEqual([]);
  });

  it("drops non-string entries and an invalid regex, keeping the rest", () => {
    const filters = parseIgnoreFilters(JSON.stringify({ userIgnoreFilters: [42, "", "/(/", "Keep/"] }));
    expect(filters).toEqual([{ kind: "prefix", prefix: "Keep/" }]);
  });

  it("treats a lone slash as a prefix, not an empty regex", () => {
    expect(parseIgnoreFilters(JSON.stringify({ userIgnoreFilters: ["/"] }))).toEqual([{ kind: "prefix", prefix: "/" }]);
  });
});

describe("the settings control's folder list", () => {
  it("splits, trims and de-duplicates (ignoring case) a comma-separated list", () => {
    expect(parseFolderList(" templates, assets ,templates,, Assets ")).toEqual(["templates", "assets"]);
    expect(parseFolderList("")).toEqual([]);
  });

  it("rejects paths and parent references, accepts plain names and an empty list", () => {
    expect(folderListProblem("templates/daily")).toMatch(/top-level folder name/);
    expect(folderListProblem("templates\\daily")).toMatch(/top-level folder name/);
    expect(folderListProblem("..")).toMatch(/\.\./);
    expect(folderListProblem("a..b")).toMatch(/\.\./);
    expect(folderListProblem("templates, My Assets")).toBeUndefined();
    expect(folderListProblem("")).toBeUndefined();
  });
});
