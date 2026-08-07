import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AppError,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
  decimal,
} from "@waitron/shared";
import type { NodeId, SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
// **Deviation from the brief.** The brief imports `FakeFiscalBackend` from `@waitron/fiscal/testing`
// — a subpath that does not exist (no `packages/fiscal/testing` folder, no `exports` map, and
// `@waitron/fiscal`'s own `src/index.ts` re-export barrel explicitly does NOT carry the fake — see
// its own closing comment). That same comment in the already-committed `packages/fiscal/src/index.ts`
// states the ACTUAL intended import path in so many words: "packages/core imports it from
// '@waitron/fiscal/src/testing/fake-backend.js' in test files only". Used that path, verbatim, per
// the already-committed source rather than the brief's paraphrase of it.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type {
  FiscalBackend,
  IntegrityIssue,
  TrustedClock,
  VatBreakdownLine,
} from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  invoiceSeries,
  pgErrorCode,
  saleLines,
  saleSettlements,
  sales,
  tenders,
  withTenant,
} from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { formatInvoiceNumber, recordSale } from "./record-sale.js";
import type { RecordSaleInput, RecordSaleTender } from "./record-sale.js";
import { settleSale } from "./settle-sale.js";
import { seedRectificativeSeries, seedTenant } from "../test/fixtures.js";

let tenantId: TenantId;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

// PGlite boots a WASM PostgreSQL and then runs @waitron/db's own migrations, which is
// comfortably past Vitest's 5s default. The explicit hook timeout is not padding — without it
// this suite fails intermittently on a cold machine and passes on a warm one, which is the worst
// possible failure signature.
//
// **Deviation from the brief.** The brief's `beforeAll` ran BOTH `@waitron/db`'s migrations and
// `@waitron/fiscal-verifactu`'s (`FISCAL_MIGRATIONS`). This suite never touches a module's own
// tables at all — `FakeFiscalBackend` participates in the caller's transaction through its OWN
// ephemeral `fake_node_registrations`/`fake_fiscal_records` tables (created below via
// `FakeFiscalBackend.install`), never `registros_facturacion`/`cadenas`/`envios` — and importing
// `@waitron/fiscal-verifactu` from `packages/core` at all (even from a test file: the eslint
// boundary zone's `files` glob is `packages/core/**/*.ts`, with no `*.test.ts` carve-out) would
// trip the very generic-layer boundary this task was asked to re-verify. Runs core migrations
// only.
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS],
  // Not in the brief at all: `FakeFiscalBackend.recordSale`/`registerNode`/`checkIntegrity` read
  // and write `fake_node_registrations`/`fake_fiscal_records`, and nothing creates those tables
  // except this call. Omitting it fails every test in this file with "relation
  // fake_fiscal_records does not exist" — caught in this task's own red phase.
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tenantId, tillId, nodeId, seriesId } = await seedTenant(suite.db));
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/**
 * Builds a `TrustedClock` from a `now()` implementation alone.
 *
 * **Deviation from the brief.** Every `TrustedClock` literal in the brief supplied only `now`.
 * The real interface (`packages/fiscal/src/clock.ts`) also requires `anchor` and
 * `currentAnchor` — `recordSale` never calls either (it reads `now()` exactly once), so both are
 * stubbed here rather than duplicated at each of this file's three call sites.
 */
function fixedClock(now: TrustedClock["now"]): TrustedClock {
  return {
    now,
    anchor: () => {
      throw new Error("fixedClock: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

/** Confident, fixed, +01:00 — the ordinary case. */
const steadyClock: TrustedClock = fixedClock(() => ({
  instant: BASE,
  offsetMinutes: 60,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
}));

// The default immediate tender for the €14.41 sale: sum(amount) 16.31 = total 14.41 + tip 1.90 —
// the coverage identity `settleSale` now enforces inside `recordSale`'s immediate half. The tip
// rides on the tender (design D2), no longer on the sale. Reused by the mode-equivalence test so
// the two modes settle the identical tender list.
const DEFAULT_TENDERS: RecordSaleTender[] = [
  { method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE },
];

function input(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    tenantId,
    tillId,
    nodeId,
    seriesId,
    locale: "es-ES",
    invoiceLocales: ["es-ES", "ca-ES"],
    // The taxable total: base (10.00 + 2.10 = 12.10) plus this fixture's own VAT (2.10 + 0.21 =
    // 2.31) = 14.41. Deliberately reconciled by hand here rather than left to coincide with
    // `lines`, so a reader can check the arithmetic without running the suite.
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Café solo", "ca-ES": "Cafè sol" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        descriptions: { "es-ES": "Agua", "ca-ES": "Aigua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    fiscalBackend: "fake",
    clock: steadyClock,
    settlement: { kind: "immediate", tenders: DEFAULT_TENDERS },
    ...overrides,
  };
}

/**
 * Runs the write path exactly as the application will: as `app_user`, in one transaction, on a
 * node already registered with the injected backend.
 *
 * Registration is not in the brief's own `run` helper, but it is required: `FakeFiscalBackend` is
 * "a genuine test double" (its own doc comment) that refuses `recordSale`/`recordVoid` for a node
 * with no prior `registerNode` — `fiscal.node_not_registered` — exactly like a real backend would.
 * `recordSale` itself never calls `registerNode` (provisioning a node is a separate, one-time
 * admin action, out of this task's seven steps), so a test that skips this fails every happy-path
 * assertion with that error instead of the one under test.
 */
async function run(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTenant(suite.db, tenantId, async (tx) => {
    // Never as the owner. An owner bypasses RLS and can disable any trigger, so an owner-run
    // write-path test would prove the code runs, not that the application role is permitted to
    // run it.
    await asAppUser(tx);
    await backend.registerNode(tx, nodeId, { tenantId });
    return recordSale(tx, backend, input(overrides));
  });
}

/**
 * **Deviation from the brief.** The brief's `countRows` counted every row in the whole table,
 * unscoped. That silently assumes either a fresh database per test or a truncation between
 * them — neither holds here: this file's `beforeAll` boots ONE PGlite instance for the whole
 * suite (booting a fresh WASM PostgreSQL per test would be the far slower alternative), and
 * `beforeEach` seeds a FRESH tenant per test rather than truncating. Left unscoped, a later
 * test's count includes every row every earlier test in the file committed — observed live in
 * this task's own red phase as counts like 11, 12, 15 where 1 or 2 were expected. Scoped to the
 * CURRENT test's own tenant instead, which is what "this test wrote exactly N rows" actually
 * means once the database is shared across the file.
 */
async function countRows(table: string): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)} where tenant_id = ${tenantId}`,
  );
  return result.rows[0]!.n;
}

/**
 * A thin `execute` wrapper returning the raw rows, for the `sale_lines.category` assertion. Scoped
 * by the CALLER's own `where` (in practice `sale_id = ${saleId}`) rather than an unscoped `limit 1`
 * — this suite shares ONE PGlite instance across the whole file and seeds a fresh tenant per test
 * (see `countRows`'s own note), so an unscoped read would pick up rows an earlier test committed.
 */
async function rows<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  const result = await suite.db.execute<T>(query);
  // `execute`'s row type is `Assume<T, Record<string, unknown>>`, structurally identical to `T`
  // here but not provably equal to a fresh `T` for tsc — the same reason `countRows` above passes a
  // concrete literal to `execute` rather than a type parameter. Cast at this single boundary.
  return result.rows as T[];
}

/**
 * Builds a `FiscalBackend` that delegates every method to `fake` except whichever ones
 * `overrides` supplies.
 *
 * **Deviation from the brief.** The brief built this shape with `{ ...fake, async
 * checkIntegrity(...) {...} }` — object-spreading a `FakeFiscalBackend` INSTANCE. That does not
 * work against the real class: `registerNode`/`recordSale`/`recordVoid`/`checkIntegrity`/
 * `pendingCount` are ordinary ES class methods, which live on `FakeFiscalBackend.prototype` and
 * are non-enumerable — object spread copies only an instance's OWN enumerable properties, so
 * `{...fake}` silently produces an object with NONE of the interface's methods on it, and calling
 * `backend.recordSale(...)` on the spread result throws "is not a function". Verified live in this
 * task's own red phase. Every method is bound explicitly here instead.
 */
function wrapBackend(fake: FakeFiscalBackend, overrides: Partial<FiscalBackend>): FiscalBackend {
  return {
    registerNode: (tx, node, params) => fake.registerNode(tx, node, params),
    recordSale: (tx, sale) => fake.recordSale(tx, sale),
    filedReceiptFor: (tx, saleId) => fake.filedReceiptFor(tx, saleId),
    recordVoid: (tx, saleId, reason) => fake.recordVoid(tx, saleId, reason),
    recordCorrection: (tx, sale, correction) => fake.recordCorrection(tx, sale, correction),
    recordSubstitution: (tx, sale, substitution) => fake.recordSubstitution(tx, sale, substitution),
    checkIntegrity: (tx, tenant, node) => fake.checkIntegrity(tx, tenant, node),
    pendingCount: (tenant, node) => fake.pendingCount(tenant, node),
    drain: (now) => fake.drain(now),
    reconcile: (tenant, period) => fake.reconcile(tenant, period),
    ...overrides,
  };
}

describe("formatInvoiceNumber", () => {
  it("joins the series code and the bare counter with a slash", () => {
    expect(formatInvoiceNumber("A", 1)).toBe("A/1");
  });

  it("does not pad or otherwise reformat the counter", () => {
    expect(formatInvoiceNumber("FA", 123)).toBe("FA/123");
  });
});

describe("recordSale — the happy path", () => {
  it("allocates the next number from the series and stamps it on the sale", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.invoiceNumber).toBe(1);
  });

  it("advances the series counter so the second sale gets the next number", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    await run(backend);
    const second = await run(backend);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, second.saleId));
    expect(row?.invoiceNumber).toBe(2);
  });

  it("inserts exactly one sale, its two lines and its one tender", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    expect(
      await suite.db.select().from(saleLines).where(eq(saleLines.saleId, saleId)),
    ).toHaveLength(2);
    expect(await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId))).toHaveLength(1);
    expect(await countRows("sales")).toBe(1);
  });

  it("keeps the tip off the sale's fiscal total and onto the tender", async () => {
    // total is the taxable amount and now the ONLY money column on the sale (design D1); the tip is
    // non-taxable, must never reach the fiscal record, and rides on the tender it was left with
    // (design D2). `amount_charged` is derived (total + tip = 16.31), never stored — migration 0012
    // dropped both the tip and amount_charged columns off `sales`. Fixture values are deliberately
    // different from each other and from their sum, so an implementation that copied the wrong field
    // cannot produce the expected rows by coincidence.
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.total).toBe("14.41");

    const [tender] = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    expect(tender?.amount).toBe("16.31");
    expect(tender?.tipAmount).toBe("1.90");
  });

  it("snapshots the locale list as at issuance", async () => {
    // A receipt reprinted a year later must read identically to the one the customer took, so
    // the list is copied onto the sale rather than read back from configuration at print time.
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.invoiceLocales).toEqual(["es-ES", "ca-ES"]);
  });

  it("returns the fiscal record reference the backend produced", async () => {
    // **Deviation from the brief.** `FiscalRecordRef` is `{ backend, recordId, state, issuedAt,
    // offsetMinutes, verificationUrl? }` — there is no `.hash`, `.sequence` or `.qrPayload` field
    // on the real type (`packages/fiscal/src/backend.ts`); those describe chaining/huella
    // concepts that belong to a regime's own module, never the generic interface. Assertions
    // below are against the fields that actually exist.
    const backend = new FakeFiscalBackend(suite.db);
    const { fiscal } = await run(backend);
    expect(fiscal.backend).toBe("fake");
    expect(fiscal.recordId).toMatch(/^fake-\d{8}$/);
    expect(fiscal.state).toBe("pending");
  });

  it("hands the backend the sale's bare invoice number and taxable total", async () => {
    // **Deviation from the brief.** The brief asserted `backend.calls.recordSale[0]?.invoiceNumber
    // === "A/1"` — a pre-formatted string — via a `.calls` spy that does not exist on the real
    // fake. The real `SaleForFiscalRecord.invoiceNumber` is a bare `number`, with `seriesCode`
    // carried alongside it SEPARATELY so a regime-specific backend composes its own identity
    // string however its regime requires (`formatInvoiceNumber`, exported from this package,
    // composes Veri*Factu's own "code/number" form — see
    // packages/fiscal-verifactu/src/write-path.e2e.test.ts for that assertion against the REAL
    // backend). Observed here via `FakeFiscalBackend`'s own `recordsFor` accessor rather than a
    // spy — the fake's one intentional test-only affordance for this.
    const backend = new FakeFiscalBackend(suite.db);
    await run(backend);
    const [record] = await backend.recordsFor(nodeId);
    expect(record?.invoiceNumber).toBe(1);
    expect(record?.total).toBe("14.41");
    expect(record?.kind).toBe("sale");
  });

  it("groups two lines at the same VAT rate into one breakdown entry", async () => {
    // Exercises `buildVatBreakdown`'s merge path (two lines contributing to the SAME rate's
    // base) rather than only ever having one line per rate. `FakeFiscalBackend` does not store
    // `vatBreakdown` at all, so this cannot assert on the merged entry's own shape — that is
    // exactly what packages/fiscal-verifactu/src/write-path.e2e.test.ts's real Desglose
    // assertions are for — but it does prove the grouping arithmetic runs without error and
    // still lands on the sale's own taxable total.
    const backend = new FakeFiscalBackend(suite.db);
    await run(backend, {
      total: "9.68",
      lines: [
        {
          lineNo: 1,
          descriptions: { "es-ES": "Café solo" },
          quantity: "1",
          unitPrice: "5.00",
          vatRate: "21.00",
          lineTotal: "5.00",
        },
        {
          lineNo: 2,
          descriptions: { "es-ES": "Té" },
          quantity: "1",
          unitPrice: "3.00",
          vatRate: "21.00",
          lineTotal: "3.00",
        },
      ],
      // sum(amount) 10.00 = total 9.68 + tip 0.32.
      settlement: {
        kind: "immediate",
        tenders: [{ method: "card", amount: "10.00", tipAmount: "0.32", settledAt: BASE }],
      },
    });
    const [record] = await backend.recordsFor(nodeId);
    expect(record?.total).toBe("9.68");
  });

  it("stores the filed vatBreakdown on sales, equal to what the backend filed", async () => {
    // The single-source guarantee (spec 8a): the breakdown written to `sales.vat_breakdown` is the
    // SAME variable filed into the hash-chained registro — never a second, recomputed one. Proven by
    // filing a mixed-rate sale with a caller-supplied DIFFERENCE-METHOD breakdown whose 21% cuota
    // (1.74) is deliberately NOT `percentOf(base, rate)` (8.26 * 21% = 1.73), then reading BOTH the
    // stored `sales.vat_breakdown` and the filed desglose (`FakeFiscalBackend.filedReceiptFor`,
    // inverted from `fake_fiscal_records`) back and asserting they carry the same per-rate base and
    // tax. Were the sale insert to recompute from `lines` (or file any second breakdown), the stored
    // 21% tax would read 1.73 and this would fail — which is exactly what the mutation in this task's
    // report exercises. Reconciles with `total` (8.26 + 1.74 + 5.00 + 0.50 = 15.50), so it passes
    // `recordSale`'s own `sale.total_mismatch` precondition; `deferred` settlement keeps the sale off
    // the tender-coverage identity so the breakdown is the only thing under test.
    const backend = new FakeFiscalBackend(suite.db);
    const filedBreakdown: VatBreakdownLine[] = [
      { rate: decimal("21.00"), base: decimal("8.26"), tax: decimal("1.74") },
      { rate: decimal("10.00"), base: decimal("5.00"), tax: decimal("0.50") },
    ];
    const { saleId } = await run(backend, {
      total: "15.50",
      vatBreakdown: filedBreakdown,
      lines: [
        {
          lineNo: 1,
          descriptions: { "es-ES": "Café solo" },
          quantity: "1",
          unitPrice: "8.26",
          vatRate: "21.00",
          lineTotal: "8.26",
        },
        {
          lineNo: 2,
          descriptions: { "es-ES": "Agua" },
          quantity: "1",
          unitPrice: "5.00",
          vatRate: "10.00",
          lineTotal: "5.00",
        },
      ],
      settlement: { kind: "deferred" },
    });

    const sortByRate = <T extends { rate: string }>(g: readonly T[]): T[] =>
      [...g].sort((a, b) => a.rate.localeCompare(b.rate));

    const [saleRow] = await suite.db
      .select({ vb: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.id, saleId));
    const filed = await suite.db.transaction((tx) => backend.filedReceiptFor(tx, saleId));

    expect(sortByRate(saleRow!.vb)).toEqual(sortByRate(filed!.vatBreakdown));
    // And it is the FILED difference-method cuota, not `percentOf(base, rate)`: 1.74, not 1.73.
    expect(saleRow!.vb.find((g) => g.rate === "21.00")?.tax).toBe("1.74");
  });
});

describe("recordSale — operator attribution", () => {
  // Attribution only (design §7). A uuid-shaped value the till would supply from its open session;
  // recordSale writes it verbatim to `sales.operator_id`, with no FK and no authorize — ringing a
  // sale is ungated in this slice. Deliberately distinct from tenant/till/node/series so a copy of
  // the wrong column could not produce it by coincidence.
  const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";

  it("stamps input.operatorId onto sales.operator_id when supplied", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db), { operatorId: OPERATOR_ID });
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.operatorId).toBe(OPERATOR_ID);
  });

  it("leaves sales.operator_id NULL when no operator is supplied", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.operatorId).toBeNull();
  });
});

describe("recordSale — the order of operations", () => {
  it("verifies the chain before allocating a number", async () => {
    const observed: number[] = [];
    const fake = new FakeFiscalBackend(suite.db);
    const backend = wrapBackend(fake, {
      async checkIntegrity(tx, tenant, node) {
        // Read the counter from inside the verification call. If allocation had already run,
        // next_number would read 2 here. Observing only "both happened" would not discriminate
        // which came first — this is the one observation that does.
        const [row] = await tx
          .select({ n: invoiceSeries.nextNumber })
          .from(invoiceSeries)
          .where(eq(invoiceSeries.id, seriesId));
        observed.push(row?.n ?? -1);
        return fake.checkIntegrity(tx, tenant, node);
      },
    });
    await run(backend);
    expect(observed).toEqual([1]);
  });

  it("reads the clock exactly once for the whole transaction", async () => {
    // Reading it twice — once for the sale's own issued_at, once again for whatever the module
    // stamps its own record with — lets a second boundary fall between them, and the sale and its
    // fiscal record then carry different timestamps for one event. The drifting clock makes that
    // divergence observable instead of theoretical.
    //
    // **Deviation from the brief.** The brief compared against `backend.calls.recordSale[0]
    // ?.issuedAt` — the non-existent spy again. `FiscalRecordRef.issuedAt` is a real field on the
    // real interface, and `FakeFiscalBackend` echoes back exactly the `issuedAt` it was handed, so
    // the backend's OWN return value is the observation point instead.
    let ticks = 0;
    const drifting: TrustedClock = fixedClock(() => {
      ticks += 1;
      return {
        instant: new Date(BASE.getTime() + ticks * 1000),
        offsetMinutes: 60,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    });
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId, fiscal } = await run(backend, { clock: drifting });
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(ticks).toBe(1);
    expect(new Date(row!.issuedAt).getTime()).toBe(fiscal.issuedAt.getTime());
  });
});

describe("recordSale — no fiscal condition blocks a sale", () => {
  it("completes the sale when chain verification fails", async () => {
    // AEAT: «la facturación por este motivo NUNCA debe interrumpirse». A test asserting the sale
    // is BLOCKED here would enforce the exact opposite of the requirement, so this assertion is
    // the one that must not be inverted.
    //
    // **Deviation from the brief.** `backend.chainVerification = { ok: false, error: new
    // AppError(...) }` is not a real affordance on `FakeFiscalBackend` — the actual test-only
    // control is `breakIntegrity(nodeId, issue)`, taking a plain `IntegrityIssue` (`{ code,
    // params, recordId? }`), never an `AppError` instance (an `IntegrityReport` is persisted and
    // displayed, and an `Error` does not survive JSON — `packages/fiscal/src/backend.ts`'s own
    // doc comment on `IntegrityIssue`).
    const backend = new FakeFiscalBackend(suite.db);
    const issue: IntegrityIssue = { code: "chain.verification_failed", params: { sequence: 4 } };
    backend.breakIntegrity(nodeId, issue);
    const { saleId } = await run(backend);
    expect(await countRows("sales")).toBe(1);
    expect(await backend.recordsFor(nodeId)).toHaveLength(1);
    expect(saleId).toBeTruthy();
  });

  it("completes the sale when the clock reports degraded confidence", async () => {
    const degraded: TrustedClock = fixedClock(() => ({
      instant: BASE,
      offsetMinutes: 60,
      confident: false,
      confidence: "degraded",
      anchorAgeSeconds: 999,
    }));
    await run(new FakeFiscalBackend(suite.db), { clock: degraded });
    expect(await countRows("sales")).toBe(1);
  });

  // The brief additionally asserted `backend.calls.recordSale[0]?.clockConfident === false`. There
  // is no such field to assert on: the real `SaleForFiscalRecord` (`packages/fiscal/src/backend.ts`)
  // carries no `clockConfident` at all — only `issuedAt`/`offsetMinutes`. A degraded reading's
  // `TrustedReading.warning` (an `AppError`, never thrown) is how confidence would be surfaced,
  // and recording that warning as an incident is out of this task's seven steps. Dropped rather
  // than kept as a test of a field that does not exist.
});

describe("recordSale — the fiscal record is created when ALL tenders settle", () => {
  it("writes nothing when a tender has not settled", async () => {
    // A card declined mid-tender must leave the order open and retryable with NOTHING chained.
    // The alternative chains records for sales that never happened, correctable only by issuing
    // a rectifying record later.
    await expect(
      run(new FakeFiscalBackend(suite.db), {
        settlement: {
          kind: "immediate",
          tenders: [
            { method: "cash", amount: "5.00", tipAmount: "0.00", settledAt: BASE },
            { method: "card", amount: "11.31", tipAmount: "1.90", settledAt: null },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "sale.tender_unsettled" });

    // Nothing survives — but now BY ATOMICITY, not by a pre-check. `recordSale` has already written
    // the sale and its lines by the time it calls `settleSale`; the throw rolls the whole
    // transaction back, allocated invoice number included, so a declined card still leaves nothing
    // chained. This is the assertion that pins that guarantee under the new order of operations.
    expect(await countRows("sales")).toBe(0);
    expect(await countRows("sale_lines")).toBe(0);
    expect(await countRows("tenders")).toBe(0);
  });

  it("writes nothing when the settled tenders do not cover the amount due", async () => {
    await expect(
      run(new FakeFiscalBackend(suite.db), {
        settlement: {
          kind: "immediate",
          tenders: [{ method: "cash", amount: "5.00", tipAmount: "0.00", settledAt: BASE }],
        },
      }),
    ).rejects.toMatchObject({ code: "sale.tender_shortfall" });
    expect(await countRows("sales")).toBe(0);
  });

  it("chains nothing when a tender has not settled", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    await expect(
      run(backend, {
        settlement: {
          kind: "immediate",
          tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: null }],
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await backend.recordsFor(nodeId)).toHaveLength(0);
  });

  it("records exactly one chained sale when the declined tender is retried", async () => {
    // The retry path end to end: decline, then settle. Two calls, one sale.
    const backend = new FakeFiscalBackend(suite.db);
    await expect(
      run(backend, {
        settlement: {
          kind: "immediate",
          tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: null }],
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
    await run(backend);
    expect(await countRows("sales")).toBe(1);
    expect(await backend.recordsFor(nodeId)).toHaveLength(1);
  });

  it("accepts a split tender that settles across several payments", async () => {
    await run(new FakeFiscalBackend(suite.db), {
      // sum(amount) 6.31 + 10.00 = 16.31 = total 14.41 + tip 1.90.
      settlement: {
        kind: "immediate",
        tenders: [
          { method: "cash", amount: "6.31", tipAmount: "0.00", settledAt: BASE },
          { method: "card", amount: "10.00", tipAmount: "1.90", settledAt: BASE },
        ],
      },
    });
    expect(await countRows("tenders")).toBe(2);
    expect(await countRows("sales")).toBe(1);
  });
});

describe("recordSale — atomicity", () => {
  it("leaves no sale, no line and no tender when the fiscal step fails", async () => {
    // The worst outcome this design has is a partial write here: an invoice that exists
    // commercially and not fiscally, with a customer holding a receipt for a record that was
    // never legally recorded. Nothing may survive.
    const fake = new FakeFiscalBackend(suite.db);
    const exploding = wrapBackend(fake, {
      recordSale: () => {
        throw new Error("simulated fiscal backend outage");
      },
    });
    await expect(run(exploding)).rejects.toThrow("simulated fiscal backend outage");

    expect(await countRows("sales")).toBe(0);
    expect(await countRows("sale_lines")).toBe(0);
    expect(await countRows("tenders")).toBe(0);
  });
});

describe("recordSale — settlement modes", () => {
  it("deferred records the sale and fiscal record with no tender and no settlement", async () => {
    // Invoice-first: the bill is printed and handed over BEFORE payment. The sale and its fiscal
    // record exist; there is no tender and no `sale_settlements` row — a legitimate unsettled
    // steady state, not a half-written sale (design §3). Issuing the invoice is the fiscal event;
    // payment is not, so the record is chained regardless of settlement.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await run(backend, { settlement: { kind: "deferred" } });

    expect(await countRows("sales")).toBe(1);
    expect(
      await suite.db.select().from(saleLines).where(eq(saleLines.saleId, saleId)),
    ).toHaveLength(2);
    expect(await countRows("tenders")).toBe(0);
    expect(await countRows("sale_settlements")).toBe(0);
    expect(await backend.recordsFor(nodeId)).toHaveLength(1);
  });

  it("immediate and deferred+settleSale produce identical tenders and settlement rows", async () => {
    // D6, made observable: `immediate` runs the SAME `settleSale` code in the same transaction, so
    // a sale settled inline must leave byte-for-byte identical `tenders` and `sale_settlements`
    // rows to the identical sale recorded `deferred` and settled later by a separate `settleSale`
    // (modulo the ids and the sale/tenant they hang off). If the two paths ever drift, this fails —
    // which is the whole reason `recordSale` calls `settleSale` rather than re-implementing it.
    const later = new Date(BASE.getTime() + 5 * 60_000);
    const tendersInput: RecordSaleTender[] = [
      { method: "cash", amount: "6.31", tipAmount: "0.00", settledAt: BASE },
      { method: "card", amount: "10.00", tipAmount: "1.90", settledAt: later },
    ];
    const backend = new FakeFiscalBackend(suite.db);

    // Path A — immediate, on the beforeEach tenant.
    const a = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await backend.registerNode(tx, nodeId, { tenantId });
      return recordSale(
        tx,
        backend,
        input({ settlement: { kind: "immediate", tenders: tendersInput } }),
      );
    });

    // Path B — a second, independent tenant: deferred record, then a SEPARATE settleSale.
    const other = await seedTenant(suite.db);
    const b = await withTenant(suite.db, other.tenantId, async (tx) => {
      await asAppUser(tx);
      await backend.registerNode(tx, other.nodeId, { tenantId: other.tenantId });
      return recordSale(
        tx,
        backend,
        input({
          tenantId: other.tenantId,
          tillId: other.tillId,
          nodeId: other.nodeId,
          seriesId: other.seriesId,
          settlement: { kind: "deferred" },
        }),
      );
    });
    await withTenant(suite.db, other.tenantId, async (tx) => {
      await asAppUser(tx);
      await settleSale(tx, { tenantId: other.tenantId, saleId: b.saleId, tenders: tendersInput });
    });

    // Tenders, modulo id/tenant_id/sale_id, sorted for a position-independent compare.
    const normalize = (rows: (typeof tenders.$inferSelect)[]) =>
      rows
        .map((r) => ({
          method: r.method,
          amount: r.amount,
          tipAmount: r.tipAmount,
          settledAt: new Date(r.settledAt).getTime(),
        }))
        .sort((x, y) => x.amount.localeCompare(y.amount));
    const aTenders = normalize(
      await suite.db.select().from(tenders).where(eq(tenders.saleId, a.saleId)),
    );
    const bTenders = normalize(
      await suite.db.select().from(tenders).where(eq(tenders.saleId, b.saleId)),
    );
    expect(aTenders).toHaveLength(2);
    expect(aTenders).toEqual(bTenders);

    // Settlements, modulo id/tenant_id/sale_id. Both stamp the LATEST tender's instant (decision 5),
    // which is `later`, NOT either sale's issuance instant (BASE) — proving the max-tender path.
    const [aSettle] = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, a.saleId));
    const [bSettle] = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, b.saleId));
    expect(aSettle).toBeDefined();
    expect(bSettle).toBeDefined();
    expect(new Date(aSettle!.settledAt).getTime()).toBe(new Date(bSettle!.settledAt).getTime());
    expect(new Date(aSettle!.settledAt).getTime()).toBe(later.getTime());
  });

  it("immediate settles a fully-comped €0 sale with no tenders", async () => {
    // The tenderless immediate path, driven end to end through `recordSale` rather than only through
    // a direct `settleSale` (settle-sale.test.ts already covers the latter). A fully-comped sale is
    // total 0.00 with NO tender — `tenders_amount_ck` forbids a €0 tender — so immediate mode hands
    // `settleSale` an EMPTY tender list; it must record the settlement (stamped at its OWN instant,
    // `new Date()`, like `record-void.ts`) rather than crash on an empty `reduce`/`insert().values([])`.
    // The coverage identity `0 = 0 + 0` holds, so the settlement is written and the sale is still
    // chained.
    const backend = new FakeFiscalBackend(suite.db);
    // Window the run so the stamped instant is pinned to the actual settlement moment. `issued_at` is
    // the fixed `steadyClock` reading (BASE, March), so a settlement stamped `new Date()` (now) is
    // demonstrably NOT a copy of issuance.
    const before = new Date();
    const { saleId } = await run(backend, {
      total: "0.00",
      lines: [
        {
          lineNo: 1,
          descriptions: { "es-ES": "Free item", "ca-ES": "Free item" },
          quantity: "1",
          unitPrice: "0.00",
          vatRate: "0.00",
          lineTotal: "0.00",
        },
      ],
      settlement: { kind: "immediate", tenders: [] },
    });
    const after = new Date();

    expect(await countRows("sales")).toBe(1);
    expect(await countRows("tenders")).toBe(0);
    expect(await countRows("sale_settlements")).toBe(1);
    expect(await backend.recordsFor(nodeId)).toHaveLength(1);
    // Stamped at the settlement's own instant — there is no tender to time it by, and settlement is
    // not a fiscal event.
    const [settled] = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    const settledAt = new Date(settled!.settledAt).getTime();
    // Within the run window …
    expect(settledAt).toBeGreaterThanOrEqual(before.getTime());
    expect(settledAt).toBeLessThanOrEqual(after.getTime());
    // … and strictly LATER than the fixed issued_at (BASE), proving it is the settlement instant, not
    // a backdated copy of the print instant.
    expect(settledAt).toBeGreaterThan(new Date(row!.issuedAt).getTime());
  });
});

describe("recordSale — numbering", () => {
  it("never reissues a number that reached a committed sale", async () => {
    // The property that actually matters. Gaps are permitted; reuse is not.
    //
    // `.rejects.toThrow`/`.rejects.toMatchObject` do not see through Drizzle's own
    // `DrizzleQueryError` wrapper (its `.code` is undefined; the real SQLSTATE lives on
    // `.cause.code`), so the SQLSTATE is read via `captureError`/`pgErrorCode` instead, per this
    // task's own governing context.
    await run(new FakeFiscalBackend(suite.db));
    const error = await captureError(() =>
      withTenant(suite.db, tenantId, async (tx) => {
        await asAppUser(tx);
        await tx.insert(sales).values({
          tenantId,
          tillId,
          nodeId,
          seriesId,
          invoiceNumber: 1,
          issuedAt: BASE.toISOString(),
          issuedOffsetMinutes: 60,
          total: "1.00",
          // The filed per-rate desglose (migration 0031); `[]` — supplied so the insert reaches the
          // duplicate-invoice-number unique violation (23505) under test rather than tripping the
          // column's own NOT NULL (23502) first.
          vatBreakdown: [],
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          fiscalBackend: "fake",
          fiscalState: "recorded",
        });
      }),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("returns the number to the pool when the transaction rolls back", async () => {
    // Documented so the behaviour is deliberate rather than discovered. Under a `next_number`
    // COLUMN the allocating UPDATE is transactional, so a rollback un-allocates. That is safe —
    // the number never reached a committed sale, so reissuing it is not reuse.
    const fake = new FakeFiscalBackend(suite.db);
    const exploding = wrapBackend(fake, {
      recordSale: () => {
        throw new Error("simulated fiscal backend outage");
      },
    });
    await expect(run(exploding)).rejects.toThrow("simulated fiscal backend outage");
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.invoiceNumber).toBe(1);
  });
});

describe("recordSale — series validation", () => {
  it("rejects a series that does not exist", async () => {
    await expect(
      run(new FakeFiscalBackend(suite.db), {
        seriesId: brandSeriesId("00000000-0000-4000-8000-000000000000"),
      }),
    ).rejects.toMatchObject({ code: "sale.series_not_found" });
  });

  it("rejects a series belonging to another node", async () => {
    // A node may own N series, but a series belongs to exactly one node. Allocating from another
    // node's series would have two chains issuing from one counter, which no constraint
    // downstream can detect. `seedTenant({ tenantId })` mints a SECOND node under the same tenant,
    // so `other.seriesId` is real and same-tenant but owned by a different node than the one under
    // test — the series↔node guard must reject it.
    const other = await seedTenant(suite.db, { tenantId });
    await expect(
      run(new FakeFiscalBackend(suite.db), { seriesId: other.seriesId }),
    ).rejects.toMatchObject({ code: "sale.series_wrong_node" });
  });

  it("rejects a rectificative series: an ordinary sale must not draw a corrective number", async () => {
    // The other direction of the §5 purpose guard. A corrective series (`purpose='rectificative'`)
    // is reserved for rectificativas (RD 1619/2012 art. 6.1.a); an ordinary sale drawing from it
    // would consume a corrective number and break the mandated separation.
    const rectSeriesId = await seedRectificativeSeries(suite.db, tenantId, nodeId);
    await expect(
      run(new FakeFiscalBackend(suite.db), { seriesId: rectSeriesId }),
    ).rejects.toMatchObject({
      code: "sale.series_wrong_purpose",
      params: { seriesId: rectSeriesId, expected: "standard", actual: "rectificative" },
    });
  });
});

describe("recordSale — working order linkage", () => {
  // The parked working order this sale is FILED from is the sale-idempotency key
  // (`sales_working_order_id_key`, migration for sub-project 7b): recordSale writes
  // `input.workingOrderId` onto `sales.working_order_id` when the till supplies one, and leaves it
  // NULL for a walk-up sale rung with no draft. The composite FK
  // `(tenant_id, working_order_id) → working_orders(tenant_id, id)` is enforced even on PGlite (its
  // default connection is a superuser, but constraints still hold), so the "supplied" case needs a
  // REAL working_orders row as the FK target — a fabricated id would FK-violate, which is why the
  // seed fixtures no longer mint one.
  async function seedOpenWorkingOrder(): Promise<WorkingOrderId> {
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`insert into working_orders (tenant_id, till_id, order_number)
          values (${tenantId}, ${tillId}, 1) returning id`,
    );
    return brandWorkingOrderId(rows[0]!.id);
  }

  it("writes working_order_id onto the sale when supplied", async () => {
    const woId = await seedOpenWorkingOrder();
    const { saleId } = await run(new FakeFiscalBackend(suite.db), { workingOrderId: woId });
    const [row] = await suite.db
      .select({ wo: sales.workingOrderId })
      .from(sales)
      .where(eq(sales.id, saleId));
    expect(row!.wo).toBe(woId);
  });

  it("leaves working_order_id NULL when omitted (an ordinary walk-up sale)", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    const [row] = await suite.db
      .select({ wo: sales.workingOrderId })
      .from(sales)
      .where(eq(sales.id, saleId));
    expect(row!.wo).toBeNull();
  });
});

describe("recordSale — caller-supplied vatBreakdown and line category", () => {
  /**
   * Captures the `vatBreakdown` that actually reaches `FiscalBackend.recordSale`.
   *
   * **Deviation from the brief.** The brief asserts on `backend.lastSale!.vatBreakdown`, but the
   * real `FakeFiscalBackend` (`@waitron/fiscal/src/testing/fake-backend.js`) has no `lastSale`
   * affordance and does not persist `vatBreakdown` at all — its `fake_fiscal_records` table carries
   * no such column, and the suite's existing "groups two lines…" test already records that the fake
   * cannot assert on the breakdown's shape. Observed instead through this file's own `wrapBackend`
   * override, capturing the `SaleForFiscalRecord` argument as it passes through — the same
   * method-override mechanism the "order of operations" tests already use.
   */
  function captureBreakdown(): {
    backend: FiscalBackend;
    captured: () => readonly VatBreakdownLine[] | undefined;
  } {
    const fake = new FakeFiscalBackend(suite.db);
    let seen: readonly VatBreakdownLine[] | undefined;
    const backend = wrapBackend(fake, {
      recordSale: (tx, sale) => {
        seen = sale.vatBreakdown;
        return fake.recordSale(tx, sale);
      },
    });
    return { backend, captured: () => seen };
  }

  it("passes a supplied vatBreakdown to the backend verbatim", async () => {
    // The whole point of the catalogue slice: a caller (catalogue pricing's gross-inclusive
    // difference method) hands recordSale the desglose it computed, and recordSale files it as-is
    // rather than re-deriving one from `lines`. The supplied entry (base 7.25 + tax 0.72 = 7.97) is
    // deliberately NOT what `buildVatBreakdown` would derive from the single 7.25 line at 10%
    // (which would compute tax 0.73 = percentOf(7.25, 10.00)), so a code path that ignored the
    // supplied value and derived its own could not produce this by coincidence.
    const breakdown: VatBreakdownLine[] = [
      { rate: decimal("10.00"), base: decimal("7.25"), tax: decimal("0.72") },
    ];
    const { backend, captured } = captureBreakdown();
    await run(backend, {
      total: "7.97",
      vatBreakdown: breakdown,
      lines: [
        {
          lineNo: 1,
          descriptions: { en: "x" },
          quantity: "0.320",
          unitPrice: "22.64",
          vatRate: "10.00",
          lineTotal: "7.25",
          category: "Food",
        },
      ],
      // total 7.97 ≠ the fixture's default €14.41, so its default tenders would fail settleSale's
      // coverage identity. Deferred keeps this test on the fiscal-record path it is about.
      settlement: { kind: "deferred" },
    });
    expect(captured()).toEqual(breakdown); // NOT buildVatBreakdown's derivation
  });

  it("derives the breakdown when none is supplied (legacy path unchanged)", async () => {
    // The additive guarantee: with no `vatBreakdown`, recordSale runs `buildVatBreakdown(lines)`
    // exactly as before — one 10.00 line at 10% derives base 10.00, tax 1.00.
    const { backend, captured } = captureBreakdown();
    await run(backend, {
      total: "11.00",
      lines: [
        {
          lineNo: 1,
          descriptions: { en: "x" },
          quantity: "1",
          unitPrice: "10.00",
          vatRate: "10.00",
          lineTotal: "10.00",
        },
      ],
      settlement: { kind: "deferred" },
    });
    expect(captured()).toEqual([
      { rate: decimal("10.00"), base: decimal("10.00"), tax: decimal("1.00") },
    ]);
  });

  it("throws sale.total_mismatch when a supplied breakdown disagrees with total", async () => {
    // The defence for an unrepairable record: a supplied desglose summing to 7.97 filed against a
    // declared total of 8.00 would chain a self-inconsistent record. Compared by value, so it fires
    // on the magnitude, not on scale. Refused at the very top of recordSale, before anything is
    // written.
    const breakdown: VatBreakdownLine[] = [
      { rate: decimal("10.00"), base: decimal("7.25"), tax: decimal("0.72") }, // sums to 7.97
    ];
    await expect(
      run(new FakeFiscalBackend(suite.db), {
        total: "8.00",
        vatBreakdown: breakdown,
        lines: [
          {
            lineNo: 1,
            descriptions: { en: "x" },
            quantity: "1",
            unitPrice: "7.25",
            vatRate: "10.00",
            lineTotal: "7.25",
          },
        ],
        settlement: { kind: "deferred" },
      }),
    ).rejects.toMatchObject({
      code: "sale.total_mismatch",
      params: { declaredTotal: "8.00", breakdownTotal: "7.97" },
    });
    // Nothing written — the throw precedes every insert.
    expect(await countRows("sales")).toBe(0);
  });

  it("snapshots the line category onto sale_lines", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      total: "1.50",
      lines: [
        {
          lineNo: 1,
          descriptions: { en: "Water" },
          quantity: "1",
          unitPrice: "1.50",
          vatRate: "21.00",
          lineTotal: "1.50",
          category: "Drinks",
        },
      ],
      settlement: { kind: "deferred" },
    });
    const [row] = await rows<{ category: string | null }>(
      sql`select category from sale_lines where sale_id = ${saleId}`,
    );
    expect(row!.category).toBe("Drinks");
  });

  it("leaves sale_lines.category NULL when a line omits it (additive, no behaviour change)", async () => {
    // The other branch of `line.category ?? null`: an existing caller that never sets `category`
    // inserts NULL, exactly as before this field existed.
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      total: "1.50",
      lines: [
        {
          lineNo: 1,
          descriptions: { en: "Water" },
          quantity: "1",
          unitPrice: "1.50",
          vatRate: "21.00",
          lineTotal: "1.50",
        },
      ],
      settlement: { kind: "deferred" },
    });
    const [row] = await rows<{ category: string | null }>(
      sql`select category from sale_lines where sale_id = ${saleId}`,
    );
    expect(row!.category).toBeNull();
  });
});
