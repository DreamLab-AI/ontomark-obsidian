// End-to-end test of "Extract facts from this note" on the BUILT plugin
// (dist/main.js), over the real engine and worker. The model is a stub
// installed on the obsidian mock's network primitive, so nothing leaves the
// process; the network tripwire stays armed to prove that.
//
// Usage: node test/e2e/ingest.e2e.cjs      (after `npm run build`; builds its own scratch vault)
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const plugin = path.resolve(__dirname, "../..");
const stage = path.join(plugin, ".offline/ingest-vault");
const pluginDir = path.join(stage, ".obsidian/plugins/ontomark");
const report = { started: new Date().toISOString(), node: process.version, checks: [] };
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
const read = (rel) => fs.readFileSync(path.join(stage, rel), "utf8");

const ENDPOINT = "http://127.0.0.1:1/v1"; // nothing listens here
const KEY = "sk-test-session-key-0001";
const BOB = "---\ntype: individual\n---\nBob is a person. Bob owns Rex, and the dog Rex is his companion.\n";
const CAROL = "---\ntype: individual\n---\nCarol is a person.\n";

async function main() {
  // ---- scratch vault: the fixture plus two notes, and the built plugin ----
  fs.rmSync(stage, { recursive: true, force: true });
  fs.cpSync(path.join(plugin, "test/fixtures/vault"), stage, { recursive: true });
  fs.writeFileSync(path.join(stage, "People/Bob.md"), BOB);
  fs.writeFileSync(path.join(stage, "People/Carol.md"), CAROL);
  fs.mkdirSync(pluginDir, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(plugin, "dist", f), path.join(pluginDir, f));

  const runtime = require("./runtime-shim.cjs");
  runtime.installTripwire();
  globalThis.Worker = runtime.BlobWorker;
  globalThis.activeWindow = globalThis;
  if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
  const obsidian = require("./obsidian-shim.cjs");
  const manifest = JSON.parse(read(".obsidian/plugins/ontomark/manifest.json"));

  const calls = [];
  let model = async () => ({ status: 200, json: {} });
  obsidian.requestUrlHost.impl = async (req) => {
    calls.push({ url: req.url, headers: req.headers, body: JSON.parse(req.body) });
    return model(req);
  };

  const app = new obsidian.App(stage);
  const source = fs.readFileSync(path.join(pluginDir, "main.js"), "utf8");
  const mod = { exports: {} };
  new Function("require", "module", "exports", source)((n) => {
    if (n === "obsidian") return obsidian;
    throw new Error(`plugin required unexpected module "${n}"`);
  }, mod, mod.exports);
  const Plugin = mod.exports.default ?? mod.exports;
  const p = new Plugin(app, manifest);
  await p.load();
  app.workspace._setLayoutReady();
  await p.ready;

  const noticesSince = (n) => obsidian.Notice.log.slice(n);
  const run = async (file) => {
    app.workspace.activeFile = app.vault.getAbstractFileByPath(file);
    const n = obsidian.Notice.log.length;
    app.executeCommand("ontomark:extract-facts");
    return n;
  };

  // ---- refusals before anything is configured ----
  let n = await run("People/Bob.md");
  await tick(30);
  check("no endpoint: refusing Notice, no call", noticesSince(n).some((m) => m.includes("set an ingest endpoint")) && calls.length === 0, noticesSince(n));

  // ---- configure through the settings tab, as a user would ----
  const tab = app.settingTabs[0];
  tab.display();
  const inputs = tab.containerEl.findAll((el) => el.tagName === "INPUT");
  const keyInput = inputs.find((el) => el.type === "password");
  const textInputs = inputs.filter((el) => el.type !== "password");
  check("settings: endpoint, model and a password-type key field", textInputs.length === 2 && !!keyInput, inputs.map((i) => i.type));
  check("settings: assisted-ingest group is labelled as using the network", tab.containerEl.textContent.includes("Assisted ingest (optional, uses the network)"));
  textInputs[0].value = ENDPOINT;
  await textInputs[0].dispatch("change");
  textInputs[1].value = "stub-model";
  await textInputs[1].dispatch("change");

  n = await run("People/Bob.md");
  await tick(30);
  check("endpoint but no key: refusing Notice, no call", noticesSince(n).some((m) => m.includes("enter the API key for this session")) && calls.length === 0, noticesSince(n));

  keyInput.value = KEY;
  await keyInput.dispatch("change");
  check("settings: key held on the plugin instance", p.ingestKey === KEY);
  const saved = read(".obsidian/plugins/ontomark/data.json");
  check("settings: endpoint persisted, key never written to data.json", saved.includes(ENDPOINT) && !saved.includes(KEY) && !saved.includes("ingestKey"), saved);

  // ---- run 1: model answers, user reviews, patch applies ----
  model = async (req) => {
    const user = JSON.parse(req.body).messages[1].content;
    const chunk = Number(/Chunk (\d+):/.exec(user)[1]);
    return {
      status: 200,
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                chunk,
                assertions: [
                  { key: "instance-of", value: "Person", evidence: "Bob is a person" },
                  { key: "instance-of", value: "Nobody", evidence: "Bob owns Rex" },
                  { key: "not-a-key", value: "x", evidence: "Bob" },
                ],
              }),
            },
          },
        ],
      },
    };
  };
  const selections = [];
  app.workspace.activeEditor = {
    file: app.vault.getAbstractFileByPath("People/Bob.md"),
    editor: {
      offsetToPos: (o) => ({ line: 0, ch: o }),
      setSelection: (a, h) => selections.push([a.ch, h.ch]),
    },
  };
  let shown = null;
  app.onModalOpen = (modal) => {
    shown = {
      text: modal.contentEl.textContent,
      diff: modal.contentEl.find((el) => el.tagName === "PRE")?.textContent ?? null,
      accepted: modal.contentEl.find((el) => el.attrs["data-ontomark"] === "accepted")?.textContent ?? "",
      withheld: modal.contentEl.find((el) => el.attrs["data-ontomark"] === "withheld")?.textContent ?? "",
      applyDisabled: modal.contentEl.find((el) => el.attrs["data-ontomark-action"] === "apply")?.disabled === true,
    };
    modal.contentEl.find((el) => el.attrs["data-ontomark"] === "quote")?.click();
    modal.contentEl.find((el) => el.attrs["data-ontomark-action"] === "apply")?.click();
  };
  n = await run("People/Bob.md");
  const wrote = await waitFor(() => read("People/Bob.md").includes("instance-of"));
  check("run 1: the file was written after approval", wrote, read("People/Bob.md"));
  check("run 1: exactly one model call, to the configured URL, with the session key", calls.length === 1 && calls[0].url === ENDPOINT && calls[0].headers.Authorization === `Bearer ${KEY}`, calls.map((c) => c.url));
  check("run 1: request carries the engine's instructions, the model name and the keys", calls[0].body.model === "stub-model" && calls[0].body.messages[0].content.includes("frontmatter keys") && calls[0].body.messages[1].content.includes("instance-of"), calls[0].body.messages[0].content.slice(0, 80));
  check("run 1: the diff and accepted value were shown first", shown && shown.diff.includes("+instance-of:") && shown.accepted.includes("instance-of ← [[Person]]") && !shown.applyDisabled, shown);
  check("run 1: the quote is shown and clicking it selects its range in the editor", shown.accepted.includes("Bob is a person") && JSON.stringify(selections) === JSON.stringify([[25, 40]]), selections);
  check("run 1: withheld values carry the engine's reason tag verbatim", shown.withheld.includes("unknown_key") && shown.withheld.includes("ungrounded"), shown.withheld);
  check("run 1: prose preserved byte for byte", read("People/Bob.md").endsWith("Bob is a person. Bob owns Rex, and the dog Rex is his companion.\n"));
  await waitFor(() => noticesSince(n).some((m) => m.includes("updated People/Bob.md")));
  check("run 1: applied notice", noticesSince(n).some((m) => m.includes("updated People/Bob.md")), noticesSince(n));

  // ---- run 2: the same ask again finds nothing new and writes nothing ----
  const afterRun1 = read("People/Bob.md");
  let second = null;
  app.onModalOpen = (modal) => {
    second = {
      text: modal.contentEl.textContent,
      applyDisabled: modal.contentEl.find((el) => el.attrs["data-ontomark-action"] === "apply")?.disabled === true,
    };
    modal.contentEl.find((el) => el.attrs["data-ontomark-action"] === "cancel")?.click();
  };
  await run("People/Bob.md");
  await waitFor(() => second !== null);
  check("run 2: a second model call, answered with already_present and no patch", calls.length === 2 && second.text.includes("already_present") && second.text.includes("No change to write."), second);
  check("run 2: Apply is disabled and nothing was written", second.applyDisabled && read("People/Bob.md") === afterRun1);

  // ---- run 3: the model is unavailable ----
  model = async () => {
    const err = new Error("Request failed, status 503");
    err.status = 503;
    throw err;
  };
  app.onModalOpen = () => {
    throw new Error("no modal expected when the model is unavailable");
  };
  n = await run("People/Carol.md");
  await waitFor(() => noticesSince(n).some((m) => m.includes("model_unavailable")));
  check("503: model_unavailable surfaced in a Notice", noticesSince(n).some((m) => m.includes("model_unavailable")), noticesSince(n));
  check("503: nothing was written", read("People/Carol.md") === CAROL);

  model = async () => ({ status: 503 });
  n = await run("People/Carol.md");
  await waitFor(() => noticesSince(n).some((m) => m.includes("model_unavailable")));
  check("non-2xx status: model_unavailable too, nothing written", noticesSince(n).some((m) => m.includes("model_unavailable")) && read("People/Carol.md") === CAROL);

  // ---- unload forgets the key; the tripwire saw nothing ----
  p.unload();
  await tick(20);
  check("unload: the session key is forgotten", p.ingestKey === "");
  check("no network attempt from any thread", runtime.attempts.length === 0, runtime.attempts);
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
