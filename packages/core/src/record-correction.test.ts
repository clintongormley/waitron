import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AppError,
  decimal,
  seriesId as brandSeriesId,
  deviceOrigin,
  jobOrigin,
} from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, SaleForFiscalRecord, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  incidents,
  invoiceSeries,
  saleLines,
  sales,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin, persons } from "@waitron/identity";
import { recordCorrection } from "./record-correction.js";
import type { RecordCorrectionInput } from "./record-correction.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { seedBareSale, seedRectificativeSeries, seedTenant } from "../test/fixtures.js";
import { seedDevice } from "@waitron/db/testing/seed.js";

let tillId: TillId;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId; // the ordinary (purpose='standard') series seedTenant creates
let rectSeriesId: SeriesId; // a purpose='rectificative' series on the same node
// `supervisorId` holds `sale.rectify`, so `supervisorSessionId` authorizes every green-path
// correction; `staffId` holds no `sale.rectify`; `managerId` is the second person whose PIN unlocks
// an override, and also holds `sale.void`, so `managerSessionId` authorizes the one precondition
// void.
let supervisorId: string;
let managerId: string;
let supervisorSessionId: string;
let managerSessionId: string;
let staffSessionId: string;

const suite = useVenueDb({
  // `authorize` reads identity's tables.
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tillId, deviceId, nodeId, seriesId } = await seedTenant(suite.db));
  rectSeriesId = await seedRectificativeSeries(suite.db, nodeId);
  supervisorId = await seedPerson("supervisor");
  managerId = await seedPerson("manager");
  const staffId = await seedPerson("staff");
  supervisorSessionId = await openSession(supervisorId);
  managerSessionId = await openSession(managerId);
  staffSessionId = await openSession(staffId);
});

/** A person of `role` whose PIN is "1234". The role keeps the display names distinct. */
async function seedPerson(role: "staff" | "supervisor" | "manager" | "admin"): Promise<string> {
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: `P ${role}`, pinHash: hashPin("1234"), role })
    .returning({ id: persons.id });
  return row!.id;
}

/** Opens a shift session for `personId` at this tenant's till and returns its id. */
async function openSession(personId: string): Promise<string> {
  const deviceId = (await seedDevice(suite.db, { tillId: tillId })).deviceId;
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId, personId, pin: "1234" }),
  );
  return session.id;
}

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** A `TrustedClock` from `now()` alone; nothing under test calls anything else on it. */
function fixedClock(now: TrustedClock["now"]): TrustedClock {
  return {
    now,
    anchor: () => {
      throw new Error("fixedClock: anchor() is not used by recordSale/recordCorrection");
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

/** The ordinary sale, settled immediately, so "the corrective is unsettled" is not vacuous. */
function saleInput(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    origin: deviceOrigin(deviceId),
    nodeId,
    seriesId,
    locale: "es-ES",
    invoiceLocales: ["es-ES", "ca-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        name: "Coffee",
        descriptions: { "es-ES": "Coffee" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        name: "Water",
        descriptions: { "es-ES": "Water" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE }],
    },
    clock: steadyClock,
    ...overrides,
  };
}

/** A full reversal of the €14.41 sale: negative total and negative delta lines, drawn from the
 * rectificative series. The locale list is inherited from the original, not supplied. */
function correctionInput(
  correctsSaleId: SaleId,
  overrides: Partial<RecordCorrectionInput> = {},
): RecordCorrectionInput {
  return {
    origin: deviceOrigin(deviceId),
    nodeId,
    seriesId: rectSeriesId,
    correctsSaleId,
    total: "-14.41",
    lines: [
      {
        lineNo: 1,
        name: "Coffee",
        descriptions: { "es-ES": "Coffee" },
        quantity: "-2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "-10.00",
      },
      {
        lineNo: 2,
        name: "Water",
        descriptions: { "es-ES": "Water" },
        quantity: "-1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "-2.10",
      },
    ],
    clock: steadyClock,
    // The supervisor holds `sale.rectify`, so green-path corrections authorize on the operator's
    // own role.
    authz: { sessionId: supervisorSessionId },
    ...overrides,
  };
}

/** A one-line credit: `base` plus its tax at `vatRate`, rounded to the cent, is `total`'s magnitude. */
function credit(base: string, total: string, vatRate = "21.00"): Partial<RecordCorrectionInput> {
  return {
    total,
    lines: [
      {
        lineNo: 1,
        name: "Discount",
        descriptions: { "es-ES": "Descuento" },
        quantity: "-1",
        unitPrice: base,
        vatRate,
        lineTotal: `-${base}`,
      },
    ],
  };
}

/** Records an original sale in one transaction, on a node registered with the backend. */
async function sell(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, saleInput(overrides));
  });
}

async function correct(
  backend: FiscalBackend,
  correctsSaleId: SaleId,
  overrides: Partial<RecordCorrectionInput> = {},
) {
  return withTransaction(suite.db, async (tx) => {
    return recordCorrection(tx, backend, correctionInput(correctsSaleId, overrides));
  });
}

/** Counts every row in `table`; the suite helper empties the tables between tests. */
async function countRows(table: string): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)}`,
  );
  return result.rows[0]!.n;
}

/** Rows for one sale: the original, settled by `sell`, has tenders and a settlement of its own. */
async function countForSale(table: string, saleId: SaleId): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)} where sale_id = ${saleId}`,
  );
  return result.rows[0]!.n;
}

/** How many corrective sales point at `originalId`; a refused correction leaves it at zero. */
async function countCorrectives(originalId: SaleId): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from sales where corrects_sale_id = ${originalId}`,
  );
  return result.rows[0]!.n;
}

async function rectSeriesNext(): Promise<number | undefined> {
  const [series] = await suite.db
    .select({ n: invoiceSeries.nextNumber })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.id, rectSeriesId));
  return series?.n;
}

describe("recordCorrection — the corrective's origin", () => {
  async function storedOrigin(id: SaleId) {
    const result = await suite.db.execute<{ source: string; device_id: string | null }>(
      sql`select source, device_id from sales where id = ${id}`,
    );
    return result.rows[0];
  }

  it("stores the device it was issued on", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: original } = await sell(backend);
    const { saleId } = await correct(backend, original, { origin: deviceOrigin(deviceId) });
    expect(await storedOrigin(saleId)).toEqual({ source: "device", device_id: deviceId });
  });

  it("stores a demo seed corrective with no device", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: original } = await sell(backend);
    const { saleId } = await correct(backend, original, { origin: jobOrigin("demo_seed") });
    expect(await storedOrigin(saleId)).toEqual({ source: "demo_seed", device_id: null });
  });

  it("hands the origin to the fiscal backend", async () => {
    const fake = new FakeFiscalBackend(suite.db);
    const { saleId: original } = await sell(fake);
    const seen: SaleForFiscalRecord[] = [];
    const backend: FiscalBackend = Object.assign(Object.create(fake) as FakeFiscalBackend, {
      recordCorrection: (
        tx: Transaction,
        sale: SaleForFiscalRecord,
        extra: Parameters<FiscalBackend["recordCorrection"]>[2],
      ) => {
        seen.push(sale);
        return fake.recordCorrection(tx, sale, extra);
      },
    });
    await correct(backend, original, { origin: jobOrigin("readiness_test") });
    expect(seen.map((sale) => sale.origin)).toEqual([jobOrigin("readiness_test")]);
  });
});

describe("recordCorrection — series purpose guard (§5)", () => {
  it("rejects an ordinary (standard) series: a correction must draw a corrective number", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await expect(correct(backend, saleId, { seriesId })).rejects.toMatchObject({
      code: "sale.series_wrong_purpose",
      params: { seriesId, expected: "rectificative", actual: "standard" },
    });
  });

  it("rejects a RETIRED series: a restored box must never number from the series it was restored with", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const retiredAt = new Date("2026-09-06T10:00:00.000Z");
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt })
      .where(eq(invoiceSeries.id, rectSeriesId));
    try {
      await expect(correct(backend, saleId)).rejects.toMatchObject({
        code: "sale.series_retired",
        params: { seriesId: rectSeriesId, retiredAt: retiredAt.toISOString() },
      });
    } finally {
      await suite.db
        .update(invoiceSeries)
        .set({ retiredAt: null })
        .where(eq(invoiceSeries.id, rectSeriesId));
    }
  });

  it("rejects a series that does not exist", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await expect(
      correct(backend, saleId, {
        seriesId: brandSeriesId("00000000-0000-4000-8000-000000000000"),
      }),
    ).rejects.toMatchObject({ code: "sale.series_not_found" });
  });

  it("rejects a rectificative series belonging to another node", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const other = await seedTenant(suite.db);
    const otherRect = await seedRectificativeSeries(suite.db, other.nodeId, "R2");
    await expect(correct(backend, saleId, { seriesId: otherRect })).rejects.toMatchObject({
      code: "sale.series_wrong_node",
      params: { seriesId: otherRect, expected: other.nodeId, actual: nodeId },
    });
  });
});

describe("recordCorrection — the sale being corrected", () => {
  it("rejects a correction of a sale that does not exist", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    await expect(
      correct(backend, "00000000-0000-4000-8000-000000000000" as SaleId),
    ).rejects.toMatchObject({ code: "sale.not_found" });
  });

  it("rejects a correction when the original was never fiscally recorded", async () => {
    // The original exists in `sales` but has no fiscal record, so the fake backend refuses with
    // `fiscal.sale_not_recorded`.
    const backend = new FakeFiscalBackend(suite.db);
    const bareOriginal = await seedBareSale(suite.db, { deviceId, nodeId, seriesId });
    await expect(correct(backend, bareOriginal)).rejects.toMatchObject({
      code: "fiscal.sale_not_recorded",
      params: { saleId: bareOriginal },
    });
  });

  it("refuses to correct a voided sale (a voided sale is corrected by nothing)", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await withTransaction(suite.db, async (tx) => {
      await recordVoid(tx, backend, saleId, "Wrong table", { sessionId: managerSessionId });
    });
    await expect(correct(backend, saleId)).rejects.toMatchObject({
      code: "sale.voided",
      params: { saleId },
    });
  });
});

describe("recordCorrection — the corrective sale", () => {
  /** Keeps the VAT breakdown each correction hands the backend. */
  class FilesBreakdownsBackend extends FakeFiscalBackend {
    readonly filed: SaleForFiscalRecord["vatBreakdown"][] = [];

    override recordCorrection(
      tx: Transaction,
      sale: SaleForFiscalRecord,
      correction: { correctsSaleId: SaleId },
    ) {
      this.filed.push(sale.vatBreakdown);
      return super.recordCorrection(tx, sale, correction);
    }
  }

  it("records a negative-total corrective sale linked to the original, in state recorded", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    // Read straight off `sales`, so the total is a count of whole cents: -1441 is -14.41.
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe(-1441);
    expect(row?.correctsSaleId).toBe(originalId);
    expect(row?.fiscalState).toBe("recorded");
    expect(row?.locale).toBe("es-ES");
    expect(row?.invoiceLocales).toEqual(["es-ES", "ca-ES"]);
  });

  it("writes the backend's own id into sales.fiscal_backend", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(backend.id).toBe("fake");
    expect(row?.fiscalBackend).toBe(backend.id);
  });

  it("allocates the corrective number from the rectificative series", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.seriesId).toBe(rectSeriesId);
    expect(row?.invoiceNumber).toBe(1);
    const [series] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, rectSeriesId));
    expect(series?.n).toBe(2); // advanced past the number just allocated
  });

  it("records the negative delta lines against the corrective sale", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    const lines = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, correctiveId));
    expect(lines).toHaveLength(2);
    // Whole cents off the table, and a numeric sort: the default one orders numbers as text.
    expect(lines.map((l) => l.lineTotal).sort((x, y) => x - y)).toEqual([-1000, -210]);
  });

  it("asks the backend for a correction record referencing the original", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "correction"]);
    const correction = records[1];
    expect(correction?.saleId).toBe(correctiveId);
    expect(correction?.total).toBe("-14.41");
  });

  it("hands the backend the cent amounts the rows store, not the amounts as typed", async () => {
    const backend = new FilesBreakdownsBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    // -0.055 is stored as -0.06 and the -0.045 line as -0.05, whose 10% is -0.005, rounded -0.01.
    const { saleId: correctiveId } = await correct(
      backend,
      originalId,
      credit("0.045", "-0.055", "10.00"),
    );

    expect((await backend.recordsFor(nodeId))[1]?.total).toBe("-0.06");
    const breakdown = [{ rate: "10.00", base: "-0.05", tax: "-0.01" }];
    expect(backend.filed[0]).toEqual(breakdown);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe(-6);
    expect(row?.vatBreakdown).toEqual(breakdown);
  });

  it("refuses a breakdown that no longer sums to the total once each line is rounded to the cent, writing nothing", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    const discount = credit("0.005", "-0.01", "0.00").lines![0]!;

    // Each -0.005 is stored as -0.01: the lines hold -0.02 against a total of -0.01. Caught inside
    // the transaction, so the transaction commits whatever was written before the refusal.
    await withTransaction(suite.db, async (tx) => {
      await expect(
        recordCorrection(
          tx,
          backend,
          correctionInput(originalId, {
            total: "-0.01",
            lines: [discount, { ...discount, lineNo: 2 }],
          }),
        ),
      ).rejects.toMatchObject({
        code: "sale.total_mismatch",
        params: { declaredTotal: "-0.01", breakdownTotal: "-0.02" },
      });
    });

    expect(await countRows("sales")).toBe(1); // the original alone
    expect((await backend.recordsFor(nodeId)).map((r) => r.kind)).toEqual(["sale"]);
    expect(await rectSeriesNext()).toBe(1);
  });

  it("still files a two-decimal correction whose breakdown does not sum to its total", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    // -1.00 at 21% derives -1.00 - 0.21, against a total of -1.00. No amount is past the cent.
    await correct(backend, originalId, credit("1.00", "-1.00"));

    expect((await backend.recordsFor(nodeId))[1]?.total).toBe("-1.00");
  });
});

describe("recordCorrection — a whole-invoice credit copies the invoice's own VAT split", () => {
  /** Keeps the VAT breakdown each correction hands the backend. */
  class FilesBreakdownsBackend extends FakeFiscalBackend {
    readonly filed: SaleForFiscalRecord["vatBreakdown"][] = [];

    override recordCorrection(
      tx: Transaction,
      sale: SaleForFiscalRecord,
      correction: { correctsSaleId: SaleId },
    ) {
      this.filed.push(sale.vatBreakdown);
      return super.recordCorrection(tx, sale, correction);
    }
  }

  const mosto = {
    lineNo: 1,
    name: "Mosto",
    descriptions: { "es-ES": "Mosto" },
    quantity: "1",
    unitPrice: "0.45",
    vatRate: "21.00",
    lineTotal: "0.45",
    lineGross: "0.55",
  };

  /** 0.55 at 21% as the catalogue invoices it, gross minus base: 0.45 + 0.10. Taxing the 0.45 base
   * instead gives 0.09. */
  function sellMosto(backend: FiscalBackend) {
    return sell(backend, {
      total: "0.55",
      lines: [mosto],
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("0.45"), tax: decimal("0.10") }],
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: "0.55", tipAmount: "0.00", settledAt: BASE }],
      },
    });
  }

  function wholeCredit(overrides: Partial<RecordCorrectionInput> = {}) {
    return {
      wholeInvoice: true,
      total: "-0.55",
      lines: [{ ...mosto, quantity: "-1", lineTotal: "-0.45", lineGross: "-0.55" }],
      ...overrides,
    };
  }

  /** The id of the one line `sellMosto` (or a one-line `sell`) stored, for the credit to name. */
  async function soldLineId(saleId: SaleId): Promise<string> {
    const [row] = await suite.db
      .select({ id: saleLines.id })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId));
    return row!.id;
  }

  /** Runs a correction expected to be refused inside a transaction that then commits, so a number
   * allocated before the refusal would stay allocated. */
  async function expectRefusedUnwritten(
    backend: FakeFiscalBackend,
    originalId: SaleId,
    overrides: Partial<RecordCorrectionInput>,
    refusal: { code: string; params?: Record<string, unknown> },
  ) {
    const correctives = await countCorrectives(originalId);
    const next = await rectSeriesNext();
    const filed = (await backend.recordsFor(nodeId)).map((r) => r.kind);
    await withTransaction(suite.db, async (tx) => {
      await expect(
        recordCorrection(tx, backend, correctionInput(originalId, overrides)),
      ).rejects.toMatchObject(refusal);
    });
    expect(await countCorrectives(originalId)).toBe(correctives);
    expect(await rectSeriesNext()).toBe(next);
    expect((await backend.recordsFor(nodeId)).map((r) => r.kind)).toEqual(filed);
  }

  it("stores and files the invoice's breakdown negated, where the lines would derive another", async () => {
    const backend = new FilesBreakdownsBackend(suite.db);
    const { saleId: originalId } = await sellMosto(backend);
    const [reversed] = wholeCredit().lines;
    const correctsLineId = await soldLineId(originalId);

    const { saleId: correctiveId } = await correct(
      backend,
      originalId,
      wholeCredit({ lines: [{ ...reversed!, correctsLineId }] }),
    );

    const negated = [{ rate: "21.00", base: "-0.45", tax: "-0.10" }];
    expect(backend.filed).toEqual([negated]);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.vatBreakdown).toEqual(negated);
    expect(row?.total).toBe(-55);
    expect((await backend.recordsFor(nodeId))[1]?.total).toBe("-0.55");
  });

  it("still derives the breakdown from the lines when the whole invoice is not asked for", async () => {
    const backend = new FilesBreakdownsBackend(suite.db);
    const { saleId: originalId } = await sellMosto(backend);

    await correct(backend, originalId, wholeCredit({ wholeInvoice: false }));

    expect(backend.filed).toEqual([[{ rate: "21.00", base: "-0.45", tax: "-0.09" }]]);
  });

  it("refuses a total that is not minus the invoice's, writing nothing and using no number", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sellMosto(backend);

    await expectRefusedUnwritten(backend, originalId, wholeCredit({ total: "-0.54" }), {
      code: "sale.correction_not_whole",
      params: { saleId: originalId, invoiceTotal: "0.55", correctionCount: 0, correction: "-0.54" },
    });
  });

  it("refuses an invoice something has already corrected, even upwards", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sellMosto(backend);
    // 0.08 at 21% is 0.10; a raise, so the whole credit would not take the invoice below zero.
    await correct(backend, originalId, {
      total: "0.10",
      lines: [{ ...mosto, unitPrice: "0.08", lineTotal: "0.08", lineGross: "0.10" }],
    });

    await expectRefusedUnwritten(backend, originalId, wholeCredit(), {
      code: "sale.correction_not_whole",
      params: { saleId: originalId, invoiceTotal: "0.55", correctionCount: 1, correction: "-0.55" },
    });
  });

  it("refuses lines whose bases are not the invoice's, rate by rate", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sellMosto(backend);
    const [reversed] = wholeCredit().lines;

    await expectRefusedUnwritten(
      backend,
      originalId,
      wholeCredit({
        lines: [
          { ...reversed!, lineTotal: "-0.40" },
          { ...reversed!, lineNo: 2, vatRate: "10.00", lineTotal: "-0.05" },
        ],
      }),
      {
        code: "sale.correction_lines_mismatch",
        params: {
          saleId: originalId,
          rate: "21.00",
          linesBase: "-0.40",
          breakdownBase: "-0.45",
          linesGross: "-0.55",
          breakdownGross: "-0.55",
        },
      },
    );
  });

  it("refuses a line at a rate the invoice's breakdown does not carry", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sellMosto(backend);
    const [reversed] = wholeCredit().lines;

    await expectRefusedUnwritten(
      backend,
      originalId,
      wholeCredit({
        lines: [reversed!, { ...reversed!, lineNo: 2, vatRate: "10.00", lineTotal: "-0.01" }],
      }),
      {
        code: "sale.correction_lines_mismatch",
        params: {
          saleId: originalId,
          rate: "10.00",
          linesBase: "-0.01",
          breakdownBase: "0",
          linesGross: "-0.55",
          breakdownGross: "0",
        },
      },
    );
  });

  it.each(["-0.54", "1.00"])(
    "refuses lines whose gross, %s, is not the invoice's base plus tax at their rate",
    async (lineGross) => {
      const backend = new FakeFiscalBackend(suite.db);
      const { saleId: originalId } = await sellMosto(backend);
      const [reversed] = wholeCredit().lines;

      await expectRefusedUnwritten(
        backend,
        originalId,
        wholeCredit({ lines: [{ ...reversed!, lineGross }] }),
        {
          code: "sale.correction_lines_mismatch",
          params: {
            saleId: originalId,
            rate: "21.00",
            linesBase: "-0.45",
            breakdownBase: "-0.45",
            linesGross: lineGross,
            breakdownGross: "-0.55",
          },
        },
      );
    },
  );

  it("refuses a gross stated on some lines of a rate and not others, counting the others as none", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sellMosto(backend);
    const [reversed] = wholeCredit().lines;

    await expectRefusedUnwritten(
      backend,
      originalId,
      wholeCredit({
        lines: [
          { ...reversed!, lineTotal: "-0.40", lineGross: "-0.49" },
          { ...reversed!, lineNo: 2, lineTotal: "-0.05", lineGross: null },
        ],
      }),
      {
        code: "sale.correction_lines_mismatch",
        params: {
          saleId: originalId,
          rate: "21.00",
          linesBase: "-0.45",
          breakdownBase: "-0.45",
          linesGross: "-0.49",
          breakdownGross: "-0.55",
        },
      },
    );
  });

  it("credits an invoice whose lines state no gross, comparing their bases alone", async () => {
    const backend = new FilesBreakdownsBackend(suite.db);
    const { saleId: originalId } = await sell(backend, {
      total: "0.55",
      lines: [{ ...mosto, lineGross: null }],
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("0.45"), tax: decimal("0.10") }],
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: "0.55", tipAmount: "0.00", settledAt: BASE }],
      },
    });
    const [reversed] = wholeCredit().lines;
    const correctsLineId = await soldLineId(originalId);

    await correct(
      backend,
      originalId,
      wholeCredit({ lines: [{ ...reversed!, lineGross: null, correctsLineId }] }),
    );

    expect(backend.filed).toEqual([[{ rate: "21.00", base: "-0.45", tax: "-0.10" }]]);
  });

  it.each([
    ["1000000000", "shared.decimal_overflow"],
    ["abc", "shared.invalid_decimal"],
  ])(
    "refuses a line whose quantity %s the converters refuse (overflow, or not a decimal) before a number is allocated",
    async (quantity, code) => {
      const backend = new FakeFiscalBackend(suite.db);
      const { saleId: originalId } = await sellMosto(backend);
      const [reversed] = wholeCredit().lines;

      await expectRefusedUnwritten(
        backend,
        originalId,
        wholeCredit({ lines: [{ ...reversed!, quantity }] }),
        { code, params: { value: quantity } },
      );
    },
  );

  it("refuses to copy an invoice breakdown that does not sum to the invoice's total", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const originalId = await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
      { total: "0.55", vatBreakdown: [{ rate: "21.00", base: "0.45", tax: "0.09" }] },
    );

    await expectRefusedUnwritten(backend, originalId, wholeCredit(), {
      code: "sale.total_mismatch",
      params: { declaredTotal: "-0.55", breakdownTotal: "-0.54" },
    });
  });
});

describe("recordCorrection — decoupled refund (the corrective is unsettled)", () => {
  it("records no tenders and no settlement for the corrective sale", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    expect(await countForSale("tenders", correctiveId)).toBe(0);
    expect(await countForSale("sale_settlements", correctiveId)).toBe(0);
  });
});

describe("recordCorrection — a sale may be corrected more than once", () => {
  it("allows the same original to be corrected twice, each with its own number", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    // Two partial credits: two full reversals would take the invoice below zero, which
    // `sale.correction_exceeds_total` refuses. 0.83 at 21% is 1.00.
    const partial: Partial<RecordCorrectionInput> = {
      total: "-1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Coffee" },
          quantity: "-1",
          unitPrice: "0.83",
          vatRate: "21.00",
          lineTotal: "-0.83",
        },
      ],
    };
    const first = await correct(backend, originalId, partial);
    const second = await correct(backend, originalId, partial);

    const rows = await suite.db.select().from(sales).where(eq(sales.correctsSaleId, originalId));
    expect(rows.map((r) => r.id).sort()).toEqual([first.saleId, second.saleId].sort());
    const numbers = rows.map((r) => r.invoiceNumber).sort();
    expect(numbers).toEqual([1, 2]);
  });
});

describe("recordCorrection — never below zero", () => {
  /** The fake refuses to correct anything but a sale; the `none` backend (fiscal-none) records a
   * correction of a credit note, which this stands in for. */
  class CorrectsCreditNotesBackend extends FakeFiscalBackend {
    override recordCorrection(
      tx: Transaction,
      sale: SaleForFiscalRecord,
      // Kept so the override matches the interface's signature, as in the parent fake.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
      _correction: { correctsSaleId: SaleId },
    ) {
      return this.recordSale(tx, sale);
    }
  }

  it("refuses a correction one cent larger than the invoice, and writes nothing", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    // 11.92 at 21% is 14.42: one cent more than the 14.41 invoice.
    await expect(correct(backend, originalId, credit("11.92", "-14.42"))).rejects.toMatchObject({
      code: "sale.correction_exceeds_total",
      params: { saleId: originalId, remaining: "14.41", correction: "-14.42" },
    });

    expect(await countCorrectives(originalId)).toBe(0);
    expect(await rectSeriesNext()).toBe(1);
    expect((await backend.recordsFor(nodeId)).map((r) => r.kind)).toEqual(["sale"]);
  });

  it("counts the corrections already recorded against the invoice", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    // 9.09 at 10% is 10.00, leaving 4.41 on the invoice.
    await correct(backend, originalId, credit("9.09", "-10.00", "10.00"));

    // 4.02 at 10% is 4.42.
    await expect(
      correct(backend, originalId, credit("4.02", "-4.42", "10.00")),
    ).rejects.toMatchObject({
      code: "sale.correction_exceeds_total",
      params: { saleId: originalId, remaining: "4.41", correction: "-4.42" },
    });

    expect(await countCorrectives(originalId)).toBe(1);
    expect(await rectSeriesNext()).toBe(2);
  });

  it("records a correction that takes the invoice to exactly zero", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    await correct(backend, originalId, credit("9.09", "-10.00", "10.00"));

    // 4.01 at 10% is 4.41, everything left on the invoice.
    const { saleId: correctiveId } = await correct(
      backend,
      originalId,
      credit("4.01", "-4.41", "10.00"),
    );

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe(-441);
    expect(await countCorrectives(originalId)).toBe(2);
  });

  it("still records a correction that raises an invoice already at zero", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    await correct(backend, originalId);

    // 0.83 at 21% is 1.00.
    const { saleId: correctiveId } = await correct(backend, originalId, {
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Coffee" },
          quantity: "1",
          unitPrice: "0.83",
          vatRate: "21.00",
          lineTotal: "0.83",
        },
      ],
    });

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe(100);
  });

  it("records a correction whose total rounds to exactly what is left on the invoice", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    // -14.414 is stored as -14.41, the whole 14.41 invoice.
    const { saleId: correctiveId } = await correct(backend, originalId, credit("11.91", "-14.414"));

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe(-1441);
  });

  it("refuses a correction whose total rounds to one cent more than what is left", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    // -14.415 is stored as -14.42.
    await expect(correct(backend, originalId, credit("11.92", "-14.415"))).rejects.toMatchObject({
      code: "sale.correction_exceeds_total",
      params: { saleId: originalId, remaining: "14.41", correction: "-14.42" },
    });
    expect(await countCorrectives(originalId)).toBe(0);
  });

  it("still records a positive correction of a credit note", async () => {
    const backend = new CorrectsCreditNotesBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    const { saleId: creditId } = await correct(backend, originalId);

    // 0.41 at 21% is 0.50.
    const { saleId: correctiveId } = await correct(backend, creditId, {
      total: "0.50",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Coffee" },
          quantity: "1",
          unitPrice: "0.41",
          vatRate: "21.00",
          lineTotal: "0.41",
        },
      ],
    });

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe(50);
    expect(row?.correctsSaleId).toBe(creditId);
  });

  it("refuses a negative correction of a credit note, which is already below zero", async () => {
    const backend = new CorrectsCreditNotesBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    const { saleId: creditId } = await correct(backend, originalId);

    // 0.41 at 21% is 0.50.
    await expect(correct(backend, creditId, credit("0.41", "-0.50"))).rejects.toMatchObject({
      code: "sale.correction_exceeds_total",
      params: { saleId: creditId, remaining: "-14.41", correction: "-0.50" },
    });
    expect(await countCorrectives(creditId)).toBe(0);
  });

  it("refuses before allocating a number, even when the caller catches the refusal and commits", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    // Caught inside the transaction, so the transaction commits and a number allocated before the
    // refusal would stay allocated.
    await withTransaction(suite.db, async (tx) => {
      await expect(
        recordCorrection(tx, backend, correctionInput(originalId, credit("11.92", "-14.42"))),
      ).rejects.toMatchObject({ code: "sale.correction_exceeds_total" });
    });

    expect(await rectSeriesNext()).toBe(1);
    expect(await countCorrectives(originalId)).toBe(0);
  });
});

describe("recordCorrection — authorization", () => {
  it("records the authorizing supervisor on the corrective sale", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId, {
      authz: { sessionId: supervisorSessionId },
    });

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.authorizedBy).toBe(supervisorId);
  });

  it("records the authorizing manager when a staff session corrects under an override", async () => {
    // The staff operator holds no `sale.rectify`; the manager's PIN authorizes, so `authorized_by`
    // names the manager.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId, {
      authz: { sessionId: staffSessionId, override: { personId: managerId, pin: "1234" } },
    });

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.authorizedBy).toBe(managerId);
  });

  it("refuses a staff session with no override, allocating no number and writing no corrective sale", async () => {
    // A refused correction writes no corrective sale and burns no number: `authorize` runs before
    // `allocateInvoiceNumber`.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    const [before] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, rectSeriesId));

    await expect(
      correct(backend, originalId, { authz: { sessionId: staffSessionId } }),
    ).rejects.toMatchObject({ code: "authorization.not_permitted" });

    const [after] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, rectSeriesId));
    expect(after?.n).toBe(before?.n); // no number burned
    expect(await countCorrectives(originalId)).toBe(0);
  });

  it("returns the series guard before the gate — a wrong-purpose series never leaks an authz error", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await expect(
      correct(backend, saleId, { seriesId, authz: { sessionId: staffSessionId } }),
    ).rejects.toMatchObject({ code: "sale.series_wrong_purpose" });
  });

  it("answers an unauthorised session with the permission refusal, not the invoice's amounts", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    // 11.92 at 21% is 14.42, more than the 14.41 invoice.
    await expect(
      correct(backend, originalId, {
        ...credit("11.92", "-14.42"),
        authz: { sessionId: staffSessionId },
      }),
    ).rejects.toMatchObject({ code: "authorization.not_permitted" });
  });
});

describe("recordCorrection — no fiscal condition blocks a correction (§5)", () => {
  it("completes the correction when chain verification fails, recording an incident on it", async () => {
    // «NUNCA debe interrumpirse». The incident is recorded against the corrective sale.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    backend.breakIntegrity(nodeId, { code: "predecessor-hash-mismatch", params: { sequence: 1 } });

    const { saleId: correctiveId } = await correct(backend, originalId);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "correction"]);
    const rows = await suite.db.select().from(incidents).where(eq(incidents.saleId, correctiveId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.severity).toBe("error");
  });

  it("records a warning incident when the clock is degraded, and still records the correction", async () => {
    const degraded: TrustedClock = fixedClock(() => ({
      instant: BASE,
      offsetMinutes: 60,
      confident: false,
      confidence: "degraded",
      anchorAgeSeconds: 999,
      warning: new AppError("clock.degraded", { deviceId, anchorAgeSeconds: 999 }),
    }));
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId, { clock: degraded });

    const rows = await suite.db.select().from(incidents).where(eq(incidents.saleId, correctiveId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("clock.degraded");
    expect(rows[0]?.severity).toBe("warning");
    // The correction itself still landed: -1441 cents is -14.41.
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe(-1441);
  });

  it("records nothing to incidents when verification and the clock are both clean", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    await correct(backend, originalId);

    // The original sale's own recordSale ran clean too.
    expect(await countRows("incidents")).toBe(0);
  });
});

it("persists the frozen options answers and child links on the issued lines", async () => {
  const backend = new FakeFiscalBackend(suite.db);
  const original = await sell(backend);
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
  const lines = correctionInput(original.saleId).lines.map((line, index) => ({
    ...line,
    optionSnapshots: index === 0 ? optionSnapshots : [],
    parentLineNo: index === 0 ? null : 1,
    category: "Drinks",
  }));
  const { saleId } = await correct(backend, original.saleId, { lines });
  const saved = await suite.db
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  expect(saved.map((line) => line.optionSnapshots)).toEqual([optionSnapshots, []]);
  expect(saved[0]!.parentLineId).toBeNull();
  expect(saved[1]!.parentLineId).toBe(saved[0]!.id);
  expect(saved.map((line) => line.category)).toEqual(["Drinks", "Drinks"]);
});

describe("recordCorrection — a corrective line names the invoice line it reverses", () => {
  /** The original sale's line ids, by line number. */
  async function lineIdsOf(saleId: SaleId): Promise<Map<number, string>> {
    const rows = await suite.db
      .select({ id: saleLines.id, lineNo: saleLines.lineNo })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId));
    return new Map(rows.map((row) => [row.lineNo, row.id]));
  }

  async function linksOf(saleId: SaleId): Promise<(string | null)[]> {
    const rows = await suite.db
      .select({ correctsLineId: saleLines.correctsLineId })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo);
    return rows.map((row) => row.correctsLineId);
  }

  it("stores the original line a partial correction's line names", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    const coffee = (await lineIdsOf(originalId)).get(1)!;

    const [line] = credit("0.83", "-1.00").lines!;
    const { saleId } = await correct(backend, originalId, {
      total: "-1.00",
      lines: [{ ...line!, correctsLineId: coffee }],
    });

    expect(await linksOf(saleId)).toEqual([coffee]);
  });

  it("stores each original line a whole-invoice credit's lines name", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    const ids = await lineIdsOf(originalId);

    const lines = correctionInput(originalId).lines.map((line) => ({
      ...line,
      correctsLineId: ids.get(line.lineNo)!,
    }));
    const { saleId } = await correct(backend, originalId, { wholeInvoice: true, lines });

    expect(await linksOf(saleId)).toEqual([ids.get(1), ids.get(2)]);
  });

  it("stores no link on a partial correction's line that names none", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId } = await correct(backend, originalId);

    expect(await linksOf(saleId)).toEqual([null, null]);
  });

  it.each([false, true])(
    "refuses a line naming a line of another invoice, writing nothing (whole invoice: %s)",
    async (wholeInvoice) => {
      const backend = new FakeFiscalBackend(suite.db);
      const { saleId: originalId } = await sell(backend);
      const { saleId: otherId } = await sell(backend);
      const elsewhere = (await lineIdsOf(otherId)).get(2)!;
      const ids = await lineIdsOf(originalId);
      const lines = correctionInput(originalId).lines.map((line) => ({
        ...line,
        correctsLineId: line.lineNo === 2 ? elsewhere : ids.get(line.lineNo)!,
      }));
      const next = await rectSeriesNext();
      const filed = (await backend.recordsFor(nodeId)).length;

      await withTransaction(suite.db, async (tx) => {
        await expect(
          recordCorrection(tx, backend, correctionInput(originalId, { wholeInvoice, lines })),
        ).rejects.toMatchObject({
          code: "sale.correction_line_not_on_invoice",
          params: { saleId: originalId, lineNo: 2, correctsLineId: elsewhere },
        });
      });

      expect(await countCorrectives(originalId)).toBe(0);
      expect(await rectSeriesNext()).toBe(next);
      expect((await backend.recordsFor(nodeId)).length).toBe(filed);
      expect(await countRows("sale_lines")).toBe(4);
    },
  );

  it("answers an unauthorised session with the permission refusal, not what is on the invoice", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    const { saleId: otherId } = await sell(backend);
    const elsewhere = (await lineIdsOf(otherId)).get(2)!;
    const lines = correctionInput(originalId).lines.map((line) => ({
      ...line,
      correctsLineId: elsewhere,
    }));

    await expect(
      correct(backend, originalId, { lines, authz: { sessionId: staffSessionId } }),
    ).rejects.toMatchObject({ code: "authorization.not_permitted" });
  });
});

describe("recordCorrection — a whole-invoice credit reverses each invoice line exactly once", () => {
  /** Coffee with a free oat-milk extra (a child line at 0.00) and a water: 14.41 as `sell` sells
   * it, so the credit's VAT split matches the invoice's and only the line rules are tested. */
  const soldLines: RecordSaleInput["lines"] = [
    {
      lineNo: 1,
      name: "Coffee",
      descriptions: { "es-ES": "Coffee" },
      quantity: "2",
      unitPrice: "5.00",
      vatRate: "21.00",
      lineTotal: "10.00",
      productId: "product-coffee",
    },
    {
      lineNo: 2,
      name: "Oat milk",
      descriptions: { "es-ES": "Oat milk" },
      quantity: "2",
      unitPrice: "0.00",
      vatRate: "21.00",
      lineTotal: "0.00",
      parentLineNo: 1,
      productId: "product-oat",
    },
    {
      lineNo: 3,
      name: "Water",
      descriptions: { "es-ES": "Water" },
      quantity: "1",
      unitPrice: "2.10",
      vatRate: "10.00",
      lineTotal: "2.10",
      productId: "product-water",
    },
  ];

  async function sellWithExtra(backend: FiscalBackend) {
    const { saleId } = await sell(backend, { lines: soldLines });
    const rows = await suite.db
      .select({ id: saleLines.id, lineNo: saleLines.lineNo })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId));
    const ids = new Map(rows.map((row) => [row.lineNo, row.id]));
    return { originalId: saleId, idOf: (lineNo: number) => ids.get(lineNo)! };
  }

  /** Each sold line with its signs reversed, naming the line it reverses. */
  function reversal(idOf: (lineNo: number) => string): RecordCorrectionInput["lines"] {
    return soldLines.map((line) => ({
      ...line,
      quantity: `-${line.quantity}`,
      lineTotal: line.lineTotal === "0.00" ? "0.00" : `-${line.lineTotal}`,
      correctsLineId: idOf(line.lineNo),
    }));
  }

  async function linksOf(saleId: SaleId) {
    return suite.db
      .select({
        lineNo: saleLines.lineNo,
        id: saleLines.id,
        parentLineId: saleLines.parentLineId,
        correctsLineId: saleLines.correctsLineId,
      })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo);
  }

  /** Refused inside a transaction that then commits, so a number allocated or a row written
   * before the refusal would stay. */
  async function expectNotReversedUnwritten(
    backend: FakeFiscalBackend,
    originalId: SaleId,
    lines: RecordCorrectionInput["lines"],
    params: Record<string, unknown>,
  ) {
    const next = await rectSeriesNext();
    const filed = (await backend.recordsFor(nodeId)).length;
    const lineRows = await countRows("sale_lines");
    await withTransaction(suite.db, async (tx) => {
      await expect(
        recordCorrection(tx, backend, correctionInput(originalId, { wholeInvoice: true, lines })),
      ).rejects.toMatchObject({
        code: "sale.correction_line_not_reversed",
        params: { saleId: originalId, ...params },
      });
    });
    expect(await countCorrectives(originalId)).toBe(0);
    expect(await rectSeriesNext()).toBe(next);
    expect((await backend.recordsFor(nodeId)).length).toBe(filed);
    expect(await countRows("sale_lines")).toBe(lineRows);
  }

  it("accepts a credit whose every line names the invoice line it exactly reverses, extras included", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);

    const { saleId } = await correct(backend, originalId, {
      wholeInvoice: true,
      lines: reversal(idOf),
    });

    const stored = await linksOf(saleId);
    expect(stored.map((row) => row.correctsLineId)).toEqual([idOf(1), idOf(2), idOf(3)]);
    expect(stored[1]!.parentLineId).toBe(stored[0]!.id);
  });

  it("refuses a line that names no invoice line, writing nothing and using no number", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    const lines = reversal(idOf).map((line) =>
      line.lineNo === 3 ? { ...line, correctsLineId: null } : line,
    );

    await expectNotReversedUnwritten(backend, originalId, lines, {
      reason: "names_no_line",
      lineNo: 3,
      correctsLineId: null,
    });
  });

  it("refuses two lines naming the same invoice line", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    // The Water line names Coffee's line as well.
    const lines = reversal(idOf).map((line) =>
      line.lineNo === 3 ? { ...line, correctsLineId: idOf(1) } : line,
    );

    await expectNotReversedUnwritten(backend, originalId, lines, {
      reason: "names_line_twice",
      lineNo: 3,
      correctsLineId: idOf(1),
    });
  });

  it("refuses an exact reversal of one invoice line given twice, every line named", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    // Two exact reversals of the free extra, so the reversal rule alone cannot see it.
    const lines = reversal(idOf);
    lines.push({ ...lines[1]!, lineNo: 4 });

    await expectNotReversedUnwritten(backend, originalId, lines, {
      reason: "names_line_twice",
      lineNo: 4,
      correctsLineId: idOf(2),
    });
  });

  it("refuses two lines whose links are swapped", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    const lines = reversal(idOf).map((line) =>
      line.lineNo === 1
        ? { ...line, correctsLineId: idOf(3) }
        : line.lineNo === 3
          ? { ...line, correctsLineId: idOf(1) }
          : line,
    );

    await expectNotReversedUnwritten(backend, originalId, lines, {
      reason: "not_exact_reversal",
      lineNo: 1,
      correctsLineId: idOf(3),
    });
  });

  it("refuses a credit that leaves an invoice line unnamed", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    // The free extra's line is left out; every rate still sums to the invoice's.
    const lines = reversal(idOf).filter((line) => line.lineNo !== 2);

    await expectNotReversedUnwritten(backend, originalId, lines, {
      reason: "leaves_line_unnamed",
      lineNo: null,
      correctsLineId: idOf(2),
    });
  });

  it.each([
    ["a quantity", { quantity: "-1" }],
    ["a quantity past the third decimal place", { quantity: "-2.001" }],
    ["a positive quantity", { quantity: "2" }],
  ])("refuses %s that is not minus the invoice line's", async (_, change) => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    const lines = reversal(idOf).map((line) => (line.lineNo === 1 ? { ...line, ...change } : line));

    await expectNotReversedUnwritten(backend, originalId, lines, {
      reason: "not_exact_reversal",
      lineNo: 1,
      correctsLineId: idOf(1),
    });
  });

  it("refuses a line total that is not minus the invoice line's, though the rate's total is", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    // A cent moved from Coffee to its extra: the 21% base still sums to -10.00.
    const lines = reversal(idOf).map((line) =>
      line.lineNo === 1
        ? { ...line, lineTotal: "-9.99" }
        : line.lineNo === 2
          ? { ...line, lineTotal: "-0.01" }
          : line,
    );

    await expectNotReversedUnwritten(backend, originalId, lines, {
      reason: "not_exact_reversal",
      lineNo: 1,
      correctsLineId: idOf(1),
    });
  });

  it.each([
    ["another product", "product-tea"],
    ["no product", null],
  ])("refuses a line naming %s than the invoice line it names", async (_, productId) => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    const lines = reversal(idOf).map((line) => (line.lineNo === 3 ? { ...line, productId } : line));

    await expectNotReversedUnwritten(backend, originalId, lines, {
      reason: "not_exact_reversal",
      lineNo: 3,
      correctsLineId: idOf(3),
    });
  });

  it("still refuses a line naming a line of another invoice with its own code, before these rules", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    const { idOf: otherIdOf } = await sellWithExtra(backend);
    // Line 1 breaks a whole-invoice rule; line 3 names another invoice's line.
    const lines = reversal(idOf).map((line) =>
      line.lineNo === 1
        ? { ...line, correctsLineId: null }
        : line.lineNo === 3
          ? { ...line, correctsLineId: otherIdOf(3) }
          : line,
    );

    await withTransaction(suite.db, async (tx) => {
      await expect(
        recordCorrection(tx, backend, correctionInput(originalId, { wholeInvoice: true, lines })),
      ).rejects.toMatchObject({
        code: "sale.correction_line_not_on_invoice",
        params: { saleId: originalId, lineNo: 3, correctsLineId: otherIdOf(3) },
      });
    });
  });

  it("keeps a partial correction free to leave a line unnamed and to name a line twice", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { originalId, idOf } = await sellWithExtra(backend);
    const [coffee] = reversal(idOf);

    const { saleId } = await correct(backend, originalId, {
      total: "-2.42",
      lines: [
        { ...coffee!, quantity: "-1", lineTotal: "-1.00", correctsLineId: idOf(1) },
        { ...coffee!, lineNo: 2, quantity: "-1", lineTotal: "-1.00", correctsLineId: idOf(1) },
        { ...coffee!, lineNo: 3, quantity: "-1", lineTotal: "0.00", correctsLineId: null },
      ],
    });

    expect((await linksOf(saleId)).map((row) => row.correctsLineId)).toEqual([
      idOf(1),
      idOf(1),
      null,
    ]);
  });
});
