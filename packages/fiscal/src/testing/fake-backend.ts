import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { NodeId, SaleId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type {
  FiscalBackend,
  FiledReceipt,
  FiscalRecordRef,
  IntegrityIssue,
  IntegrityReport,
  NodeRegistration,
  SaleForFiscalRecord,
  VatBreakdownLine,
} from "../backend.js";

/**
 * A `type` alias, not an `interface`, on purpose: `Database["execute"]`/`Transaction["execute"]`
 * are generic over `TRow extends Record<string, unknown>`, and only an object type declared via
 * `type` picks up the implicit string index signature TypeScript uses to satisfy that constraint
 * — a structurally-identical `interface` does not, and fails with "index signature for type
 * 'string' is missing" at every `execute<FakeFiscalRecord & {...}>(...)` call site below.
 */
export type FakeFiscalRecord = {
  recordId: string;
  nodeId: string;
  saleId: string;
  sequence: number;
  kind: "sale" | "void" | "correction" | "substitution";
  invoiceNumber: number;
  total: string;
  state: string;
};

// Exactly the shape of a decimal literal @waitron/shared produces. Re-derived here rather than
// imported, because the point is to check what actually arrived at the boundary — importing the
// producer's own validator would make the check agree with the producer by construction.
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

let counter = 0;
const nextId = (): string => `fake-${String(++counter).padStart(8, "0")}`;

/**
 * A genuine test double for `packages/core`'s tests, not a stub. It enforces the same
 * preconditions a real backend enforces (an unregistered till is refused, a non-decimal total is
 * refused), it participates in the caller's own transaction so rollback is observable, and its
 * integrity check can be told to fail on demand so "a failed check never stops the next sale" is
 * exercisable at all.
 *
 * An in-memory `FakeFiscalBackend` (an array in a field) was rejected. The interface takes a
 * transaction handle because atomicity between the sale and the fiscal record is the property it
 * exists to guarantee, and an array does not roll back — so every packages/core test asserting "a
 * failed sale records nothing" would have passed while testing nothing at all. This fake writes to
 * real tables through the caller's own transaction instead, which makes that property observable
 * and costs one `CREATE TABLE` in a test harness.
 */
export class FakeFiscalBackend implements FiscalBackend {
  readonly id = "fake";

  private readonly injectedIssues = new Map<string, IntegrityIssue[]>();

  constructor(private readonly db: Database) {}

  /**
   * Creates this fake's two bookkeeping tables, and nothing else — no grants, because the engine
   * has no roles to grant to (`packages/db/src/testing/roles.ts`).
   *
   * The DDL stays hand-written rather than moving to `@waitron/db`'s column vocabulary. These are
   * not product tables: they belong to no migration set, carry no `ledger`/`state`/`local`
   * classification, and stand in for a remote service's own storage — so declaring them with the
   * helpers every product table uses would make them read as schema they are not.
   *
   * **Nothing checks that this DDL stays in the engine's dialect**, and a collecting suite is not
   * that check either. `scripts/column-vocabulary.test.ts` reads IMPORT lines and this file names
   * no column builder. Of the PostgreSQL spellings that were here, only `default now()` was
   * REFUSED (`near "(": syntax error`, which stopped this package's suite and
   * `packages/catalogue/src/integration.test.ts` from collecting at all); `timestamptz`,
   * `numeric(12, 2)` and `jsonb` were each accepted as type names and silently given an affinity —
   * see the `total` column below for what that cost.
   */
  static async install(db: Database): Promise<void> {
    await db.execute(sql`
      create table if not exists fake_node_registrations (
        node_id text primary key,
        registration_id text not null,
        -- Nothing reads this column; it exists so a registration carries when it was made. An
        -- expression DEFAULT rather than a generator, because the insert below is raw SQL and
        -- $defaultFn is run by drizzle's insert builder only. This spelling emits the same
        -- ISO-8601 shape nowIso() does -- measured on node:sqlite (Node v26.7.0):
        -- 2026-09-21T19:09:06.727Z, against "default current_timestamp" as the control, which
        -- gives 2026-09-21 19:09:06.
        registered_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
    await db.execute(sql`
      create table if not exists fake_fiscal_records (
        record_id text primary key,
        node_id text not null,
        sale_id text not null,
        sequence integer not null,
        kind text not null,
        invoice_number integer not null,
        -- Text, because this table stores the decimal STRING the backend interface handed it and
        -- recordsFor hands it back digit for digit. Not a money column: money counts whole cents
        -- at the row, and what arrives here is already a decimal amount (total: Decimal,
        -- packages/fiscal/src/backend.ts:72), above that boundary rather than under it.
        --
        -- numeric(12, 2) is the trap this replaced, and it is a trap because the engine ACCEPTS
        -- the type name: it gives the column numeric affinity, so the stored '12.10' comes back as
        -- the number 12.1 (measured on node:sqlite, Node v26.7.0, against a text column as the
        -- control, which returns '12.10'). What no spelling here restores is the refusal the
        -- PostgreSQL column made: neither type rejects 'abc', so recordSale's own DECIMAL_PATTERN
        -- is the whole check, and recordCorrection/recordSubstitution -- which do not run it --
        -- now store whatever string they are handed.
        total text not null,
        state text not null,
        -- The filed VAT breakdown, stored so filedReceiptFor can hand back the EXACT figures the
        -- replay path reprints (Task 14). NULL for a void, which files no breakdown of its own; set
        -- for a sale, the only kind the replay read-back reads. JSON in a text column: the engine
        -- has no jsonb, and nothing below filedReceiptFor parses it.
        vat_breakdown text,
        unique (node_id, sequence)
      );
    `);
  }

  /**
   * Empties both tables. `delete from`, one statement each: measured on node:sqlite (Node
   * v26.7.0), this engine refuses `truncate` (`near "truncate": syntax error`) and refuses naming
   * two tables in one `delete` (`near ",": syntax error`).
   */
  static async truncate(db: Database): Promise<void> {
    await db.execute(sql`delete from fake_fiscal_records`);
    await db.execute(sql`delete from fake_node_registrations`);
  }

  async registerNode(tx: Transaction, nodeId: NodeId): Promise<NodeRegistration> {
    const registrationId = nextId();
    await tx.execute(sql`
      insert into fake_node_registrations (node_id, registration_id)
      values (${nodeId}, ${registrationId})
      on conflict (node_id) do update set registration_id = excluded.registration_id
    `);
    return { backend: this.id, nodeId, registrationId, registeredAt: new Date() };
  }

  async recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    await this.assertRegistered(tx, sale.nodeId);
    if (typeof sale.total !== "string" || !DECIMAL_PATTERN.test(sale.total)) {
      throw new AppError("shared.invalid_decimal", { value: String(sale.total) });
    }
    return this.append(tx, {
      nodeId: sale.nodeId,
      saleId: sale.saleId,
      kind: "sale",
      invoiceNumber: sale.invoiceNumber,
      total: sale.total,
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      vatBreakdown: sale.vatBreakdown,
    });
  }

  /**
   * The replay read-back (`FiscalBackend.filedReceiptFor`, Task 14): returns the breakdown this fake
   * FILED for the sale plus a deterministic stand-in verification URL. Reads the `sale` record only —
   * the one kind the till-sale replay path reprints — so a void's own `sale_id` row (which carries no
   * breakdown) is never mistaken for the sale's receipt. `undefined` for a sale it never recorded.
   *
   * The fake has no real regime and so no real QR to re-derive; it fabricates a STABLE one from the
   * record's own id, the same value on every replay of the sale — which is all the replay path needs
   * (an idempotent replay must reprint the SAME qr). The breakdown, by contrast, is genuinely stored
   * and handed back verbatim, so the read-back round-trips the exact filed figures.
   */
  async filedReceiptFor(tx: Transaction, saleId: SaleId): Promise<FiledReceipt | undefined> {
    const rows = await tx.execute<{ record_id: string; vat_breakdown: string }>(sql`
      select record_id, vat_breakdown
      from fake_fiscal_records
      where sale_id = ${saleId} and kind = 'sale'
      limit 1
    `);
    const row = rows.rows[0];
    if (row === undefined) {
      return undefined;
    }
    // A `kind = 'sale'` row always carries a non-null `vat_breakdown` — `recordSale` always supplies
    // it (see `append`), so no null branch is reachable here. The parse belongs here because the
    // driver hands this column back as a string — measured on node:sqlite (Node v26.7.0), for a
    // column declared `text` and for one declared `jsonb` alike, so the type NAME does not move it.
    // The host is a regime-NEUTRAL stand-in (this package names no regime — its own
    // no-regime-vocabulary guard scans this file), not any real verification service.
    return {
      verificationUrl: `https://fiscal-receipt.example/fake/${row.record_id}`,
      vatBreakdown: JSON.parse(row.vat_breakdown) as VatBreakdownLine[],
    };
  }

  // `reason` is part of FiscalBackend's public contract (a real backend may keep it as part of
  // its own audit trail); this fake has nothing to do with it, but the parameter stays — with an
  // underscore, so tsc's own `noUnusedParameters` (a separate check from eslint's) leaves it
  // alone — so callers on the concrete class, not just the interface, are still typechecked
  // against the real three-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  async recordVoid(tx: Transaction, saleId: SaleId, _reason: string): Promise<FiscalRecordRef> {
    const rows = await tx.execute<{
      node_id: string;
      invoice_number: number;
      total: string;
    }>(sql`
      select node_id, invoice_number, total
      from fake_fiscal_records
      where sale_id = ${saleId} and kind = 'sale'
      limit 1
    `);
    const original = rows.rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId });
    }
    return this.append(tx, {
      nodeId: original.node_id,
      saleId,
      kind: "void",
      invoiceNumber: original.invoice_number,
      total: original.total,
      issuedAt: new Date(),
      offsetMinutes: 0,
    });
  }

  async recordCorrection(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    correction: { correctsSaleId: SaleId },
  ): Promise<FiscalRecordRef> {
    // Mirrors recordVoid's precondition: the sale being corrected must already have a fiscal
    // record. A correction references a prior sale (spec §4); there is nothing to correct if the
    // original was never recorded.
    const rows = await tx.execute<{ record_id: string }>(sql`
      select record_id from fake_fiscal_records
      where sale_id = ${correction.correctsSaleId} and kind = 'sale'
      limit 1
    `);
    if (rows.rows[0] === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId: correction.correctsSaleId });
    }
    // Unlike a void, a correction carries its OWN data (its own saleId, invoice number and negative
    // total), so it is appended from `sale`, not from the corrected record's columns — the same
    // shape recordSale uses. The real backend validates none of this beyond what appendToChain
    // does, so neither does the fake.
    return this.append(tx, {
      nodeId: sale.nodeId,
      saleId: sale.saleId,
      kind: "correction",
      invoiceNumber: sale.invoiceNumber,
      total: sale.total,
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    });
  }

  async recordSubstitution(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    substitution: { substitutedSaleIds: SaleId[] },
  ): Promise<FiscalRecordRef> {
    // A substitution replaces one or more prior simplified sales (spec §4). Two preconditions,
    // mirroring recordCorrection's single one extended to the N:1 fan-out: the list must name at
    // least one sale, and every sale it names must already have a fiscal record. The real backend
    // additionally asserts each replaced sale is a simplified ticket; this fake carries no
    // invoice-type information, so — like recordCorrection — it checks only existence.
    if (substitution.substitutedSaleIds.length === 0) {
      throw new Error("FakeFiscalBackend.recordSubstitution: substitutedSaleIds must not be empty");
    }
    for (const substitutedSaleId of substitution.substitutedSaleIds) {
      const rows = await tx.execute<{ record_id: string }>(sql`
        select record_id from fake_fiscal_records
        where sale_id = ${substitutedSaleId} and kind = 'sale'
        limit 1
      `);
      if (rows.rows[0] === undefined) {
        throw new AppError("fiscal.sale_not_recorded", { saleId: substitutedSaleId });
      }
    }
    // Like a correction, a substitution carries its OWN data (its own saleId, invoice number and
    // positive total), so it is appended from `sale`, not from the replaced records' columns. The
    // replaced 'sale' records are only read above, never rewritten — nothing here annuls them.
    return this.append(tx, {
      nodeId: sale.nodeId,
      saleId: sale.saleId,
      kind: "substitution",
      invoiceNumber: sale.invoiceNumber,
      total: sale.total,
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    });
  }

  async checkIntegrity(tx: Transaction, nodeId: NodeId): Promise<IntegrityReport> {
    const rows = await tx.execute<{ count: string }>(sql`
      select cast(count(*) as text) as count from fake_fiscal_records
      where node_id = ${nodeId}
    `);
    const checked = Number(rows.rows[0].count);
    const issues = this.injectedIssues.get(nodeId) ?? [];
    return { ok: issues.length === 0, checked, issues };
  }

  async pendingCount(nodeId: NodeId): Promise<number> {
    const rows = await this.db.execute<{ count: string }>(sql`
      select cast(count(*) as text) as count
      from fake_fiscal_records
      where node_id = ${nodeId} and state = 'pending'
    `);
    return Number(rows.rows[0].count);
  }

  // ---- test-only affordances ------------------------------------------------------------

  /** Makes `checkIntegrity` report a failure. Without this the "records the next sale anyway"
   * requirement — the one spec §4 states outright — could not be exercised at all. */
  breakIntegrity(nodeId: NodeId, issue: IntegrityIssue): void {
    this.injectedIssues.set(nodeId, [...(this.injectedIssues.get(nodeId) ?? []), issue]);
  }

  restoreIntegrity(nodeId: NodeId): void {
    this.injectedIssues.delete(nodeId);
  }

  async acknowledge(recordId: string): Promise<void> {
    await this.db.execute(sql`
      update fake_fiscal_records set state = 'acknowledged' where record_id = ${recordId}
    `);
  }

  async recordsFor(nodeId: NodeId): Promise<FakeFiscalRecord[]> {
    const rows = await this.db.execute<FakeFiscalRecord & { sequence: number }>(sql`
      select record_id as "recordId", node_id as "nodeId", sale_id as "saleId",
             sequence, kind, invoice_number as "invoiceNumber", total, state
      from fake_fiscal_records
      where node_id = ${nodeId}
      order by sequence
    `);
    return rows.rows;
  }

  // ---- internals ------------------------------------------------------------------------

  private async assertRegistered(tx: Transaction, nodeId: string): Promise<void> {
    const rows = await tx.execute<{ node_id: string }>(sql`
      select node_id from fake_node_registrations where node_id = ${nodeId}
    `);
    if (rows.rows.length === 0) {
      throw new AppError("fiscal.node_not_registered", { nodeId });
    }
  }

  private async append(
    tx: Transaction,
    entry: {
      nodeId: string;
      saleId: string;
      kind: "sale" | "void" | "correction" | "substitution";
      invoiceNumber: number;
      total: string;
      issuedAt: Date;
      offsetMinutes: number;
      /** The filed VAT breakdown, so `filedReceiptFor` can hand back the exact figures a replay
       * reprints. Supplied by `recordSale` (the only kind the replay read-back reads); absent for a
       * void, which files no breakdown. */
      vatBreakdown?: readonly VatBreakdownLine[];
    },
  ): Promise<FiscalRecordRef> {
    const recordId = nextId();
    // `coalesce(max(...), 0) + 1` with no `group by` always returns exactly one row and a
    // non-null value (that is what the coalesce is for), so `next.rows[0]` is never absent — a
    // `?? 1` fallback here would be dead code no test could ever legitimately reach.
    const next = await tx.execute<{ sequence: number }>(sql`
      select coalesce(max(sequence), 0) + 1 as sequence
      from fake_fiscal_records
      where node_id = ${entry.nodeId}
    `);
    const sequence = next.rows[0].sequence;
    // `null` when no breakdown was filed (a void), the serialised array otherwise — stored so
    // `filedReceiptFor` returns the EXACT filed figures rather than a recompute. Bound as-is, with
    // no cast: the column is text and this engine has no `::` operator.
    const vatBreakdown =
      entry.vatBreakdown === undefined ? null : JSON.stringify(entry.vatBreakdown);
    // UNIQUE (node_id, sequence) is the backstop, mirroring the real one. A fake that assigned
    // positions without a constraint would let a core test interleave two writes and still pass.
    await tx.execute(sql`
      insert into fake_fiscal_records
        (record_id, node_id, sale_id, sequence, kind, invoice_number, total, state,
         vat_breakdown)
      values
        (${recordId}, ${entry.nodeId}, ${entry.saleId}, ${sequence},
         ${entry.kind}, ${entry.invoiceNumber}, ${entry.total}, 'pending', ${vatBreakdown})
    `);
    return {
      backend: this.id,
      recordId,
      state: "pending",
      issuedAt: entry.issuedAt,
      offsetMinutes: entry.offsetMinutes,
    };
  }
}
