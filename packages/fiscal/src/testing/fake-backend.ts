import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { SaleId, TenantId, TillId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type {
  AckState,
  DrainResult,
  FiscalBackend,
  FiscalRecordRef,
  IntegrityIssue,
  IntegrityReport,
  ReconcileMismatch,
  ReconcileResult,
  SaleForFiscalRecord,
  TillRegistration,
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
  tillId: string;
  saleId: string;
  sequence: number;
  kind: "sale" | "void" | "correction";
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
  private readonly injectedIssues = new Map<string, IntegrityIssue[]>();
  private readonly reportedState = new Map<string, AckState | null>();

  constructor(private readonly db: Database) {}

  static async install(db: Database): Promise<void> {
    await db.execute(sql`
      create table if not exists fake_till_registrations (
        till_id text primary key,
        tenant_id text not null,
        registration_id text not null,
        registered_at timestamptz not null default now()
      );
    `);
    await db.execute(sql`
      create table if not exists fake_fiscal_records (
        record_id text primary key,
        tenant_id text not null,
        till_id text not null,
        sale_id text not null,
        sequence integer not null,
        kind text not null,
        invoice_number integer not null,
        total numeric(12, 2) not null,
        state text not null,
        unique (till_id, sequence)
      );
    `);
    // Grants `app_user` access to this fake's own bookkeeping tables, if that role exists.
    //
    // Added by packages/core's write-path task (Task 16), not present when this file was first
    // committed (Task 11): every one of THIS package's own tests exercises the fake as the
    // connection owner (`db.transaction(...)`, never `asAppUser(tx)` first — see
    // `fake-backend.test.ts`), and PostgreSQL grants a freshly created table's privileges to its
    // owner only, nobody else, by default. `packages/core`'s own write-path test is the first
    // caller to exercise this fake through a transaction that has already switched to the
    // non-owner `app_user` role — deliberately, per that suite's own doc comment: an owner-run
    // write-path test would prove the code runs, not that the application role is permitted to
    // run it. Without this grant, every insert this fake makes on `app_user`'s behalf fails with
    // "permission denied for table fake_till_registrations" — caught live in that task's own red
    // phase.
    //
    // Conditional on the role actually existing, and not a bare `GRANT ... TO app_user`: this
    // package's OWN test database (`fake-backend.test.ts`) never runs `@waitron/db`'s migrations
    // at all, so `app_user` does not exist there, and an unconditional GRANT would break that
    // already-passing suite outright — verified live. A database that HAS run those migrations
    // (every real deployment, and `packages/core`'s own suite) already created the role, and this
    // becomes a normal, idempotent grant.
    await db.execute(sql`
      do $$
      begin
        if exists (select 1 from pg_roles where rolname = 'app_user') then
          grant select, insert, update on fake_till_registrations, fake_fiscal_records
            to app_user;
        end if;
      end
      $$;
    `);
  }

  static async truncate(db: Database): Promise<void> {
    await db.execute(sql`truncate fake_fiscal_records, fake_till_registrations`);
  }

  async registerTill(
    tx: Transaction,
    tillId: TillId,
    params: { tenantId: string },
  ): Promise<TillRegistration> {
    const registrationId = nextId();
    await tx.execute(sql`
      insert into fake_till_registrations (till_id, tenant_id, registration_id)
      values (${tillId}, ${params.tenantId}, ${registrationId})
      on conflict (till_id) do update set registration_id = excluded.registration_id
    `);
    return { backend: "fake", tillId, registrationId, registeredAt: new Date() };
  }

  async recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    await this.assertRegistered(tx, sale.tillId);
    if (typeof sale.total !== "string" || !DECIMAL_PATTERN.test(sale.total)) {
      throw new AppError("shared.invalid_decimal", { value: String(sale.total) });
    }
    return this.append(tx, {
      tenantId: sale.tenantId,
      tillId: sale.tillId,
      saleId: sale.saleId,
      kind: "sale",
      invoiceNumber: sale.invoiceNumber,
      total: sale.total,
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    });
  }

  // `reason` is part of FiscalBackend's public contract (a real backend may keep it as part of
  // its own audit trail); this fake has nothing to do with it, but the parameter stays — with an
  // underscore, so tsc's own `noUnusedParameters` (a separate check from eslint's) leaves it
  // alone — so callers on the concrete class, not just the interface, are still typechecked
  // against the real three-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  async recordVoid(tx: Transaction, saleId: SaleId, _reason: string): Promise<FiscalRecordRef> {
    const rows = await tx.execute<{
      tenant_id: string;
      till_id: string;
      invoice_number: number;
      total: string;
    }>(sql`
      select tenant_id, till_id, invoice_number, total
      from fake_fiscal_records
      where sale_id = ${saleId} and kind = 'sale'
      limit 1
    `);
    const original = rows.rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId });
    }
    return this.append(tx, {
      tenantId: original.tenant_id,
      tillId: original.till_id,
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
      tenantId: sale.tenantId,
      tillId: sale.tillId,
      saleId: sale.saleId,
      kind: "correction",
      invoiceNumber: sale.invoiceNumber,
      total: sale.total,
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    });
  }

  async checkIntegrity(
    tx: Transaction,
    tenantId: TenantId,
    tillId: TillId,
  ): Promise<IntegrityReport> {
    const rows = await tx.execute<{ count: string }>(sql`
      select count(*)::text as count from fake_fiscal_records
      where tenant_id = ${tenantId} and till_id = ${tillId}
    `);
    const checked = Number(rows.rows[0].count);
    const issues = this.injectedIssues.get(tillId) ?? [];
    return { ok: issues.length === 0, checked, issues };
  }

  async pendingCount(tenantId: TenantId, tillId: TillId): Promise<number> {
    const rows = await this.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from fake_fiscal_records
      where tenant_id = ${tenantId} and till_id = ${tillId} and state = 'pending'
    `);
    return Number(rows.rows[0].count);
  }

  /**
   * Minimal-but-honest: every `pending` fake record, across every tenant and till, is marked
   * `acknowledged` in one pass — there is no external submission target here to reject or delay
   * anything, so "submitted" and "accepted" are the same event and `recordsHalted`/`incidentsRaised`
   * stay zero. `nextDueAt` is always `null`: a fake with nothing left to retry has nothing to
   * schedule. `now` is unused — this fake has no retry-scheduling concept to consult — and kept
   * only so callers on the concrete class are still typechecked against the real one-argument
   * signature, matching `recordVoid`'s identical `_reason` convention above.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  async drain(_now: Date): Promise<DrainResult> {
    const pending = await this.db.execute<{ count: string }>(sql`
      select count(*)::text as count from fake_fiscal_records where state = 'pending'
    `);
    const accepted = Number(pending.rows[0].count);
    await this.db.execute(sql`
      update fake_fiscal_records set state = 'acknowledged' where state = 'pending'
    `);
    return {
      nextDueAt: null,
      batchesSent: accepted > 0 ? 1 : 0,
      recordsSubmitted: accepted,
      recordsAccepted: accepted,
      recordsHalted: 0,
      incidentsRaised: 0,
      // This fake has no per-tenant loop or containment at all — one `db.execute` sweeps every
      // pending record in a single shot. Those `db.execute` calls above CAN throw like any real
      // query; there is simply no per-tenant try/catch here to turn that into a `skipped` entry —
      // a throw propagates straight out of this method, unlike the real `VerifactuBackend.drain`.
      // `skipped` is always `[]` because nothing here is wired to ever push to it, not because
      // nothing can fail.
      skipped: [],
    };
  }

  /**
   * A genuine diff, not a stub: reads every one of this tenant's fake records and classifies each
   * against `reportedState` — the test-only injectable view set via `setReportedState`, standing
   * in for whatever a real regime would report back. This fake's own records carry no date, so —
   * unlike a real backend's period-scoped implementation — this does not filter by `period` at
   * all; it exists to demonstrate the three-way diff and the result shape, nothing more.
   * `incidentsRaised` stays zero: this fake has no incident sink to raise one into.
   */
  async reconcile(
    tenantId: TenantId,
    period: { year: string; month: string },
  ): Promise<ReconcileResult> {
    const rows = await this.db.execute<{ record_id: string; state: string }>(sql`
      select record_id, state from fake_fiscal_records where tenant_id = ${tenantId}
    `);
    const lostAck: ReconcileMismatch[] = [];
    const noTrace: ReconcileMismatch[] = [];
    const drift: ReconcileMismatch[] = [];
    for (const row of rows.rows) {
      const reported = this.reportedState.get(row.record_id) ?? null;
      const mismatch: ReconcileMismatch = {
        recordId: row.record_id,
        localState: row.state,
        reportedState: reported,
      };
      if (row.state === "pending") {
        // reported === null: still in flight, which is ordinary, not a mismatch.
        if (reported !== null) lostAck.push(mismatch);
      } else if (row.state === "acknowledged") {
        if (reported === null) noTrace.push(mismatch);
        // reported === "accepted": clean, otherwise the regime's report disagrees.
        else if (reported !== "accepted") drift.push(mismatch);
      }
    }
    return {
      year: period.year,
      month: period.month,
      checked: rows.rows.length,
      lostAck,
      noTrace,
      drift,
      incidentsRaised: 0,
    };
  }

  // ---- test-only affordances ------------------------------------------------------------

  /** Makes `checkIntegrity` report a failure. Without this the "records the next sale anyway"
   * requirement — the one spec §4 states outright — could not be exercised at all. */
  breakIntegrity(tillId: TillId, issue: IntegrityIssue): void {
    this.injectedIssues.set(tillId, [...(this.injectedIssues.get(tillId) ?? []), issue]);
  }

  restoreIntegrity(tillId: TillId): void {
    this.injectedIssues.delete(tillId);
  }

  /** Sets what the (fake) regime reports back for `recordId` — the injectable view `reconcile`
   * diffs its own records against. `null` means the regime has no record of it at all. Without
   * this, `reconcile`'s three-way classification could not be exercised at all — mirrors
   * `breakIntegrity`'s identical injectable-state convention above. */
  setReportedState(recordId: string, state: AckState | null): void {
    this.reportedState.set(recordId, state);
  }

  async acknowledge(recordId: string): Promise<void> {
    await this.db.execute(sql`
      update fake_fiscal_records set state = 'acknowledged' where record_id = ${recordId}
    `);
  }

  async recordsFor(tillId: TillId): Promise<FakeFiscalRecord[]> {
    const rows = await this.db.execute<FakeFiscalRecord & { sequence: number }>(sql`
      select record_id as "recordId", till_id as "tillId", sale_id as "saleId",
             sequence, kind, invoice_number as "invoiceNumber", total, state
      from fake_fiscal_records
      where till_id = ${tillId}
      order by sequence
    `);
    return rows.rows;
  }

  // ---- internals ------------------------------------------------------------------------

  private async assertRegistered(tx: Transaction, tillId: string): Promise<void> {
    const rows = await tx.execute<{ till_id: string }>(sql`
      select till_id from fake_till_registrations where till_id = ${tillId}
    `);
    if (rows.rows.length === 0) {
      throw new AppError("fiscal.till_not_registered", { tillId });
    }
  }

  private async append(
    tx: Transaction,
    entry: {
      tenantId: string;
      tillId: string;
      saleId: string;
      kind: "sale" | "void" | "correction";
      invoiceNumber: number;
      total: string;
      issuedAt: Date;
      offsetMinutes: number;
    },
  ): Promise<FiscalRecordRef> {
    const recordId = nextId();
    // `coalesce(max(...), 0) + 1` with no `group by` always returns exactly one row and a
    // non-null value (that is what the coalesce is for), so `next.rows[0]` is never absent — a
    // `?? 1` fallback here would be dead code no test could ever legitimately reach.
    const next = await tx.execute<{ sequence: number }>(sql`
      select coalesce(max(sequence), 0) + 1 as sequence
      from fake_fiscal_records
      where till_id = ${entry.tillId}
    `);
    const sequence = next.rows[0].sequence;
    // UNIQUE (till_id, sequence) is the backstop, mirroring the real one. A fake that assigned
    // positions without a constraint would let a core test interleave two writes and still pass.
    await tx.execute(sql`
      insert into fake_fiscal_records
        (record_id, tenant_id, till_id, sale_id, sequence, kind, invoice_number, total, state)
      values
        (${recordId}, ${entry.tenantId}, ${entry.tillId}, ${entry.saleId}, ${sequence},
         ${entry.kind}, ${entry.invoiceNumber}, ${entry.total}, 'pending')
    `);
    return {
      backend: "fake",
      recordId,
      state: "pending",
      issuedAt: entry.issuedAt,
      offsetMinutes: entry.offsetMinutes,
    };
  }
}
