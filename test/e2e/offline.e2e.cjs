// Offline end-to-end test of the INSTALLED plugin (EXP-11, with EXP-05/06/12
// exercised through the plugin's own surface).
//
// Usage: node offline.e2e.cjs <vault-dir>
// <vault-dir>/.obsidian/plugins/ontomark/{main.js,manifest.json,styles.css}
// must exist. main.js is evaluated the way Obsidian loads a plugin: as a
// CommonJS function with an injected `require` that serves "obsidian".
// Prints a JSON report and exits non-zero if any check fails.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");

const vaultDir = path.resolve(process.argv[2] ?? "");
const pluginDir = path.join(vaultDir, ".obsidian/plugins/ontomark");
const report = { started: new Date().toISOString(), node: process.version, checks: [], network: {} };
let failed = 0;
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) failed++;
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await tick(5);
  }
  return false;
};
const hashTree = (dir) => {
  const h = crypto.createHash("sha256");
  const walk = (d) => {
    for (const n of fs.readdirSync(d).sort()) {
      if (n === ".obsidian") continue;
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else h.update(path.relative(dir, p)).update("\0").update(fs.readFileSync(p)).update("\0");
    }
  };
  walk(dir);
  return h.digest("hex");
};
const codeOf = async (p) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e && e.code ? e.code : String(e);
  }
};

async function probeNetwork() {
  // Before the tripwire: is there any route out at all?
  report.network.interfaces = Object.keys(require("node:os").networkInterfaces());
  report.network.outbound = await new Promise((resolve) => {
    const s = net.connect({ host: "1.1.1.1", port: 443, timeout: 1500 });
    s.on("connect", () => {
      s.destroy();
      resolve("connected");
    });
    s.on("timeout", () => {
      s.destroy();
      resolve("timeout");
    });
    s.on("error", (e) => resolve(e.code ?? String(e)));
  });
}

async function main() {
  await probeNetwork();
  const runtime = require("./runtime-shim.cjs");
  runtime.installTripwire();
  globalThis.Worker = runtime.BlobWorker;
  const obsidian = require("./obsidian-shim.cjs");

  // ---- install check ----
  const installed = fs.readdirSync(pluginDir).sort();
  check("installed plugin consists of main.js, manifest.json, styles.css only", JSON.stringify(installed.filter((f) => f !== "data.json")) === JSON.stringify(["main.js", "manifest.json", "styles.css"]), installed);
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
  check("manifest: id ontomark, desktop only", manifest.id === "ontomark" && manifest.isDesktopOnly === true, manifest);

  const loadPlugin = async (app) => {
    const source = fs.readFileSync(path.join(pluginDir, "main.js"), "utf8");
    const mod = { exports: {} };
    const req = (name) => {
      if (name === "obsidian") return obsidian;
      throw new Error(`plugin required unexpected module "${name}"`);
    };
    new Function("require", "module", "exports", source)(req, mod, mod.exports);
    const PluginClass = mod.exports.default ?? mod.exports;
    const plugin = new PluginClass(app, manifest);
    await plugin.load();
    return plugin;
  };

  const app = new obsidian.App(vaultDir);
  const before = hashTree(vaultDir);
  const plugin = await loadPlugin(app);
  check("no vault listeners before layout-ready (startup create storm ignored)", app.vault.listenerCount() === 0, app.vault.listenerCount());
  app.workspace._setLayoutReady();
  await plugin.ready;
  check("vault listeners registered after layout-ready", app.vault.listenerCount() === 4, app.vault.listenerCount());
  check("loading and indexing wrote nothing to the vault", hashTree(vaultDir) === before);

  // ---- index (EXP-05: generic profile default; plain notes are not entities) ----
  const api = plugin.api;
  const index = await api.index();
  const entityPaths = index.entities.map((e) => e.path);
  const chain = entityPaths.filter((p) => p.startsWith("Chain/")).length;
  check("index: generic profile by default", index.profile === "generic", index.profile);
  check("index: 10 fixture entities + chain", index.entities.length === 10 + chain, { entities: index.entities.length, chain });
  check("index: plain notes are not entities", !entityPaths.includes("Welcome.md") && !entityPaths.includes("Notes/Daily idea.md"));
  check("index: malformed frontmatter reported, indexing continued", index.diagnostics.some((d) => d.code === "frontmatter_unreadable" && d.path === "Broken.md"));

  // ---- side panel ----
  await plugin.openEntityView();
  const entityLeaf = app.workspace.getLeavesOfType("ontomark-entities")[0];
  await waitFor(() => entityLeaf?.view?.contentEl?.textContent.includes("Animal"));
  const panelText = entityLeaf.view.contentEl.textContent;
  check("panel lists classes, individuals and properties", ["Animal", "Rex", "has owner"].every((s) => panelText.includes(s)), panelText.slice(0, 300));
  check("panel names the EL reasoner", panelText.includes("ontomark-reason/whelk-el"), panelText.slice(0, 200));
  const animalItem = entityLeaf.view.contentEl.find((el) => el.attrs["data-iri"] === "urn:ontomark:page:Ontology/Animal");
  check("panel item carries its IRI", !!animalItem);

  // ---- classify in the worker (real thread) ----
  const done = await api.classify();
  check("classify: unsatisfiable class found", JSON.stringify(done.classification.unsatisfiable) === JSON.stringify(["urn:ontomark:page:Ontology/Catdog"]), done.classification.unsatisfiable);
  check("classify: EL fragment reasoner, full-input policy", done.classification.reasoner.id === "ontomark-reason/whelk-el" && done.classification.reasoner.el_complete === false && done.classification.policy === "all", done.classification.reasoner);
  check("classify: refused range axiom reported, result marked incomplete", done.classification.complete === false && done.classification.unsupported.length === 1 && done.classification.unsupported[0].reason.startsWith("EL_NOT_IMPLEMENTED"), done.classification.unsupported);
  await waitFor(() => entityLeaf.view.contentEl.textContent.includes("inferred"));
  check("panel shows inferred superclasses after classification", entityLeaf.view.contentEl.textContent.includes("inferred"));
  const incomplete = entityLeaf.view.contentEl.find((el) => el.attrs["data-ontomark"] === "incomplete");
  check("panel explains why the classification is incomplete", !!incomplete && incomplete.textContent.includes("EL_NOT_IMPLEMENTED"), incomplete?.textContent);

  // ---- cancel-on-edit through real vault events (EXP-06) ----
  const genBefore = api.status().generation;
  const racing = codeOf(api.classify());
  await tick(1);
  const catFile = app.vault.getAbstractFileByPath("Ontology/Cat.md");
  const catEdited = "---\ntype: class\nsubclass-of: [\"[[Mammal]]\"]\nquality: 0.65\n---\nCats, edited during classification.\n";
  await app.vault.modify(catFile, catEdited);
  const racingCode = await racing;
  await waitFor(() => api.status().generation > genBefore);
  check("edit during classify: old result discarded (stale/cancelled)", ["stale", "cancelled"].includes(racingCode), racingCode);
  const after = await api.query('PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT ?q WHERE { ?c rdfs:label "Cat" ; <urn:ontomark:key:quality> ?q }');
  check("edit during classify: new generation reflects the edit", after.rows[0]?.q?.value === "0.65", after.rows);

  // ---- SPARQL view (EXP-12) ----
  await plugin.openQueryView();
  const queryView = app.workspace.getLeavesOfType("ontomark-query")[0].view;
  queryView.textarea.value = "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT ?t WHERE { ?r rdfs:label \"Rex\" ; rdf:type ?t } ORDER BY ?t";
  queryView.datasetSelect.value = "combined";
  await queryView.run();
  const rexRows = queryView.lastResult?.rows?.length;
  check("query view: inferred types of Rex over the combined dataset", rexRows === 5, { rows: rexRows, error: queryView.lastError });
  check("query view renders a results table", queryView.contentEl.find((el) => el.tagName === "TABLE") !== null);
  const hashBeforeQueries = hashTree(vaultDir);
  const refusals = {};
  for (const [name, q] of Object.entries({
    update: "DELETE WHERE { ?s ?p ?o }",
    service: "SELECT * WHERE { SERVICE <http://example.org/sparql> { ?s ?p ?o } }",
    from: "SELECT * FROM <urn:x> WHERE { ?s ?p ?o }",
  })) {
    refusals[name] = await codeOf(api.query(q));
  }
  check("SPARQL UPDATE / SERVICE / FROM refused with codes", refusals.update === "update_forbidden" && refusals.service === "service_forbidden" && refusals.from === "dataset_clause", refusals);
  check("queries changed no file", hashTree(vaultDir) === hashBeforeQueries);

  // ---- guarded patch with diff preview (applied) ----
  const welcomeBefore = fs.readFileSync(path.join(vaultDir, "Welcome.md"), "utf8");
  let shownDiff = null;
  app.onModalOpen = (modal) => {
    shownDiff = modal.contentEl.find((el) => el.tagName === "PRE")?.textContent ?? null;
    modal.contentEl.find((el) => el.attrs["data-ontomark-action"] === "apply")?.click();
  };
  const typed = await api.proposeSetType("Welcome.md", "class");
  const applied = await api.applyPatch(typed, (p) => plugin.confirm(p));
  const welcomeAfter = fs.readFileSync(path.join(vaultDir, "Welcome.md"), "utf8");
  check("patch: diff preview shown before writing", typeof shownDiff === "string" && shownDiff.includes("+type: class"), shownDiff);
  check("patch: applied after approval", applied.status === "applied", applied);
  check("patch: prose bytes preserved, frontmatter added", welcomeAfter.endsWith(welcomeBefore) && welcomeAfter.startsWith("---\n"), welcomeAfter);
  const reindexed = await api.index();
  check("patch: the note is now a class in the index", reindexed.entities.some((e) => e.path === "Welcome.md" && e.kind === "class"));

  // ---- guarded patch refused: the file changed between preview and accept ----
  const dogPath = path.join(vaultDir, "Ontology/Dog.md");
  const proposal = await api.proposeAddParent("Ontology/Dog.md", "Person");
  const external = fs.readFileSync(dogPath, "utf8").replace("quality: 0.8", "quality: 0.85");
  app.onModalOpen = async (modal) => {
    // While the user looks at the diff, another editor changes the file.
    fs.writeFileSync(dogPath, external);
    modal.contentEl.find((el) => el.attrs["data-ontomark-action"] === "apply")?.click();
  };
  const refused = await api.applyPatch(proposal, (p) => plugin.confirm(p));
  check("patch refused when the source changed after preview", refused.status === "refused" && refused.code === "source_changed", refused);
  check("refused patch wrote nothing (external edit intact)", fs.readFileSync(dogPath, "utf8") === external);

  // ---- declined patch ----
  app.onModalOpen = (modal) => modal.contentEl.find((el) => el.attrs["data-ontomark-action"] === "cancel")?.click();
  const catBefore = fs.readFileSync(path.join(vaultDir, "Ontology/Cat.md"), "utf8");
  const declined = await api.applyPatch(await api.proposeAddParent("Ontology/Cat.md", "Person"), (p) => plugin.confirm(p));
  check("declined patch writes nothing", declined.status === "declined" && fs.readFileSync(path.join(vaultDir, "Ontology/Cat.md"), "utf8") === catBefore, declined);
  app.onModalOpen = null;

  // ---- delete and rename through vault events ----
  const genDel = api.status().generation;
  await app.vault.delete(app.vault.getAbstractFileByPath("People/Rex.md"));
  await waitFor(() => api.status().generation > genDel);
  const noRex = await api.index();
  check("delete: entity gone from the index", !noRex.entities.some((e) => e.path === "People/Rex.md"));
  const genRen = api.status().generation;
  await app.vault.rename(app.vault.getAbstractFileByPath("Ontology/Mammal.md"), "Ontology/Mammals/Mammal.md");
  await waitFor(() => api.status().generation > genRen);
  const renamed = await api.index();
  check("rename: entity follows the file", renamed.entities.some((e) => e.path === "Ontology/Mammals/Mammal.md"));

  // ---- estate profile is opt-in (EXP-05) ----
  const tab = app.settingTabs[0];
  tab.display();
  const profileSelect = tab.containerEl.find((el) => el.tagName === "SELECT" && el.children.some((o) => o.value === "estate"));
  check("settings: profile selector offers generic (default) and estate", !!profileSelect && profileSelect.value === "generic", profileSelect?.children.map((o) => o.value));
  profileSelect.value = "estate";
  await profileSelect.dispatch("change");
  await waitFor(async () => (await api.index().catch(() => null))?.profile === "estate");
  const estate = await api.index();
  check("estate profile: pages without `resource` refused", estate.profile === "estate" && estate.entities.length === 0 && estate.diagnostics.some((d) => d.code === "iri_missing"), { entities: estate.entities.length });

  // ---- unload / reload ----
  const workersBefore = runtime.liveWorkers();
  plugin.unload();
  await tick(20);
  check("unload: worker terminated", runtime.liveWorkers() === 0, { before: workersBefore, after: runtime.liveWorkers() });
  check("unload: vault listeners removed", app.vault.listenerCount() === 0, app.vault.listenerCount());
  check("unload: commands and views unregistered", app.commands.size === 0 && app._viewFactories.size === 0, { commands: app.commands.size, views: app._viewFactories.size });
  check("unload: later calls reject with disposed", (await codeOf(api.index())) === "disposed");

  const app2 = new obsidian.App(vaultDir);
  const plugin2 = await loadPlugin(app2);
  app2.workspace._setLayoutReady();
  await plugin2.ready;
  const again = await plugin2.api.index();
  check("reload: plugin indexes again (persisted estate profile honoured)", again.profile === "estate", again.profile);
  plugin2.unload();
  await tick(20);

  report.network.attempts = runtime.attempts;
  check("no network attempt from any thread", runtime.attempts.length === 0, runtime.attempts);
  report.notices = obsidian.Notice.log;
  report.finished = new Date().toISOString();
  report.failed = failed;
  report.passed = report.checks.length - failed;
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  report.fatal = String(err && err.stack ? err.stack : err);
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
});
