import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError, decimal, seriesId as brandSeriesId, deviceOrigin } from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
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
import { seedDevice } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, startManagementSession } from "@waitron/identity";
import { recordCorrection } from "./record-correction.js";
import { recordReplacement } from "./record-replacement.js";
import type { RecordReplacementInput } from "./record-replacement.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { seedRectificativeSeries, seedTenant } from "../test/fixtures.js";

let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;
let rectSeriesId: SeriesId;
let supervisorId: string;
let supervisorSessionId: string;
let staffSessionId: string;
let managerSessionId: string;

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ deviceId, nodeId, seriesId } = await seedTenant(suite.db));
  rectSeriesId = await seedRectificativeSeries(suite.db, nodeId);
  supervisorId = await seedPerson("supervisor");
  supervisorSessionId = await openSession(supervisorId);
  staffSessionId = await openSession(await seedPerson("staff"));
  managerSessionId = await openSession(await seedPerson("manager"));
});

async function seedPerson(role: "staff" | "supervisor" | "manager"): Promise<string> {
  const [row] = await seedPersons(suite.db, {
    displayName: `P ${role}`,
    pinHash: hashPin("1234"),
    role,
  });
  return row!.id;
}

async function openSession(personId: string): Promise<string> {
  const { deviceId: till } = await seedDevice(suite.db, {});
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId: till, personId, pin: "1234" }),
  );
  return session.id;
}

const steadyClock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-03-02T13:05:00+01:00"),
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used here");
  },
  currentAnchor: () => null,
};

/** A 12.10 ticket: one line, 10.00 base and 2.10 VAT at 21%. */
async function sell(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId,
      locale: "ca-ES",
      invoiceLocales: ["ca-ES", "es-ES"],
      total: "12.10",
      lines: [
        {
          lineNo: 1,
          name: "Menu",
          descriptions: { "es-ES": "Menú", "ca-ES": "Menú" },
          quantity: "2",
          unitPrice: "6.05",
          vatRate: "21.00",
          lineTotal: "10.00",
          lineGross: "12.10",
        },
      ],
      settlement: {
        kind: "immediate",
        tenders: [{ method: "card", amount: "12.10", tipAmount: "0.00", settledAt: new Date() }],
      },
      clock: steadyClock,
      ...overrides,
    });
  });
}

function replacementInput(
  correctsSaleId: SaleId,
  overrides: Partial<RecordReplacementInput> = {},
): RecordReplacementInput {
  return {
    origin: deviceOrigin(deviceId),
    nodeId,
    seriesId: rectSeriesId,
    correctsSaleId,
    authz: { sessionId: supervisorSessionId },
    clock: steadyClock,
    ...overrides,
  };
}

function replace(
  backend: FiscalBackend,
  correctsSaleId: SaleId,
  overrides: Partial<RecordReplacementInput> = {},
) {
  return withTransaction(suite.db, (tx) =>
    recordReplacement(tx, backend, replacementInput(correctsSaleId, overrides)),
  );
}

async function rectSeriesNext(): Promise<number | undefined> {
  const [series] = await suite.db
    .select({ n: invoiceSeries.nextNumber })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.id, rectSeriesId));
  return series?.n;
}

async function countCorrectives(originalId: SaleId): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from sales where corrects_sale_id = ${originalId}`,
  );
  return rows[0]!.n;
}

describe("recordReplacement — the replacement sale", () => {
  it("stores the original's total, VAT split and lines, flagged as replacing it, under a corrective number", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId } = await replace(backend, originalId);

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row).toMatchObject({
      total: 1210,
      vatBreakdown: [{ rate: "21.00", base: "10.00", tax: "2.10" }],
      correctsSaleId: originalId,
      replacesOriginal: true,
      seriesId: rectSeriesId,
      invoiceNumber: 1,
      locale: "ca-ES",
      invoiceLocales: ["ca-ES", "es-ES"],
      authorizedBy: supervisorId,
      issuedAt: "2026-03-02T12:05:00.000Z",
    });
    expect(await rectSeriesNext()).toBe(2);

    const [originalLine] = await suite.db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, originalId));
    const lines = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.id).not.toBe(originalLine!.id);
    expect(lines[0]).toEqual({
      ...originalLine,
      id: lines[0]!.id,
      saleId,
      correctsLineId: null,
    });
  });

  it("keeps each extra under its own copied dish", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend, {
      lines: [
        {
          lineNo: 1,
          name: "Burger",
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1",
          unitPrice: "9.00",
          vatRate: "21.00",
          lineTotal: "9.00",
        },
        {
          lineNo: 2,
          parentLineNo: 1,
          name: "Cheese",
          descriptions: { "es-ES": "Queso" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "21.00",
          lineTotal: "1.00",
        },
      ],
    });

    const { saleId } = await replace(backend, originalId);

    const lines = await suite.db
      .select({ id: saleLines.id, lineNo: saleLines.lineNo, parentLineId: saleLines.parentLineId })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo);
    expect(lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(lines[0]!.parentLineId).toBeNull();
    expect(lines[1]!.parentLineId).toBe(lines[0]!.id);
  });

  it("asks the backend for a correction by replacement, at the original's amounts", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId } = await replace(backend, originalId);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => [r.saleId, r.kind, r.total])).toEqual([
      [originalId, "sale", "12.10"],
      [saleId, "correction", "12.10"],
    ]);
    expect(await backend.replacementsFor(nodeId)).toEqual([saleId]);
  });

  it("files the original's stored VAT split, not one derived again from its lines", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend, {
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.01"), tax: decimal("2.09") }],
    });
    const stored = [{ rate: "21.00", base: "10.01", tax: "2.09" }];

    const { saleId } = await replace(backend, originalId);

    const [row] = await suite.db
      .select({ vatBreakdown: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.id, saleId));
    expect(row!.vatBreakdown).toEqual(stored);
    const filed = await withTransaction(suite.db, (tx) => backend.filedFiguresFor(tx, [saleId]));
    expect(filed.get(saleId)).toMatchObject({
      readable: true,
      newest: {
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.01"), tax: decimal("2.09") }],
      },
    });
  });
});

describe("recordReplacement — refusals use no number", () => {
  async function expectRefused(
    backend: FiscalBackend,
    originalId: SaleId,
    overrides: Partial<RecordReplacementInput>,
    refusal: { code: string; params?: Record<string, unknown> },
    correctivesBefore = 0,
  ) {
    await expect(replace(backend, originalId, overrides)).rejects.toMatchObject(refusal);
    expect(await rectSeriesNext()).toBe(correctivesBefore + 1);
    expect(await countCorrectives(originalId)).toBe(correctivesBefore);
  }

  it("refuses a sale that does not exist", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const missing = "00000000-0000-4000-8000-000000000000" as SaleId;
    await expect(replace(backend, missing)).rejects.toMatchObject({
      code: "sale.not_found",
      params: { saleId: missing },
    });
    expect(await rectSeriesNext()).toBe(1);
  });

  it("refuses a voided original", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await withTransaction(suite.db, (tx) =>
      recordVoid(tx, backend, saleId, "Wrong table", { sessionId: managerSessionId }, nodeId),
    );
    await expectRefused(backend, saleId, {}, { code: "sale.voided", params: { saleId } });
  });

  it("refuses a series that is not a rectificative one", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await expectRefused(
      backend,
      saleId,
      { seriesId },
      {
        code: "sale.series_wrong_purpose",
        params: { seriesId, expected: "rectificative", actual: "standard" },
      },
    );
  });

  it("refuses another node's rectificative series", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const other = await seedTenant(suite.db);
    const otherRect = await seedRectificativeSeries(suite.db, other.nodeId, "R2");
    await expect(replace(backend, saleId, { seriesId: otherRect })).rejects.toMatchObject({
      code: "sale.series_wrong_node",
      params: { seriesId: otherRect, expected: other.nodeId, actual: nodeId },
    });
    expect(await countCorrectives(saleId)).toBe(0);
  });

  it("refuses a retired series", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const retiredAt = new Date("2026-09-06T10:00:00.000Z");
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt })
      .where(eq(invoiceSeries.id, rectSeriesId));
    await expectRefused(
      backend,
      saleId,
      {},
      {
        code: "sale.series_retired",
        params: { seriesId: rectSeriesId, retiredAt: retiredAt.toISOString() },
      },
    );
  });

  it("refuses a session without sale.rectify", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await expectRefused(
      backend,
      saleId,
      { authz: { sessionId: staffSessionId } },
      { code: "authorization.not_permitted" },
    );
  });

  it("refuses a full invoice", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const [fullSeries] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId, code: "F", purpose: "full" })
      .returning({ id: invoiceSeries.id });
    suite.db.run(
      sql`update tenants set taxpayer_domicile = 'Calle Fiscal 8, 28001 Madrid' where id = 1`,
    );
    const { saleId } = await sell(backend, {
      seriesId: brandSeriesId(fullSeries!.id),
      counterparty: { taxId: "12345678Z", legalName: "Ana García", countryCode: "ES" },
      recipientAddress: "Calle Mayor 2, 28013 Madrid, España",
    });
    await expectRefused(
      backend,
      saleId,
      {},
      { code: "sale.correction_unsupported", params: { saleId } },
    );
  });

  it("refuses an original an earlier partial refund already corrects", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await withTransaction(suite.db, (tx) =>
      recordCorrection(tx, backend, {
        origin: deviceOrigin(deviceId),
        nodeId,
        seriesId: rectSeriesId,
        correctsSaleId: saleId,
        total: "-6.05",
        lines: [
          {
            lineNo: 1,
            name: "Menu",
            descriptions: { "es-ES": "Menú" },
            quantity: "-1",
            unitPrice: "6.05",
            vatRate: "21.00",
            lineTotal: "-5.00",
          },
        ],
        authz: { sessionId: supervisorSessionId },
        clock: steadyClock,
      }),
    );

    await expectRefused(
      backend,
      saleId,
      {},
      { code: "sale.replacement_not_first", params: { saleId } },
      1,
    );
  });
});

describe("recordReplacement — sign-in and warnings", () => {
  it("records the person signed in on the dashboard as its authorizer", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: supervisorId }),
    );

    const { saleId } = await replace(backend, originalId, {
      authz: { managementSessionId: session.token },
    });

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row!.authorizedBy).toBe(supervisorId);
  });

  it("completes when chain verification fails or the clock is degraded, recording both on it", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    backend.breakIntegrity(nodeId, { code: "predecessor-hash-mismatch", params: { sequence: 1 } });
    const degraded: TrustedClock = {
      ...steadyClock,
      now: () => ({
        ...steadyClock.now(),
        confident: false,
        confidence: "degraded",
        anchorAgeSeconds: 999,
        warning: new AppError("clock.degraded", { deviceId, anchorAgeSeconds: 999 }),
      }),
    };

    const { saleId } = await replace(backend, originalId, { clock: degraded });

    const rows = await suite.db.select().from(incidents).where(eq(incidents.saleId, saleId));
    expect(rows.map((r) => [r.code, r.severity])).toEqual([
      ["chain.verification_failed", "error"],
      ["clock.degraded", "warning"],
    ]);
  });
});
