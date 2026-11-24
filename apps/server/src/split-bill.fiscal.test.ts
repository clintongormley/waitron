import { randomUUID } from "node:crypto";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { saleLineDishes, saleLines, sales, withTransaction, workingOrderLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignMenuToVenue,
  createMenu,
  createCategory,
  createProduct,
  setTakeawayVatRate,
} from "@waitron/menu";
import { departments } from "@waitron/venue-service";
import { VerifactuBackend, verifactuRecords } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { basisPointsToDecimal, nodeId as brandNodeId, thousandthsToDecimal } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { DeviceRequestConfig } from "./trading-context.js";

import { createTable } from "./testing/live-table.js";
import { paySavedBillInCash, takeBillPayment } from "./testing/bill-payment-fixture.js";
import type { TillSaleResult } from "./till-sale.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { openPartyTab, splitPartyBill } from "./testing/serve-line.js";
import { writeGroupedLines } from "./testing/grouped-counter-order.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { counterFixtureOperator, deviceRequestCfg } from "./testing/session-device.js";
import type { TradingContext } from "./trading-context.js";

// Each case provisions its own venue, so a readback count is that case's alone.
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

/** The wall clock at the moment this process runs, reported as already confident and anchored. */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("split-bill.fiscal.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(60_000_000 + nifCounter);
}

function tillConfigFromVenue(venue: VenueResult): TradingContext {
  return {
    nodeId: brandNodeId(venue.nodeId),
    locale: LOCALE,
    simplifiedInvoiceLimit: null,
  };
}

interface Seeded {
  cfg: DeviceRequestConfig;
  /** "Agua" — each, 1.50 gross; taken away, 21%. */
  waterId: string;
  /** "Jamón" — WEIGHT, 24.90/kg gross; taken away, 10%. */
  hamId: string;
  tableId: string;
  /** Both products offered in the table's zone. */
  offers: ZoneOffers;
}

/**
 * Stand up a fresh chained venue + registered SIF, then seed the two-product menu and one
 * dining table. With `takeaway`, the department sells only takeaway, so Agua and Jamón file at
 * different rates.
 */
async function setupVenue(opts: { takeaway?: boolean } = {}): Promise<Seeded> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Split SL",
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        correctiveSeriesCode: "R",
        admin: {
          displayName: "Administrator",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const cfg = await deviceRequestCfg(suite.db, tillConfigFromVenue(venue));
  const seeded = await withTransaction(suite.db, async (tx) => {
    const cat = await createMenu(tx, { name: "Delicatessen" });
    const food = await createCategory(tx, { name: "Comida" });
    const drinks = await createCategory(tx, { name: "Bebidas" });
    const ham = await createProduct(tx, {
      categoryId: food.id,
      name: "Jamón cortado",
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    const water = await createProduct(tx, {
      categoryId: drinks.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    if (opts.takeaway) {
      await tx.update(departments).set({ dining: "takeaway" });
      await setTakeawayVatRate(tx, water.id, "21.00");
    }
    await assignMenuToVenue(tx, cat.id);
    const offers = await offerProducts(tx, { zone: "tables" });
    const t1 = await createTable(tx, { label: "T1", zoneId: offers.zoneId });
    return { waterId: water.id, hamId: ham.id, tableId: t1.id, offers };
  });
  return { cfg, ...seeded };
}

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, async (tx) => {
    return fn(tx);
  });
}

interface ThreeChecks {
  /** The emptied ORIGIN tab. */
  tabId: string;
  a: string;
  b: string;
  c: string;
  /** The paid results, in pay order. */
  rA: TillSaleResult;
  rB: TillSaleResult;
  rC: TillSaleResult;
}

async function splitIntoThreeChecks(
  seeded: Seeded,
  deps: Parameters<typeof paySavedBillInCash>[0],
): Promise<ThreeChecks> {
  const { cfg, waterId, hamId, tableId, offers } = seeded;
  const water = { productId: waterId, quantity: "3" };
  const ham = { productId: hamId, quantity: "0.300" };
  // Each water becomes its own line, so line 1 is the ham and lines 2–4 the waters;
  // check A takes 1–2.
  const { tabId } = await asApp((tx) =>
    openPartyTab(tx, cfg, { tableId, lines: offers.toOfferLines([ham, water]) }),
  );
  const { billId: a } = await asApp((tx) =>
    splitPartyBill(tx, cfg, tabId, [{ lineNo: 1 }, { lineNo: 2 }]),
  );
  const { billId: b } = await asApp((tx) => splitPartyBill(tx, cfg, tabId, [{ lineNo: 3 }]));
  const { billId: c } = await asApp((tx) => splitPartyBill(tx, cfg, tabId, [{ lineNo: 4 }]));

  const operator = await counterFixtureOperator(suite.db, cfg.origin.deviceId);
  const rA = await paySavedBillInCash(deps, cfg, operator, a, "10.00");
  const rB = await paySavedBillInCash(deps, cfg, operator, b, "2.00");
  const rC = await paySavedBillInCash(deps, cfg, operator, c, "2.00");
  return { tabId, a, b, c, rA, rB, rC };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
  });
});

// Parse a check's invoice sequence number (the N in "A/N").
function seqOf(result: TillSaleResult): number {
  const m = /^A\/(\d+)$/.exec(result.invoiceNumber);
  if (m === null) throw new Error(`unexpected invoice number ${result.invoiceNumber}`);
  return Number(m[1]);
}

describe("split-bill: pay each check files its own record", () => {
  it("splits a mixed-VAT tab into 3 checks; paying all files EXACTLY 3 records with contiguous numbers", async () => {
    const seeded = await setupVenue({ takeaway: true });
    const deps = { db: suite.db, backend, clock };

    const { a, b, c, rA, rB, rC } = await splitIntoThreeChecks(seeded, {
      ...deps,
      admission: testTradingAdmission(),
    });

    // (1) EXACTLY THREE verifactu_records for this taxpayer — one per check, none from the origin.
    const rows = await asApp((tx) => tx.select().from(verifactuRecords));
    expect(rows.length).toBe(3);

    // (2) Contiguous invoice numbers from the tab's series (fresh series ⇒ 1,2,3 in pay order).
    const seqs = [seqOf(rA), seqOf(rB), seqOf(rC)].sort((x, y) => x - y);
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1, seqs[0]! + 2]);
    expect(rA.invoiceNumber).toMatch(/^A\/\d+$/);

    // (3) Per-check TOTALS = the gross sum of that check's OWN items (the retail line totals).
    expect(rA.total).toBe("8.97"); // 1×1.50 + round(0.300×24.90)=7.47
    expect(rB.total).toBe("1.50");
    expect(rC.total).toBe("1.50");

    expect(new Set(rA.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00", "10.00"]));
    expect(new Set(rB.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00"]));
    expect(new Set(rC.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00"]));
    for (const r of [rA, rB, rC]) {
      const sum = r.vatBreakdown.reduce((acc, v) => acc + Number(v.base) + Number(v.tax), 0);
      expect(sum.toFixed(2)).toBe(r.total);
    }

    expect(rA.vatBreakdown).toEqual([
      { rate: "10.00", base: "6.79", tax: "0.68" },
      { rate: "21.00", base: "1.24", tax: "0.26" },
    ]);
    expect(rB.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);
    expect(rC.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);

    const filedFor = await asApp((tx) =>
      tx.select({ workingOrderId: sales.workingOrderId }).from(sales),
    );
    expect(new Set(filedFor.map((s) => s.workingOrderId))).toEqual(new Set([a, b, c]));

    const waterLinks = await asApp((tx) =>
      tx
        .select({ workingOrderId: sales.workingOrderId, portionId: saleLineDishes.dishLineId })
        .from(saleLineDishes)
        .innerJoin(saleLines, eq(saleLines.id, saleLineDishes.saleLineId))
        .innerJoin(sales, eq(sales.id, saleLines.saleId))
        .where(eq(saleLines.vatRate, 2100)),
    );
    expect(waterLinks.map((link) => link.workingOrderId).sort()).toEqual([a, b, c].sort());
    expect(new Set(waterLinks.map((link) => link.portionId)).size).toBe(3);
  });

  it("on a tab written before portions, the whole water line files on its own check", async () => {
    const { cfg, waterId, hamId, tableId, offers } = await setupVenue({ takeaway: true });
    const deps = { db: suite.db, backend, clock, admission: testTradingAdmission() };
    const lines = offers.toOfferLines([
      { productId: waterId, quantity: "3" },
      { productId: hamId, quantity: "0.300" },
    ]);
    const { tabId } = await asApp(async (tx) => {
      const opened = await openPartyTab(tx, cfg, { tableId });
      await writeGroupedLines(tx, cfg, opened.tabId, lines);
      return opened;
    });
    const { billId: a } = await asApp((tx) => splitPartyBill(tx, cfg, tabId, [{ lineNo: 2 }]));
    const { billId: b } = await asApp((tx) => splitPartyBill(tx, cfg, tabId, [{ lineNo: 1 }]));
    const operator = await counterFixtureOperator(suite.db, cfg.origin.deviceId);
    const rA = await paySavedBillInCash(deps, cfg, operator, a, "10.00");
    const rB = await paySavedBillInCash(deps, cfg, operator, b, "5.00");

    const { records, originLines, filed } = await asApp(async (tx) => ({
      records: await tx.select({ id: verifactuRecords.id }).from(verifactuRecords),
      originLines: await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId)),
      filed: await tx
        .select({
          workingOrderId: sales.workingOrderId,
          vatRate: saleLines.vatRate,
          quantity: saleLines.quantity,
        })
        .from(saleLines)
        .innerJoin(sales, eq(sales.id, saleLines.saleId)),
    }));
    expect(records.length).toBe(2);
    expect(seqOf(rB)).toBe(seqOf(rA) + 1);
    expect([rA.total, rB.total]).toEqual(["7.47", "4.50"]);
    expect(rA.vatBreakdown).toEqual([{ rate: "10.00", base: "6.79", tax: "0.68" }]);
    expect(rB.vatBreakdown).toEqual([{ rate: "21.00", base: "3.72", tax: "0.78" }]);
    expect(originLines).toEqual([]);
    expect(
      filed
        .map((row) => [row.workingOrderId, row.vatRate, row.quantity])
        .sort((x, y) => String(x).localeCompare(String(y))),
    ).toEqual(
      [
        [a, 1000, 300],
        [b, 2100, 3000],
      ].sort((x, y) => String(x).localeCompare(String(y))),
    );
  });

  it("partitions the items — every unit filed on exactly ONE check, quantity conserved, origin emptied", async () => {
    const seeded = await setupVenue({ takeaway: true });
    const deps = { db: suite.db, backend, clock };

    const { tabId, a } = await splitIntoThreeChecks(seeded, {
      ...deps,
      admission: testTradingAdmission(),
    });

    const { originLines, filed, filedForOrigin } = await asApp(async (tx) => {
      // The emptied origin: 0 working_order_lines, and it files NOTHING (never paid → no sales row).
      const originLines = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId));

      const filedRows = await tx
        .select({
          workingOrderId: sales.workingOrderId,
          vatRate: saleLines.vatRate,
          quantity: saleLines.quantity,
        })
        .from(saleLines)
        .innerJoin(sales, eq(sales.id, saleLines.saleId));
      // `sale_lines.vat_rate` is a count of whole basis points and `quantity` a count of whole
      // thousandths; both become decimal literals here, at the row.
      const filed = filedRows.map((row) => ({
        ...row,
        vatRate: basisPointsToDecimal(row.vatRate),
        quantity: thousandthsToDecimal(row.quantity),
      }));
      const filedForOrigin = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, tabId));
      return { originLines, filed, filedForOrigin };
    });

    // The origin is emptied and files nothing.
    expect(originLines).toEqual([]);
    expect(filedForOrigin).toEqual([]);

    // CONSERVATION: summing the filed quantities per RATE across the 3 checks == the original basket.
    const filed21 = filed.filter((f) => f.vatRate === "21.00");
    const filed10 = filed.filter((f) => f.vatRate === "10.00");
    const totalWater = filed21.reduce((n, f) => n + Number(f.quantity), 0);
    const totalHam = filed10.reduce((n, f) => n + Number(f.quantity), 0);
    expect(totalWater).toBe(3); // 1 + 1 + 1, no unit created or destroyed
    expect(totalHam.toFixed(3)).toBe("0.300"); // moved whole to check A

    const checksWith10 = new Set(filed10.map((f) => f.workingOrderId));
    expect(checksWith10).toEqual(new Set([a]));
  });

  it("paying a check twice files exactly ONE record (sale-idempotency replay)", async () => {
    const { cfg, waterId, tableId, offers } = await setupVenue();
    const deps = { db: suite.db, backend, clock };

    const { tabId } = await asApp((tx) =>
      openPartyTab(tx, cfg, {
        tableId,
        lines: offers.toOfferLines([{ productId: waterId, quantity: "2" }]),
      }),
    );
    const { billId: checkId } = await asApp((tx) =>
      splitPartyBill(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );

    const operator = await counterFixtureOperator(suite.db, cfg.origin.deviceId);
    const request = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "1.50",
      method: "cash",
      tendered: "2.00",
      applied: "1.50",
      tip: "0.00",
    } as const;
    const paymentDeps = { ...deps, admission: testTradingAdmission() };
    const first = await takeBillPayment(paymentDeps, cfg, checkId, request, operator);
    const second = await takeBillPayment(paymentDeps, cfg, checkId, request, operator);

    expect(first.invoice).toMatchObject({ total: "1.50", invoiceNumber: expect.any(String) });
    expect(second.invoice).toMatchObject({
      total: first.invoice?.total,
      invoiceNumber: first.invoice?.invoiceNumber,
    });

    const forCheck = await asApp((tx) =>
      tx
        .select({ id: verifactuRecords.id })
        .from(verifactuRecords)
        .innerJoin(sales, eq(sales.id, verifactuRecords.saleId))
        .where(eq(sales.workingOrderId, checkId)),
    );
    expect(forCheck.length).toBe(1);
  });
});
