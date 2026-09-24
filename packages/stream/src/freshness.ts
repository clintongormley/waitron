/**
 * Commits closer together than this are kept as one run. Grouping them overstates the figure by
 * less than this.
 */
export const COMMIT_GRANULARITY_MS = 10_000;

export interface LagInput {
  /** Commits not yet known to be in the bucket, oldest first, as [first, last] in this box's milliseconds. */
  pending: readonly (readonly [number, number])[];
  /** The newest file seen in the live generation, by the bucket's clock; null before any. */
  newestUploadAt: Date | null;
  /** The bucket's clock minus this box's, measured from a write this box made. */
  skewMs: number;
  now: Date;
}

/**
 * How long the oldest change not yet in the bucket has been waiting (spec §7), and the box-clock
 * time up to which the bucket is taken to hold everything. Zero when nothing waits — never "time
 * since the last upload", which would call a quiet night stale.
 *
 * An upload is stamped when it finished, and holds what Litestream read a moment before, so a
 * commit landing in between counts as covered: the figure can be understated by up to one upload's
 * duration. It is also understated by commits the store does not report (see `StoreHandle.onCommit`
 * in `@waitron/store`).
 */
export function computeLag(input: LagInput): { lagMs: number; coveredUpTo: number | null } {
  const coveredUpTo =
    input.newestUploadAt === null ? null : input.newestUploadAt.getTime() - input.skewMs;
  for (const [first, last] of input.pending) {
    if (coveredUpTo !== null && last <= coveredUpTo) continue;
    const start = coveredUpTo !== null && first <= coveredUpTo ? coveredUpTo + 1 : first;
    return { lagMs: Math.max(0, input.now.getTime() - start), coveredUpTo };
  }
  return { lagMs: 0, coveredUpTo };
}

/**
 * The commits the bucket may not hold yet, kept as at most one run per `COMMIT_GRANULARITY_MS` of
 * committing, so a box offline for days holds a bounded list.
 *
 * A reported commit can add nothing for Litestream to upload, and then waits, reading as behind,
 * until the next commit that does. Measured 2026-09-25 on `node:sqlite`, Node v26.7.0, WAL mode
 * with automatic checkpoints off: an UPDATE setting a column to the value it already held moved
 * `total_changes()` (which is what the store reports on) by 1 and grew the `-wal` file by 0 bytes;
 * the same UPDATE changing the value grew it by 4120.
 */
export class CommitLog {
  readonly #runs: [number, number][] = [];

  record(at: Date): void {
    const t = at.getTime();
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
    while (this.#runs.length > 0 && this.#runs[0]![1] <= coveredUpTo) this.#runs.shift();
    const first = this.#runs[0];
    if (first !== undefined && first[0] <= coveredUpTo) first[0] = coveredUpTo + 1;
  }
}
