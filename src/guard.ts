// The host-side generation guard (EXP-06).
//
// A result may update the UI only when all of these hold:
//  - it came from the live worker epoch;
//  - for reads, it was computed at the generation that is still current;
//  - when the caller named a channel (one consumer, e.g. the query view), it
//    answers that channel's latest request, so an older request finishing
//    after a newer one cannot overwrite it. Requests without a channel are
//    independent: two callers reading the same generation both get answers.
//
// The guard is pure state with no timers or I/O so it is exhaustively testable.

export type Verdict =
  | { accept: true }
  | { accept: false; reason: "dead_epoch" | "stale_generation" | "superseded" };

export class GenerationGuard {
  private gen = 0;
  private liveEpoch = 0;
  private latestByChannel = new Map<string, number>();

  /** The current generation. */
  get generation(): number {
    return this.gen;
  }

  /** The live worker epoch. */
  get epoch(): number {
    return this.liveEpoch;
  }

  /** Allocate the next generation (call before sending a mutation). */
  bump(): number {
    this.gen += 1;
    return this.gen;
  }

  /** A worker was (re)spawned: allocate its epoch. Older epochs are dead from now on. */
  newEpoch(): number {
    this.liveEpoch += 1;
    return this.liveEpoch;
  }

  /** Record that request `id` is now the latest on `channel`. */
  issued(channel: string, id: number): void {
    this.latestByChannel.set(channel, id);
  }

  /** Is `id` still the latest request on `channel`? */
  isLatest(channel: string, id: number): boolean {
    return this.latestByChannel.get(channel) === id;
  }

  /**
   * Judge a reply.
   * @param epoch epoch the reply came from
   * @param channel the consumer channel, or null for an independent request
   * @param id request id
   * @param computedAt generation the read was computed at (`null` for mutations)
   */
  judge(epoch: number, channel: string | null, id: number, computedAt: number | null): Verdict {
    if (epoch !== this.liveEpoch) return { accept: false, reason: "dead_epoch" };
    if (computedAt !== null && computedAt !== this.gen) {
      return { accept: false, reason: "stale_generation" };
    }
    if (channel === null) return { accept: true };
    const latest = this.latestByChannel.get(channel);
    if (latest !== undefined && latest !== id) return { accept: false, reason: "superseded" };
    return { accept: true };
  }
}
