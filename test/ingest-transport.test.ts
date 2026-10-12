// The transport in isolation: obsidian's network primitive is replaced by a stub.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "../src/protocol";

const calls: { url: string; body: string; headers?: Record<string, string> }[] = [];
let handler: (n: number) => Promise<{ status: number; json?: unknown }> = async () => ({ status: 200, json: {} });

vi.mock("obsidian", () => ({
  requestUrl: (req: { url: string; body: string; headers?: Record<string, string> }) => {
    calls.push({ url: req.url, body: req.body, headers: req.headers });
    return handler(calls.length);
  },
}));

const { callModel, MAX_CHUNKS } = await import("../src/ingest-transport");

const request = (n: number): ModelRequest => ({
  contract: "ontomark-ingest/facts/1",
  note: { document: "A", digest: "d", iri: "i", kind: "individual", label: "A" },
  instructions: "SYSTEM INSTRUCTIONS",
  keys: [{ key: "instance-of", predicate: "p", form: "class_assertion", value: { kind: "name" }, range: null, present: ["[[X]]"] }],
  chunks: Array.from({ length: n }, (_, i) => ({ index: i, span: { start: 0, end: 1 }, heading_path: [], text: `chunk text ${i}` })),
  response_schema: { type: "object" },
});

const reply = (content: string) => ({ status: 200, json: { choices: [{ message: { content } }] } });

beforeEach(() => {
  calls.length = 0;
});

describe("callModel", () => {
  it("posts one request per chunk to the endpoint verbatim, with the bearer key and the engine's instructions", async () => {
    handler = async () => reply(JSON.stringify({ chunk: 99, assertions: [{ key: "instance-of", value: "P", evidence: "q" }] }));
    const out = await callModel("http://endpoint.invalid/v1/chat/completions", "k3y", "m", request(2));
    expect(calls.map((c) => c.url)).toEqual(Array(2).fill("http://endpoint.invalid/v1/chat/completions"));
    expect(calls[0].headers).toEqual({ Authorization: "Bearer k3y" });
    const body = JSON.parse(calls[1].body) as { model: string; response_format: unknown; messages: { role: string; content: string }[] };
    expect(body.model).toBe("m");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({ role: "system", content: "SYSTEM INSTRUCTIONS" });
    expect(body.messages[1].content).toContain("chunk text 1");
    expect(body.messages[1].content).toContain("instance-of");
    // The chunk index comes from the request, not from the model's own claim (99).
    expect(out.map((r) => r.chunk)).toEqual([0, 1]);
  });

  it("drops a malformed chunk with a report instead of throwing", async () => {
    handler = async (n) => (n === 1 ? reply("not json") : reply(JSON.stringify({ assertions: [] })));
    const dropped: string[] = [];
    const out = await callModel("http://e.invalid/", "k", "", request(2), (m) => dropped.push(m));
    expect(out.map((r) => r.chunk)).toEqual([1]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain("chunk 0");
  });

  it("a non-2xx status and a thrown error both surface as model_unavailable", async () => {
    handler = async () => ({ status: 503 });
    await expect(callModel("http://e.invalid/", "k", "", request(1))).rejects.toMatchObject({ code: "model_unavailable" });
    handler = async () => {
      throw new Error("connect refused");
    };
    await expect(callModel("http://e.invalid/", "k", "", request(1))).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("refuses a note with too many chunks before sending anything", async () => {
    await expect(callModel("http://e.invalid/", "k", "", request(MAX_CHUNKS + 1))).rejects.toMatchObject({ code: "too_many_chunks" });
    expect(calls).toHaveLength(0);
  });
});
