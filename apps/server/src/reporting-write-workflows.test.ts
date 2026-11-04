import { beforeEach, describe, expect, it } from "vitest";
import {
  invoiceSeries,
  purchaseInvoiceVat,
  purchaseInvoices,
  sales,
  withTransaction,
} from "@waitron/db";
import { seedDevice, seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordCorrection, recordSale, settleSale, withIssuanceTransaction } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import { prepareIssueClock, type TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  computeDailyClose,
  computeVatReturn,
  computeVatSummaryForPeriod,
  mapModelo303,
  recordDailyClose,
  resolveVenueClock,
  toDr303Record,
  verifyDailyCloseChain,
} from "@waitron/reporting";
import {
  addDecimal,
  decimal,
  deviceOrigin,
  jobOrigin,
  seriesId,
  stringToBasisPoints,
  stringToCents,
  sumDecimals,
} from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";

const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((set) => ["core", "identity"].includes(set.name)),
    null,
  ),
});
interface Issuer {
  nodeId: NodeId;
  seriesId: SeriesId;
  correctionSeriesId: SeriesId;
}
let issuer: Issuer;
let backend: FakeFiscalBackend;
let tillOne: DeviceId;
let tillTwo: DeviceId;
let sessionId: string;

async function seedIssuer(): Promise<Issuer> {
  const nodeId = await seedNode(suite.db);
  const [ordinary] = await suite.db.insert(invoiceSeries).values({ nodeId, code: "A" }).returning();
  const [correction] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "R", purpose: "rectificative" })
    .returning();
  await withTransaction(suite.db, (tx) => backend.registerNode(tx, nodeId));
  return { nodeId, seriesId: seriesId(ordinary!.id), correctionSeriesId: seriesId(correction!.id) };
}
function clockAt(day: string): TrustedClock {
  return {
    now: () => ({
      instant: new Date(`${day}T10:00:00Z`),
      offsetMinutes: 120,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("Unexpected anchor request");
    },
    currentAnchor: () => null,
  };
}
async function sell(input: {
  day: string;
  base: string;
  rate: string;
  tax: string;
  issuer?: Issuer;
  device?: DeviceId;
  method?: string;
}): Promise<SaleId> {
  const owner = input.issuer ?? issuer;
  const total = addDecimal(decimal(input.base), decimal(input.tax));
  const clock = clockAt(input.day);
  const sale: RecordSaleInput = {
    origin: input.device ? deviceOrigin(input.device) : jobOrigin("demo_seed"),
    nodeId: owner.nodeId,
    seriesId: owner.seriesId,
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    total,
    lines: [
      {
        lineNo: 1,
        name: "Meal",
        descriptions: { "en-GB": "Meal" },
        quantity: "1",
        unitPrice: input.base,
        vatRate: input.rate,
        lineTotal: input.base,
      },
    ],
    vatBreakdown: [
      { rate: decimal(input.rate), base: decimal(input.base), tax: decimal(input.tax) },
    ],
    clock,
    settlement: input.method
      ? {
          kind: "immediate",
          tenders: [
            {
              method: input.method,
              amount: total,
              tipAmount: "0.00",
              settledAt: clock.now().instant,
            },
          ],
        }
      : { kind: "deferred" },
  };
  return withIssuanceTransaction(
    suite.db,
    async (tx) =>
      (
        await recordSale(tx, backend, {
          ...sale,
          clock: await prepareIssueClock(tx, owner, clock),
        })
      ).saleId,
  );
}
async function correct(saleId: SaleId, day: string): Promise<void> {
  await withIssuanceTransaction(suite.db, async (tx) => {
    await recordCorrection(tx, backend, {
      origin: jobOrigin("demo_seed"),
      nodeId: issuer.nodeId,
      seriesId: issuer.correctionSeriesId,
      correctsSaleId: saleId,
      total: "-6.05",
      lines: [
        {
          lineNo: 1,
          name: "Meal correction",
          descriptions: { "en-GB": "Meal correction" },
          quantity: "1",
          unitPrice: "-5.00",
          vatRate: "21.00",
          lineTotal: "-5.00",
        },
      ],
      clock: await prepareIssueClock(tx, issuer, clockAt(day)),
      authz: { sessionId },
    });
  });
}
async function expectAugustMadridSales(count: number) {
  const rows = await suite.db
    .select({ at: sales.issuedAt, offset: sales.issuedOffsetMinutes })
    .from(sales);
  expect(rows).toHaveLength(count);
  for (const row of rows) {
    expect(row.at).toMatch(/^2026-08-\d\dT10:00:00/);
    expect(row.offset).toBe(120);
  }
}
beforeEach(async () => {
  await seedVenue(suite.db, {
    timeZone: "Europe/Madrid",
    dayCutover: "05:00:00",
    invoiceLocales: ["en-GB"],
  });
  await FakeFiscalBackend.install(suite.db);
  backend = new FakeFiscalBackend(suite.db);
  issuer = await seedIssuer();
  tillOne = (await seedDevice(suite.db, { label: "Till one", capabilities: ["take-cash"] }))
    .deviceId;
  tillTwo = (await seedDevice(suite.db, { label: "Till two", capabilities: ["take-cash"] }))
    .deviceId;
  const [person] = await suite.db
    .insert(persons)
    .values({
      displayName: "Supervisor",
      email: "supervisor@example.test",
      pinHash: hashPin("1234"),
      role: "supervisor",
    })
    .returning();
  sessionId = (
    await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, {
        deviceId: tillOne,
        personId: person!.id,
        pin: "1234",
      }),
    )
  ).id;
});

describe("reporting over recorded sales", () => {
  it("nets a correction in VAT while keeping immediate and later settlements in cash-up", async () => {
    const first = await sell({
      day: "2026-08-04",
      base: "100.00",
      rate: "21.00",
      tax: "21.00",
      method: "cash",
    });
    const later = await sell({ day: "2026-08-04", base: "50.00", rate: "10.00", tax: "5.00" });
    await withTransaction(suite.db, (tx) =>
      settleSale(tx, {
        saleId: later,
        tenders: [
          {
            method: "card",
            amount: "55.00",
            tipAmount: "0.00",
            settledAt: new Date("2026-08-04T16:00:00Z"),
          },
        ],
      }),
    );
    await correct(first, "2026-08-04");
    const close = await withTransaction(suite.db, async (tx) =>
      computeDailyClose(tx, {
        nodeId: issuer.nodeId,
        businessDay: "2026-08-04",
        ...(await resolveVenueClock(tx, issuer.nodeId)),
      }),
    );
    expect(close.vat).toEqual({
      byRate: [
        { rate: "10.00", base: "50.00", tax: "5.00" },
        { rate: "21.00", base: "95.00", tax: "19.95" },
      ],
      baseTotal: "145.00",
      taxTotal: "24.95",
      grossTotal: "169.95",
    });
    expect(close.counts).toEqual({ sales: 2, corrections: 1, voids: 0 });
    expect(close.cash.tenderTotal).toBe("176.00");
    expect(close.cash.tipTotal).toBe("0.00");
    expect(close.cash.byOrigin).toEqual([
      {
        source: "demo_seed",
        deviceId: null,
        cashTakings: "121.00",
        byMethod: [
          { method: "card", amount: "55.00", tip: "0.00" },
          { method: "cash", amount: "121.00", tip: "0.00" },
        ],
      },
    ]);
    await expectAugustMadridSales(3);
  });

  it("freezes two tills' cash variances, refuses a duplicate day and chains the next close", async () => {
    for (const [device, base, rate, tax, method] of [
      [tillOne, "100.00", "21.00", "21.00", "cash"],
      [tillOne, "40.00", "10.00", "4.00", "card"],
      [tillTwo, "50.00", "10.00", "5.00", "cash"],
      [tillTwo, "20.00", "21.00", "4.20", "card"],
    ] as const)
      await sell({ day: "2026-08-04", device, base, rate, tax, method });
    const cashCounts = [
      { deviceId: tillOne, openingFloat: "50.00", payouts: "0.00", countedCash: "172.50" },
      { deviceId: tillTwo, openingFloat: "30.00", payouts: "0.00", countedCash: "83.00" },
    ];
    const closeDay = (businessDay: string, counts = cashCounts) =>
      withTransaction(suite.db, (tx) =>
        recordDailyClose(tx, {
          nodeId: issuer.nodeId,
          businessDay,
          timeZone: "Europe/Madrid",
          closedBy: "supervisor",
          cashCounts: counts,
        }),
      );
    const first = await closeDay("2026-08-04");
    expect(first.sequenceNo).toBe(1);
    expect(first.prevEntryHash).toBe("");
    expect(first.snapshot.close.vat).toEqual({
      byRate: [
        { rate: "10.00", base: "90.00", tax: "9.00" },
        { rate: "21.00", base: "120.00", tax: "25.20" },
      ],
      baseTotal: "210.00",
      taxTotal: "34.20",
      grossTotal: "244.20",
    });
    expect(first.snapshot.close.counts).toEqual({ sales: 4, corrections: 0, voids: 0 });
    expect(first.snapshot.close.cash.tenderTotal).toBe("244.20");
    expect(
      Object.fromEntries(
        first.snapshot.cashReconciliation.byDevice.map((row) => [
          row.deviceId,
          {
            cashTakings: row.cashTakings,
            cashVariance: row.cashVariance,
          },
        ]),
      ),
    ).toEqual({
      [tillOne]: { cashTakings: "121.00", cashVariance: "1.50" },
      [tillTwo]: { cashTakings: "55.00", cashVariance: "-2.00" },
    });
    expect(first.snapshot.cashReconciliation.nodeVariance).toBe("-0.50");
    expect(
      await withTransaction(suite.db, (tx) => verifyDailyCloseChain(tx, issuer.nodeId)),
    ).toMatchObject({ ok: true });
    await expect(closeDay("2026-08-04")).rejects.toMatchObject({ code: "close.already_closed" });
    await sell({
      day: "2026-08-05",
      device: tillOne,
      base: "80.00",
      rate: "21.00",
      tax: "16.80",
      method: "cash",
    });
    const second = await closeDay("2026-08-05", [
      { deviceId: tillOne, openingFloat: "100.00", payouts: "0.00", countedCash: "196.80" },
    ]);
    expect(second.sequenceNo).toBe(2);
    expect(second.prevEntryHash).toBe(first.entryHash);
    expect(second.snapshot.cashReconciliation.nodeVariance).toBe("0.00");
    expect(
      await withTransaction(suite.db, (tx) => verifyDailyCloseChain(tx, issuer.nodeId)),
    ).toMatchObject({ ok: true });
    await expectAugustMadridSales(5);
  });

  it("reconciles the worked Spain VAT return across nodes, weeks, months and DR303 files", async () => {
    const other = await seedIssuer();
    const first = await sell({ day: "2026-08-03", base: "100.00", rate: "21.00", tax: "21.00" });
    for (const [owner, day, base, rate, tax] of [
      [issuer, "2026-08-10", "50.00", "10.00", "5.00"],
      [issuer, "2026-08-17", "200.00", "21.00", "42.00"],
      [other, "2026-08-05", "80.00", "10.00", "8.00"],
      [other, "2026-08-12", "40.00", "21.00", "8.40"],
      [other, "2026-08-24", "30.00", "10.00", "3.00"],
    ] as const)
      await sell({ issuer: owner, day, base, rate, tax });
    await correct(first, "2026-08-18");
    await withTransaction(suite.db, async (tx) => {
      for (const [number, issuedOn, receivedOn, base, tax, rate, kind, regime] of [
        ["2026/501", "2026-08-01", "2026-08-04", "200.00", "41.99", "21.00", "ordinary", "general"],
        ["F-88", "2026-08-06", "2026-08-09", "100.00", "10.00", "10.00", "ordinary", "general"],
        ["INV-7", "2026-08-11", "2026-08-14", "1000.00", "210.00", "21.00", "capital", "general"],
        [
          "T-3",
          "2026-08-17",
          "2026-08-20",
          "50.00",
          "10.50",
          "21.00",
          "ordinary",
          "equivalence_surcharge",
        ],
      ] as const) {
        const [invoice] = await tx
          .insert(purchaseInvoices)
          .values({
            supplierTaxId: "B11111111",
            supplierName: "Supplier",
            deductibleProportion: 10000,
            supplierInvoiceNumber: number,
            issuedOn,
            receivedOn,
            total: stringToCents(addDecimal(decimal(base), decimal(tax))),
            regime,
          })
          .returning();
        await tx.insert(purchaseInvoiceVat).values({
          purchaseInvoiceId: invoice!.id,
          base: stringToCents(base),
          tax: stringToCents(tax),
          rate: stringToBasisPoints(rate),
          kind,
        });
      }
    });
    const month = await withTransaction(suite.db, (tx) =>
      computeVatReturn(tx, { year: 2026, period: { kind: "month", month: 8 } }),
    );
    const expectedOutput = [
      { rate: "10.00", base: "160.00", tax: "16.00" },
      { rate: "21.00", base: "335.00", tax: "70.35" },
    ];
    expect(month).toEqual({
      year: 2026,
      period: { kind: "month", month: 8 },
      byRate: expectedOutput,
      baseTotal: "495.00",
      taxTotal: "86.35",
      deductible: {
        byRate: [
          { rate: "10.00", base: "100.00", tax: "10.00", kind: "ordinary" },
          { rate: "21.00", base: "200.00", tax: "41.99", kind: "ordinary" },
          { rate: "21.00", base: "1000.00", tax: "210.00", kind: "capital" },
        ],
        baseTotal: "1300.00",
        taxTotal: "261.99",
      },
      result: "-175.64",
    });
    const summaries = await withTransaction(suite.db, async (tx) => {
      const range = {
        ...(await resolveVenueClock(tx, issuer.nodeId)),
        fromBusinessDay: "2026-08-01",
        toBusinessDay: "2026-08-31",
      };
      return [
        await computeVatSummaryForPeriod(tx, range),
        await computeVatSummaryForPeriod(tx, { ...range, nodeId: issuer.nodeId }),
        await computeVatSummaryForPeriod(tx, { ...range, nodeId: other.nodeId }),
        await computeVatSummaryForPeriod(tx, {
          ...range,
          fromBusinessDay: "2026-08-03",
          toBusinessDay: "2026-08-09",
        }),
      ];
    });
    expect(summaries).toEqual([
      { byRate: expectedOutput, baseTotal: "495.00", taxTotal: "86.35", grossTotal: "581.35" },
      {
        byRate: [
          { rate: "10.00", base: "50.00", tax: "5.00" },
          { rate: "21.00", base: "295.00", tax: "61.95" },
        ],
        baseTotal: "345.00",
        taxTotal: "66.95",
        grossTotal: "411.95",
      },
      {
        byRate: [
          { rate: "10.00", base: "110.00", tax: "11.00" },
          { rate: "21.00", base: "40.00", tax: "8.40" },
        ],
        baseTotal: "150.00",
        taxTotal: "19.40",
        grossTotal: "169.40",
      },
      {
        byRate: [
          { rate: "10.00", base: "80.00", tax: "8.00" },
          { rate: "21.00", base: "100.00", tax: "21.00" },
        ],
        baseTotal: "180.00",
        taxTotal: "29.00",
        grossTotal: "209.00",
      },
    ]);
    const [july, september, quarter, annual] = await withTransaction(suite.db, async (tx) => [
      await computeVatReturn(tx, { year: 2026, period: { kind: "month", month: 7 } }),
      await computeVatReturn(tx, { year: 2026, period: { kind: "month", month: 9 } }),
      await computeVatReturn(tx, { year: 2026, period: { kind: "quarter", quarter: 3 } }),
      await computeVatReturn(tx, { year: 2026, period: { kind: "year" } }),
    ]);
    expect(july!.byRate).toEqual([]);
    expect(september!.byRate).toEqual([]);
    for (const aggregate of [quarter!, annual!]) {
      expect(aggregate.byRate).toEqual(expectedOutput);
      expect(aggregate.baseTotal).toBe("495.00");
      expect(aggregate.taxTotal).toBe("86.35");
      expect(aggregate.deductible).toEqual(month.deductible);
      expect(aggregate.result).toBe("-175.64");
    }
    for (const field of ["baseTotal", "taxTotal", "result"] as const)
      expect(sumDecimals([july![field], month[field], september![field]])).toBe(quarter![field]);
    expect(
      sumDecimals([
        july!.deductible.taxTotal,
        month.deductible.taxTotal,
        september!.deductible.taxTotal,
      ]),
    ).toBe("261.99");
    for (const [aggregate, period] of [
      [month, "08"],
      [quarter!, "3T"],
    ] as const) {
      const modelo = mapModelo303(aggregate);
      expect(modelo.boxes["27"]).toBe("86.35");
      expect(modelo.boxes["46"]).toBe("-175.64");
      const record = toDr303Record(modelo, {
        taxId: "50000000K",
        name: "Deli Example Ltd",
        year: 2026,
        period,
        declarationType: "C",
      });
      expect(record.length).toBe(2944);
      expect(record.toString("latin1", 10, 12)).toBe(period);
      expect(record.toString("latin1", 1023, 1040)).toBe("00000000000008635");
      expect(record.toString("latin1", 1346, 1363)).toBe("N0000000000017564");
    }
    await expectAugustMadridSales(7);
  });
});
