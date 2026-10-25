// The Jev option: fallback equivalence, wire shape and the accept path, over a mocked transport.
import { describe, expect, it, vi } from "vitest";

// settings.ts builds a PluginSettingTab; the rest of the Obsidian API is never reached here.
vi.mock("obsidian", () => ({ PluginSettingTab: class {}, Setting: class {}, requestUrl: () => Promise.reject(new Error("no network in tests")) }));

import {
  JEV_TIMEOUT_MS,
  jevAsk,
  pickEdit,
  pickTemplate,
  templateQuestions,
  verifyFacts,
  QUESTION_SETS,
  type JevConfig,
  type JevDeps,
  type JevReply,
} from "../src/jev";
import { judgeIngest } from "../src/jev-ingest";
import { compileTemplate, mentionedEntities, safeIri, templateOffers } from "../src/query-templates";
import { DEFAULT_SETTINGS, normaliseSettings } from "../src/settings";
import type { CandidateAssertion, Entity, IngestAcceptResult, ModelRequest, ModelResponse } from "../src/protocol";

const cfg = (over: Partial<JevConfig> = {}): JevConfig => ({
  enabled: true,
  endpoint: "http://jev.invalid/v1/systemone",
  model: "",
  key: "sekret",
  withholdAtOrBelow: 0.1,
  minConfidence: 0.6,
  ...over,
});

interface Sent {
  url: string;
  key: string;
  body: { model: string; state: unknown; questions: Record<string, { type: string; instructions: string; criteria?: unknown }> };
  timeoutMs: number;
}

/** A transport double: records requests, replies with `reply(body)` or throws. */
function transport(reply: (body: Sent["body"]) => JevReply | Error) {
  const sent: Sent[] = [];
  const logs: string[] = [];
  const deps: JevDeps = {
    post: async (url, key, body, timeoutMs) => {
      const parsed = JSON.parse(body) as Sent["body"];
      sent.push({ url, key, body: parsed, timeoutMs });
      const r = reply(parsed);
      if (r instanceof Error) throw r;
      return r;
    },
    log: (l) => logs.push(l),
  };
  return { deps, sent, logs };
}

const ok = (answers: unknown): JevReply => ({ status: 200, json: { model: "jev-1", answers, usage: {} } });
const noulFor = (ps: number[]) => (b: Sent["body"]): JevReply =>
  ok(Object.fromEntries(Object.keys(b.questions).map((id) => [id, { type: "noul", noul: ps[Number(id.slice(1))] }])));
const choiceFor = (picks: Record<string, [string, number]>) => (b: Sent["body"]): JevReply =>
  ok(
    Object.fromEntries(
      Object.keys(b.questions).map((id) => [id, { type: "choice", choice: picks[id][0], confidence: picks[id][1], probabilities: {} }]),
    ),
  );

/** Every way Jev can be unavailable, as [reason, config, transport reply]. */
const FAILURES: [string, Partial<JevConfig>, (b: Sent["body"]) => JevReply | Error][] = [
  ["flag-off", { enabled: false }, () => new Error("must not be called")],
  ["no-endpoint", { endpoint: "" }, () => new Error("must not be called")],
  ["no-endpoint", { endpoint: "ftp://x" }, () => new Error("must not be called")],
  ["timeout", {}, () => new Error("no reply within 4 s")],
  ["transport", {}, () => new Error("connect refused")],
  ["http-429", {}, () => ({ status: 429, json: {} })],
  ["http-529", {}, () => ({ status: 529, json: {} })],
  ["http-500", {}, () => ({ status: 500, json: undefined })],
  ["malformed", {}, () => ({ status: 200, json: "nope" })],
  ["malformed", {}, () => ({ status: 200, json: { answers: {} } })],
  ["malformed", {}, () => ({ status: 200, json: { answers: { c0: { type: "choice" } } } })],
];

// ------------------------------------------------------------------ OB-01

const request: ModelRequest = {
  contract: "ontomark-ingest/facts/1",
  note: { document: "A.md", digest: "d", iri: "urn:a", kind: "class", label: "Knowledge graph" },
  instructions: "",
  keys: [],
  chunks: [],
  response_schema: {},
};

const fact = (key: string, written: string, quote: string): CandidateAssertion => ({
  key,
  predicate: `urn:p:${key}`,
  written,
  grounded: null,
  tier: null,
  datatype: null,
  evidence: [{ chunk: 0, span: { start: 0, end: 1 }, utf16: { start: 0, end: 1 }, quote }],
  confidence: 0.5,
  method: "inferred",
});

const responses: ModelResponse[] = [
  {
    chunk: 0,
    assertions: [
      { key: "is-a", value: "graph", evidence: "is a directed graph" },
      { key: "part-of", value: "Thing", evidence: "not a Thing" },
    ],
  },
];

/** A stand-in for the engine's ingest_accept: one fact per surviving proposal. */
function engine() {
  const calls: ModelResponse[][] = [];
  const written: Record<string, [string, string]> = {
    graph: ["is-a", "[[Graph]]"],
    Thing: ["part-of", "[[Thing]]"],
  };
  const accept = async (rs: ModelResponse[]): Promise<IngestAcceptResult> => {
    calls.push(rs);
    const accepted = rs.flatMap((r) =>
      r.assertions.map((a) => fact(written[a.value][0], written[a.value][1], a.evidence)),
    );
    return {
      path: "A.md",
      candidates: { document: "A.md", digest: "d", patch: null, accepted, withheld: [], diagnostics: [] },
      preview: null,
    };
  };
  return { accept, calls };
}

describe("OB-01 verifier", () => {
  it("every fallback returns the plain result itself, untouched, with no notes", async () => {
    for (const [reason, over, reply] of FAILURES) {
      const e = engine();
      const plain = await e.accept(responses);
      e.calls.length = 0;
      const t = transport(reply);
      const out = await judgeIngest(e.accept, request, responses, plain, cfg(over), t.deps);
      expect(out.result, reason).toBe(plain);
      expect(out.notes, reason).toEqual([]);
      expect(out.outcome, reason).toBe(reason);
      expect(e.calls, `${reason}: the engine is not asked again`).toHaveLength(0);
      if (reason === "flag-off" || reason === "no-endpoint") expect(t.sent).toHaveLength(0);
      // One line, reason + question-set version, never note content.
      if (reason !== "flag-off") {
        expect(t.logs).toEqual([`ontomark-jev: fallback reason=${reason} question-set=${QUESTION_SETS.facts}`]);
      }
    }
  });

  it("a probability outside 0..1 is malformed", async () => {
    const e = engine();
    const plain = await e.accept(responses);
    const out = await judgeIngest(e.accept, request, responses, plain, cfg(), transport(noulFor([7, 7])).deps);
    expect(out.result).toBe(plain);
    expect(out.outcome).toBe("malformed");
  });

  it("builds the contract's wire shape: one Noul per fact, criteria {true,false}, bearer, 4 s, no retry", async () => {
    const e = engine();
    const plain = await e.accept(responses);
    const t = transport(noulFor([0.9, 0.9]));
    await judgeIngest(e.accept, request, responses, plain, cfg(), t.deps);
    expect(t.sent).toHaveLength(1);
    const s = t.sent[0];
    expect(s.url).toBe("http://jev.invalid/v1/systemone");
    expect(s.key).toBe("sekret");
    expect(s.timeoutMs).toBe(JEV_TIMEOUT_MS);
    expect(s.body.model).toBe("jev-latest");
    expect(Object.keys(s.body).sort()).toEqual(["model", "questions", "state"]);
    expect(s.body.state).toMatchObject({
      subject: "Knowledge graph",
      claims: [{ index: 0, relation_key: "is-a", value: "[[Graph]]", quote: "is a directed graph" }, { index: 1 }],
    });
    expect(Object.keys(s.body.questions)).toEqual(["c0", "c1"]);
    for (const q of Object.values(s.body.questions)) {
      expect(q.type).toBe("noul");
      expect(q.instructions).toContain("`claims`");
      expect(q.criteria).toEqual({ true: expect.any(String), false: expect.any(String) });
      expect(Object.keys(q).sort()).toEqual(["criteria", "instructions", "type"]);
    }
  });

  it("annotates a doubted fact but, at the default threshold, changes nothing", async () => {
    const e = engine();
    const plain = await e.accept(responses);
    // p = 0.02 for the second fact; threshold 0 means never withhold.
    const out = await judgeIngest(e.accept, request, responses, plain, cfg({ withholdAtOrBelow: 0 }), transport(noulFor([0.9, 0.02])).deps);
    expect(out.result).toBe(plain);
    expect(out.notes).toEqual([{ key: "part-of", written: "[[Thing]]", p: 0.02 }]);
  });

  it("a confident 'no' above the threshold withholds the fact and re-runs the engine on the survivors", async () => {
    const e = engine();
    const plain = await e.accept(responses);
    e.calls.length = 0;
    const out = await judgeIngest(e.accept, request, responses, plain, cfg(), transport(noulFor([0.9, 0.02])).deps);
    expect(out.outcome).toBe("applied");
    expect(out.result.candidates.accepted.map((a) => a.written)).toEqual(["[[Graph]]"]);
    expect(out.result.candidates.withheld).toEqual([
      expect.objectContaining({ key: "part-of", reason: { reason: "judged_unsupported" } }),
    ]);
    // Downstream validation still ran: the last engine call is on the surviving proposal only.
    expect(e.calls.at(-1)).toEqual([{ chunk: 0, assertions: [responses[0].assertions[0]] }]);
    expect(out.notes).toEqual([]);
  });

  it("returns the plain result if the re-run would write something the plain run did not", async () => {
    const e = engine();
    const plain = await e.accept(responses);
    let n = 0;
    const odd = async (rs: ModelResponse[]): Promise<IngestAcceptResult> => {
      const r = await e.accept(rs);
      // Probe calls behave; the final re-run invents a new fact.
      return ++n > 2 ? { ...r, candidates: { ...r.candidates, accepted: [fact("is-a", "[[Other]]", "q")] } } : r;
    };
    const out = await judgeIngest(odd, request, responses, plain, cfg(), transport(noulFor([0.9, 0.02])).deps);
    expect(out.result).toBe(plain);
    expect(out.outcome).toBe("not-monotone");
  });

  it("fails open if the engine throws during the re-run", async () => {
    const e = engine();
    const plain = await e.accept(responses);
    const out = await judgeIngest(async () => Promise.reject(new Error("worker gone")), request, responses, plain, cfg(), transport(noulFor([0.9, 0.02])).deps);
    expect(out.result).toBe(plain);
    expect(out.outcome).toBe("error");
  });

  it("verifyFacts sends nothing for no facts", async () => {
    const t = transport(() => new Error("no"));
    expect(await verifyFacts(cfg(), t.deps, "S", [])).toEqual({ ok: true, value: [] });
    expect(t.sent).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ OB-02

const entity = (label: string, kind: Entity["kind"], aliases: string[] = []): Entity => ({
  iri: `urn:x:${label.replace(/\s/g, "")}`,
  iri_authored: true,
  kind,
  path: `${label}.md`,
  label,
  aliases,
  parents: [],
});
const entities = [entity("Animal", "class"), entity("Dog", "class", ["hound"]), entity("Rex", "individual")];

describe("OB-02 query template picker", () => {
  const mentioned = mentionedEntities("what are the subclasses of Animal?", entities).map((e) => ({ iri: e.iri, label: e.label, kind: e.kind }));

  it("finds mentioned entities by label or alias, on word boundaries", () => {
    expect(mentionedEntities("what are the subclasses of Animal?", entities).map((e) => e.label)).toEqual(["Animal"]);
    expect(mentionedEntities("any hounds? a hound", entities).map((e) => e.label)).toEqual(["Dog"]);
    expect(mentionedEntities("Doggerel", entities)).toEqual([]);
  });

  it("every fallback leaves the caller with nothing to fill in", async () => {
    const failures = [...FAILURES.filter(([r]) => r !== "malformed"), ...FAILURES.filter(([r]) => r === "malformed")];
    for (const [reason, over, reply] of failures) {
      const t = transport(reply);
      const r = await pickTemplate(cfg(over), t.deps, "subclasses of Animal", templateOffers(), mentioned);
      expect(r, reason).toEqual({ ok: false, reason });
    }
  });

  it("low confidence, a key outside the offered set, none, and a missing entity all fall back", async () => {
    const ask = (picks: Record<string, [string, number]>) =>
      pickTemplate(cfg(), transport(choiceFor(picks)).deps, "q", templateOffers(), mentioned);
    const good = { template: ["subclasses-of", 0.95], entity: ["e0", 0.95], dataset: ["asserted", 0.9] } as Record<string, [string, number]>;
    expect(await ask({ ...good, template: ["subclasses-of", 0.3] })).toEqual({ ok: false, reason: "low-confidence" });
    expect(await ask({ ...good, entity: ["e0", 0.3] })).toEqual({ ok: false, reason: "low-confidence" });
    expect(await ask({ ...good, template: ["drop-everything", 1] })).toEqual({ ok: false, reason: "malformed" });
    expect(await ask({ ...good, entity: ["e9", 1] })).toEqual({ ok: false, reason: "malformed" });
    expect(await ask({ ...good, template: ["none", 0.99] })).toEqual({ ok: false, reason: "not-stated" });
    expect(await ask({ ...good, entity: ["none", 0.99] })).toEqual({ ok: false, reason: "unresolved-target" });
  });

  it("wire shape: Choice criteria are maps with a none option; ids are template/entity/dataset", async () => {
    const t = transport(choiceFor({ template: ["subclasses-of", 0.95], entity: ["e0", 0.95], dataset: ["inferred", 0.9] }));
    const r = await pickTemplate(cfg(), t.deps, "subclasses of Animal", templateOffers(), mentioned);
    expect(r).toEqual({ ok: true, value: { templateId: "subclasses-of", entityIri: "urn:x:Animal", dataset: "inferred" } });
    const q = t.sent[0].body.questions;
    expect(Object.keys(q)).toEqual(["template", "entity", "dataset"]);
    for (const id of Object.keys(q)) {
      expect(q[id].type).toBe("choice");
      expect(Array.isArray(q[id].criteria)).toBe(false);
    }
    expect(Object.keys(q.template.criteria as object)).toEqual([...templateOffers().map((x) => x.id), "none"]);
    expect(Object.keys(q.entity.criteria as object)).toEqual(["e0", "none"]);
    expect(Object.keys(q.dataset.criteria as object)).toEqual(["asserted", "inferred", "combined"]);
    expect(t.sent[0].body.state).toMatchObject({ question: "subclasses of Animal", entities: [{ id: "e0", label: "Animal" }] });
    expect(Object.keys(templateQuestions(templateOffers(), []))).toHaveLength(3);
  });

  it("a low-confidence dataset choice degrades to the default asserted scope", async () => {
    const t = transport(choiceFor({ template: ["subclasses-of", 0.95], entity: ["e0", 0.95], dataset: ["combined", 0.4] }));
    const r = await pickTemplate(cfg(), t.deps, "q", templateOffers(), mentioned);
    expect(r).toMatchObject({ ok: true, value: { dataset: "asserted" } });
  });

  it("queries are compiled in code from a closed set; nothing the model says reaches the text", () => {
    for (const o of templateOffers()) {
      const q = compileTemplate(o.id, o.needsEntity ? "urn:x:Animal" : null, entities);
      expect(q, o.id).not.toBeNull();
      expect(q).not.toMatch(/\b(UPDATE|INSERT|DELETE|SERVICE|FROM|LOAD|CLEAR|DROP)\b/);
      expect(q).toMatch(/^(PREFIX|SELECT)/);
    }
    expect(compileTemplate("subclasses-of", "urn:x:Animal", entities)).toContain("<urn:x:Animal>");
    expect(compileTemplate("subclasses-of", "urn:x:Nope", entities)).toBeNull();
    expect(compileTemplate("subclasses-of", null, entities)).toBeNull();
    expect(compileTemplate("drop-all", null, entities)).toBeNull();
    expect(safeIri("urn:x:a> } DROP ALL {<")).toBe(false);
    const evil = [{ ...entity("Evil", "class"), iri: "urn:x:a> . } DROP ALL {<b" }];
    expect(compileTemplate("subclasses-of", evil[0].iri, evil)).toBeNull();
  });
});

// ------------------------------------------------------------------ OB-03

describe("OB-03 frontmatter edit proposal", () => {
  const parents = [{ target: "Animal", label: "Animal", kind: "class" }];
  const note = { label: "Dog", kind: null };

  it("every fallback proposes nothing", async () => {
    for (const [reason, over, reply] of FAILURES) {
      const r = await pickEdit(cfg(over), transport(reply).deps, "Dog is an animal", note, parents);
      expect(r, reason).toEqual({ ok: false, reason });
    }
  });

  it("low confidence, an unresolved parent and none all fall back; a confident choice proposes", async () => {
    const ask = (picks: Record<string, [string, number]>) =>
      pickEdit(cfg(), transport(choiceFor(picks)).deps, "Dog is a kind of animal", note, parents);
    expect(await ask({ action: ["add_parent", 0.3], parent: ["p0", 0.9] })).toEqual({ ok: false, reason: "low-confidence" });
    expect(await ask({ action: ["add_parent", 0.9], parent: ["none", 0.9] })).toEqual({ ok: false, reason: "unresolved-target" });
    expect(await ask({ action: ["none", 0.99], parent: ["p0", 0.9] })).toEqual({ ok: false, reason: "not-stated" });
    expect(await ask({ action: ["publish", 1], parent: ["p0", 1] })).toEqual({ ok: false, reason: "malformed" });
    expect(await ask({ action: ["make_class", 0.9], parent: ["none", 0.1] })).toEqual({ ok: true, value: { action: "make_class", parent: null } });
    expect(await ask({ action: ["add_parent", 0.9], parent: ["p0", 0.8] })).toEqual({ ok: true, value: { action: "add_parent", parent: "Animal" } });
  });

  it("wire shape: action and parent are Choice maps with none; no public/publish action exists", async () => {
    const t = transport(choiceFor({ action: ["make_class", 0.9], parent: ["none", 0.9] }));
    await pickEdit(cfg(), t.deps, "this is a class", note, parents);
    const q = t.sent[0].body.questions;
    expect(Object.keys(q.action.criteria as object)).toEqual(["make_class", "make_individual", "make_property", "add_parent", "none"]);
    expect(Object.keys(q.parent.criteria as object)).toEqual(["p0", "none"]);
    expect(t.sent[0].body.state).toEqual({
      intent: "this is a class",
      note: { label: "Dog", current_kind: "untyped" },
      parents: [{ id: "p0", label: "Animal", kind: "class" }],
    });
  });
});

// ------------------------------------------------------------------ settings & core

describe("flag and settings", () => {
  it("is off by default and fails closed on a tampered data.json", () => {
    expect(DEFAULT_SETTINGS.jevEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.jevEndpoint).toBe("");
    expect(DEFAULT_SETTINGS.jevWithholdAtOrBelow).toBe(0);
    expect(normaliseSettings(null).jevEnabled).toBe(false);
    const bad = normaliseSettings({ jevEnabled: "yes", jevWithholdAtOrBelow: 9, jevMinConfidence: "x", jevEndpoint: 5 } as never);
    expect(bad.jevEnabled).toBe(false);
    expect(bad.jevWithholdAtOrBelow).toBe(0);
    expect(bad.jevMinConfidence).toBe(DEFAULT_SETTINGS.jevMinConfidence);
    expect(bad.jevEndpoint).toBe("");
  });

  it("jevAsk with the flag off builds no request at all", async () => {
    const t = transport(() => new Error("no"));
    const r = await jevAsk(cfg({ enabled: false }), t.deps, QUESTION_SETS.facts, {}, { c0: { type: "noul" } });
    expect(r).toEqual({ ok: false, reason: "flag-off" });
    expect(t.sent).toHaveLength(0);
    expect(t.logs).toEqual([]);
  });

  it("omits Authorization via an empty key (keyless local endpoint)", async () => {
    const t = transport(noulFor([0.9]));
    await verifyFacts(cfg({ key: "" }), t.deps, "S", [{ key: "k", predicate: "p", written: "w", quote: "q" }]);
    expect(t.sent[0].key).toBe("");
  });
});
