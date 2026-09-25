/**
 * Commits closer together than this are kept as one run. Grouping them overstates the figure by
 * less than this.
 */
export const COMMIT_GRANULARITY_MS = 10_000;

/**
 * `pending`, `now` and the result's `coveredUpTo` are milliseconds on one timeline of this box's
 * choosing; the supervisor uses a clock that the time of day does not move.
 */
export interface LagInput {
  /** Commits not yet known to be in the bucket, oldest first, as [first, last]. */
  pending: readonly (readonly [number, number])[];
  /** The newest file seen in the live generation, by the bucket's clock; null before any. */
  newestUploadAt: Date | null;
  /** The bucket's clock minus this timeline, measured from a write this box made. */
  skewMs: number;
  now: number;
}

/**
 * How long the oldest change not yet in the bucket has been waiting (spec §7), and the time up to
 * which the bucket is taken to hold everything. Zero when nothing waits — never "time since the
 * last upload", which would call a quiet night stale.
 *
 * A file is stamped when its upload finished, and holds data written some time before, so a commit
 * landing in between counts as covered: the figure can be understated by the time between a file's
 * newest data and its upload. It is also understated by commits the store does not report (see
 * `StoreHandle.onCommit` in `@waitron/store`).
 */
export function computeLag(input: LagInput): { lagMs: number; coveredUpTo: number | null } {
  const coveredUpTo =
    input.newestUploadAt === null ? null : input.newestUploadAt.getTime() - input.skewMs;
  for (const [first, last] of input.pending) {
    if (coveredUpTo !== null && last <= coveredUpTo) continue;
    const start = coveredUpTo !== null && first <= coveredUpTo ? coveredUpTo + 1 : first;
    return { lagMs: Math.max(0, input.now - start), coveredUpTo };
  }
  return { lagMs: 0, coveredUpTo };
}

/**
 * The commits the bucket may not hold yet, kept as at most one run per `COMMIT_GRANULARITY_MS` of
 * committing, so a box offline for days holds a bounded list.
 */
export class CommitLog {
  readonly #runs: [number, number][] = [];

  record(t: number): void {
    const last = this.#runs.at(-1);
    if (last !== undefined && t - last[0] < COMMIT_GRANULARITY_MS) {
      last[1] = Math.max(last[1], t);
      return;
    }
    this.#runs.push([t, t]);
  }

  pending(): readonly (readonly [number, number])[] {
    return this.#runs;
  }

  /** Drops everything at or before `coveredUpTo`, and trims a run that straddles it. */
  settle(coveredUpTo: number | null): void {
    if (coveredUpTo === null) return;
    const kept = this.#runs.findIndex(([, last]) => last > coveredUpTo);
    this.#runs.splice(0, kept === -1 ? this.#runs.length : kept);
    const first = this.#runs[0];
    if (first !== undefined && first[0] <= coveredUpTo) first[0] = coveredUpTo + 1;
  }
}
