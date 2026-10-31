// Loads the BUILT wasm (both wasm-bindgen targets) and replays the engine
// script over the synthetic fixture vault. Every response must be
// byte-identical to the native golden transcript written by
// `cargo test -p ontomark-wasm --test transcript` (native/wasm parity), and
// the query and classify paths must actually execute in wasm (a clock or
// entropy call that panics on wasm32-unknown-unknown fails here, not natively).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
const generated = join(here, "../src/generated");

function readVault(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p).split(sep).join("/"), readFileSync(p, "utf8"));
    }
  };
  walk(root);
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const digest = (text) => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");

function replay(engine) {
  const files = readVault(join(fixtures, "vault"));
  const script = JSON.parse(readFileSync(join(fixtures, "script.json"), "utf8"));
  const lines = [];
  for (const raw of script) {
    if (raw.$raw !== undefined) {
      lines.push(engine.handle(raw.$raw));
      continue;
    }
    const step = { ...raw };
    if (step.files === "@vault") step.files = [...files].map(([path, text]) => ({ path, text }));
    if (step.base_digest === "@digest") step.base_digest = digest(files.get(step.path));
    // `@plan:N` feeds step N's `ingest_plan` result back as the request.
    if (typeof step.request === "string" && step.request.startsWith("@plan:")) {
      step.request = JSON.parse(lines[Number(step.request.slice(6))]).result.request;
    }
    const line = engine.handle(JSON.stringify(step));
    if (JSON.parse(line).ok) {
      if (step.kind === "upsert") files.set(step.path, step.text);
      if (step.kind === "remove") files.delete(step.path);
      if (step.kind === "rename") {
        files.set(step.to, files.get(step.from));
        files.delete(step.from);
      }
    }
    lines.push(line);
  }
  return lines.join("\n") + "\n";
}

// `ONTOMARK_BLESS=1` rewrites the golden from the nodejs-target replay, as the
// native test's switch does. Bless only an engine whose wasm already matched
// its native golden on Ontomark's own fixtures (the `plugin` job of
// Ontomark's CI, scripts/test-plugin-consumer.sh): this vault is a superset
// of those fixtures, so its golden has no native writer of its own.
const goldenPath = join(fixtures, "transcript.golden.jsonl");
if (process.env.ONTOMARK_BLESS) {
  const { WasmEngine } = createRequire(import.meta.url)(join(generated, "node/ontomark_wasm.js"));
  writeFileSync(goldenPath, replay(new WasmEngine()));
}
const golden = readFileSync(goldenPath, "utf8");

test("nodejs-target wasm replays the script byte-identically to native", () => {
  const require = createRequire(import.meta.url);
  const { WasmEngine } = require(join(generated, "node/ontomark_wasm.js"));
  const got = replay(new WasmEngine());
  assert.equal(got, golden);
});

test("web-target wasm (the bytes embedded in the plugin) via initSync matches native", async () => {
  const glue = await import(join(generated, "web/ontomark_wasm.js"));
  const bytes = readFileSync(join(generated, "ontomark.wasm"));
  glue.initSync({ module: bytes });
  const got = replay(new glue.WasmEngine());
  assert.equal(got, golden);
  const lines = got.trim().split("\n").map((l) => JSON.parse(l));
  // Spot-check that the wasm actually ran the heavy paths.
  assert.equal(lines[5].result.status, "done", "classify executed in wasm");
  assert.equal(lines[6].result.rows.length, 5, "SPARQL over the inferred graph executed in wasm");
  assert.equal(lines[8].error.code, "service_forbidden");
});

test("bundle check is not vacuous: it flags the raw web glue, which loads wasm by fetch", () => {
  const script = join(here, "../scripts/check-bundle.mjs");
  let failed = false;
  try {
    execFileSync(process.execPath, [script, join(generated, "web/ontomark_wasm.js")], { stdio: "pipe" });
  } catch (e) {
    failed = true;
    const report = JSON.parse(e.stdout.toString());
    assert.ok(report.findings.some((f) => f.startsWith("fetch(")), JSON.stringify(report.findings));
    assert.ok(report.findings.some((f) => f.startsWith("import.meta")), JSON.stringify(report.findings));
  }
  assert.ok(failed, "check-bundle must exit non-zero on the raw glue");
});

test("wasm-only runtime paths: entropy (RAND, UUID, STRUUID, BNODE, CONSTRUCT bnodes) and clock (NOW) execute", async () => {
  // These reach getrandom / js-sys Date at run time and would trap on
  // wasm32-unknown-unknown without the wasm_js / js features; the golden
  // transcript does not exercise them, and native tests cannot.
  const glue = await import(join(generated, "web/ontomark_wasm.js"));
  glue.initSync({ module: readFileSync(join(generated, "ontomark.wasm")) });
  const engine = new glue.WasmEngine();
  const call = (req) => JSON.parse(engine.handle(JSON.stringify(req)));
  const files = [
    { path: "A.md", text: "---\ntype: class\n---\n" },
    { path: "B.md", text: '---\ntype: class\nsubclass-of: ["[[A]]"]\n---\n' },
  ];
  assert.equal(call({ kind: "load", generation: 1, files }).ok, true);
  const q = (sparql) => call({ kind: "query", generation: 1, sparql });
  const r = q("SELECT (RAND() AS ?r) (UUID() AS ?u) (STRUUID() AS ?s) (BNODE() AS ?b) (NOW() AS ?n) WHERE {}");
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = r.result.rows[0];
  assert.match(row.u.value, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.match(row.s.value, /^[0-9a-f-]{36}$/);
  assert.equal(row.b.type, "bnode");
  const year = Number(row.n.value.slice(0, 4));
  assert.ok(year >= 2024, `NOW() from the JS clock, got ${row.n.value}`);
  const r2 = q("SELECT (RAND() AS ?r) WHERE {}");
  assert.notEqual(r2.result.rows[0].r.value, row.r.value, "RAND() draws fresh entropy");
  const c = q("CONSTRUCT { ?c <urn:x:note> [ <urn:x:label> ?l ] } WHERE { ?c <http://www.w3.org/2000/01/rdf-schema#label> ?l }");
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.result.triples.length, 4);
  assert.ok(c.result.triples.some((t) => t[0].type === "bnode"));
  const cls = call({ kind: "classify", generation: 1 });
  assert.equal(cls.result.classification.reasoner.id, "ontomark-reason/whelk-el");
});
