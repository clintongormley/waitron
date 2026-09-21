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
  /** A table the STAMP joins, so its `returning` can read the claimed row's neighbours. */
  readonly join?: { readonly from: SQL; readonly on: SQL };
  /** What the claim hands back. Spelled by every caller: a default would hide the join above. */
  readonly returning: SQL;
}

/**
 * Claims up to `limit` rows by UPDATING them, and returns the rows it claimed.
 *
 * One statement, so no second claimer can slip between choosing a row and stamping it. The inner
 * selection chooses and locks the batch, skipping any row another claimer already holds, and the
 * outer UPDATE stamps exactly those rows, finding them again by `key`.
 *
 * `key` must be the row's own identifier and not its physical address, and that is the whole reason
 * this parameter exists. Measured 2026-09-21 on PostgreSQL 18, with a claim held mid-statement on
 * an advisory lock while another transaction committed a change to the row it was about to take:
 * keyed on the row's `ctid` the claim returned NOTHING, because the outer scan still saw the row
 * where it used to be while the selection had followed it to where it now was; keyed on its primary
 * key the same claim took the row, carrying the other transaction's change. The regression case is
 * `job-claim.pg.test.ts`'s "takes a row another transaction rewrote while the claim was running".
 *
 * What `skip locked` buys is that a claimer does not WAIT for another claimer. That much is
 * measured: delete it and this module's own `job-claim.pg.test.ts` fails on its test timeout, while
 * `packages/printing`'s two-agent suites still pass. It is therefore NOT the only thing keeping a
 * row from being claimed twice — but what else keeps it is the CALLER's business, not this
 * function's: a caller whose `claimable` excludes the state its `set` writes (as `claimPrintJobs`
 * does, on `status` and the lease) refuses a second claim on the predicate alone, and a caller whose
 * predicate does not read what it stamps has only the clause. The runs are in
 * `docs/developers/testing-guide.md` under "A proof-by-deletion belongs to the SHAPE of the code it
 * was taken against".
 *
 * `for update … skip locked` has no SQLite equivalent. Task F1 of the storage switch removes it,
 * leaving the conditional update as the whole mechanism — under the write queue one transaction
 * writes at a time, so there are no locked rows to skip
 * (`docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`, step 16). Keeping the clause
 * here means that step edits this module rather than each caller. The clause is still spelled
 * outside it, but only ever by a suite and never by a caller — some hold a row against the claim
 * under test, others run it as a control they expect to be refused. Grep rather than trust a list
 * here: this sentence has carried a count twice and been wrong both times.
 */
export async function claimRows<Row extends Record<string, unknown>>(
  tx: Transaction,
  spec: ClaimSpec,
): Promise<Row[]> {
  const name = sql.identifier(spec.table);
  const key = sql.identifier(spec.key);
  const stamp = spec.join;
  const claimed = await tx.execute<Row>(sql`
    update ${name} set ${spec.set}
    ${stamp === undefined ? sql.empty() : sql`from ${stamp.from}`}
    where ${stamp === undefined ? sql.empty() : sql`${stamp.on} and `}${name}.${key} in (
      select j.${key} from ${name} j ${spec.claimableJoin ?? sql.empty()}
      where ${spec.claimable}
      order by ${spec.order}
      limit ${spec.limit}
      for update of j skip locked
    )
    returning ${spec.returning}
  `);
  // `tx.execute` hands back `Assume<Row, Record<string, unknown>>[]`, which the constraint above
  // already makes the same type — but TypeScript will not reduce that while `Row` is a parameter.
  return claimed.rows as Row[];
}

export interface LockedClaimSpec {
  /** The rows to claim: a complete SELECT, carrying its own joins, ordering and limit. */
  readonly selection: SQL;
  /**
   * Which ONE of the tables the selection names is locked, spelled as the selection spells it —
   * its alias where it has one. Quoted by `sql.identifier`, like {@link ClaimSpec.table}, which
   * means it is passed through as written: PostgreSQL folds an unquoted alias to lower case, so
   * a selection written `from envios E` needs `of: "e"` here and not `"E"`.
   */
  readonly of: string;
}

/**
 * Claims rows by LOCKING them and stamping nothing, like {@link claimLock}. Two things differ.
 * The caller hands over raw SQL rather than a drizzle query, and gets back what `tx.execute`
 * returns rather than drizzle's typed rows; and the lock it takes is narrowed to one table, where
 * {@link claimLock} locks everything its query names.
 *
 * Both differences come back to the same thing: drizzle's `LockConfig` does carry an `of` (read in
 * drizzle-orm 0.45.2, `pg-core/query-builders/select.types.d.ts:61`), but it wants a table object,
 * and a caller writing its selection as raw SQL has only an alias to name. `Lockable` below, this
 * module's own structural type, pins the config to `{ skipLocked: true }` and so offers no `of` at
 * all.
 *
 * A caller needs that narrowing whenever it joins a table the role may not lock: PostgreSQL wants
 * an update-shaped privilege on every table a `FOR UPDATE` touches, so an unnarrowed lock over
 * such a join is refused `42501` before it reads anything. The case, with its control running the
 * refused form first, is `job-claim.test.ts`'s "locks only the table `of` names" — measured there
 * against a table-wide grant, which is the only shape it covers.
 *
 * A caller that needs to STAMP everything it locks wants {@link claimRows} instead, which does
 * both in one statement. This one exists for a caller that locks a window and then decides, row by
 * row, which of those rows it will stamp — `packages/fiscal-verifactu/src/drain.ts` reads each
 * claimed record's own environment before it commits to sending it, and leaves the rest alone.
 *
 * Like {@link claimLock}, what task F1 leaves of this is an ordinary ordered SELECT with no claim
 * in it, sound because the write queue admits one writer at a time — see that function's own
 * paragraph. A caller relying on that should check {@link claimRows}'s warning against its own
 * predicate first; the drain's does exclude the state it stamps, and says so at its call site.
 */
export async function claimLockedRows<Row extends Record<string, unknown>>(
  tx: Transaction,
  spec: LockedClaimSpec,
): Promise<Row[]> {
  const claimed = await tx.execute<Row>(
    sql`${spec.selection} for update of ${sql.identifier(spec.of)} skip locked`,
  );
  // Same reduction TypeScript will not make for `claimRows` above, for the same reason.
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
 * has no column to stamp, so a claim there is a row lock plus the caller's own state-guarded
 * advances. A no-op UPDATE would put it through {@link claimRows} instead, at the price of writing
 * a new version of every row a forward pass merely looked at.
 *
 * On PostgreSQL, two concurrent claimers partition the queue exactly as {@link claimRows}: the
 * second returns the rows the first does not hold, immediately, rather than waiting for it. What
 * task F1 should leave of each is NOT the same, and the difference is worth knowing before that
 * task starts: its step 16 names `claimRows`, which keeps a conditional update that still does the
 * claiming, and says nothing about this function, which has nothing left to keep — an ordinary
 * ordered SELECT with no claim in it. That is sound only because the write queue admits one writer
 * at a time, and it is this comment's reading of the plan rather than a line in it.
 */
export async function claimLock<Row>(query: Lockable<Row>): Promise<Row[]> {
  return query.for("update", { skipLocked: true });
}
