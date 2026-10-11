// Test doubles: an in-process worker that runs the real worker loop over the
// real engine (Node-target wasm), delivering every message asynchronously like
// a real Worker does.
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileText, HostToWorker, WorkerLike, WorkerToHost } from "../src/protocol";
import { createWorkerCore } from "../src/worker-core";

const require = createRequire(import.meta.url);
export const wasmGlue = require("../src/generated/node/ontomark_wasm.js") as {
  WasmEngine: new () => { handle(req: string): string };
};

export class InProcWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerToHost }) => void) | null = null;
  onerror: ((ev: { message?: string } | Error) => void) | null = null;
  terminated = false;
  readonly sent: HostToWorker[] = [];
  private core = createWorkerCore(
    (msg) =>
      setTimeout(() => {
        if (!this.terminated) this.onmessage?.({ data: msg });
      }, 0),
    { makeEngine: () => this.makeEngine() },
  );

  /** When set and returning true, the message is swallowed: a worker stuck on it forever. */
  stuckOn: ((msg: HostToWorker) => boolean) | null = null;

  constructor(private readonly makeEngine: () => { handle(req: string): string } = () => new wasmGlue.WasmEngine()) {}

  postMessage(msg: HostToWorker): void {
    if (this.terminated) return;
    this.sent.push(msg);
    if (this.stuckOn?.(msg)) return;
    setTimeout(() => {
      if (!this.terminated) this.core(msg);
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

export const FIXTURE_VAULT = join(dirname(fileURLToPath(import.meta.url)), "fixtures/vault");

export function readVault(root: string = FIXTURE_VAULT): FileText[] {
  const out: FileText[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(root, p).split(sep).join("/"), text: readFileSync(p, "utf8") });
    }
  };
  walk(root);
  return out;
}

/** A vault with a long subclass chain so classification spans many worker steps. */
export function chainVault(n: number): FileText[] {
  const files: FileText[] = [{ path: "C0.md", text: "---\ntype: class\n---\n" }];
  for (let i = 1; i < n; i++) {
    files.push({ path: `C${i}.md`, text: `---\ntype: class\nsubclass-of: ["[[C${i - 1}]]"]\n---\n` });
  }
  return files;
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
