import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError, seriesId as brandSeriesId } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  incidents,
  invoiceSeries,
  saleLines,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin, persons } from "@waitron/identity";
import { recordCorrection } from "./record-correction.js";
import type { RecordCorrectionInput } from "./record-correction.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { seedBareSale, seedRectificativeSeries, seedTenant } from "../test/fixtures.js";

let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId; // the ordinary (purpose='standard') series seedTenant creates
let rectSeriesId: SeriesId; // a purpose='rectificative' series on the same node
// `supervisorId` holds `sale.rectify`, so `supervisorSessionId` authorizes every green-path
// correction; `staffId` holds nothing; `managerId` is the second person whose PIN unlocks an
// override, and also holds `sale.void`, so `managerSessionId` authorizes the one precondition void.
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
  ({ tillId, nodeId, seriesId } = await seedTenant(suite.db));
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
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { tillId, personId, pin: "1234" }),
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
    tillId,
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
    tillId,
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
    const bareOriginal = await seedBareSale(suite.db, { tillId, nodeId, seriesId });
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

    const first = await correct(backend, originalId);
    const second = await correct(backend, originalId);

    const rows = await suite.db.select().from(sales).where(eq(sales.correctsSaleId, originalId));
    expect(rows.map((r) => r.id).sort()).toEqual([first.saleId, second.saleId].sort());
    const numbers = rows.map((r) => r.invoiceNumber).sort();
    expect(numbers).toEqual([1, 2]);
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
    // The staff operator holds nothing; the manager's PIN authorizes, so `authorized_by` names the
    // manager.
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
      warning: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
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
