import { eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
// Side-effect only — nothing here is used as a value. This is what keeps `series.not_found`
// (declared in ./errors.ts via `declare module "@waitron/shared"`) visible outside this package.
// Declaration merging is a whole-program fact only for files the TypeScript compiler actually
// loads. Inside packages/db, `./errors.ts` is loaded regardless: packages/db/tsconfig.json
// `include`s all of `src`, so `pnpm --filter @waitron/db typecheck` (and this package's own
// tests) stay green whether or not this import exists — nothing in this package's own checks
// would catch its removal. But an external consumer of `@waitron/db` only sees what is
// transitively reachable from this package's public barrel (./index.ts, which exports
// `allocateInvoiceNumber` from this very file). Delete this line and `series.not_found` silently
// stops being a valid `ErrorCode` for anyone importing `@waitron/db` from outside this package,
// while every check this repo runs today stays green, because they all run from inside it. See
// the general rule this instance follows in packages/shared/src/errors.ts's design comment: a
// package augmenting `ErrorParams` must keep the augmenting file reachable from its own public
// barrel, not merely present in `src/`.
import "./errors.js";
import type { Transaction } from "./client.js";
import { invoiceSeries } from "./schema/series.js";

/**
 * Allocates the next invoice number from a series.
 *
 * Strictly increasing, and never reused once used. One statement, so the read
 * of `next_number` and the write of its successor cannot be separated.
 *
 * On PostgreSQL the UPDATE also took a row lock, and that is what made a second
 * allocator on the same series re-evaluate `next_number + 1` against the first's
 * committed value instead of its own stale snapshot. There is no second
 * allocator to overlap with: one write transaction runs on the venue file at a
 * time, and the pattern is stated once, with its measurement and its control, on
 * `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 *
 * Allocation is transactional. A rollback returns the number, and the next
 * caller receives it again; no gap appears. This is correct rather than a
 * compromise: the regulation requires strictly-increasing and never-reused
 * numbering and PERMITS gaps without requiring them, and a number that was
 * allocated inside a transaction that aborted was never used — nothing was
 * recorded under it. The property that must hold, "no two committed sales
 * share a number", is enforced by `sales_series_invoice_number_key`, UNIQUE
 * (series_id, invoice_number) on `sales`
 * (`packages/db/src/schema/sales.ts`, generated at
 * `packages/db/drizzle/0000_baseline.sql:617`). That does not depend on this
 * function being correct, and it is engine-independent.
 *
 * A counter in a row, rather than a counter the engine owns. That was the
 * decision on PostgreSQL — a per-series `nextval` would have put the number
 * outside transactional visibility and burnt it on rollback, to buy a gap the
 * regulation never asked for — and this engine has no sequences at all, so the
 * alternative it rejected no longer exists to reconsider.
 */
export async function allocateInvoiceNumber(tx: Transaction, seriesId: string): Promise<number> {
  const updated = await tx
    .update(invoiceSeries)
    .set({ nextNumber: sql`${invoiceSeries.nextNumber} + 1` })
    .where(eq(invoiceSeries.id, seriesId))
    .returning({ allocated: invoiceSeries.nextNumber });

  const row = updated[0];
  if (row === undefined) {
    throw new AppError("series.not_found", { seriesId });
  }
  // RETURNING on an UPDATE yields the NEW row, so `next_number` has already
  // been incremented. The number this caller may use is therefore the one
  // before the increment.
  return row.allocated - 1;
}
