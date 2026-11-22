import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { expect } from "vitest";

/**
 * Runs `first` in a transaction and keeps it open, uncommitted, while `second` is submitted, so
 * `second` meets the held write lock rather than `first`'s committed result. Fails, once both have
 * settled, if `second` had started within 20 ms of being submitted. A `first` that rejects rejects
 * this with its own error, and `second` is never submitted.
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
  const one = withTransaction(db, async (tx) => {
    const value = await first(tx);
    parked();
    await released;
    return value;
  });
  await Promise.race([holding, one]);
  let secondStarted = false;
  const two = withTransaction(db, (tx) => {
    secondStarted = true;
    return second(tx);
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const startedEarly = secondStarted;
  release();
  const settled = await Promise.allSettled([one, two]);
  expect(startedEarly, "the second transaction started while the first was still open").toBe(false);
  return settled;
}
