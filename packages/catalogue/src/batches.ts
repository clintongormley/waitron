/** Rows or ids one statement binds at most. The store's adapter passes each bound value as its own
 * function argument, so one statement binding a whole large list overflows the call stack. */
export const BATCH_SIZE = 1000;

export function batches<T>(items: readonly T[], size: number = BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    result.push(items.slice(start, start + size));
  return result;
}
