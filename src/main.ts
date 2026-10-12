import { Modal, Notice, Plugin, TFile, debounce } from "obsidian";
import type { App, TAbstractFile, WorkspaceLeaf } from "obsidian";
import workerSource from "virtual:worker-source";
import wasm from "./generated/ontomark.wasm";
import { OntomarkApi } from "./api";
import type { ChangeEvent, VaultPort } from "./api";
import { OntomarkClient, OntomarkError } from "./client";
import type { EntityKind, PatchProposal, WorkerLike } from "./protocol";
import { DEFAULT_SETTINGS, OntomarkSettingTab } from "./settings";
import type { OntomarkSettings } from "./settings";
import { ENTITY_VIEW, EntityView } from "./views/entity-view";
import { QUERY_VIEW, QueryView } from "./views/query-view";
import { GRAPH_VIEW, GraphView } from "./views/graph-view";
import { confirmWithDiff } from "./views/diff-modal";
import { confirmIngest } from "./views/ingest-modal";
import { callModel } from "./ingest-transport";

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

  private workerUrl = "";
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
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };

    this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    this.api = this.createApi();
    this.ready = this.startApi(this.api);

    this.addSettingTab(new OntomarkSettingTab(this.app, this));
    this.registerView(ENTITY_VIEW, (leaf) => new EntityView(leaf, this));
    this.registerView(QUERY_VIEW, (leaf) => new QueryView(leaf, this));
    this.registerView(GRAPH_VIEW, (leaf) => new GraphView(leaf, this));
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
    this.ingestKey = "";
    this.apiUnsubscribe?.();
    this.apiUnsubscribe = null;
    this.listeners.clear();
    this.api?.dispose();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = "";
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
        const files = vault.getMarkdownFiles();
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
    const changed = (f: TAbstractFile): void => {
      if (!isMd(f)) return;
      void this.guard(async () => {
        await this.ready;
        await this.api.fileChanged(f.path, await vault.read(f));
      });
    };
    this.registerEvent(vault.on("modify", changed));
    this.registerEvent(vault.on("create", changed));
    this.registerEvent(
      vault.on("delete", (f) => {
        if (!isMd(f)) return;
        void this.guard(async () => {
          await this.ready;
          await this.api.fileDeleted(f.path);
        });
      }),
    );
    this.registerEvent(
      vault.on("rename", (f, oldPath) => {
        if (!isMd(f)) return;
        void this.guard(async () => {
          await this.ready;
          await this.api.fileRenamed(oldPath, f.path);
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
    const key = this.ingestKey;
    if (!key) {
      new Notice("Ontomark: enter the API key for this session in settings.");
      return;
    }
    void this.guard(async () => {
      await this.ready;
      const { request } = await this.api.ingestPlan(file.path);
      const responses = await callModel(ingestEndpoint, key, ingestModel, request, (m) => new Notice(`Ontomark: ${m}.`));
      const result = await this.api.ingestAccept(file.path, request, responses);
      if (!result.preview) {
        await confirmIngest(this.app, result);
        return;
      }
      this.announce(await this.api.applyPatch(result.preview, () => confirmIngest(this.app, result)));
    });
  }

  private registerCommands(): void {
    this.addCommand({ id: "extract-facts", name: "Extract facts from this note", callback: () => this.extractFacts() });
    this.addCommand({ id: "open-graph", name: "Open ontology graph", callback: () => void this.openGraphView() });
    this.addCommand({ id: "open-panel", name: "Open ontology panel", callback: () => void this.openEntityView() });
    this.addCommand({ id: "open-query", name: "Open SPARQL query", callback: () => void this.openQueryView() });
    this.addCommand({ id: "classify-now", name: "Classify now", callback: () => void this.runClassify() });
    this.addCommand({
      id: "reindex",
      name: "Reindex vault",
      callback: () => {
        this.api.dispose();
        this.api = this.createApi();
        this.ready = this.startApi(this.api);
      },
    });
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
