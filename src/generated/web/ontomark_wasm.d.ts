/**
 * The engine as a JavaScript class.
 *
 * ```js
 * import { initSync, WasmEngine } from "./ontomark_wasm.js";
 * initSync({ module: wasmBytes });
 * const engine = new WasmEngine();
 * const res = JSON.parse(engine.handle(JSON.stringify({ kind: "version" })));
 * ```
 */
export class WasmEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The engine's current generation.
     */
    generation(): number;
    /**
     * Handle one JSON request; returns the JSON response.
     */
    handle(request: string): string;
    /**
     * An empty engine (generation 0, generic profile).
     */
    constructor();
}

/**
 * Prepare a review binding and report source freshness without modifying it.
 * `keys_json` is `null` for the whole page or a non-empty JSON array of keys.
 * The returned JSON contains either `error` or `content_digest` and counts.
 */
export function review_binding(source: string, keys_json: string): string;

/**
 * The crate version.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmengine_free: (a: number, b: number) => void;
    readonly review_binding: (a: number, b: number, c: number, d: number) => [number, number];
    readonly version: () => [number, number];
    readonly wasmengine_generation: (a: number) => number;
    readonly wasmengine_handle: (a: number, b: number, c: number) => [number, number];
    readonly wasmengine_new: () => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
