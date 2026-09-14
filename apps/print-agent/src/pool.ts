/** Calls `work` for every item, starting them in order with at most `concurrency` calls in flight.
 * `work` handles its own failures: a rejection rejects the returned promise while the remaining items
 * still start. */
export async function forEachBounded<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      await work(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
