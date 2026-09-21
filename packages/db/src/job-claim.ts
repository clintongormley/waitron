import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "./client.js";

/**
 * The two shapes a job claim takes in this repository, and the ONE file that spells the
 * PostgreSQL-only SQL both of them rest on.
 *
 * `for update … skip locked` has no SQLite equivalent, and neither does `ctid`. Task F1 of the
 * storage switch removes both — under the write queue one transaction writes at a time, so there
 * are no locked rows to skip and the conditional update is the whole mechanism
 * (`docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`, step 16). Putting both
 * constructs here means that step edits this file instead of four call sites in three packages.
 */

export interface ClaimSpec {
  /** The job table's name. A literal in the caller's own source, never user input. */
  readonly table: string;
  /**
   * What the claimable rows are selected FROM, with the job table aliased `j` — the alias the lock
   * clause names. Omitted, it is the job table alone; a caller whose predicate reads a second table
   * joins it here (`packages/printing/src/runtime.ts` reads the printer's `active` flag).
   */
  readonly claimableFrom?: SQL;
  /** Which rows may be claimed, written against the alias `j`. */
  readonly claimable: SQL;
  /** The order rows are claimed in, written against the alias `j`. */
  readonly order: SQL;
  /** How many rows one claim takes at most. */
  readonly limit: number;
  /** What claiming stamps on the rows it takes. */
  readonly set: SQL;
  /** A table the stamp joins so its `returning` can read the claimed row's neighbours. */
  readonly join?: { readonly from: SQL; readonly on: SQL };
  /** What the claim hands back. Spelled by every caller: a default would hide the join above. */
  readonly returning: SQL;
}

/**
 * Claims up to `limit` rows by UPDATING them, and returns the rows it claimed.
 *
 * One statement, so no second claimer can slip between choosing a row and stamping it. The inner
 * selection locks the rows it picks and skips any row another claimer already holds, so two
 * concurrent claims partition the queue rather than blocking on each other or taking the same row
 * twice; `job-claim.pg.test.ts` shows both halves against a real server, which is the only place
 * they can be shown (PGlite runs one backend — CLAUDE.md §4).
 *
 * `ctid` carries the lock's choice out to the UPDATE: the row's physical address is what the two
 * halves of the statement agree on, and it is stable here because the inner selection holds a lock
 * on every row it returns, so nothing else can move one.
 */
export async function claimRows<Row extends Record<string, unknown>>(
  tx: Transaction,
  spec: ClaimSpec,
): Promise<Row[]> {
  const name = sql.identifier(spec.table);
  const claimed = await tx.execute<Row>(sql`
    update ${name} set ${spec.set}
    ${spec.join === undefined ? sql.empty() : sql`from ${spec.join.from}`}
    where ${spec.join === undefined ? sql.empty() : sql`${spec.join.on} and `}${name}.ctid in (
      select j.ctid from ${spec.claimableFrom ?? sql`${name} j`}
      where ${spec.claimable}
      order by ${spec.order}
      limit ${spec.limit}
      for update of j skip locked
    )
    returning ${spec.returning}
  `);
  // `tx.execute` hands back `Assume<Row, Record<string, unknown>>[]`. The constraint above already
  // makes that the same type as `Row[]`, but TypeScript will not reduce the conditional while `Row`
  // is still a type parameter, so the equality has to be asserted rather than inferred.
  return claimed.rows as Row[];
}

/** A select this module can add the claim's lock clause to — drizzle's builder, structurally. */
interface Lockable<Row> extends PromiseLike<Row[]> {
  for(strength: "update", config: { skipLocked: true }): PromiseLike<Row[]>;
}

/**
 * Claims rows by LOCKING them and stamping nothing, and returns the rows it claimed.
 *
 * The claim is the lock itself, held until the claiming transaction ends:
 * `packages/payments/src/store.ts` reads its forward queue out of the payment rows' own state and
 * has no column to stamp, so a claim there is a row lock and the caller's own state-guarded
 * advances. A no-op UPDATE would put the claim through {@link claimRows} instead, at the price of
 * writing a new version of every row a forward pass merely looked at.
 *
 * Behaviour under two concurrent claimers is the same as {@link claimRows}: the second returns the
 * rows the first does not hold, immediately, rather than waiting for it.
 */
export async function claimLock<Row>(query: Lockable<Row>): Promise<Row[]> {
  return query.for("update", { skipLocked: true });
}
