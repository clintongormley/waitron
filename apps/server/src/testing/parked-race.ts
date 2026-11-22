import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { expect } from "vitest";

/**
 * Runs `first` and parks its transaction uncommitted, starts `second` only once `first` has
 * signalled that it holds the write lock, checks that `second` has not run, then lets `first`
 * commit. The 20 ms pause is a real one, not a microtask turn, to give the second transaction every
 * chance to run.
 */
export async function parkedRace<A, B>(
  db: Database,
  first: (tx: Transaction) => Promise<A>,
  second: (tx: Transaction) => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  let parked!: () => void;
  const holding = new Promise<void>((resolve) => (parked = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let secondStarted = false;
  const one = withTransaction(db, async (tx) => {
    const value = await first(tx);
    parked();
    await released;
    return value;
  });
  await Promise.race([holding, one.then(undefined, () => undefined)]);
  const two = withTransaction(db, (tx) => {
    secondStarted = true;
    return second(tx);
  });
  const settled = Promise.allSettled([one, two]);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondStarted, "the second transaction started while the first was still open").toBe(
      false,
    );
  } finally {
    release();
  }
  return settled;
}
