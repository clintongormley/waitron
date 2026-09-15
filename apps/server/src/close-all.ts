/**
 * Runs every closer, whatever the others do, then rejects with the first failure in list order —
 * so no pool is left open behind a failed one, and the failure still reaches the caller's log.
 */
export async function closeAll(closers: ReadonlyArray<() => Promise<void>>): Promise<void> {
  const outcomes = await Promise.allSettled(closers.map(async (close) => close()));
  const failed = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (failed !== undefined) throw failed.reason;
}
