/** Rows or ids one statement carries at most. A statement binds at most 32,766 values
 * (`SQL_VARIABLE_LIMIT` in `@waitron/store`), so 1,000 rows fit a table of 32 columns or fewer. */
export const BATCH_SIZE = 1000;

export function batches<T>(items: readonly T[], size: number = BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    result.push(items.slice(start, start + size));
  return result;
}
