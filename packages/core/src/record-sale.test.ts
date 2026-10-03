import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AppError,
  locationId as brandLocationId,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
  decimal,
  deviceOrigin,
  jobOrigin,
} from "@waitron/shared";
import type { DeviceId, NodeId, SeriesId, TillId, WorkingOrderId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type {
  FiscalBackend,
  SaleForFiscalRecord,
  IntegrityIssue,
  TrustedClock,
  VatBreakdownLine,
} from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  captureError,
  constraintTarget,
  isUniqueViolation,
  invoiceSeries,
  locations,
  nodes,
  saleLines,
  saleSettlements,
  sales,
  tenders,
  triggerRaised,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { formatInvoiceNumber, recordSale } from "./record-sale.js";
import type { RecordSaleInput, RecordSaleTender } from "./record-sale.js";
import { settleSale } from "./settle-sale.js";
import { seedRectificativeSeries, seedTenant } from "../test/fixtures.js";

let tillId: TillId;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tillId, deviceId, nodeId, seriesId } = await seedTenant(suite.db));
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** A `TrustedClock` from `now()` alone; `recordSale` calls nothing else on it. */
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

// sum(amount) 16.31 = total 14.41 + tip 1.90.
const DEFAULT_TENDERS: RecordSaleTender[] = [
  { method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE },
];

function input(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    origin: deviceOrigin(deviceId),
    nodeId,
    seriesId,
    locale: "es-ES",
    invoiceLocales: ["es-ES", "ca-ES"],
    // Base 10.00 + 2.10, plus VAT 2.10 + 0.21.
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        name: "Café solo",
        descriptions: { "es-ES": "Café solo", "ca-ES": "Cafè sol" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        name: "Agua",
        descriptions: { "es-ES": "Agua", "ca-ES": "Aigua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    clock: steadyClock,
    settlement: { kind: "immediate", tenders: DEFAULT_TENDERS },
    ...overrides,
  };
}

/**
 * Runs the write path in one transaction, on a node registered with the backend: the fake refuses
 * `recordSale` for a node it has not registered.
 */
async function run(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, input(overrides));
  });
}

/** Counts every row in `table`; the suite helper empties the tables between tests. */
async function countRows(table: string): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)}`,
  );
  return result.rows[0]!.n;
}

async function rows<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  const result = await suite.db.execute<T>(query);
  // `execute`'s row type is not provably `T` to tsc; cast at this one boundary.
  return result.rows as T[];
}

/**
 * A `FiscalBackend` delegating to `fake` except where `overrides` supplies a method. Each method
 * is bound by hand: they live on the class prototype, and object spread copies only an instance's
 * own enumerable properties, so `{ ...fake }` would carry none of them.
 */
function wrapBackend(fake: FakeFiscalBackend, overrides: Partial<FiscalBackend>): FiscalBackend {
  return {
    id: fake.id,
    simplifiedInvoiceLimit: fake.simplifiedInvoiceLimit,
    recipientNameMaxLength: fake.recipientNameMaxLength,
    registerNode: (tx, node) => fake.registerNode(tx, node),
    recordSale: (tx, sale) => fake.recordSale(tx, sale),
    filedReceiptFor: (tx, saleId) => fake.filedReceiptFor(tx, saleId),
    recordVoid: (tx, saleId, reason) => fake.recordVoid(tx, saleId, reason),
    recordCorrection: (tx, sale, correction) => fake.recordCorrection(tx, sale, correction),
    recordSubstitution: (tx, sale, substitution) => fake.recordSubstitution(tx, sale, substitution),
    checkIntegrity: (tx, node) => fake.checkIntegrity(tx, node),
    pendingCount: (node) => fake.pendingCount(node),
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

describe("recordSale — the sale's origin", () => {
  it("stores the device a sale was rung on", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      origin: deviceOrigin(deviceId),
    });
    const [row] = await rows<{ source: string; device_id: string | null }>(
      sql`select source, device_id from sales where id = ${saleId}`,
    );
    expect(row).toEqual({ source: "device", device_id: deviceId });
  });

  it("stores a demo seed sale with no device", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      origin: jobOrigin("demo_seed"),
    });
    const [row] = await rows<{ source: string; device_id: string | null }>(
      sql`select source, device_id from sales where id = ${saleId}`,
    );
    expect(row).toEqual({ source: "demo_seed", device_id: null });
  });

  it("hands the origin to the fiscal backend", async () => {
    const fake = new FakeFiscalBackend(suite.db);
    const seen: SaleForFiscalRecord[] = [];
    const backend = wrapBackend(fake, {
      recordSale: (tx, sale) => {
        seen.push(sale);
        return fake.recordSale(tx, sale);
      },
    });
    await run(backend, { origin: jobOrigin("readiness_test") });
    expect(seen.map((sale) => sale.origin)).toEqual([jobOrigin("readiness_test")]);
  });

  it("describes the operation from the location of the device the sale was rung on", async () => {
    const [terrace] = await suite.db
      .insert(locations)
      .values({
        name: "Terraza",
        invoiceLocales: ["es-ES"],
        operationDescription: "Terrace service",
      })
      .returning({ id: locations.id });
    const terraceDevice = await seedDevice(suite.db, { locationId: brandLocationId(terrace!.id) });
    const seen = await descriptionsFiled({ origin: deviceOrigin(terraceDevice.deviceId) });
    expect(seen).toEqual(["Terrace service"]);
  });

  it("describes a sale with no device from its node's location", async () => {
    const [node] = await suite.db
      .select({ locationId: nodes.locationId })
      .from(nodes)
      .where(eq(nodes.id, nodeId));
    await suite.db
      .update(locations)
      .set({ operationDescription: "Counter service" })
      .where(eq(locations.id, node!.locationId));
    const seen = await descriptionsFiled({ origin: jobOrigin("readiness_test") });
    expect(seen).toEqual(["Counter service"]);
  });
});

/** The `descriptionOfOperation` each filed sale handed the fiscal backend. */
async function descriptionsFiled(overrides: Partial<RecordSaleInput>): Promise<string[]> {
  const fake = new FakeFiscalBackend(suite.db);
  const seen: string[] = [];
  const backend = wrapBackend(fake, {
    recordSale: (tx, sale) => {
      seen.push(sale.descriptionOfOperation);
      return fake.recordSale(tx, sale);
    },
  });
  await run(backend, overrides);
  return seen;
}

describe("recordSale — the happy path", () => {
  it("allocates the next number from the series and stamps it on the sale", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.invoiceNumber).toBe(1);
  });

  it("writes the backend's own id into sales.fiscal_backend", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await run(backend);
    const [row] = await rows<{ fiscal_backend: string }>(
      sql`select fiscal_backend from sales where id = ${saleId}`,
    );
    expect(backend.id).toBe("fake");
    expect(row?.fiscal_backend).toBe(backend.id);
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
    // The tip is non-taxable and rides on the tender. The three figures all differ, so copying the
    // wrong field cannot produce the expected rows.
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    // Whole cents: 1441 is 14.41, 1631 is 16.31, 190 is 1.90.
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.total).toBe(1441);

    const [tender] = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    expect(tender?.amount).toBe(1631);
    expect(tender?.tipAmount).toBe(190);
  });

  it("stores a line's quantity in whole thousandths and its VAT rate in whole basis points", async () => {
    // Line 2 weighs five grams: only 5 shows the third decimal place survived, which the money
    // scale would lose. The four expected numbers differ from each other and from the amounts, so
    // a wrong scale for either column cannot produce this set.
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      // base 30.00 + 10.00, tax 6.30 (21% of 30.00) + 1.05 (10.5% of 10.00).
      total: "47.35",
      lines: [
        {
          lineNo: 1,
          name: "Jamón",
          descriptions: { "es-ES": "Jamón" },
          quantity: "1.5",
          unitPrice: "20.00",
          vatRate: "21.00",
          lineTotal: "30.00",
        },
        {
          lineNo: 2,
          name: "Azafrán",
          descriptions: { "es-ES": "Azafrán" },
          quantity: "0.005",
          unitPrice: "2000.00",
          vatRate: "10.50",
          lineTotal: "10.00",
        },
      ],
      settlement: { kind: "deferred" },
    });

    const lines = await suite.db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo);
    expect(lines.map((line) => line.quantity)).toEqual([1500, 5]);
    expect(lines.map((line) => line.vatRate)).toEqual([2100, 1050]);
  });

  it("snapshots the locale list as at issuance", async () => {
    // A receipt reprinted a year later must read identically to the one the customer took, so
    // the list is copied onto the sale rather than read back from configuration at print time.
    const { saleId } = await run(new FakeFiscalBackend(suite.db));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.invoiceLocales).toEqual(["es-ES", "ca-ES"]);
  });

  it("returns the fiscal record reference the backend produced", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { fiscal } = await run(backend);
    expect(fiscal.backend).toBe("fake");
    expect(fiscal.recordId).toMatch(/^fake-\d{8}$/);
    expect(fiscal.state).toBe("pending");
  });

  it("hands the backend the sale's bare invoice number and taxable total", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    await run(backend);
    const [record] = await backend.recordsFor(nodeId);
    expect(record?.invoiceNumber).toBe(1);
    expect(record?.total).toBe("14.41");
    expect(record?.kind).toBe("sale");
  });

  it("groups two lines at the same VAT rate into one breakdown entry", async () => {
    // Two lines at one rate exercise `buildVatBreakdown`'s merge.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await run(backend, {
      total: "9.68",
      lines: [
        {
          lineNo: 1,
          name: "Café solo",
          descriptions: { "es-ES": "Café solo" },
          quantity: "1",
          unitPrice: "5.00",
          vatRate: "21.00",
          lineTotal: "5.00",
        },
        {
          lineNo: 2,
          name: "Té",
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
    const [saleRow] = await suite.db
      .select({ vb: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.id, saleId));
    expect(saleRow!.vb).toEqual([{ rate: "21.00", base: "8.00", tax: "1.68" }]);
  });

  it("takes a rate's tax from the summed base, not from each line's rounded tax", async () => {
    // 1.07 at 21% is 0.2247, so two lines taxed one by one give 0.22 + 0.22 = 0.44; the grouped
    // base 2.14 gives 0.4494, which is 0.45, so the total is 2.14 + 0.45 = 2.59.
    const backend = new FakeFiscalBackend(suite.db);
    const line = {
      name: "Café solo",
      descriptions: { "es-ES": "Café solo" },
      quantity: "1",
      unitPrice: "1.07",
      vatRate: "21.00",
      lineTotal: "1.07",
    };
    const { saleId } = await run(backend, {
      total: "2.59",
      lines: [
        { lineNo: 1, ...line },
        { lineNo: 2, ...line },
      ],
      settlement: { kind: "deferred" },
    });
    const [saleRow] = await suite.db
      .select({ vb: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.id, saleId));
    expect(saleRow!.vb).toEqual([{ rate: "21.00", base: "2.14", tax: "0.45" }]);
  });

  it("stores the filed vatBreakdown on sales, equal to what the backend filed", async () => {
    // A caller-supplied difference-method breakdown whose 21% tax (1.74) is not
    // `percentOf(8.26, 21)` (1.73): a sale insert that recomputed from `lines` would store 1.73.
    // It reconciles with `total` (8.26 + 1.74 + 5.00 + 0.50 = 15.50).
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
          name: "Café solo",
          descriptions: { "es-ES": "Café solo" },
          quantity: "1",
          unitPrice: "8.26",
          vatRate: "21.00",
          lineTotal: "8.26",
        },
        {
          lineNo: 2,
          name: "Agua",
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
    // And it is the FILED difference-method VAT amount, not `percentOf(base, rate)`: 1.74, not 1.73.
    expect(saleRow!.vb.find((g) => g.rate === "21.00")?.tax).toBe("1.74");
  });
});

describe("recordSale — operator attribution", () => {
  // A uuid-shaped value no other fixture column holds, so copying the wrong column cannot
  // produce it.
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
      async checkIntegrity(tx, node) {
        // Read from inside verification: 1 means allocation has not run yet.
        const [row] = await tx
          .select({ n: invoiceSeries.nextNumber })
          .from(invoiceSeries)
          .where(eq(invoiceSeries.id, seriesId));
        observed.push(row?.n ?? -1);
        return fake.checkIntegrity(tx, node);
      },
    });
    await run(backend);
    expect(observed).toEqual([1]);
  });

  it("reads the clock exactly once for the whole transaction", async () => {
    // A drifting clock makes a second reading visible: the sale and its fiscal record would carry
    // different timestamps. The fake returns the `issuedAt` it was handed.
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
    // AEAT: «la facturación por este motivo NUNCA debe interrumpirse». This assertion must never
    // be inverted.
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
});

describe("recordSale — the fiscal record is created when ALL tenders settle", () => {
  it("writes nothing when a tender has not settled", async () => {
    // A declined card must leave the order retryable with nothing chained.
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

    // The sale and its lines were written before `settleSale` threw; the rollback removes them.
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
    // A partial write here would leave an invoice that exists commercially and not fiscally.
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
    // Invoice-first: the invoice is issued before payment, and a sale with no tender and no
    // settlement is a legitimate steady state.
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
    // `immediate` runs the same `settleSale`, so a sale settled inline must leave the same
    // `tenders` and `sale_settlements` rows as one recorded `deferred` and settled later.
    const later = new Date(BASE.getTime() + 5 * 60_000);
    const tendersInput: RecordSaleTender[] = [
      { method: "cash", amount: "6.31", cashTendered: "10.00", tipAmount: "0.00", settledAt: BASE },
      { method: "card", amount: "10.00", tipAmount: "1.90", settledAt: later },
    ];
    const backend = new FakeFiscalBackend(suite.db);

    // Path A — immediate, on the beforeEach venue.
    const a = await withTransaction(suite.db, async (tx) => {
      await backend.registerNode(tx, nodeId);
      return recordSale(
        tx,
        backend,
        input({ settlement: { kind: "immediate", tenders: tendersInput } }),
      );
    });

    // Path B — a second node: deferred record, then a SEPARATE settleSale.
    const other = await seedTenant(suite.db);
    const b = await withTransaction(suite.db, async (tx) => {
      await backend.registerNode(tx, other.nodeId);
      return recordSale(
        tx,
        backend,
        input({
          nodeId: other.nodeId,
          seriesId: other.seriesId,
          settlement: { kind: "deferred" },
        }),
      );
    });
    await withTransaction(suite.db, async (tx) => {
      await settleSale(tx, {
        saleId: b.saleId,
        tenders: tendersInput,
      });
    });

    // Tenders, modulo id/sale_id, sorted for a position-independent compare.
    const normalize = (rows: (typeof tenders.$inferSelect)[]) =>
      rows
        .map((r) => ({
          method: r.method,
          amount: r.amount,
          tipAmount: r.tipAmount,
          cashTendered: r.cashTendered,
          settledAt: new Date(r.settledAt).getTime(),
        }))
        .sort((x, y) => x.amount - y.amount);
    const aTenders = normalize(
      await suite.db.select().from(tenders).where(eq(tenders.saleId, a.saleId)),
    );
    const bTenders = normalize(
      await suite.db.select().from(tenders).where(eq(tenders.saleId, b.saleId)),
    );
    expect(aTenders).toHaveLength(2);
    // Read straight off the table, so these are counts of whole cents, not decimal literals.
    expect(aTenders).toContainEqual({
      method: "cash",
      amount: 631,
      cashTendered: 1000,
      tipAmount: 0,
      settledAt: BASE.getTime(),
    });
    expect(aTenders).toEqual(bTenders);

    // Both stamp the latest tender's instant, `later`, not the issuance instant (BASE).
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
    // Driven through `recordSale`; settle-sale.test.ts covers `settleSale` directly. A comped sale
    // has no tender, so immediate mode hands `settleSale` an empty list.
    const backend = new FakeFiscalBackend(suite.db);
    // `issued_at` is the fixed BASE (March), so a settlement stamped now is not a copy of it.
    const before = new Date();
    const { saleId } = await run(backend, {
      total: "0.00",
      lines: [
        {
          lineNo: 1,
          name: "Free item",
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
    const [settled] = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    const settledAt = new Date(settled!.settledAt).getTime();
    // Within the run window …
    expect(settledAt).toBeGreaterThanOrEqual(before.getTime());
    expect(settledAt).toBeLessThanOrEqual(after.getTime());
    // … and later than the fixed issued_at.
    expect(settledAt).toBeGreaterThan(new Date(row!.issuedAt).getTime());
  });
});

describe("recordSale — numbering", () => {
  it("never reissues a number that reached a committed sale", async () => {
    // Gaps are permitted; reuse is not.
    await run(new FakeFiscalBackend(suite.db));
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await tx.insert(sales).values({
          source: "device",
          deviceId,
          nodeId,
          seriesId,
          invoiceNumber: 1,
          issuedAt: BASE.toISOString(),
          issuedOffsetMinutes: 60,
          // A money column holds whole cents: 100 is 1.00.
          total: 100,
          // Required by the column; supplied so the only thing wrong with this row is its number.
          vatBreakdown: [],
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          fiscalBackend: "fake",
          fiscalState: "recorded",
        });
      }),
    );
    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({
      table: "sales",
      columns: ["series_id", "invoice_number"],
    });
  });

  it("returns the number to the pool when the transaction rolls back", async () => {
    // Deliberate: the allocating update is transactional, so a rollback un-allocates. The number
    // never reached a committed sale, so reissuing it is not reuse.
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
    // `seedTenant` mints a second node, so `other.seriesId` is real but not this node's.
    const other = await seedTenant(suite.db);
    await expect(
      run(new FakeFiscalBackend(suite.db), { seriesId: other.seriesId }),
    ).rejects.toMatchObject({ code: "sale.series_wrong_node" });
  });

  it("rejects a rectificative series: an ordinary sale must not draw a corrective number", async () => {
    const rectSeriesId = await seedRectificativeSeries(suite.db, nodeId);
    await expect(
      run(new FakeFiscalBackend(suite.db), { seriesId: rectSeriesId }),
    ).rejects.toMatchObject({
      code: "sale.series_wrong_purpose",
      params: { seriesId: rectSeriesId, expected: "standard", actual: "rectificative" },
    });
  });

  it("rejects a RETIRED series: a restored box must never number from the series it was restored with", async () => {
    // A cold restore retires the node's series and opens fresh ones; a stale configured series
    // must fail loudly, never issue a number the tax agency saw.
    const retiredAt = new Date("2026-09-06T10:00:00.000Z");
    await suite.db.update(invoiceSeries).set({ retiredAt }).where(eq(invoiceSeries.id, seriesId));
    try {
      await expect(run(new FakeFiscalBackend(suite.db))).rejects.toMatchObject({
        code: "sale.series_retired",
        params: { seriesId, retiredAt: retiredAt.toISOString() },
      });
    } finally {
      await suite.db
        .update(invoiceSeries)
        .set({ retiredAt: null })
        .where(eq(invoiceSeries.id, seriesId));
    }
  });
});

describe("recordSale — working order linkage", () => {
  // `sales.working_order_id` is a foreign key onto `working_orders`, enforced because the venue
  // store turns `foreign_keys` on (`packages/store/src/index.ts`), so the supplied case needs a
  // real row.
  async function seedOpenWorkingOrder(): Promise<WorkingOrderId> {
    const [row] = await suite.db
      .insert(workingOrders)
      .values({ tillId, orderNumber: 1 })
      .returning({ id: workingOrders.id });
    return brandWorkingOrderId(row!.id);
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
  /** Captures the `vatBreakdown` that reaches `FiscalBackend.recordSale`. */
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

  it("passes a supplied two-decimal vatBreakdown to the backend unchanged", async () => {
    // The supplied tax (0.72) is not what `buildVatBreakdown` derives from the line (0.73), so a
    // path that ignored the supplied value cannot pass.
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
          name: "x",
          descriptions: { en: "x" },
          quantity: "0.320",
          unitPrice: "22.64",
          vatRate: "10.00",
          lineTotal: "7.25",
          category: "Food",
        },
      ],
      // Deferred: the default tenders would not cover 7.97.
      settlement: { kind: "deferred" },
    });
    expect(captured()).toEqual(breakdown); // NOT buildVatBreakdown's derivation
  });

  it("derives the breakdown when none is supplied (legacy path unchanged)", async () => {
    // One 10.00 line at 10% derives base 10.00, tax 1.00.
    const { backend, captured } = captureBreakdown();
    await run(backend, {
      total: "11.00",
      lines: [
        {
          lineNo: 1,
          name: "x",
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
    // Compared by value, and refused before anything is written.
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
            name: "x",
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
          name: "Water",
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
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      total: "1.50",
      lines: [
        {
          lineNo: 1,
          name: "Water",
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

describe("recordSale — the amounts filed are the cent amounts the rows store", () => {
  /** One line per entry of `lineTotals`, sold on a deferred bill so no tender has to cover it. */
  function linesOf(lineTotals: string[], vatRate: string): Partial<RecordSaleInput> {
    return {
      lines: lineTotals.map((lineTotal, index) => ({
        lineNo: index + 1,
        name: "x",
        descriptions: { en: "x" },
        quantity: "1",
        unitPrice: lineTotal,
        vatRate,
        lineTotal,
      })),
      settlement: { kind: "deferred" },
    };
  }

  function oneLine(lineTotal: string, vatRate: string): Partial<RecordSaleInput> {
    return linesOf([lineTotal], vatRate);
  }

  async function seriesNext(): Promise<number | undefined> {
    const [series] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));
    return series?.n;
  }

  it("files the total and a derived breakdown at the cent amounts the rows store, not as typed", async () => {
    const backend = new FakeFiscalBackend(suite.db);

    // 0.055 is stored as 0.06 and the 0.045 line as 0.05, whose 10% is 0.005, rounded 0.01.
    const { saleId } = await run(backend, { total: "0.055", ...oneLine("0.045", "10.00") });

    const breakdown = [{ rate: "10.00", base: "0.05", tax: "0.01" }];
    const [record] = await backend.recordsFor(nodeId);
    expect(record?.total).toBe("0.06");
    const filed = await suite.db.transaction((tx) => backend.filedReceiptFor(tx, saleId));
    expect(filed?.vatBreakdown).toEqual(breakdown);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.total).toBe(6);
    expect(row?.vatBreakdown).toEqual(breakdown);
    const [line] = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    expect(line?.lineTotal).toBe(5);
  });

  it("files a supplied breakdown at the cent amounts the row stores, not as typed", async () => {
    const backend = new FakeFiscalBackend(suite.db);

    // 1.004 + 0.1004 = 1.1044; at the cent, 1.00 + 0.10 = 1.10.
    const { saleId } = await run(backend, {
      total: "1.1044",
      vatBreakdown: [{ rate: decimal("10.00"), base: decimal("1.004"), tax: decimal("0.1004") }],
      ...oneLine("1.004", "10.00"),
    });

    const breakdown = [{ rate: "10.00", base: "1.00", tax: "0.10" }];
    const [record] = await backend.recordsFor(nodeId);
    expect(record?.total).toBe("1.10");
    const filed = await suite.db.transaction((tx) => backend.filedReceiptFor(tx, saleId));
    expect(filed?.vatBreakdown).toEqual(breakdown);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.total).toBe(110);
    expect(row?.vatBreakdown).toEqual(breakdown);
  });

  it("refuses a supplied breakdown that no longer sums to the total once each amount is rounded to the cent", async () => {
    // 1.005 + 0.105 = 1.110 as typed; at the cent, 1.01 + 0.11 = 1.12, against a total of 1.11.
    await expect(
      run(new FakeFiscalBackend(suite.db), {
        total: "1.110",
        vatBreakdown: [{ rate: decimal("10.00"), base: decimal("1.005"), tax: decimal("0.105") }],
        ...oneLine("1.005", "10.00"),
      }),
    ).rejects.toMatchObject({
      code: "sale.total_mismatch",
      params: { declaredTotal: "1.11", breakdownTotal: "1.12" },
    });
    expect(await countRows("sales")).toBe(0);
  });

  it.each([
    // Each 0.045 is stored as 0.05: the lines hold 5.00, whose 10% is 0.50, against 4.95.
    {
      total: "4.95",
      lineTotals: Array<string>(100).fill("0.045"),
      vatRate: "10.00",
      declared: "4.95",
      sum: "5.50",
    },
    // Each 0.005 is stored as 0.01: the lines hold 0.02 against 0.01.
    {
      total: "0.01",
      lineTotals: ["0.005", "0.005"],
      vatRate: "0.00",
      declared: "0.01",
      sum: "0.02",
    },
  ])(
    "refuses a derived breakdown that does not sum to $total at the cent, writing nothing",
    async ({ total, lineTotals, vatRate, declared, sum }) => {
      const backend = new FakeFiscalBackend(suite.db);
      // Caught inside the transaction, so the transaction commits whatever was written before the
      // refusal.
      await withTransaction(suite.db, async (tx) => {
        await backend.registerNode(tx, nodeId);
        await expect(
          recordSale(tx, backend, input({ total, ...linesOf(lineTotals, vatRate) })),
        ).rejects.toMatchObject({
          code: "sale.total_mismatch",
          params: { declaredTotal: declared, breakdownTotal: sum },
        });
      });

      expect(await countRows("sales")).toBe(0);
      expect(await countRows("sale_lines")).toBe(0);
      expect(await backend.recordsFor(nodeId)).toEqual([]);
      expect(await seriesNext()).toBe(1);
    },
  );

  it("still files a two-decimal sale whose derived breakdown does not sum to its total", async () => {
    const backend = new FakeFiscalBackend(suite.db);

    // 1.00 at 21% derives 1.00 + 0.21, against a total of 1.00. No amount is past the cent.
    await run(backend, { total: "1.00", ...oneLine("1.00", "21.00") });

    const [record] = await backend.recordsFor(nodeId);
    expect(record?.total).toBe("1.00");
    expect(await countRows("sales")).toBe(1);
  });

  it("files a total past the cent, with every line at the cent, as the cent total the row stores", async () => {
    const backend = new FakeFiscalBackend(suite.db);

    // 1.005 is stored as 1.01; the 0.83 line at 21% derives 0.83 + 0.17 = 1.00. No line is past
    // the cent, so the breakdown is not checked against the total.
    const { saleId } = await run(backend, { total: "1.005", ...oneLine("0.83", "21.00") });

    const breakdown = [{ rate: "21.00", base: "0.83", tax: "0.17" }];
    const [record] = await backend.recordsFor(nodeId);
    expect(record?.total).toBe("1.01");
    const filed = await suite.db.transaction((tx) => backend.filedReceiptFor(tx, saleId));
    expect(filed?.vatBreakdown).toEqual(breakdown);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.total).toBe(101);
    expect(row?.vatBreakdown).toEqual(breakdown);
  });
});

describe("recordSale — modifier child lines (parent_line_id)", () => {
  it("links a child modifier line to its parent by the parent's GENERATED id", async () => {
    // Line 2 names line 1 as its parent; the top-level line 1 has none.
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      total: "6.71",
      lines: [
        {
          lineNo: 1,
          name: "Hamburguesa",
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1",
          unitPrice: "5.00",
          vatRate: "10.00",
          lineTotal: "5.00",
        },
        {
          lineNo: 2,
          name: "Extra de queso",
          descriptions: { "es-ES": "Extra de queso" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "21.00",
          lineTotal: "1.00",
          parentLineNo: 1,
        },
      ],
      settlement: { kind: "deferred" },
    });

    const lines = await suite.db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo);
    expect(lines).toHaveLength(2);
    const parent = lines.find((l) => l.lineNo === 1)!;
    const child = lines.find((l) => l.lineNo === 2)!;
    // The child points at the parent's generated id, not its lineNo.
    expect(parent.parentLineId).toBeNull();
    expect(child.parentLineId).toBe(parent.id);
  });

  it("leaves parent_line_id NULL when a line omits parentLineNo (additive, no behaviour change)", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      total: "6.05",
      lines: [
        {
          lineNo: 1,
          name: "Hamburguesa",
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1",
          unitPrice: "5.00",
          vatRate: "10.00",
          lineTotal: "5.00",
        },
        {
          lineNo: 2,
          name: "Agua",
          descriptions: { "es-ES": "Agua" },
          quantity: "1",
          unitPrice: "1.05",
          vatRate: "21.00",
          lineTotal: "1.05",
        },
      ],
      settlement: { kind: "deferred" },
    });

    const lines = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.parentLineId === null)).toBe(true);
  });

  it("inserts NULL for a parentLineNo that names no line in the basket (the `?? null` guard)", async () => {
    // A `parentLineNo` naming no line in this basket resolves to null, never a dangling pointer.
    // Line 2 names line 9.
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      total: "6.05",
      lines: [
        {
          lineNo: 1,
          name: "Hamburguesa",
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1",
          unitPrice: "5.00",
          vatRate: "10.00",
          lineTotal: "5.00",
        },
        {
          lineNo: 2,
          name: "Extra de queso",
          descriptions: { "es-ES": "Extra de queso" },
          quantity: "1",
          unitPrice: "1.05",
          vatRate: "21.00",
          lineTotal: "1.05",
          parentLineNo: 9,
        },
      ],
      settlement: { kind: "deferred" },
    });

    const lines = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    expect(lines.every((l) => l.parentLineId === null)).toBe(true);
  });

  it("files a VAT breakdown carrying BOTH the reduced dish's rate and the general option's rate", async () => {
    // A 10% dish with a 21% option files both rates: a child line is grouped by its own rate.
    const { saleId } = await run(new FakeFiscalBackend(suite.db), {
      total: "6.71",
      lines: [
        {
          lineNo: 1,
          name: "Hamburguesa",
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1",
          unitPrice: "5.00",
          vatRate: "10.00",
          lineTotal: "5.00",
        },
        {
          lineNo: 2,
          name: "Extra de queso",
          descriptions: { "es-ES": "Extra de queso" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "21.00",
          lineTotal: "1.00",
          parentLineNo: 1,
        },
      ],
      settlement: { kind: "deferred" },
    });

    const [saleRow] = await suite.db
      .select({ vb: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.id, saleId));
    const byRate = new Map(saleRow!.vb.map((g) => [g.rate, g]));
    expect([...byRate.keys()].sort()).toEqual(["10.00", "21.00"]);
    expect(byRate.get("10.00")!.base).toBe("5.00");
    expect(byRate.get("21.00")!.base).toBe("1.00");
  });
});

it("persists the frozen options answers and child links on the issued lines", async () => {
  const backend = new FakeFiscalBackend(suite.db);

  // Three different texts per name, so an assertion cannot pass while the wrong one is read.
  const optionSnapshots = [
    {
      listName: { en: "Milk" },
      listCustomerName: { en: "Which milk?" },
      listKitchenName: "MILK",
      labelName: { en: "Oat" },
      labelCustomerName: { en: "Oat milk" },
      labelKitchenName: "OAT",
    },
    {
      listName: { en: "Ice" },
      listCustomerName: { en: "How much ice?" },
      listKitchenName: "ICE",
      labelName: { en: "None" },
      labelCustomerName: { en: "No ice" },
      labelKitchenName: "NOICE",
    },
  ];
  const lines = input().lines.map((line, index) => ({
    ...line,
    optionSnapshots: index === 0 ? optionSnapshots : [],
    unitName: index === 0 ? { en: "portion" } : null,
    unitPrecision: index === 0 ? 2 : null,
    parentLineNo: index === 0 ? null : 1,
    category: "Drinks",
  }));
  const { saleId } = await run(backend, { lines });
  const saved = await suite.db
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  expect(saved.map((line) => line.optionSnapshots)).toEqual([optionSnapshots, []]);
  expect(saved.map((line) => line.unitName)).toEqual([{ en: "portion" }, null]);
  expect(saved.map((line) => line.unitPrecision)).toEqual([2, null]);
  expect(saved[0]!.parentLineId).toBeNull();
  expect(saved[1]!.parentLineId).toBe(saved[0]!.id);
  expect(saved.map((line) => line.category)).toEqual(["Drinks", "Drinks"]);
});

describe("recordSale — what each line sold and how it was classified", () => {
  const cocktails = {
    reporting: [
      { id: "cat-drinks", name: "Drinks" },
      { id: "cat-alcoholic", name: "Alcoholic drinks" },
      { id: "cat-cocktails", name: "Cocktails" },
    ],
  };
  const lemon = { reporting: [{ id: "cat-extras", name: "Extras" }] };

  /** The default two lines as a dish and an extras pick, with every pre-existing column set, so a
   * column the new fields disturbed cannot hide behind a null on both sides. */
  function plainLines(): RecordSaleInput["lines"] {
    return input().lines.map((line, index) => ({
      ...line,
      optionSnapshots:
        index === 0
          ? [
              {
                listName: { en: "Ice" },
                listCustomerName: { en: "How much ice?" },
                listKitchenName: "ICE",
                labelName: { en: "None" },
                labelCustomerName: { en: "No ice" },
                labelKitchenName: "NOICE",
              },
            ]
          : [],
      unitName: { "es-ES": "ud" },
      unitPrecision: 0,
      parentLineNo: index === 0 ? null : 1,
      category: "Cocktails",
      variantName: index === 0 ? "Doble" : null,
      variantDescriptions: index === 0 ? { "es-ES": "Doble", "ca-ES": "Doble" } : null,
      variantKitchenName: index === 0 ? "DBL" : null,
      kitchenName: index === 0 ? "CAF" : "AGUA",
    }));
  }

  function classifiedLines(): RecordSaleInput["lines"] {
    return plainLines().map((line, index) => ({
      ...line,
      productId: index === 0 ? "product-double" : "product-lemon",
      parentProductId: index === 0 ? "product-coffee" : null,
      menuId: "menu-lunch",
      menuVersionId: null,
      // Gross of the net 10.00 at 21% and of the net 2.10 at 10%.
      lineGross: index === 0 ? "12.10" : "2.31",
      classification: index === 0 ? cocktails : lemon,
    }));
  }

  it("stores each line's product, parent product, menu, gross and classification", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db), { lines: classifiedLines() });

    const saved = await suite.db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo);
    expect(
      saved.map((line) => ({
        productId: line.productId,
        parentProductId: line.parentProductId,
        menuId: line.menuId,
        menuVersionId: line.menuVersionId,
        lineGross: line.lineGross,
        classification: line.classification,
      })),
    ).toEqual([
      {
        productId: "product-double",
        parentProductId: "product-coffee",
        menuId: "menu-lunch",
        menuVersionId: null,
        lineGross: 1210,
        classification: cocktails,
      },
      {
        productId: "product-lemon",
        parentProductId: null,
        menuId: "menu-lunch",
        menuVersionId: null,
        lineGross: 231,
        classification: lemon,
      },
    ]);
  });

  it("leaves every new field null on a line that names none of them", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db), { lines: plainLines() });

    const saved = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    for (const line of saved) {
      expect([
        line.productId,
        line.parentProductId,
        line.menuId,
        line.menuVersionId,
        line.lineGross,
        line.classification,
      ]).toEqual([null, null, null, null, null, null]);
    }
  });

  it("refuses to rewrite a filed line's classification, and the stored snapshot stays as filed", async () => {
    const { saleId } = await run(new FakeFiscalBackend(suite.db), { lines: classifiedLines() });

    const mutation = await captureError(async () =>
      suite.db.execute(
        sql`update sale_lines set classification = '{"reporting":[]}' where sale_id = ${saleId}`,
      ),
    );

    expect(triggerRaised(mutation, "sale_lines is append-only")).toBe(true);
    const saved = await suite.db
      .select({ classification: saleLines.classification })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo);
    expect(saved.map((line) => line.classification)).toEqual([cocktails, lemon]);
  });

  it("files the same fiscal record, sale header and pre-existing line columns with or without the new fields", async () => {
    // Every column `sale_lines` had before the new fields. Pinned by hand rather than read off the
    // schema, which now includes the new ones; the table check below keeps the list complete.
    const PRE_EXISTING = [
      "line_no",
      "name",
      "descriptions",
      "variant_name",
      "variant_descriptions",
      "variant_kitchen_name",
      "kitchen_name",
      "option_snapshots",
      "unit_name",
      "unit_precision",
      "quantity",
      "unit_price",
      "vat_rate",
      "line_total",
      "category",
      "parent_line_id",
    ];
    const NEW = [
      "product_id",
      "parent_product_id",
      "menu_id",
      "menu_version_id",
      "line_gross",
      "classification",
      "price_quantity",
    ];
    const tableColumns = await rows<{ name: string }>(
      sql`select name from pragma_table_info('sale_lines')`,
    );
    expect(tableColumns.map((c) => c.name).sort()).toEqual(
      [...PRE_EXISTING, ...NEW, "corrects_line_id", "id", "sale_id"].sort(),
    );

    const fake = new FakeFiscalBackend(suite.db);
    const filed: SaleForFiscalRecord[] = [];
    const backend = wrapBackend(fake, {
      recordSale: (tx, sale) => {
        filed.push(sale);
        return fake.recordSale(tx, sale);
      },
    });
    const plain = await run(backend, { lines: plainLines() });
    const classified = await run(backend, { lines: classifiedLines() });

    const omit = (row: object, keys: string[]) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
    // What the backend chains from: everything but the sale's own id and its number in the series.
    const chained = (sale: SaleForFiscalRecord) => omit(sale, ["saleId", "invoiceNumber"]);
    expect(filed).toHaveLength(2);
    expect(chained(filed[1]!)).toEqual(chained(filed[0]!));
    expect(filed[1]!.invoiceNumber).toBe(filed[0]!.invoiceNumber + 1);

    const header = async (saleId: string) => {
      const [row] = await rows<Record<string, unknown>>(
        sql`select * from sales where id = ${saleId}`,
      );
      return omit(row!, ["id", "invoice_number"]);
    };
    const plainHeader = await header(plain.saleId);
    expect(await header(classified.saleId)).toEqual(plainHeader);
    // The two figures Review Focus 5 names, stated rather than left inside the whole-row compare.
    expect(plainHeader.total).toBe(1441);
    expect(JSON.parse(plainHeader.vat_breakdown as string)).toEqual([
      { rate: "21.00", base: "10.00", tax: "2.10" },
      { rate: "10.00", base: "2.10", tax: "0.21" },
    ]);

    // A parent link is an id of the sale's own line, so it is compared as the line number it names.
    const lineColumns = async (saleId: string) => {
      const lines = await rows<Record<string, unknown>>(
        sql`select * from sale_lines where sale_id = ${saleId} order by line_no`,
      );
      const lineNoById = new Map(lines.map((line) => [line.id, line.line_no]));
      return lines.map((line) =>
        PRE_EXISTING.map((column) =>
          column === "parent_line_id"
            ? [column, line.parent_line_id === null ? null : lineNoById.get(line.parent_line_id)]
            : [column, line[column]],
        ),
      );
    };
    const plainLinesStored = await lineColumns(plain.saleId);
    const classifiedLinesStored = await lineColumns(classified.saleId);
    expect(plainLinesStored).toHaveLength(2);
    for (const [index, columns] of classifiedLinesStored.entries()) {
      for (const [position, [column, value]] of columns.entries()) {
        expect([column, value], `line ${index + 1}, ${String(column)}`).toEqual(
          plainLinesStored[index]![position],
        );
      }
    }
    // The child line's parent survived the compare as a real link, not as null on both sides.
    expect(plainLinesStored[1]!.find(([column]) => column === "parent_line_id")).toEqual([
      "parent_line_id",
      1,
    ]);
  });
});

it("stores no corrected line on an ordinary sale's line, even when the caller names one", async () => {
  const backend = new FakeFiscalBackend(suite.db);
  const earlier = await run(backend);
  const [earlierLine] = await suite.db
    .select({ id: saleLines.id })
    .from(saleLines)
    .where(eq(saleLines.saleId, earlier.saleId));

  const lines = input().lines.map((line) => ({ ...line, correctsLineId: earlierLine!.id }));
  const { saleId } = await run(backend, { lines });

  const saved = await suite.db
    .select({ correctsLineId: saleLines.correctsLineId })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId));
  expect(saved.map((line) => line.correctsLineId)).toEqual([null, null]);
});

describe("recordSale — a regime's simplified-invoice limit", () => {
  /** One 10% line whose gross total is `total`, so the limit is the only rule a total can trip. */
  function saleOf(total: string): Partial<RecordSaleInput> {
    return {
      total,
      lines: [
        {
          lineNo: 1,
          name: "Banquete",
          descriptions: { "es-ES": "Banquete" },
          quantity: "1",
          unitPrice: total,
          vatRate: "10.00",
          lineTotal: total,
        },
      ],
      vatBreakdown: [{ rate: decimal("10.00"), base: decimal(total), tax: decimal("0.00") }],
      settlement: { kind: "deferred" },
    };
  }
  const limited = () =>
    new FakeFiscalBackend(suite.db, { simplifiedInvoiceLimit: decimal("3010.00") });

  it("files a sale whose total equals the limit", async () => {
    const { saleId } = await run(limited(), saleOf("3010.00"));
    expect(await countRows("sales")).toBe(1);
    expect(saleId).toBeDefined();
  });

  it("refuses a sale a cent over the limit, writing nothing and spending no number", async () => {
    const error = await captureError(() => run(limited(), saleOf("3010.01")));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("sale.total_exceeds_simplified_limit");
    expect((error as AppError).params).toEqual({ total: "3010.01", limit: "3010.00" });
    expect(await countRows("sales")).toBe(0);
    expect(await countRows("sale_lines")).toBe(0);
    const [series] = await suite.db
      .select({ next: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));
    expect(series!.next).toBe(1);
  });

  it("measures the base plus VAT it files, as the authority does, not the stated total", async () => {
    // A derived breakdown with every line at the cent is not checked against the stated total
    // (`deriveVatBreakdown`), so the two can differ; base 2736.37 at 10% files 2736.37 + 273.64.
    const line = {
      lineNo: 1,
      name: "Banquete",
      descriptions: { "es-ES": "Banquete" },
      quantity: "1",
      unitPrice: "2736.37",
      vatRate: "10.00",
      lineTotal: "2736.37",
    };
    const overByBreakdown = { total: "3010.00", lines: [line], settlement: { kind: "deferred" } };
    const error = await captureError(() =>
      run(limited(), overByBreakdown as Partial<RecordSaleInput>),
    );
    expect((error as AppError).params).toEqual({ total: "3010.01", limit: "3010.00" });

    await run(limited(), {
      ...overByBreakdown,
      total: "9999.00",
      lines: [{ ...line, unitPrice: "10.00", lineTotal: "10.00" }],
    } as Partial<RecordSaleInput>);
    expect(await countRows("sales")).toBe(1);
  });

  it("files any total for a regime that sets no limit", async () => {
    await run(new FakeFiscalBackend(suite.db), saleOf("99999.99"));
    expect(await countRows("sales")).toBe(1);
  });
});
