// The plugin's API surface: everything the views, commands and the offline
// end-to-end test use. It is independent of Obsidian; `main.ts` adapts the
// Obsidian vault to `VaultPort`.
//
// Write path (non-negotiable 1): the engine proposes a guarded patch; the user
// sees the diff; the host applies it with `VaultPort.process`, whose callback
// refuses to write unless the file still holds exactly the text the patch was
// planned against. Nothing else in the plugin writes to the vault.

import { OntomarkClient, OntomarkError } from "./client";
import type {
  ClassifyDone,
  DatasetSelection,
  DescribeResult,
  EntityKind,
  FileText,
  IndexResult,
  IngestAcceptResult,
  IngestPlanResult,
  ModelRequest,
  ModelResponse,
  PatchOp,
  PatchProposal,
  ProfileId,
  QueryResult,
  YamlValue,
} from "./protocol";

/** What the plugin needs from a vault. */
export interface VaultPort {
  /** Every Markdown file with its exact text. */
  listMarkdown(): Promise<FileText[]>;
  /** Exact current text of `path`. */
  read(path: string): Promise<string>;
  /**
   * Atomically transform `path`: `fn` receives the current text and returns
   * the new text. If `fn` throws, nothing is written and the promise rejects.
   * (Obsidian: `app.vault.process`.)
   */
  process(path: string, fn: (data: string) => string): Promise<string>;
}

export interface FrontmatterEntry {
  key: string;
  value: YamlValue;
}

export interface FrontmatterResult {
  path: string;
  digest: string;
  state: "absent" | { t: "parsed" } | { t: "unsupported" | "malformed"; reason: string };
  entries: FrontmatterEntry[];
}

export type ApplyOutcome =
  | { status: "applied"; path: string; digest: string }
  | { status: "no_op"; path: string }
  | { status: "declined"; path: string }
  | { status: "refused"; path: string; code: string; message: string };

export type ChangeEvent =
  | { type: "indexed"; generation: number }
  | { type: "classified"; generation: number; result: ClassifyDone }
  | { type: "classify_failed"; generation: number; code: string }
  | { type: "progress"; generation: number; steps: number; total: number | null };

export interface Status {
  generation: number;
  epoch: number;
  profile: ProfileId;
  classifying: boolean;
  lastClassified: number | null;
}

export class OntomarkApi {
  private listeners = new Set<(e: ChangeEvent) => void>();
  private classifying = false;
  private lastClassified: number | null = null;
  private lastIndex: IndexResult | null = null;

  constructor(
    readonly client: OntomarkClient,
    private readonly vault: VaultPort,
  ) {}

  /** Index the whole vault (first load). */
  async start(profile: ProfileId): Promise<void> {
    const files = await this.vault.listMarkdown();
    await this.client.start(files, profile);
    this.emit({ type: "indexed", generation: this.client.generation });
  }

  onChange(listener: (e: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): Status {
    return {
      generation: this.client.generation,
      epoch: this.client.epoch,
      profile: this.client.profileId,
      classifying: this.classifying,
      lastClassified: this.lastClassified,
    };
  }

  // ---- vault events (cancel-on-edit: every mutation supersedes running work) ----

  async fileChanged(path: string, text: string): Promise<void> {
    if (!path.endsWith(".md")) return;
    if (this.client.textOf(path) === text) return; // our own write, already sent
    await this.client.upsert(path, text);
    this.emit({ type: "indexed", generation: this.client.generation });
  }

  async fileDeleted(path: string): Promise<void> {
    if (this.client.textOf(path) === undefined) return;
    await this.client.remove(path);
    this.emit({ type: "indexed", generation: this.client.generation });
  }

  async fileRenamed(from: string, to: string): Promise<void> {
    if (this.client.textOf(from) === undefined) {
      if (to.endsWith(".md")) await this.fileChanged(to, await this.vault.read(to));
      return;
    }
    await this.client.rename(from, to);
    this.emit({ type: "indexed", generation: this.client.generation });
  }

  async setProfile(profile: ProfileId): Promise<void> {
    await this.client.setProfile(profile);
    this.emit({ type: "indexed", generation: this.client.generation });
  }

  // ---- reads ----

  /** @param channel pass one per consumer (e.g. a view) for latest-wins semantics. */
  async index(channel?: string): Promise<IndexResult> {
    this.lastIndex = await this.client.index(channel);
    return this.lastIndex;
  }

  describe(iri: string): Promise<DescribeResult> {
    return this.client.describe(iri);
  }

  query(sparql: string, dataset: DatasetSelection = "asserted", limit?: number, channel?: string): Promise<QueryResult> {
    return this.client.query(sparql, dataset, limit, channel);
  }

  frontmatter(path: string): Promise<FrontmatterResult> {
    return this.client.frontmatter(path) as Promise<FrontmatterResult>;
  }

  /** Plan an assisted-ingest request for `path` (read; no model is contacted). */
  ingestPlan(path: string): Promise<IngestPlanResult> {
    return this.client.ingestPlan(path);
  }

  /** Ground the model's `responses`; `preview` is a `PatchProposal` for `applyPatch`. */
  ingestAccept(path: string, request: ModelRequest, responses: ModelResponse[]): Promise<IngestAcceptResult> {
    return this.client.ingestAccept(path, request, responses);
  }

  /** Classify the current generation; a later edit cancels it and it rejects with `stale` or `cancelled`. */
  async classify(): Promise<ClassifyDone> {
    const generation = this.client.generation;
    this.classifying = true;
    try {
      const result = await this.client.classify();
      this.lastClassified = generation;
      this.emit({ type: "classified", generation, result });
      return result;
    } catch (err) {
      const code = err instanceof OntomarkError ? err.code : "error";
      this.emit({ type: "classify_failed", generation, code });
      throw err;
    } finally {
      if (this.client.generation === generation) this.classifying = false;
    }
  }

  // ---- guarded writes ----

  /** Propose `ops` on `path`, planned against the text the engine indexed. */
  async proposeFrontmatter(path: string, ops: PatchOp[]): Promise<PatchProposal> {
    const fm = await this.frontmatter(path);
    return this.client.proposePatch(path, fm.digest, ops);
  }

  /** Propose adding `[[target]]` to the profile's superclass (class) or type (individual) key. */
  async proposeAddParent(path: string, target: string): Promise<PatchProposal> {
    const [fm, index] = await Promise.all([this.frontmatter(path), this.index()]);
    const typeEntry = fm.entries.find((e) => e.key === index.keys.type);
    const kindText = typeEntry && typeEntry.value.t === "string" ? typeEntry.value.v.toLowerCase() : "class";
    const key = /individual|instance/.test(kindText) ? index.keys.instance : index.keys.subclass;
    const link = `[[${target}]]`;
    const existing = fm.entries.find((e) => e.key === key)?.value;
    const items: YamlValue[] =
      existing?.t === "seq" ? [...existing.v] : existing?.t === "string" ? [existing] : [];
    if (!items.some((v) => v.t === "string" && v.v === link)) items.push({ t: "string", v: link });
    return this.client.proposePatch(path, fm.digest, [{ op: "set", key, value: { t: "seq", v: items } }]);
  }

  /** Propose declaring the page's ontology kind (the explicit way a plain note becomes typed). */
  async proposeSetType(path: string, kind: EntityKind): Promise<PatchProposal> {
    const [fm, index] = await Promise.all([this.frontmatter(path), this.index()]);
    return this.client.proposePatch(path, fm.digest, [
      { op: "set", key: index.keys.type, value: { t: "string", v: kind }, placement: { t: "start" } },
    ]);
  }

  /**
   * Apply a proposal after `confirm` (the diff preview) approves it. The write
   * happens only if the file still holds exactly `proposal.base_text`.
   */
  async applyPatch(proposal: PatchProposal, confirm: (p: PatchProposal) => Promise<boolean>): Promise<ApplyOutcome> {
    const path = proposal.path;
    if (proposal.no_op) return { status: "no_op", path };
    if (!(await confirm(proposal))) return { status: "declined", path };
    try {
      await this.vault.process(path, (data) => {
        if (data !== proposal.base_text) {
          throw new OntomarkError("source_changed", `${path} changed after the patch was planned; nothing was written`);
        }
        return proposal.new_text;
      });
    } catch (err) {
      const code = err instanceof OntomarkError ? err.code : "write_failed";
      const message = err instanceof Error ? err.message : String(err);
      return { status: "refused", path, code, message };
    }
    await this.client.upsert(path, proposal.new_text);
    this.emit({ type: "indexed", generation: this.client.generation });
    return { status: "applied", path, digest: proposal.new_digest };
  }

  dispose(): void {
    this.listeners.clear();
    this.client.dispose();
  }

  private emit(e: ChangeEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // a failing view must not break the pipeline
      }
    }
  }
}
