// A filesystem-backed stand-in for the parts of the Obsidian API the plugin
// uses (see the constraint list in plugin/README.md, "Testing"). It is NOT
// Obsidian: it exists so the installed main.js can be exercised end to end
// with the network disabled. Semantics follow the Obsidian API docs:
// - vault events are delivered asynchronously;
// - vault.process(file, fn) writes fn's result, and writes nothing if fn throws;
// - Component.registerEvent refs are released on unload.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// ---------- fake DOM (Obsidian's element helpers only) ----------

class FakeEl {
  constructor(tag = "div", parent = null) {
    this.tagName = tag.toUpperCase();
    this.parent = parent;
    this.children = [];
    this.classes = new Set();
    this.attrs = {};
    this.listeners = {};
    this.ownText = "";
    this.value = "";
  }
  _apply(opts) {
    if (!opts) return this;
    if (typeof opts === "string") {
      this.addClass(opts);
      return this;
    }
    if (opts.text !== undefined) this.ownText = String(opts.text);
    if (opts.cls) for (const c of [].concat(opts.cls).flatMap((x) => String(x).split(/\s+/))) if (c) this.classes.add(c);
    if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) this.setAttr(k, v);
    if (opts.value !== undefined) this.value = String(opts.value);
    return this;
  }
  createEl(tag, opts, cb) {
    const el = new FakeEl(tag, this)._apply(opts);
    if (tag === "option" && el.attrs.value !== undefined) el.value = String(el.attrs.value);
    this.children.push(el);
    if (cb) cb(el);
    return el;
  }
  createDiv(opts, cb) {
    return this.createEl("div", opts, cb);
  }
  createSpan(opts, cb) {
    return this.createEl("span", opts, cb);
  }
  empty() {
    this.children = [];
    this.ownText = "";
  }
  setText(t) {
    this.children = [];
    this.ownText = String(t);
  }
  addClass(...c) {
    for (const x of c) this.classes.add(x);
  }
  removeClass(...c) {
    for (const x of c) this.classes.delete(x);
  }
  toggleClass(c, on) {
    if (on ?? !this.classes.has(c)) this.classes.add(c);
    else this.classes.delete(c);
  }
  hasClass(c) {
    return this.classes.has(c);
  }
  setAttr(k, v) {
    this.attrs[k] = v === null ? undefined : String(v);
    if (k === "value") this.value = String(v);
  }
  getAttr(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  dispatch(type) {
    const results = (this.listeners[type] ?? []).map((fn) => fn({ type, target: this, preventDefault() {} }));
    return Promise.all(results);
  }
  click() {
    return this.dispatch("click");
  }
  get textContent() {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  set textContent(t) {
    this.setText(t);
  }
  // ---- harness queries (not part of the plugin's allowed surface) ----
  findAll(pred) {
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        if (pred(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  find(pred) {
    return this.findAll(pred)[0] ?? null;
  }
}

// ---------- events ----------

class Events {
  constructor() {
    this._handlers = new Map();
  }
  on(name, cb, ctx) {
    const ref = { e: this, name, fn: cb, ctx };
    if (!this._handlers.has(name)) this._handlers.set(name, new Set());
    this._handlers.get(name).add(ref);
    return ref;
  }
  offref(ref) {
    this._handlers.get(ref.name)?.delete(ref);
  }
  trigger(name, ...args) {
    for (const ref of [...(this._handlers.get(name) ?? [])]) ref.fn.apply(ref.ctx, args);
  }
  listenerCount() {
    let n = 0;
    for (const s of this._handlers.values()) n += s.size;
    return n;
  }
}

// ---------- vault ----------

class TAbstractFile {
  constructor(vault, p) {
    this.vault = vault;
    this.path = p;
    this.name = path.posix.basename(p);
  }
}
class TFile extends TAbstractFile {
  get extension() {
    const i = this.name.lastIndexOf(".");
    return i < 0 ? "" : this.name.slice(i + 1);
  }
  get basename() {
    const i = this.name.lastIndexOf(".");
    return i < 0 ? this.name : this.name.slice(0, i);
  }
}
class TFolder extends TAbstractFile {}

class Vault extends Events {
  constructor(root) {
    super();
    this.root = root;
    this.configDir = ".obsidian";
    this.files = new Map();
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir).sort()) {
        if (name.startsWith(".")) continue;
        const abs = path.join(dir, name);
        if (fs.statSync(abs).isDirectory()) walk(abs);
        else {
          const rel = path.relative(root, abs).split(path.sep).join("/");
          this.files.set(rel, new TFile(this, rel));
        }
      }
    };
    walk(root);
  }
  _abs(p) {
    return path.join(this.root, ...p.split("/"));
  }
  _later(name, ...args) {
    setTimeout(() => this.trigger(name, ...args), 0);
  }
  getMarkdownFiles() {
    return [...this.files.values()].filter((f) => f.extension === "md");
  }
  getFiles() {
    return [...this.files.values()];
  }
  getAbstractFileByPath(p) {
    return this.files.get(p) ?? null;
  }
  async read(file) {
    return fs.readFileSync(this._abs(file.path), "utf8");
  }
  async cachedRead(file) {
    return this.read(file);
  }
  async modify(file, data) {
    fs.writeFileSync(this._abs(file.path), data, "utf8");
    this._later("modify", file);
  }
  async process(file, fn) {
    const data = fs.readFileSync(this._abs(file.path), "utf8");
    const next = fn(data); // throws => nothing written
    fs.writeFileSync(this._abs(file.path), next, "utf8");
    this._later("modify", file);
    return next;
  }
  async create(p, data) {
    fs.mkdirSync(path.dirname(this._abs(p)), { recursive: true });
    fs.writeFileSync(this._abs(p), data, "utf8");
    const f = new TFile(this, p);
    this.files.set(p, f);
    this._later("create", f);
    return f;
  }
  async delete(file) {
    fs.rmSync(this._abs(file.path));
    this.files.delete(file.path);
    this._later("delete", file);
  }
  async rename(file, newPath) {
    const old = file.path;
    fs.mkdirSync(path.dirname(this._abs(newPath)), { recursive: true });
    fs.renameSync(this._abs(old), this._abs(newPath));
    this.files.delete(old);
    file.path = newPath;
    file.name = path.posix.basename(newPath);
    this.files.set(newPath, file);
    this._later("rename", file, old);
  }
}

// ---------- components, plugin, views ----------

class Component {
  constructor() {
    this._refs = [];
    this._cleanups = [];
    this._loaded = false;
  }
  registerEvent(ref) {
    this._refs.push(ref);
  }
  register(cb) {
    this._cleanups.push(cb);
  }
  registerInterval(id) {
    this._cleanups.push(() => clearInterval(id));
    return id;
  }
  async load() {
    this._loaded = true;
    await this.onload?.();
  }
  unload() {
    for (const ref of this._refs.splice(0)) ref.e.offref(ref);
    for (const cb of this._cleanups.splice(0)) cb();
    this._loaded = false;
    this.onunload?.();
  }
}

class WorkspaceLeaf {
  constructor(app) {
    this.app = app;
    this.view = null;
  }
  async setViewState(state) {
    const factory = this.app._viewFactories.get(state.type);
    if (!factory) throw new Error(`no view registered for ${state.type}`);
    if (this.view) await this.view.onClose?.();
    this.view = factory(this);
    this.app.workspace._leaves.add(this);
    await this.view.onOpen?.();
  }
  getViewState() {
    return { type: this.view?.getViewType?.() };
  }
  async detach() {
    this.app.workspace._leaves.delete(this);
    await this.view?.onClose?.();
    this.view = null;
  }
}

class Workspace extends Events {
  constructor(app) {
    super();
    this.app = app;
    this._leaves = new Set();
    this._layoutReady = false;
    this._readyCbs = [];
    this.activeFile = null;
    this.opened = [];
  }
  onLayoutReady(cb) {
    if (this._layoutReady) setTimeout(cb, 0);
    else this._readyCbs.push(cb);
  }
  _setLayoutReady() {
    this._layoutReady = true;
    for (const cb of this._readyCbs.splice(0)) cb();
  }
  getActiveFile() {
    return this.activeFile;
  }
  getRightLeaf() {
    return new WorkspaceLeaf(this.app);
  }
  getLeaf() {
    return new WorkspaceLeaf(this.app);
  }
  getLeavesOfType(type) {
    return [...this._leaves].filter((l) => l.view?.getViewType?.() === type);
  }
  async revealLeaf() {}
  async openLinkText(link, source, newLeaf) {
    this.opened.push({ link, source, newLeaf });
  }
  async detachLeavesOfType(type) {
    for (const l of this.getLeavesOfType(type)) await l.detach();
  }
}

class App {
  constructor(root) {
    this.vault = new Vault(root);
    this.workspace = new Workspace(this);
    this._viewFactories = new Map();
    this.commands = new Map();
    this.settingTabs = [];
    this.ribbon = [];
    this.notices = [];
    this.modals = [];
    this.onModalOpen = null;
  }
}

class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData() {
    const p = path.join(this.app.vault.root, ".obsidian/plugins", this.manifest.id, "data.json");
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
  }
  async saveData(data) {
    const p = path.join(this.app.vault.root, ".obsidian/plugins", this.manifest.id, "data.json");
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }
  addSettingTab(tab) {
    this.app.settingTabs.push(tab);
    this.register(() => (this.app.settingTabs = this.app.settingTabs.filter((t) => t !== tab)));
  }
  registerView(type, factory) {
    this.app._viewFactories.set(type, factory);
    this.register(() => this.app._viewFactories.delete(type));
  }
  addRibbonIcon(icon, title, cb) {
    const el = new FakeEl("div");
    el.addEventListener("click", cb);
    this.app.ribbon.push({ icon, title, el });
    this.register(() => (this.app.ribbon = this.app.ribbon.filter((r) => r.el !== el)));
    return el;
  }
  addCommand(cmd) {
    const id = `${this.manifest.id}:${cmd.id}`;
    this.app.commands.set(id, cmd);
    this.register(() => this.app.commands.delete(id));
    return cmd;
  }
  addStatusBarItem() {
    return new FakeEl("div");
  }
}

class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = new FakeEl("div");
    this.containerEl.createDiv();
    this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
  }
  getIcon() {
    return "document";
  }
}

class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = new FakeEl("div");
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  open() {
    this.app.modals.push(this);
    this.onOpen?.();
    if (this.app.onModalOpen) setTimeout(() => this.app.onModalOpen(this), 0);
  }
  close() {
    this.app.modals = this.app.modals.filter((m) => m !== this);
    this.onClose?.();
  }
}

class Notice {
  constructor(message) {
    Notice.log.push(String(message));
  }
  hide() {}
  setMessage(m) {
    Notice.log.push(String(m));
    return this;
  }
}
Notice.log = [];

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = new FakeEl("div");
  }
}

class DropdownComponent {
  constructor(el) {
    this.selectEl = el.createEl("select");
    this._onChange = null;
  }
  addOption(value, label) {
    this.selectEl.createEl("option", { text: label, attr: { value } });
    return this;
  }
  addOptions(map) {
    for (const [v, l] of Object.entries(map)) this.addOption(v, l);
    return this;
  }
  setValue(v) {
    this.selectEl.value = v;
    return this;
  }
  getValue() {
    return this.selectEl.value;
  }
  onChange(fn) {
    this._onChange = fn;
    this.selectEl.addEventListener("change", () => fn(this.selectEl.value));
    return this;
  }
}

class ToggleComponent {
  constructor(el) {
    this.toggleEl = el.createDiv({ cls: "checkbox-container" });
    this.value = false;
  }
  setValue(v) {
    this.value = !!v;
    return this;
  }
  getValue() {
    return this.value;
  }
  onChange(fn) {
    this.toggleEl.addEventListener("click", () => {
      this.value = !this.value;
      return fn(this.value);
    });
    return this;
  }
}

class Setting {
  constructor(containerEl) {
    this.settingEl = containerEl.createDiv({ cls: "setting-item" });
    this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
    this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
    this.components = [];
  }
  setName(n) {
    this.nameEl.setText(n);
    return this;
  }
  setDesc(d) {
    this.descEl.setText(typeof d === "string" ? d : "");
    return this;
  }
  setHeading() {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }
  addDropdown(cb) {
    const c = new DropdownComponent(this.controlEl);
    this.components.push(c);
    cb(c);
    return this;
  }
  addToggle(cb) {
    const c = new ToggleComponent(this.controlEl);
    this.components.push(c);
    cb(c);
    return this;
  }
}

function debounce(fn, ms = 0, resetTimer = false) {
  let timer = null;
  let lastArgs = [];
  const d = (...args) => {
    lastArgs = args;
    if (timer && !resetTimer) return d;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, ms);
    return d;
  };
  d.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    return d;
  };
  d.run = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      return fn(...lastArgs);
    }
  };
  return d;
}

const normalizePath = (p) => p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");

module.exports = {
  App,
  Component,
  Events,
  FakeEl,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  Vault,
  Workspace,
  WorkspaceLeaf,
  debounce,
  normalizePath,
};
