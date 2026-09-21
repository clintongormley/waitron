import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "./client.js";

export interface ClaimSpec {
  /**
   * The job table's name. Quoted and escaped by `sql.identifier` — run against drizzle-orm 0.45.2
   * on 2026-09-21, `x"; drop table t; --` came out as `"x""; drop table t; --"`.
   */
  readonly table: string;
  /**
   * The column that says WHICH row, and does not change when the row is claimed — its primary key.
   * It is how the stamp finds the rows the selection chose, and it has to survive another
   * transaction rewriting the row while this claim runs; see {@link claimRows}. Nothing here checks
   * that it is unique, and a column that is not stamps every row sharing a claimed value, so a
   * claim can write more rows than `limit`.
   */
  readonly key: string;
  /** A table the PREDICATE reads, joined to the job table (aliased `j`). */
  readonly claimableJoin?: SQL;
  /** Which rows may be claimed, written against the alias `j`. */
  readonly claimable: SQL;
  /** The order rows are claimed in, written against the alias `j`. */
  readonly order: SQL;
  /** How many rows one claim takes at most. */
  readonly limit: number;
  /** What claiming stamps on the rows it takes. */
  readonly set: SQL;
  /**
   * What the claim hands back, spelled by every caller.
   *
   * To read a neighbour of the claimed row — the printer a print job names — write a correlated
   * subquery here. There was a `join` option that put a second table into the statement's `FROM`
   * for this clause to read; SQLite refuses that. Measured on SQLite 3.53.4:
   * `update j set … from p where p.id = j.p … returning j.id, p.host` is refused
   * `no such column: p.host`, while the same statement returning only `j`'s own columns succeeds,
   * and `returning j.id, (select host from p where p.id = j.p) as host` returns the neighbour.
   * A table the PREDICATE reads is a different thing and still joins — {@link claimableJoin}.
   */
  readonly returning: SQL;
}

/**
 * Claims up to `limit` rows by UPDATING them, and returns the rows it claimed.
 *
 * One statement, so nothing can slip between choosing a row and stamping it. The inner selection
 * chooses the batch and the outer UPDATE stamps exactly those rows, finding them again by `key`.
 *
 * `key` must be the row's own identifier and not its physical address. On SQLite the address is
 * `rowid`, and `VACUUM` rewrites it; the measurement that first bought this parameter was taken on
 * PostgreSQL 18, where keying on `ctid` made a claim return NOTHING when another transaction had
 * moved the row mid-statement. That reading belongs to PostgreSQL and to a concurrency this engine
 * does not admit, so it is recorded here as the reason the parameter exists rather than as a
 * property of the code today; its regression case, `job-claim.pg.test.ts`, is deleted with the
 * PostgreSQL suites.
 *
 * **What used to keep two claimers apart, and what does now.** The statement carried
 * `for update of j skip locked`, which had a claimer take the rows it chose and pass over any row
 * another claimer already held. SQLite has no such clause and needs none: one writer holds the
 * file at a time (`packages/store/src/write-queue.ts`), so a second claim does not run until the
 * first has committed and can only see what the first left. That is the whole mechanism now —
 * with one exception the caller owns. A claim that is not INSIDE a write transaction is one
 * statement on its own, which is atomic, but two such claims in a row see each other's results
 * only because they are serialised; a caller that then acts on the rows in a SECOND statement
 * wants both inside one `withTransaction`. Every caller today does that.
 *
 * The other half stays the caller's business exactly as before: a caller whose `claimable`
 * excludes the state its `set` writes (as `claimPrintJobs` does, on `status` and the lease)
 * refuses a second claim on the predicate alone.
 */
export async function claimRows<Row extends Record<string, unknown>>(
  tx: Transaction,
  spec: ClaimSpec,
): Promise<Row[]> {
  const name = sql.identifier(spec.table);
  const key = sql.identifier(spec.key);
  const claimed = tx.execute<Row>(sql`
    update ${name} set ${spec.set}
    where ${name}.${key} in (
      select j.${key} from ${name} j ${spec.claimableJoin ?? sql.empty()}
      where ${spec.claimable}
      order by ${spec.order}
      limit ${spec.limit}
    )
    returning ${spec.returning}
  `);
  // `tx.execute` hands back `Record<string, unknown>[]` under the type argument it was given,
  // which the constraint above already makes the same type — but TypeScript will not reduce that
  // while `Row` is a parameter.
  return claimed.rows as Row[];
}

export interface LockedClaimSpec {
  /** The rows to claim: a complete SELECT, carrying its own joins, ordering and limit. */
  readonly selection: SQL;
}

/**
 * Runs the caller's selection and hands back its rows, stamping nothing.
 *
 * It was a claim: the selection carried `for update of <table> skip locked`, so the rows it
 * returned were locked for the caller's transaction and rows another claimer held were passed
 * over. SQLite has neither clause, so what is left here is an ordinary ordered SELECT — and the
 * claim now comes from the write queue around it, which admits one writer per file at a time
 * (`packages/store/src/write-queue.ts`). **That makes the caller's transaction boundary the whole
 * of the claim**: a selection taken inside `withTransaction`, acted on, and committed there cannot
 * overlap another writer; the same selection taken outside one carries no claim at all.
 * `packages/fiscal-verifactu/src/drain.ts` takes it inside one and says so at its call site.
 *
 * It survives the clause's deletion rather than being inlined into that caller because the
 * paragraph above is what a reader needs, and it has one home here instead of one per caller. The
 * `of` parameter is gone with the lock it narrowed: it named which ONE table a `FOR UPDATE`
 * touched, and there is no `FOR UPDATE`.
 *
 * It still differs from {@link claimLock} in what the caller hands over — raw SQL rather than a
 * Drizzle query — and so in what comes back: the driver's rows rather than Drizzle's typed ones.
 */
export async function claimLockedRows<Row extends Record<string, unknown>>(
  tx: Transaction,
  spec: LockedClaimSpec,
): Promise<Row[]> {
  const claimed = tx.execute<Row>(spec.selection);
  // Same reduction TypeScript will not make for `claimRows` above, for the same reason.
  return claimed.rows as Row[];
}

/**
 * A select this module runs for the caller — drizzle's builder, structurally.
 *
 * It used to declare `for(strength, config)` as well, because this module added the claim's lock
 * clause to whatever it was handed. With that clause gone the structural requirement is only that
 * the query can be awaited for its rows.
 */
type Lockable<Row> = PromiseLike<Row[]>;

/**
 * Runs the caller's Drizzle selection and hands back its rows, stamping nothing.
 *
 * The {@link claimLockedRows} paragraph applies here unchanged: the `for update … skip locked` this
 * added is gone, the write queue is what keeps two writers apart, and so the claim is now the
 * caller's transaction boundary rather than anything in this function.
 * `packages/payments/src/store.ts` reads its forward queue out of the payment rows' own state and
 * has no column to stamp, which is why it wants this rather than {@link claimRows} — a no-op
 * UPDATE would write a new version of every row a forward pass merely looked at.
 *
 * What it does for a reader is name the selection a claim, in the one place the reasoning lives.
 */
export async function claimLock<Row>(query: Lockable<Row>): Promise<Row[]> {
  return query;
}
