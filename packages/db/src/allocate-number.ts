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
 * Strictly increasing, and never reused once used. One statement: the UPDATE
 * takes a row lock, so two concurrent allocators on the same series serialise
 * and the second re-evaluates `next_number + 1` against the first's committed
 * value. At READ COMMITTED that is exactly the semantics required — the
 * blocked statement re-reads the updated row rather than proceeding from its
 * stale snapshot.
 *
 * Allocation is transactional. A rollback returns the number, and the next
 * caller receives it again; no gap appears. This is correct rather than a
 * compromise: the regulation requires strictly-increasing and never-reused
 * numbering and PERMITS gaps without requiring them, and a number that was
 * allocated inside a transaction that aborted was never used — nothing was
 * recorded under it. The property that must hold, "no two committed sales
 * share a number", is enforced by UNIQUE (tenant_id, series_id,
 * invoice_number) on `sales`, which does not depend on this function being
 * correct.
 *
 * Deliberately NOT a per-series Postgres sequence. `nextval` would put the
 * counter outside transactional visibility and burn the number on rollback,
 * but a sequence per series row means CREATE SEQUENCE executed from a trigger
 * on every insert — dynamic DDL on the write path, plus a SECURITY DEFINER
 * function to run it — to buy a gap the regulation never asked for.
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
