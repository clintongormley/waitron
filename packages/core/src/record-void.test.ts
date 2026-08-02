import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { SaleId, SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
// See record-sale.test.ts's identical deviation note: there is no `@waitron/fiscal/testing`
// subpath (no `exports` map entry, no such folder). `packages/fiscal/src/index.ts`'s own closing
// comment states the real path: "packages/core imports it from
// '@waitron/fiscal/src/testing/fake-backend.js' in test files only".
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  incidents,
  invoiceSeries,
  pgErrorCode,
  saleVoids,
  sales,
  withTenant,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { seedTenant } from "../test/fixtures.js";

let tenantId: TenantId;
let tillId: TillId;
let seriesId: SeriesId;
let workingOrderId: WorkingOrderId;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS],
  // FakeFiscalBackend.recordSale/recordVoid/registerTill/checkIntegrity read and write
  // fake_till_registrations/fake_fiscal_records, and nothing else creates those tables — see
  // record-sale.test.ts's identical setup for the same requirement.
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tenantId, tillId, seriesId, workingOrderId } = await seedTenant(suite.db));
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** Mirrors record-sale.test.ts's identical helper: the real `TrustedClock` interface also
 * requires `anchor`/`currentAnchor`, which neither `recordSale` nor `recordVoid` ever calls. */
function fixedClock(now: TrustedClock["now"]): TrustedClock {
  return {
    now,
    anchor: () => {
      throw new Error("fixedClock: anchor() is not used by recordSale/recordVoid");
    },
    currentAnchor: () => null,
  };
}

const steadyClock: TrustedClock = fixedClock(() => ({
  instant: BASE,
  offsetMinutes: 60,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
}));

function saleInput(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    tenantId,
    tillId,
    seriesId,
    workingOrderId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Café solo" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        descriptions: { "es-ES": "Agua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    // Immediate settlement with the tip on the tender (design D2): sum(amount) 16.31 = total 14.41 +
    // tip 1.90, the coverage identity settleSale enforces inside recordSale's immediate half.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE }],
    },
    fiscalBackend: "fake",
    clock: steadyClock,
    ...overrides,
  };
}

/**
 * Runs the write path exactly as the application will, and registers the till first —
 * `FakeFiscalBackend` refuses `recordSale`/`recordVoid` for a till with no prior `registerTill`
 * (`fiscal.till_not_registered`), matching a real backend. Mirrors record-sale.test.ts's own `run`.
 */
async function sell(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    await backend.registerTill(tx, tillId, { tenantId });
    return recordSale(tx, backend, saleInput(overrides));
  });
}

async function voidSale(backend: FiscalBackend, saleId: SaleId, reason = "Wrong table") {
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordVoid(tx, backend, saleId, reason);
  });
}

async function countRows(table: string): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)} where tenant_id = ${tenantId}`,
  );
  return result.rows[0]!.n;
}

/**
 * Builds a `FiscalBackend` that delegates every method to `fake` except whichever ones
 * `overrides` supplies. Mirrors record-sale.test.ts's identical `wrapBackend` — object-spreading a
 * `FakeFiscalBackend` INSTANCE does not work (its methods live on the prototype, non-enumerable),
 * so every method is bound explicitly instead.
 */
function wrapBackend(fake: FakeFiscalBackend, overrides: Partial<FiscalBackend>): FiscalBackend {
  return {
    registerTill: (tx, till, params) => fake.registerTill(tx, till, params),
    recordSale: (tx, sale) => fake.recordSale(tx, sale),
    recordVoid: (tx, id, reason) => fake.recordVoid(tx, id, reason),
    recordCorrection: (tx, sale, correction) => fake.recordCorrection(tx, sale, correction),
    checkIntegrity: (tx, tenant, till) => fake.checkIntegrity(tx, tenant, till),
    pendingCount: (tenant, till) => fake.pendingCount(tenant, till),
    drain: (now) => fake.drain(now),
    reconcile: (tenant, period) => fake.reconcile(tenant, period),
    ...overrides,
  };
}

describe("recordVoid — nothing is ever edited", () => {
  it("leaves the original sale row byte for byte unchanged", async () => {
    // The whole point of the design. Comparing the full row rather than named columns is
    // deliberate: a named-column assertion cannot notice an implementation that quietly moved
    // fiscal_state, which is exactly the edit most likely to be attempted.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const [before] = await suite.db.select().from(sales).where(eq(sales.id, saleId));

    await voidSale(backend, saleId);

    const [after] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(after).toEqual(before);
  });

  it("appends a sale_voids row carrying the reason verbatim", async () => {
    // packages/core is English throughout, including test fixture text (english-only.test.ts
    // scans string literals too, not just identifiers) — the reason itself is free text a member
    // of staff enters and may be in any locale, but this suite's own sample data stays English.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId, "Customer returned the order");

    const [row] = await suite.db.select().from(saleVoids).where(eq(saleVoids.saleId, saleId));
    expect(row?.reason).toBe("Customer returned the order");
    // The roles seam: present, nullable, unread until sub-project 5.
    expect(row?.voidedBy).toBeNull();
  });

  it("asks the module for a new record rather than for an edit", async () => {
    // **Deviation from the brief.** The brief asserted `backend.calls.recordVoid` — a spy field
    // that does not exist on the real `FakeFiscalBackend` (see record-sale.test.ts's identical
    // corrections for `.calls`). The real fake's own test-only affordance is `recordsFor(tillId)`,
    // which returns every record it has appended in chain order — a sale, THEN a void, never an
    // edit of the first entry.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);

    const records = await backend.recordsFor(tillId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
    expect(records[1]?.saleId).toBe(saleId);
  });
});

describe("recordVoid — numbering", () => {
  it("allocates no invoice number", async () => {
    // The anulación carries the ANNULLED invoice's identity (IDFacturaAnulada), not an identity of
    // its own. Allocating here would burn a number for a record with nowhere to put it, leaving a
    // permanent series gap per void.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const [before] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));

    await voidSale(backend, saleId);

    const [after] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));
    expect(after?.n).toBe(before?.n);
  });

  it("permanently burns the annulled invoice number", async () => {
    // Findings §7, via spec §7: after an anulación, resending an alta under the same number STILL
    // returns AEAT error 3000 — record identity is IDEmisorFactura + NumSerieFactura +
    // FechaExpedicionFactura, and annulling does not free the triple. It is the same rule that
    // forbids reusing a number for a test invoice.
    //
    // Enforced locally because the alternative is discovering it as a rejected record and a
    // halted chain, hours later and in production.
    //
    // **Deviation from the brief.** The brief asserted `.rejects.toMatchObject({ code: "23505" })`
    // directly on the raw insert. `.rejects.toMatchObject` does not see through Drizzle's own
    // `DrizzleQueryError` wrapper (its `.code` is undefined; the real SQLSTATE lives on
    // `.cause.code`) — record-sale.test.ts's own "never reissues a number" test already makes this
    // exact correction for the identical shape of assertion, per this task's own governing
    // context. The brief's raw INSERT also omitted `issuedOffsetMinutes`, a NOT NULL column.
    const backend = new FakeFiscalBackend(suite.db);
    const first = await sell(backend);
    await voidSale(backend, first.saleId);

    const second = await sell(backend);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, second.saleId));
    expect(row?.invoiceNumber).toBe(2);

    const error = await captureError(() =>
      withTenant(suite.db, tenantId, async (tx) => {
        await asAppUser(tx);
        await tx.insert(sales).values({
          tenantId,
          tillId,
          seriesId,
          invoiceNumber: 1,
          issuedAt: BASE.toISOString(),
          issuedOffsetMinutes: 60,
          total: "1.00",
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          fiscalBackend: "fake",
          fiscalState: "recorded",
        });
      }),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });
});

describe("recordVoid — guards", () => {
  it("refuses to void a sale that does not exist", async () => {
    // An operational failure, not a fiscal one: there is nothing here to void.
    await expect(
      voidSale(new FakeFiscalBackend(suite.db), "00000000-0000-4000-8000-000000000000" as SaleId),
    ).rejects.toMatchObject({ code: "sale.not_found" });
  });

  it("refuses to void the same sale twice", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);
    await expect(voidSale(backend, saleId)).rejects.toMatchObject({
      code: "sale.already_voided",
    });
  });

  it("chains nothing on a rejected second void", async () => {
    // The unique violation must fire BEFORE the module builds and chains an anulación, or a
    // rejected void still consumes chain work and the rollback has to unwind it. Ordering is what
    // this asserts, not just the outcome.
    //
    // **Deviation from the brief.** `backend.calls.recordVoid` again does not exist; the real
    // fake's own record ledger (`recordsFor`) is the observation point instead — it must still
    // hold exactly one sale and one void, not two voids, after the second call is rejected.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);
    await expect(voidSale(backend, saleId)).rejects.toBeInstanceOf(AppError);

    const records = await backend.recordsFor(tillId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
    expect(await countRows("sale_voids")).toBe(1);
  });
});

describe("recordVoid — error propagation", () => {
  it("propagates a database error that is not a unique violation, untranslated", async () => {
    // The insert's OTHER failure path: any reason `sale_voids` could reject BESIDES the unique
    // constraint (a future added constraint, a transport failure) must reach the caller as-is
    // rather than being misreported as `sale.already_voided` — mirrors
    // `packages/fiscal-verifactu/src/chain.test.ts`'s identical "does not retry an error that is
    // not a chain collision" test for the analogous branch in `appendToChain`.
    //
    // A hand-built `Transaction`-shaped stub, not the real PGlite one: there is no schema-level
    // constraint on `sale_voids` today other than the unique one this suite already exercises, so
    // provoking a genuinely different SQLSTATE from the real database would mean inventing one —
    // this stub instead asserts on `recordVoid`'s own catch/rethrow logic directly, the same way
    // `chain.test.ts`'s stub asserts on `appendToChain`'s.
    const fakeTx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ tenantId, tillId }]),
        }),
      }),
      insert: () => ({
        values: () => Promise.reject(Object.assign(new Error("disk full"), { code: "53100" })),
      }),
    } as unknown as Transaction;

    const backend: FiscalBackend = {
      registerTill: () => {
        throw new Error("not used by this test");
      },
      recordSale: () => {
        throw new Error("not used by this test");
      },
      recordVoid: () => {
        throw new Error("recordVoid must not be reached: the insert above always rejects first");
      },
      recordCorrection: () => {
        throw new Error("not used by this test");
      },
      checkIntegrity: async () => ({ ok: true, checked: 0, issues: [] }),
      // Both params are part of FiscalBackend's real signature; this override never reads
      // either, mirroring fake-backend.ts's identical `_reason` convention.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      pendingCount: (_tenant, _till) => {
        throw new Error("not used by this test");
      },
      drain: () => {
        throw new Error("not used by this test");
      },
      reconcile: () => {
        throw new Error("not used by this test");
      },
    };

    const error = await captureError(() =>
      recordVoid(fakeTx, backend, "00000000-0000-4000-8000-000000000000" as SaleId, "reason"),
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect(pgErrorCode(error)).toBe("53100");
  });
});

describe("recordVoid — atomicity", () => {
  it("rolls back the sale_voids projection when the fiscal step fails", async () => {
    // Mirrors record-sale.test.ts's identical "recordSale — atomicity" test for the write path.
    // `sale_voids` is appended BEFORE `backend.recordVoid` is even called (record-void.ts's own
    // ordering comment), both inside the ONE transaction `voidSale`'s `withTenant` opens. Left
    // uncovered, a future refactor that split those two writes across separate transactions would
    // pass every OTHER test in this file — none of them fails the fiscal step AFTER the projection
    // insert has already run — while producing a corrupt half-void in production: a `sale_voids`
    // row appended with no anulación behind it.
    const fake = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(fake);
    const exploding = wrapBackend(fake, {
      recordVoid: () => {
        throw new Error("simulated fiscal backend outage");
      },
    });

    await expect(voidSale(exploding, saleId)).rejects.toThrow("simulated fiscal backend outage");

    expect(await countRows("sale_voids")).toBe(0);
    // No anulación either: the fake's own ledger must still show only the alta, never a void.
    const records = await fake.recordsFor(tillId);
    expect(records.map((r) => r.kind)).toEqual(["sale"]);
  });
});

describe("recordVoid — no fiscal condition blocks a void", () => {
  it("completes the void when chain verification fails", async () => {
    // Same rule as the sale path. An anulación is a registro de facturación like any other, so
    // art. 7.i applies to it — and so does «NUNCA debe interrumpirse». Blocking a void on a chain
    // error would leave staff unable to correct the very sale the incident concerns.
    //
    // **Deviation from the brief.** `backend.chainVerification = {...}` is not a real affordance;
    // the fake's actual test-only control is `breakIntegrity(tillId, issue)`, taking a plain
    // `IntegrityIssue` — mirrors record-sale.test.ts's identical correction.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    backend.breakIntegrity(tillId, { code: "chain.verification_failed", params: { sequence: 1 } });

    await voidSale(backend, saleId);

    expect(await countRows("sale_voids")).toBe(1);
    const records = await backend.recordsFor(tillId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
  });

  it("records an incident against the voided sale when chain verification fails", async () => {
    // Task 18: recordVoid wires the identical chain-verification block record-sale.ts does.
    // Without this test, an implementation that verified the chain and silently dropped the
    // incident would pass the test above (which only checks the void itself completed) and every
    // other test in this file.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    backend.breakIntegrity(tillId, { code: "predecessor-hash-mismatch", params: { sequence: 1 } });

    await voidSale(backend, saleId);

    const rows = await suite.db.select().from(incidents).where(eq(incidents.tillId, tillId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.severity).toBe("error");
    // The VOIDED sale's id, not some later one — an incident on the wrong sale sends staff after
    // the wrong receipt.
    expect(rows[0]?.saleId).toBe(saleId);
  });

  it("records nothing when the void's own chain verification passes", async () => {
    // The negative case. Without it, an implementation that recorded an incident on every void
    // unconditionally would pass the test above.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);

    await voidSale(backend, saleId);

    expect(await countRows("incidents")).toBe(0);
  });

  it("verifies the chain before asking the backend to record the void", async () => {
    // **Deviation from the brief.** `backend.calls.checkIntegrity` does not exist either. Ordering
    // is instead observed the same way record-sale.test.ts's "verifies the chain before
    // allocating a number" test observes ordering: wrap the fake so each method under test records
    // a marker, and read the marker order back.
    const observed: string[] = [];
    const fake = new FakeFiscalBackend(suite.db);
    const backend = wrapBackend(fake, {
      async checkIntegrity(tx, tenant, till) {
        observed.push("checkIntegrity");
        return fake.checkIntegrity(tx, tenant, till);
      },
      async recordVoid(tx, id, reason) {
        observed.push("recordVoid");
        return fake.recordVoid(tx, id, reason);
      },
    });
    const { saleId } = await sell(backend);
    observed.length = 0;

    await voidSale(backend, saleId);

    expect(observed).toEqual(["checkIntegrity", "recordVoid"]);
  });
});
