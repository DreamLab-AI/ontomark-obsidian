import { describe, expect, it } from "vitest";
import { GenerationGuard } from "../src/guard";

describe("GenerationGuard (EXP-06)", () => {
  it("accepts a read computed at the current generation from the live epoch", () => {
    const g = new GenerationGuard();
    const epoch = g.newEpoch();
    const gen = g.bump();
    g.issued("query", 7);
    expect(g.judge(epoch, "query", 7, gen)).toEqual({ accept: true });
  });

  it("rejects a read computed before a newer mutation", () => {
    const g = new GenerationGuard();
    const epoch = g.newEpoch();
    const gen = g.bump();
    g.issued("classify", 1);
    g.bump(); // an edit arrives while classify runs
    expect(g.judge(epoch, "classify", 1, gen)).toEqual({ accept: false, reason: "stale_generation" });
  });

  it("rejects anything from a dead epoch, whatever its generation", () => {
    const g = new GenerationGuard();
    const old = g.newEpoch();
    const gen = g.bump();
    g.issued("index", 3);
    g.newEpoch(); // respawn
    expect(g.judge(old, "index", 3, gen)).toEqual({ accept: false, reason: "dead_epoch" });
  });

  it("independent requests (no channel) are both accepted at the current generation", () => {
    const g = new GenerationGuard();
    const epoch = g.newEpoch();
    const gen = g.bump();
    expect(g.judge(epoch, null, 1, gen)).toEqual({ accept: true });
    expect(g.judge(epoch, null, 2, gen)).toEqual({ accept: true });
  });

  it("rejects an older request on the same channel that finishes after a newer one", () => {
    const g = new GenerationGuard();
    const epoch = g.newEpoch();
    const gen = g.bump();
    g.issued("query", 10);
    g.issued("query", 11);
    expect(g.judge(epoch, "query", 10, gen)).toEqual({ accept: false, reason: "superseded" });
    expect(g.judge(epoch, "query", 11, gen)).toEqual({ accept: true });
  });

  it("allocates strictly increasing generations and epochs", () => {
    const g = new GenerationGuard();
    const gens = [g.bump(), g.bump(), g.bump()];
    const epochs = [g.newEpoch(), g.newEpoch()];
    expect(gens).toEqual([1, 2, 3]);
    expect(epochs).toEqual([1, 2]);
  });
});
