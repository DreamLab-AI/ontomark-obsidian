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
  // Obsidian's renderer global for the window in use; timers are scoped to it.
  globalThis.activeWindow = globalThis;
  if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
  const obsidian = require("./obsidian-shim.cjs");
  // The tripwire also covers the plugin's one network primitive: any call is recorded as an attempt.
  obsidian.requestUrlHost.impl = async (req) => {
    runtime.attempts.push({ thread: "main", what: "requestUrl", url: req && req.url });
    throw new Error("network disabled by ontomark offline test: requestUrl");
  };

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
  let api = plugin.api; // reassigned after a reindex (the excluded-folders checks)
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

  // ---- in-note `ontomark-sparql` blocks (EXP-13; after Dot Triples, ADR-OBS-004) ----
  const processor = app.codeBlockProcessors.get("ontomark-sparql");
  check("an ontomark-sparql code block processor is registered", typeof processor === "function");
  const renderBlock = async (source, sourcePath) => {
    const el = new obsidian.FakeEl("div");
    let child = null;
    await processor(source, el, { sourcePath, addChild: (c) => { child = c; void c.load(); } });
    await child.ready;
    return { el, child };
  };
  const rdfPrefixes = "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n";
  const thisBlock = await renderBlock(`# dataset: combined\n${rdfPrefixes}SELECT ?t WHERE { __THIS__ rdf:type ?t } ORDER BY ?t`, "People/Rex.md");
  check("block: __THIS__ is the note's entity and the directive picks the dataset", thisBlock.child.lastResult?.rows?.length === rexRows, { rows: thisBlock.child.lastResult?.rows?.length, error: thisBlock.child.lastError });
  check("block renders a results table in place", thisBlock.el.find((e) => e.tagName === "TABLE") !== null && thisBlock.el.hasClass("ontomark-block"), { table: thisBlock.el.find((e) => e.tagName === "TABLE") !== null, classes: [...thisBlock.el.classes] });
  const linkBlock = await renderBlock(`${rdfPrefixes}SELECT ?p WHERE { [[Rex]] ?p [[Dog|the dog]] }`, "Welcome.md");
  check("block: [[links]] resolve across folders to entity IRIs", linkBlock.child.lastResult?.rows?.some((r) => r.p?.value?.endsWith("#type")) === true, { rows: linkBlock.child.lastResult?.rows, error: linkBlock.child.lastError });
  const plainBlock = await renderBlock("SELECT ?p WHERE { __THIS__ ?p ?o }", "Welcome.md");
  check("block: __THIS__ in a plain note is refused with a reason, not run", plainBlock.child.lastResult === null && /not an ontology entity/.test(plainBlock.child.lastError ?? ""), plainBlock.child.lastError);
  const missingBlock = await renderBlock("SELECT ?p WHERE { [[Nobody]] ?p ?o }", "People/Rex.md");
  check("block: an unresolved [[link]] is named in the error", /\[\[Nobody\]\]/.test(missingBlock.child.lastError ?? ""), missingBlock.child.lastError);
  const quotedBlock = await renderBlock(`${rdfPrefixes}SELECT ?x WHERE { BIND("[[Nobody]] and __THIS__" AS ?x) }`, "Welcome.md");
  check("block: references inside string literals are left alone", quotedBlock.child.lastResult?.rows?.[0]?.x?.value === "[[Nobody]] and __THIS__", { rows: quotedBlock.child.lastResult?.rows, error: quotedBlock.child.lastError });
  thisBlock.child.unload();
  linkBlock.child.unload();
  plainBlock.child.unload();
  missingBlock.child.unload();
  quotedBlock.child.unload();
  check("blocks changed no file", hashTree(vaultDir) === hashBeforeQueries);

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

  // ---- excluded folders and Obsidian's Excluded files (ADR-OBS-005) ----
  // The fixture vault holds templates/Note Template.md (Templater placeholders in its
  // frontmatter) and Notes/Private/Secret.md (type: class) under a `userIgnoreFilters`
  // entry in .obsidian/app.json. Neither may reach the engine: the entity count checked
  // above (10 fixture entities) already excludes them; this pins the paths.
  const hidden = ["templates/Note Template.md", "Notes/Private/Secret.md"];
  const tab = app.settingTabs[0];
  check("excluded: default `templates` folder and Obsidian's Excluded files are not indexed", plugin.settings.excludedFolders.join() === "templates" && hidden.every((p) => !api.client.paths.includes(p)) && renamed.entities.every((e) => !hidden.includes(e.path)) && renamed.diagnostics.every((d) => !hidden.includes(d.path)), { paths: api.client.paths.filter((p) => !p.startsWith("Chain/")), settings: plugin.settings.excludedFolders });
  check("excluded: entityForPath is undefined for the template and the private note", (await api.entityForPath(hidden[0])) === undefined && (await api.entityForPath(hidden[1])) === undefined);
  check("excluded: a note merely named like the folder is indexed", api.client.paths.includes("templates.md") && !api.client.paths.some((p) => p.startsWith("templates/")));
  // create inside an excluded folder and modify a hidden note: neither event reaches the engine
  const genQuiet = api.status().generation;
  await app.vault.create("templates/Another Template.md", "---\ntype: class\n---\nStill a template.\n");
  await app.vault.modify(app.vault.getAbstractFileByPath("Notes/Private/Secret.md"), "---\ntype: class\n---\nEdited in private.\n");
  await tick(60);
  check("excluded: create in templates/ and modify under Excluded files leave the engine untouched", api.status().generation === genQuiet && !api.client.paths.includes("templates/Another Template.md") && !api.client.paths.includes("Notes/Private/Secret.md"), { generation: api.status().generation, before: genQuiet });
  // Obsidian's Excluded files change while the plugin runs: the next settings save picks it up and reindexes
  const appJsonPath = path.join(vaultDir, ".obsidian/app.json");
  const appJsonBefore = fs.readFileSync(appJsonPath, "utf8");
  fs.writeFileSync(appJsonPath, JSON.stringify({ userIgnoreFilters: ["Notes/Private/", "People/"] }));
  await tab.setControlValue("autoClassify", true); // any save re-reads app.json
  api = plugin.api;
  const noPeople = await api.index();
  check("excluded: a changed app.json is honoured at the next settings save (People/ gone)", !api.client.paths.some((p) => p.startsWith("People/")) && noPeople.entities.every((e) => !e.path.startsWith("People/")) && api.client.paths.includes("Ontology/Animal.md"), api.client.paths.filter((p) => !p.startsWith("Chain/")));
  fs.writeFileSync(appJsonPath, "{ not json");
  await tab.setControlValue("autoClassify", true);
  api = plugin.api;
  check("excluded: unreadable app.json fails open (People/ back, Notes/Private/ now indexed)", api.client.paths.includes("People/Alice.md") && api.client.paths.includes("Notes/Private/Secret.md"), api.client.paths.filter((p) => !p.startsWith("Chain/")));
  fs.writeFileSync(appJsonPath, appJsonBefore);
  await tab.setControlValue("autoClassify", true);
  api = plugin.api;
  check("excluded: restoring app.json restores the filters", api.client.paths.includes("People/Alice.md") && !api.client.paths.includes("Notes/Private/Secret.md"));
  const genIn = api.status().generation;
  const chien = app.vault.getAbstractFileByPath("Ontology/Chien.md");
  await app.vault.rename(chien, "templates/Chien.md");
  await waitFor(() => api.status().generation > genIn);
  const movedIn = await api.index();
  check("excluded: moving a page into templates/ removes it from the engine", !movedIn.entities.some((e) => e.path.endsWith("Chien.md")) && api.client.textOf("templates/Chien.md") === undefined && api.client.textOf("Ontology/Chien.md") === undefined, movedIn.entities.map((e) => e.path).filter((p) => p.includes("Chien")));
  const genOut = api.status().generation;
  await app.vault.rename(chien, "Ontology/Chien.md");
  await waitFor(() => api.status().generation > genOut);
  const movedOut = await api.index();
  check("excluded: moving it back out indexes it again", movedOut.entities.some((e) => e.path === "Ontology/Chien.md") && api.client.textOf("Ontology/Chien.md") !== undefined);
  const excludedDef = tab.getSettingDefinitions().find((d) => d.control?.key === "excludedFolders");
  const excludedVerdicts = { path: await excludedDef.control.validate("Ontology/sub"), backslash: await excludedDef.control.validate("a\\b"), parent: await excludedDef.control.validate(".."), ok: await excludedDef.control.validate(" templates, My Assets "), empty: await excludedDef.control.validate("") };
  check("settings: excluded folders is a text control whose validate rejects paths and `..`", excludedDef.control.type === "text" && typeof excludedVerdicts.path === "string" && typeof excludedVerdicts.backslash === "string" && typeof excludedVerdicts.parent === "string" && excludedVerdicts.ok === undefined && excludedVerdicts.empty === undefined, excludedVerdicts);
  await tab.setControlValue("excludedFolders", " templates, Ontology ,templates ");
  api = plugin.api; // the setting change reindexed: a new engine
  const withoutOntology = await api.index();
  const persistedFolders = JSON.parse(fs.readFileSync(path.join(pluginDir, "data.json"), "utf8")).excludedFolders;
  check("settings: excluding Ontology reindexes; its pages are gone, others remain", withoutOntology.entities.every((e) => !e.path.startsWith("Ontology/")) && withoutOntology.entities.some((e) => e.path === "People/Alice.md") && !api.client.paths.some((p) => p.startsWith("Ontology/")) && JSON.stringify(persistedFolders) === JSON.stringify(["templates", "Ontology"]) && tab.getControlValue("excludedFolders") === "templates, Ontology", { entities: withoutOntology.entities.map((e) => e.path).filter((p) => !p.startsWith("Chain/")), persistedFolders });
  await tab.setControlValue("excludedFolders", "templates");
  api = plugin.api;
  const restored = await api.index();
  check("settings: restoring the default brings the Ontology pages back", restored.entities.some((e) => e.path === "Ontology/Animal.md") && restored.entities.length === withoutOntology.entities.length + 7 /* Animal, Cat, Catdog, Chien, Dog, Mammal, has owner */ && plugin.settings.excludedFolders.join() === "templates", { before: withoutOntology.entities.length, after: restored.entities.length });

  // ---- estate profile is opt-in (EXP-05) ----
  tab.display();
  const profileSelect = tab.containerEl.find((el) => el.tagName === "SELECT" && el.children.some((o) => o.value === "estate"));
  check("settings: profile selector offers generic (default) and estate", !!profileSelect && profileSelect.value === "generic", profileSelect?.children.map((o) => o.value));
  profileSelect.value = "estate";
  await profileSelect.dispatch("change");
  await waitFor(async () => (await api.index().catch(() => null))?.profile === "estate");
  const estate = await api.index();
  check("estate profile: pages without `resource` refused", estate.profile === "estate" && estate.entities.length === 0 && estate.diagnostics.some((d) => d.code === "iri_missing"), { entities: estate.entities.length });

  // ---- assisted ingest is off until an endpoint is set (ADR-OBS-003) ----
  check("ingest: command is registered", app.commands.has("ontomark:extract-facts"));
  app.workspace.activeFile = app.vault.getAbstractFileByPath("Welcome.md");
  const noticesBefore = obsidian.Notice.log.length;
  app.executeCommand("ontomark:extract-facts");
  await tick(50);
  const ingestNotices = obsidian.Notice.log.slice(noticesBefore);
  check("ingest: no endpoint -> refusing Notice naming the setting, nothing sent", ingestNotices.some((n) => n.includes("set an ingest endpoint in settings")) && runtime.attempts.length === 0, { ingestNotices, attempts: runtime.attempts });
  check("ingest: endpoint default is empty and the key is not persisted", plugin.settings.ingestEndpoint === "" && plugin.ingestKey === "" && !fs.readFileSync(path.join(pluginDir, "data.json"), "utf8").includes("ingestKey"));

  // ---- declarative settings (Obsidian 1.13+ API): one definition list behind both renderers ----
  const defs = tab.getSettingDefinitions();
  const flatDefs = defs.flatMap((d) => (d.type === "group" ? d.items : [d]));
  const controlKeys = flatDefs.filter((d) => d.control).map((d) => d.control.key).sort();
  check("settings: declarative definitions cover every persisted setting and nothing else", JSON.stringify(controlKeys) === JSON.stringify(Object.keys(plugin.settings).sort()), { controlKeys, settings: Object.keys(plugin.settings) });
  check("settings: the session API key is a render item, not a persisted control", !controlKeys.includes("ingestKey") && flatDefs.some((d) => typeof d.render === "function" && /API key/.test(d.name)));
  const endpointDef = flatDefs.find((d) => d.control?.key === "ingestEndpoint");
  const endpointVerdicts = { credentials: await endpointDef.control.validate("https://user:pw@host/v1"), fragment: await endpointDef.control.validate("https://host/v1#x"), ok: await endpointDef.control.validate(" https://host/v1/chat/completions "), empty: await endpointDef.control.validate("") };
  check("settings: endpoint validate rejects credentials and fragments, accepts a clean URL and empty", typeof endpointVerdicts.credentials === "string" && typeof endpointVerdicts.fragment === "string" && endpointVerdicts.ok === undefined && endpointVerdicts.empty === undefined, endpointVerdicts);
  const limitDef = flatDefs.find((d) => d.control?.key === "queryLimit");
  const limitBefore = plugin.settings.queryLimit;
  await tab.setControlValue("queryLimit", "100");
  check("settings: row limit is a bounded dropdown and is stored as a number", limitDef.control.type === "dropdown" && Object.keys(limitDef.control.options).join() === "100,1000,10000" && plugin.settings.queryLimit === 100 && tab.getControlValue("queryLimit") === "100", { stored: plugin.settings.queryLimit });
  await tab.setControlValue("queryLimit", String(limitBefore));
  await tab.setControlValue("autoClassify", false);
  const persistedOff = JSON.parse(fs.readFileSync(path.join(pluginDir, "data.json"), "utf8")).autoClassify;
  await tab.setControlValue("autoClassify", true);
  check("settings: setControlValue persists through the plugin's own store", persistedOff === false && plugin.settings.autoClassify === true, { persistedOff });
  await tab.setControlValue("ingestModel", "  gpt-x  ");
  check("settings: setControlValue trims text and ignores unknown keys", plugin.settings.ingestModel === "gpt-x" && (await tab.setControlValue("ingestKey", "leak"), plugin.settings.ingestKey === undefined && plugin.ingestKey === ""));
  await tab.setControlValue("ingestModel", "");

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
