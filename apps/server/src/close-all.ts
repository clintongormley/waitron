/**
 * Runs every closer in order, each after the one before it settles, even when one fails; then
 * rejects with the first failure.
 */
export async function closeAll(closers: ReadonlyArray<() => unknown>): Promise<void> {
  const failures: unknown[] = [];
  for (const close of closers) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
