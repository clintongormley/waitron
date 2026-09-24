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
 * A `type`, not an `interface`: `execute<TRow>` requires `TRow extends Record<string, unknown>`,
 * which only a type alias satisfies.
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

// Re-derived rather than imported from @waitron/shared: importing the producer's own validator
// would make the check agree with the producer by construction.
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

let counter = 0;
const nextId = (): string => `fake-${String(++counter).padStart(8, "0")}`;

/**
 * A test double, not a stub. It writes to real tables through the caller's own transaction, so a
 * rollback is observable — an in-memory array would not roll back — and its integrity check can be
 * told to fail on demand.
 */
export class FakeFiscalBackend implements FiscalBackend {
  readonly id = "fake";

  private readonly injectedIssues = new Map<string, IntegrityIssue[]>();

  constructor(private readonly db: Database) {}

  /**
   * Creates this fake's two bookkeeping tables. Hand-written rather than in `@waitron/db`'s column
   * vocabulary: they are not product tables, belong to no migration set, and stand in for a remote
   * service's own storage.
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
   * Reads the `sale` record only, so a void's row for the same sale is never mistaken for the
   * receipt. The URL is a stand-in derived from the record id, so it is the same on every replay.
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
    // `recordSale` always stores a breakdown, so a `sale` row's is never null.
    return {
      verificationUrl: `https://fiscal-receipt.example/fake/${row.record_id}`,
      vatBreakdown: JSON.parse(row.vat_breakdown) as VatBreakdownLine[],
    };
  }

  // `_reason` is unused but kept, so callers on the concrete class are typechecked against the
  // interface's three-argument signature; the underscore satisfies tsc's `noUnusedParameters`.
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
    const rows = await tx.execute<{ record_id: string }>(sql`
      select record_id from fake_fiscal_records
      where sale_id = ${correction.correctsSaleId} and kind = 'sale'
      limit 1
    `);
    if (rows.rows[0] === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId: correction.correctsSaleId });
    }
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
    // Unlike the real backend, this checks only that each replaced sale exists: the fake stores no
    // invoice type.
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

  /** Makes `checkIntegrity` report a failure, so "a failed check never stops the next sale" can
   * be tested. */
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
      vatBreakdown?: readonly VatBreakdownLine[];
    },
  ): Promise<FiscalRecordRef> {
    const recordId = nextId();
    const next = await tx.execute<{ sequence: number }>(sql`
      select coalesce(max(sequence), 0) + 1 as sequence
      from fake_fiscal_records
      where node_id = ${entry.nodeId}
    `);
    const sequence = next.rows[0].sequence;
    const vatBreakdown =
      entry.vatBreakdown === undefined ? null : JSON.stringify(entry.vatBreakdown);
    // UNIQUE (node_id, sequence) is the backstop: without it a core test could interleave two
    // writes and still pass.
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
