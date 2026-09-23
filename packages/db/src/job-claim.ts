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
   * **Write the TABLE's name here, never the alias `j`.** `j` names the inner selection's copy of
   * the table; {@link claimRows}'s outer `update` is unaliased, so this clause cannot see it.
   * {@link claimable}, {@link order} and {@link claimableJoin} are the three written against `j`,
   * and this one is the odd one out.
   *
   * To read a neighbour of the claimed row — the printer a print job names — write a correlated
   * subquery here. There was a `join` option that put a second table into the statement's `FROM`
   * for this clause to read; SQLite refuses that.
   *
   * All four re-driven on 2026-09-23 against SQLite 3.53.4 (`node:sqlite`, Node v26.7.0), on the
   * exact statement `claimRows` builds — a job table `pj`, a printer table `pr`:
   *  - `… returning j.id` — refused, `no such column: j.id`;
   *  - `… returning pj.id`, and a bare `… returning id` — both return the claimed row;
   *  - `… returning pj.id, (select host from pr where pr.id = pj.p) as host` — returns the
   *    neighbour, which is what `packages/printing/src/runtime.ts` writes;
   *  - `update pj set … from pr where pr.id = pj.p returning pj.id, pr.host` — refused,
   *    `no such column: pr.host`, which is the `join` option's obituary.
   *
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
