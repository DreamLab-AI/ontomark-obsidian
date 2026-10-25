// OB-01-S1-01: the Jev semantic verifier for assisted-ingest suggestions.
//
// Runs AFTER the engine has grounded the model's answer. It asks one Noul per
// accepted fact: does the located quote itself state it? A fact Jev doubts is
// annotated in the review dialog; only if the user set a withhold threshold
// is a fact the verifier rates at or below it also dropped, and then the
// engine's own `ingest_accept` is run again on the surviving proposals, so
// grounding, kind and conflict checks, the digest guard and the reviewed
// diff all still produce the patch. Pure: the engine call is injected.
import type { CandidateAssertion, IngestAcceptResult, ModelRequest, ModelResponse, Withheld } from "./protocol";
import { DOUBT_BELOW, verifyFacts } from "./jev";
import type { JevConfig, JevDeps } from "./jev";

/** What the review dialog shows next to an accepted fact. */
export interface JevNote {
  key: string;
  written: string;
  /** Jev's probability that the quote supports the fact. */
  p: number;
}

export interface Judged {
  result: IngestAcceptResult;
  notes: JevNote[];
  /** `applied` or the fallback reason; the plain result is returned unchanged for any reason. */
  outcome: string;
}

export type AcceptFn = (responses: ModelResponse[]) => Promise<IngestAcceptResult>;

const same = (a: CandidateAssertion, key: string, written: string): boolean => a.key === key && a.written === written;

/**
 * Verify the accepted facts of `plain` (the result of `accept(responses)`).
 * Never throws: any failure returns `plain` unchanged with no notes.
 */
export async function judgeIngest(
  accept: AcceptFn,
  request: ModelRequest,
  responses: ModelResponse[],
  plain: IngestAcceptResult,
  cfg: JevConfig,
  deps: JevDeps,
): Promise<Judged> {
  const unchanged = (outcome: string): Judged => ({ result: plain, notes: [], outcome });
  try {
    const facts = plain.candidates.accepted.filter((a) => a.evidence.length > 0);
    if (facts.length === 0) return unchanged("nothing-to-judge");
    const verdict = await verifyFacts(
      cfg,
      deps,
      request.note.label,
      facts.map((f) => ({ key: f.key, predicate: f.predicate, written: f.written, quote: f.evidence[0].quote })),
    );
    if (!verdict.ok) return unchanged(verdict.reason);
    const notes: JevNote[] = [];
    const rejected: CandidateAssertion[] = [];
    facts.forEach((f, i) => {
      const p = verdict.value[i];
      if (p < DOUBT_BELOW) notes.push({ key: f.key, written: f.written, p });
      // 0 means "never withhold": the default accepts nothing automatically.
      if (cfg.withholdAtOrBelow > 0 && p <= cfg.withholdAtOrBelow) rejected.push(f);
    });
    if (rejected.length === 0) return { result: plain, notes, outcome: "applied" };

    // Which proposals produced the rejected facts? Ask the engine about each on its own.
    const dropped = new Set<string>();
    for (const r of responses) {
      for (let ai = 0; ai < r.assertions.length; ai++) {
        const one = await accept([{ chunk: r.chunk, assertions: [r.assertions[ai]] }]);
        const fact = one.candidates.accepted[0];
        if (fact && rejected.some((x) => same(x, fact.key, fact.written))) dropped.add(`${r.chunk}:${ai}`);
      }
    }
    const kept: ModelResponse[] = responses.map((r) => ({
      chunk: r.chunk,
      assertions: r.assertions.filter((_, ai) => !dropped.has(`${r.chunk}:${ai}`)),
    }));
    const after = await accept(kept);
    // Monotone: the re-run may only write facts the plain run wrote.
    if (!after.candidates.accepted.every((a) => plain.candidates.accepted.some((b) => same(b, a.key, a.written)))) {
      return { result: plain, notes, outcome: "not-monotone" };
    }
    const withheld: Withheld[] = [...after.candidates.withheld];
    for (const f of rejected) {
      withheld.push({
        chunk: f.evidence[0].chunk,
        key: f.key,
        value: f.written,
        reason: { reason: "judged_unsupported" },
        evidence: f.evidence[0],
      });
    }
    return {
      result: { ...after, candidates: { ...after.candidates, withheld } },
      notes: notes.filter((n) => !rejected.some((f) => same(f, n.key, n.written))),
      outcome: "applied",
    };
  } catch {
    // Fail open: a failing verifier must never block the reviewed flow.
    return unchanged("error");
  }
}
