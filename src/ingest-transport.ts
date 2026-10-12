// The ONLY module that touches the network (ADR-OBS-003 §3). Everything else
// in the plugin stays offline; scripts/check-bundle.mjs proves the network
// primitive below is named exactly once in the bundle, inside this module.
//
// OpenAI-compatible chat completions, one request per chunk: the engine's
// response schema describes a single `{chunk, assertions}` object, so a chunk
// that comes back malformed can be dropped without losing the others. No
// retries. The model never sees identifiers: only note text, key names and
// the instructions the engine carried in the request.

import { requestUrl } from "obsidian";
import { OntomarkError } from "./client";
import type { Chunk, KeySpec, ModelRequest, ModelResponse, ProposedAssertion } from "./protocol";

/** Most chunks one note may send (a runaway note must not become a runaway bill). */
export const MAX_CHUNKS = 64;
/** Wall-clock bound for one model call. */
export const TIMEOUT_MS = 60_000;

/** Reports a chunk that was dropped (malformed model output). */
export type DropReporter = (message: string) => void;

function describeKey(k: KeySpec): string {
  const kind = k.value.kind === "literal" ? `literal (${k.value.datatype})` : "name";
  const present = k.present.length > 0 ? `; already present: ${k.present.join(", ")}` : "";
  return `- ${k.key}: ${kind}${present}`;
}

/** The user message for one chunk: the keys, the schema, then the chunk text. */
function userMessage(request: ModelRequest, chunk: Chunk): string {
  const where = chunk.heading_path.length > 0 ? `\nUnder: ${chunk.heading_path.join(" > ")}` : "";
  return [
    `Note: ${request.note.label}`,
    "Keys you may fill:",
    ...request.keys.map(describeKey),
    "",
    `Response schema (answer with one JSON object, chunk = ${chunk.index}):`,
    JSON.stringify(request.response_schema),
    "",
    `Chunk ${chunk.index}:${where}`,
    chunk.text,
  ].join("\n");
}

/** Validate one model answer; null when it is not the contract shape. */
function parseAnswer(content: string, chunk: number): ModelResponse | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as { assertions?: unknown }).assertions;
  if (!Array.isArray(list)) return null;
  const assertions: ProposedAssertion[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { key, value, evidence } = item as Record<string, unknown>;
    if (typeof key !== "string" || typeof value !== "string" || typeof evidence !== "string") return null;
    assertions.push({ key, value, evidence });
  }
  // The index comes from the request, never from the model: an unknown chunk is a hard engine error.
  return { chunk, assertions };
}

function unavailable(detail: string): OntomarkError {
  return new OntomarkError("model_unavailable", `the model endpoint did not answer: ${detail}`);
}

async function complete(endpoint: string, key: string, body: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(unavailable(`no reply within ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([
      requestUrl({
        url: endpoint,
        method: "POST",
        contentType: "application/json",
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        body,
        throw: false,
      }),
      timeout,
    ]);
    if (res.status < 200 || res.status >= 300) throw unavailable(`HTTP ${res.status}`);
    const parsed = res.json as { choices?: { message?: { content?: unknown } }[] } | undefined;
    const content = parsed?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  } catch (err) {
    throw err instanceof OntomarkError ? err : unavailable(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the model about every chunk of `request` and collect one `ModelResponse`
 * per chunk it answered well. A malformed answer drops that chunk (reported
 * through `onDrop`); an unreachable endpoint or non-2xx status throws
 * `model_unavailable`.
 */
export async function callModel(
  endpoint: string,
  key: string,
  model: string,
  request: ModelRequest,
  onDrop?: DropReporter,
): Promise<ModelResponse[]> {
  if (request.chunks.length > MAX_CHUNKS) {
    throw new OntomarkError(
      "too_many_chunks",
      `this note has ${request.chunks.length} chunks; the limit is ${MAX_CHUNKS}. Nothing was sent.`,
    );
  }
  const responses: ModelResponse[] = [];
  for (const chunk of request.chunks) {
    const body = JSON.stringify({
      ...(model ? { model } : {}),
      messages: [
        { role: "system", content: request.instructions },
        { role: "user", content: userMessage(request, chunk) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const answer = parseAnswer(await complete(endpoint, key, body), chunk.index);
    if (answer) responses.push(answer);
    else onDrop?.(`chunk ${chunk.index} dropped: the model did not return valid JSON for the response schema`);
  }
  return responses;
}
