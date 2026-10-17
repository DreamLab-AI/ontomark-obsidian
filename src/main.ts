import { Modal, Notice, Plugin, TFile, debounce } from "obsidian";
import type { App, TAbstractFile, WorkspaceLeaf } from "obsidian";
import workerSource from "virtual:worker-source";
import wasm from "./generated/ontomark.wasm";
import { OntomarkApi } from "./api";
import type { ChangeEvent, VaultPort } from "./api";
import { OntomarkClient, OntomarkError } from "./client";
import { isExcluded, parseIgnoreFilters } from "./excludes";
import type { IgnoreFilter } from "./excludes";
import type { EntityKind, PatchProposal, WorkerLike } from "./protocol";
import { DEFAULT_SETTINGS, OntomarkSettingTab, normaliseSettings } from "./settings";
import type { OntomarkSettings } from "./settings";
import { ENTITY_VIEW, EntityView } from "./views/entity-view";
import { QUERY_VIEW, QueryView } from "./views/query-view";
import { GRAPH_VIEW, GraphView } from "./views/graph-view";
import { registerSparqlBlock } from "./sparql-block";
import { confirmWithDiff } from "./views/diff-modal";
import { confirmIngest } from "./views/ingest-modal";
import { callModel, endpointProblem, type AbortToken } from "./ingest-transport";

export { ENTITY_VIEW, QUERY_VIEW, GRAPH_VIEW };
export type { OntomarkSettings };

const QUIET_CODES = new Set(["stale", "cancelled", "superseded", "dead_epoch", "worker_restarted", "disposed"]);

class AddParentModal extends Modal {
  private input!: HTMLInputElement;

  constructor(
    app: App,
    private readonly path: string,
    private readonly onSubmit: (target: string) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(`Add parent to ${this.path}`);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: "Target page name (without brackets)." });
    this.input = contentEl.createEl("input", { attr: { type: "text", placeholder: "Animal", "data-ontomark": "parent" } });
    const button = contentEl.createEl("button", { text: "Propose", cls: "mod-cta", attr: { "data-ontomark-action": "propose" } });
    button.addEventListener("click", () => {
      const target = this.input.value.trim().replace(/^\[\[|\]\]$/g, "");
      if (!target) return;
      this.close();
      this.onSubmit(target);
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export default class OntomarkPlugin extends Plugin {
  api!: OntomarkApi;
  override settings: OntomarkSettings = { ...DEFAULT_SETTINGS };
  ready!: Promise<void>;
  /** Assisted-ingest API key: memory only, never in data.json, cleared on unload. */
  ingestKey = "";
  /** The extraction in flight, if any; `onunload` aborts it. */
  private ingestRun: AbortToken | null = null;

  private workerUrl = "";
  /** Obsidian's own "Excluded files" (`userIgnoreFilters` in app.json), honoured alongside `settings.excludedFolders`. */
  private ignoreFilters: IgnoreFilter[] = [];
  private listeners = new Set<(e: ChangeEvent) => void>();
  private apiUnsubscribe: (() => void) | null = null;
  private autoClassify = debounce(
    () => {
      void this.guard(() => this.api.classify());
    },
    750,
    true,
  );

  override async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<OntomarkSettings> | null;
    this.settings = normaliseSettings(saved);

    this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    this.api = this.createApi();
    this.ready = this.startApi(this.api);

    this.addSettingTab(new OntomarkSettingTab(this.app, this));
    this.registerView(ENTITY_VIEW, (leaf) => new EntityView(leaf, this));
    this.registerView(QUERY_VIEW, (leaf) => new QueryView(leaf, this));
    this.registerView(GRAPH_VIEW, (leaf) => new GraphView(leaf, this));
    registerSparqlBlock(this);
    this.addRibbonIcon("network", "Open ontology panel", () => {
      void this.openGraphView();
    });

    // Obsidian fires `create` for every file while the vault loads; the initial
    // index already covers those, so listen only once the layout is ready.
    this.app.workspace.onLayoutReady(() => this.registerVaultEvents());
    this.registerCommands();
  }

  override onunload(): void {
    this.autoClassify.cancel();
    // Stop any extraction at its next chunk boundary; the copied key in the
    // running closure must not be used again after this point.
    if (this.ingestRun) this.ingestRun.aborted = true;
    this.ingestRun = null;
    this.ingestKey = "";
    this.apiUnsubscribe?.();
    this.apiUnsubscribe = null;
    this.listeners.clear();
    this.api?.dispose();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = "";
  }

  /**
   * Persist the settings. A save is also one of the two moments app.json is
   * re-read (see loadIgnoreFilters); when Obsidian's Excluded files changed
   * since the last read, the vault is reindexed under the new rules so the
   * engine never keeps a page that is now excluded. Returns `true` when that
   * reindex ran, so a caller that would reindex anyway can skip its own.
   */
  async saveSettings(): Promise<boolean> {
    await this.saveData(this.settings);
    if (!(await this.loadIgnoreFilters())) return false;
    await this.reindex();
    return true;
  }

  /**
   * Throw the engine away and index the vault again from scratch, so it holds
   * exactly the notes that are not excluded. Used by the "Reindex vault"
   * command and by a change to the excluded folders. Resolves once the new
   * index is ready; a failure is reported in a Notice, not thrown.
   */
  reindex(): Promise<void> {
    this.api.dispose();
    this.api = this.createApi();
    this.ready = this.startApi(this.api);
    return this.ready.catch(() => undefined);
  }

  /** Is this vault path kept out of the engine by the excluded-folders setting or Obsidian's Excluded files? */
  excluded(path: string): boolean {
    return isExcluded(path, this.settings.excludedFolders, this.ignoreFilters);
  }

  /** Subscribe to change and progress events of the current api (survives re-indexing). */
  subscribe(listener: (e: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  confirm(p: PatchProposal): Promise<boolean> {
    return confirmWithDiff(this.app, p);
  }

  /** Run a classification, reporting non-routine failures in a Notice. */
  runClassify(): Promise<void> {
    return this.guard(async () => {
      await this.api.classify();
    });
  }

  reportError(err: unknown): void {
    if (err instanceof OntomarkError && QUIET_CODES.has(err.code)) return;
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OntomarkError ? `${err.code}: ` : "";
    new Notice(`Ontomark: ${code}${message}`);
  }

  async openEntityView(): Promise<void> {
    await this.openView(ENTITY_VIEW);
  }

  async openGraphView(): Promise<void> {
    await this.openView(GRAPH_VIEW);
  }

  async openQueryView(): Promise<void> {
    await this.openView(QUERY_VIEW);
  }

  // ---- internals ----

  private async openView(type: string): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private vaultPort(): VaultPort {
    const vault = this.app.vault;
    return {
      listMarkdown: async () => {
        const files = vault.getMarkdownFiles().filter((f) => !this.excluded(f.path));
        return Promise.all(files.map(async (f) => ({ path: f.path, text: await vault.read(f) })));
      },
      read: async (path) => {
        const f = vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) throw new Error(`File not found: ${path}`);
        return vault.read(f);
      },
      process: async (path, fn) => {
        const f = vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) throw new Error(`File not found: ${path}`);
        return vault.process(f, fn);
      },
    };
  }

  private createApi(): OntomarkApi {
    const client = new OntomarkClient({
      spawn: () => new Worker(this.workerUrl) as unknown as WorkerLike,
      wasmBytes: () => wasm.slice().buffer,
      onProgress: (p) => this.emit({ type: "progress", generation: p.generation, steps: p.steps, total: p.total }),
      onRestart: (reason) => {
        new Notice(`Ontomark: engine restarted (${reason}).`);
      },
    });
    const api = new OntomarkApi(client, this.vaultPort());
    this.apiUnsubscribe?.();
    this.apiUnsubscribe = api.onChange((e) => {
      this.emit(e);
      if (e.type === "indexed" && this.settings.autoClassify) this.autoClassify();
    });
    return api;
  }

  private startApi(api: OntomarkApi): Promise<void> {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const ready = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    ready.catch(() => undefined);
    const run = async (): Promise<void> => {
      try {
        await this.loadIgnoreFilters();
        await api.start(this.settings.profile);
        resolve();
      } catch (err) {
        this.reportError(err);
        reject(err);
      }
    };
    this.app.workspace.onLayoutReady(() => void run());
    return ready;
  }

  /**
   * Read Obsidian's "Excluded files" setting from `<configDir>/app.json`.
   * Fail-open: a missing file, bad JSON or no `userIgnoreFilters` key means
   * no extra filters; a read that fails for another reason keeps the filters
   * already loaded rather than silently un-excluding everything. There is no
   * public event for a change to app.json (`vault.on("raw", …)` is not part
   * of the API), so it is read when the layout is ready (before the initial
   * index) and again whenever the settings tab saves; a change made in
   * Obsidian's own settings takes effect at the next settings save, reindex
   * or plugin reload. Returns `true` when the filters differ from before.
   */
  private async loadIgnoreFilters(): Promise<boolean> {
    const { adapter, configDir } = this.app.vault;
    const file = `${configDir}/app.json`;
    let next: IgnoreFilter[];
    try {
      next = (await adapter.exists(file)) ? parseIgnoreFilters(await adapter.read(file)) : [];
    } catch {
      return false;
    }
    const describe = (f: IgnoreFilter): string => (f.kind === "regex" ? `r:${f.regex.source}` : `p:${f.prefix}`);
    const changed = JSON.stringify(next.map(describe)) !== JSON.stringify(this.ignoreFilters.map(describe));
    this.ignoreFilters = next;
    return changed;
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

  private async guard(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.reportError(err);
    }
  }

  private registerVaultEvents(): void {
    const vault = this.app.vault;
    const isMd = (f: TAbstractFile): f is TFile => f instanceof TFile && f.extension === "md";
    // Every handler waits for the initial index, so an edit made while it loads
    // is applied after it (fileChanged ignores text the engine already has).
    // Excluded paths (ADR-OBS-005) never reach the engine. The rules are
    // checked after `ready`, once the ignore filters are loaded, and the api
    // is the one current at event time, so a call outlasting a reindex lands
    // on the disposed client (quiet) rather than on the unstarted new one.
    // Delete and rename-out ask the engine, not the rules: `fileDeleted` is a
    // no-op for a path it never indexed, and `fileRenamed` indexes the target
    // when the source was not indexed, so a page the rules excluded only
    // after it was indexed is still removed or moved rather than orphaned.
    const current = (): { ready: Promise<void>; api: OntomarkApi } => ({ ready: this.ready, api: this.api });
    const changed = (f: TAbstractFile): void => {
      if (!isMd(f)) return;
      const { ready, api } = current();
      void this.guard(async () => {
        await ready;
        if (this.excluded(f.path)) return;
        await api.fileChanged(f.path, await vault.read(f));
      });
    };
    this.registerEvent(vault.on("modify", changed));
    this.registerEvent(vault.on("create", changed));
    this.registerEvent(
      vault.on("delete", (f) => {
        if (!isMd(f)) return;
        const { ready, api } = current();
        void this.guard(async () => {
          await ready;
          await api.fileDeleted(f.path);
        });
      }),
    );
    this.registerEvent(
      vault.on("rename", (f, oldPath) => {
        if (!isMd(f)) return;
        const { ready, api } = current();
        void this.guard(async () => {
          await ready;
          // Into an excluded folder: the page leaves the engine (no-op if it was never there).
          if (this.excluded(f.path)) await api.fileDeleted(oldPath);
          // Otherwise follow the file; out of an excluded folder this indexes it afresh.
          else await api.fileRenamed(oldPath, f.path);
        });
      }),
    );
  }

  private async setActiveKind(kind: EntityKind): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Ontomark: open a note first.");
      return;
    }
    await this.guard(async () => {
      const proposal = await this.api.proposeSetType(file.path, kind);
      this.announce(await this.api.applyPatch(proposal, (q) => this.confirm(q)));
    });
  }

  private announce(outcome: Awaited<ReturnType<OntomarkApi["applyPatch"]>>): void {
    switch (outcome.status) {
      case "applied":
        new Notice(`Ontomark: updated ${outcome.path}.`);
        break;
      case "no_op":
        new Notice(`Ontomark: ${outcome.path} already has this change.`);
        break;
      case "declined":
        new Notice("Ontomark: change cancelled.");
        break;
      case "refused":
        new Notice(`Ontomark: not written (${outcome.code}): ${outcome.message}`);
        break;
    }
  }

  /** Plan, ask the model (the one network call), ground the answer, then review and apply. */
  private extractFacts(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Ontomark: open a note first.");
      return;
    }
    const { ingestEndpoint, ingestModel } = this.settings;
    if (!ingestEndpoint) {
      new Notice("Ontomark: set an ingest endpoint in settings first.");
      return;
    }
    const problem = endpointProblem(ingestEndpoint);
    if (problem) {
      new Notice(`Ontomark: ${problem}.`);
      return;
    }
    const key = this.ingestKey;
    if (!key) {
      new Notice("Ontomark: enter the API key for this session in settings.");
      return;
    }
    // One run at a time: a second invocation while chunks are in flight would
    // double the calls (and the bill) and open two modals.
    if (this.ingestRun) {
      new Notice("Ontomark: an extraction is already running.");
      return;
    }
    const run: AbortToken = { aborted: false };
    this.ingestRun = run;
    void this.guard(async () => {
      try {
        await this.ready;
        const { request } = await this.api.ingestPlan(file.path);
        const responses = await callModel(
          ingestEndpoint,
          key,
          ingestModel,
          request,
          (m) => new Notice(`Ontomark: ${m}.`),
          run,
        );
        if (run.aborted) return;
        const result = await this.api.ingestAccept(file.path, request, responses);
        if (!result.preview) {
          await confirmIngest(this.app, result);
          return;
        }
        this.announce(await this.api.applyPatch(result.preview, () => confirmIngest(this.app, result)));
      } finally {
        if (this.ingestRun === run) this.ingestRun = null;
      }
    });
  }

  private registerCommands(): void {
    this.addCommand({ id: "extract-facts", name: "Extract facts from this note", callback: () => this.extractFacts() });
    this.addCommand({ id: "open-graph", name: "Open ontology graph", callback: () => void this.openGraphView() });
    this.addCommand({ id: "open-panel", name: "Open ontology panel", callback: () => void this.openEntityView() });
    this.addCommand({ id: "open-query", name: "Open SPARQL query", callback: () => void this.openQueryView() });
    this.addCommand({ id: "classify-now", name: "Classify now", callback: () => void this.runClassify() });
    this.addCommand({ id: "reindex", name: "Reindex vault", callback: () => void this.reindex() });
    this.addCommand({ id: "make-class", name: "Make this note a class", callback: () => void this.setActiveKind("class") });
    this.addCommand({
      id: "make-individual",
      name: "Make this note an individual",
      callback: () => void this.setActiveKind("individual"),
    });
    this.addCommand({
      id: "make-property",
      name: "Make this note a property",
      callback: () => void this.setActiveKind("property"),
    });
    this.addCommand({
      id: "add-parent",
      name: "Add parent to this note",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("Ontomark: open a note first.");
          return;
        }
        new AddParentModal(this.app, file.path, (target) => {
          void this.guard(async () => {
            const proposal = await this.api.proposeAddParent(file.path, target);
            this.announce(await this.api.applyPatch(proposal, (q) => this.confirm(q)));
          });
        }).open();
      },
    });
  }
}
