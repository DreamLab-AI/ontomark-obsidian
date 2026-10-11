// Wire protocol between the plugin (host) and its engine worker.
//
// Two layers:
//  1. Engine requests/responses: the JSON schema of `ontomark_wasm::engine`
//     (Rust is the source of truth; these types mirror it).
//  2. Worker envelopes: {v, epoch, id} around engine traffic, plus the
//     worker-only operations `init`, `classify` (stepped loop) and `cancel`.
//
// Generation discipline (EXP-06): the host owns the generation counter. Every
// mutation carries a new, larger generation; every read carries the generation
// the host believes is current. The host owns the worker epoch too: each
// spawned worker gets a fresh epoch and every message from it is checked
// against the live epoch, so a late reply from a terminated worker can never
// be applied.

export const PROTOCOL_VERSION = 1;

export type ProfileId = "generic" | "estate";
export type DatasetSelection = "asserted" | "inferred" | "combined";
export type EntityKind = "class" | "individual" | "property";

export interface FileText {
  path: string;
  text: string;
}

/** ontomark-parse `Value` wire form. */
export type YamlValue =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "int"; v: number }
  | { t: "float"; v: string }
  | { t: "string"; v: string }
  | { t: "seq"; v: YamlValue[] }
  | { t: "map"; v: Record<string, YamlValue> };

export type Placement = { t: "end" } | { t: "start" } | { t: "after"; key: string };

/** ontomark-parse `PatchOp` wire form. */
export type PatchOp =
  | { op: "set"; key: string; value: YamlValue; placement?: Placement }
  | { op: "remove"; key: string }
  | {
      op: "replace_body";
      range: { start: number; end: number };
      expected: string;
      replacement: string;
    };

export type EngineRequest =
  | { kind: "load"; generation: number; profile?: ProfileId; files: FileText[] }
  | { kind: "upsert"; generation: number; path: string; text: string }
  | { kind: "remove"; generation: number; path: string }
  | { kind: "rename"; generation: number; from: string; to: string }
  | { kind: "set_profile"; generation: number; profile: ProfileId }
  | { kind: "index"; generation: number }
  | { kind: "describe"; generation: number; iri: string }
  | { kind: "frontmatter"; generation: number; path: string }
  | { kind: "classify_start"; generation: number; budget?: number }
  | { kind: "classify_step"; generation: number; budget?: number }
  | { kind: "classify"; generation: number }
  | {
      kind: "query";
      generation: number;
      sparql: string;
      dataset?: DatasetSelection;
      limit?: number;
    }
  | {
      kind: "propose_patch";
      generation: number;
      path: string;
      base_digest: string;
      ops: PatchOp[];
    }
  | { kind: "version" };

export const MUTATIONS = new Set<EngineRequest["kind"]>([
  "load",
  "upsert",
  "remove",
  "rename",
  "set_profile",
]);

export interface WireError {
  code: string;
  message: string;
}

export interface EngineResponse<T = unknown> {
  ok: boolean;
  generation: number;
  result?: T;
  error?: WireError;
}

// ---- Engine result shapes (mirrors of the Rust serde output) ----

export interface HostSpan {
  byte_start: number;
  byte_end: number;
  utf16_start: number;
  utf16_end: number;
  line: number;
  col: number;
}

export interface Diagnostic {
  path: string;
  code: string;
  severity: "error" | "warning";
  message: string;
  span: HostSpan | null;
}

export interface Entity {
  iri: string;
  iri_authored: boolean;
  kind: EntityKind;
  path: string;
  label: string;
  aliases: string[];
  parents: string[];
}

export interface ReasonerInfo {
  id: string;
  version: string;
  el_complete: boolean;
  note: string;
}

export interface Classification {
  reasoner: ReasonerInfo;
  subsumptions: { sub: string; sup: string; told: boolean }[];
  equivalences: string[][];
  unsatisfiable: string[];
  unsupported: { axiom: unknown; reason: string }[];
  /** Existential policy used: "all" (complete) or "relevant" (budget fallback). */
  policy: "all" | "relevant";
  /** No axiom refused and the complete policy finished. */
  complete: boolean;
}

export interface IndexResult {
  profile: ProfileId;
  /** Key names of the active profile, so the UI never hard-codes them. */
  keys: { type: string; iri: string; subclass: string; instance: string };
  documents: number;
  entities: Entity[];
  triples: number;
  axioms: number;
  diagnostics: Diagnostic[];
  reasoner: ReasonerInfo;
  classification: Classification | null;
}

export type WireTerm =
  | { type: "iri"; value: string }
  | { type: "bnode"; value: string }
  | { type: "literal"; value: string; datatype: string; lang?: string };

export type QueryResult =
  | {
      form: "select";
      variables: string[];
      rows: Record<string, WireTerm>[];
      truncated: boolean;
    }
  | { form: "ask"; boolean: boolean }
  | { form: "construct"; triples: [WireTerm, WireTerm, WireTerm][]; truncated: boolean };

export interface DescribeResult {
  entity: Entity;
  outgoing: [WireTerm, WireTerm, WireTerm][];
  incoming: [WireTerm, WireTerm, WireTerm][];
}

export type ClassifyProgress = { status: "pending"; steps: number; total: number | null };
export interface ClassifyDone {
  status: "done";
  classification: Classification;
  inferred_triples: number;
}

export interface PatchProposal {
  path: string;
  base_digest: string;
  base_text: string;
  new_text: string;
  new_digest: string;
  diff: string;
  edits: { op: number; before: { start: number; end: number }; after: { start: number; end: number } }[];
  preserved_bytes: number;
  no_op: boolean;
}

// ---- Worker envelopes ----

export type HostToWorker =
  | { v: 1; epoch: number; id: number; op: "init"; wasm: ArrayBuffer }
  | { v: 1; epoch: number; id: number; op: "engine"; request: EngineRequest }
  | { v: 1; epoch: number; id: number; op: "classify"; generation: number; budget: number }
  | { v: 1; epoch: number; id: number; op: "cancel"; target: number };

export type WorkerToHost =
  | { v: 1; epoch: number; id: number; op: "reply"; response: EngineResponse }
  | { v: 1; epoch: number; id: number; op: "progress"; generation: number; steps: number; total: number | null }
  | { v: 1; epoch: number; id: number; op: "fatal"; message: string };

/** Minimal Worker surface, satisfied by DOM Workers and the Node test shim. */
export interface WorkerLike {
  postMessage(message: HostToWorker, transfer?: Transferable[]): void;
  onmessage: ((ev: { data: WorkerToHost }) => void) | null;
  onerror: ((ev: { message?: string } | Error) => void) | null;
  terminate(): void;
}
