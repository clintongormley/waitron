import { testTradingAdmission } from "./testing/trading-admission.js";
// The fiscal half of split-bill: paying a carved check files its own registro, the items partition
// across the checks, and a repeated pay replays rather than files twice.
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  saleLinePortions,
  saleLines,
  sales,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  basisPointsToDecimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  thousandthsToDecimal,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TradingContext, DeviceRequestConfig } from "./trading-context.js";
import { createTable } from "./testing/live-table.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import type { TillSaleResult } from "./till-sale.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { openPartyTab, splitPartyBill } from "./testing/serve-line.js";
import { writeGroupedLines } from "./testing/grouped-counter-order.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deviceRequestCfg } from "./testing/session-device.js";

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
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

interface Seeded {
  cfg: DeviceRequestConfig;
  /** "Agua" — each, 1.50 gross, general(21%). */
  aguaId: string;
  /** "Jamón" — WEIGHT, 24.90/kg gross, reduced(10%). */
  jamonId: string;
  tableId: string;
  /** Both products offered in the table's zone. */
  offers: ZoneOffers;
}

/**
 * Stand up a fresh chained venue + registered SIF, then seed the two-product catalogue and one
 * dining table.
 */
async function setupVenue(): Promise<Seeded> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Split SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
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
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const comida = await createCategory(tx, { name: "Comida" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const jamon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: comida.id,
      name: "Jamón cortado",
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToVenue(tx, cat.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const t1 = await createTable(tx, cfg, { label: "T1", zoneId: offers.zoneId });
    return { aguaId: agua.id, jamonId: jamon.id, tableId: t1.id, offers };
  });
  return { cfg, ...seeded };
}

function asApp<T>(cfg: DeviceRequestConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return fn(tx);
  });
}

interface ThreeChecks {
  /** The emptied ORIGIN tab. */
  tabId: string;
  /** Check A = 1 agua + the whole jamón (MIXED VAT); B = 1 agua; C = 1 agua. */
  a: string;
  b: string;
  c: string;
  /** The paid results, in pay order. */
  rA: TillSaleResult;
  rB: TillSaleResult;
  rC: TillSaleResult;
}

/**
 * Open the mixed-VAT origin tab (3× agua @21%, 0.300 kg jamón @10%), carve it into three checks
 * (A = 1 agua + whole jamón; B = 1 agua; C = 1 agua, which empties the tab), and pay all three.
 * `portions` holds each agua as its own line; the jamón is ordered first so that check A holds it
 * first, as the grouped carve does, and its VAT breakdown lists the rates in the same order.
 * `grouped` holds the three agua as one line, as a tab written before portions does, and carves it
 * by quantity.
 */
async function splitIntoThreeChecks(
  seeded: Seeded,
  deps: Parameters<typeof payWorkingOrder>[0],
  shape: "portions" | "grouped" = "portions",
): Promise<ThreeChecks> {
  const { cfg, aguaId, jamonId, tableId, offers } = seeded;
  const agua = { productId: aguaId, quantity: "3" };
  const jamon = { productId: jamonId, quantity: "0.300" };
  const { tabId } = await asApp(cfg, async (tx) => {
    if (shape === "portions") {
      return openPartyTab(tx, cfg, { tableId, lines: offers.toOfferLines([jamon, agua]) });
    }
    const lines = offers.toOfferLines([agua, jamon]);
    const opened = await openPartyTab(tx, cfg, { tableId });
    await writeGroupedLines(tx, cfg, opened.tabId, lines);
    return opened;
  });
  const [toA, toB, toC] =
    shape === "portions"
      ? [[{ lineNo: 1 }, { lineNo: 2 }], [{ lineNo: 3 }], [{ lineNo: 4 }]]
      : [
          [{ lineNo: 1, quantity: "1" }, { lineNo: 2 }],
          [{ lineNo: 1, quantity: "1" }],
          [{ lineNo: 1 }],
        ];
  const { billId: a } = await asApp(cfg, (tx) => splitPartyBill(tx, cfg, tabId, toA!));
  const { billId: b } = await asApp(cfg, (tx) => splitPartyBill(tx, cfg, tabId, toB!));
  const { billId: c } = await asApp(cfg, (tx) => splitPartyBill(tx, cfg, tabId, toC!));

  // A check is a retrieved order, so req.lines is ignored — it files from its stored locked lines.
  const rA = await payWorkingOrder(deps, cfg, {
    id: a,
    tender: { method: "cash", amount: "10.00" },
    lines: [],
  });
  const rB = await payWorkingOrder(deps, cfg, {
    id: b,
    tender: { method: "cash", amount: "2.00" },
    lines: [],
  });
  const rC = await payWorkingOrder(deps, cfg, {
    id: c,
    tender: { method: "cash", amount: "2.00" },
    lines: [],
  });
  return { tabId, a, b, c, rA, rB, rC };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("split-bill.fiscal.test: resolveClient must never be called by recordSale"),
      ),
  });
});

// Parse a check's invoice sequence number (the N in "A/N").
function seqOf(result: TillSaleResult): number {
  const m = /^A\/(\d+)$/.exec(result.invoiceNumber);
  if (m === null) throw new Error(`unexpected invoice number ${result.invoiceNumber}`);
  return Number(m[1]);
}

describe("split-bill: pay each check files its own registro", () => {
  it("splits a mixed-VAT tab into 3 checks; paying all files EXACTLY 3 registros with contiguous numbers", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const deps = { db: suite.db, backend, clock };

    const { a, b, c, rA, rB, rC } = await splitIntoThreeChecks(seeded, {
      ...deps,
      admission: testTradingAdmission(),
    });

    // (1) EXACTLY THREE registros_facturacion for this tenant — one per check, none from the origin.
    const rows = await asApp(cfg, (tx) => tx.select().from(registrosFacturacion));
    expect(rows.length).toBe(3);

    // (2) Contiguous invoice numbers from the tab's series (fresh series ⇒ 1,2,3 in pay order).
    const seqs = [seqOf(rA), seqOf(rB), seqOf(rC)].sort((x, y) => x - y);
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1, seqs[0]! + 2]);
    expect(rA.invoiceNumber).toMatch(/^A\/\d+$/);

    // (3) Per-check TOTALS = the gross sum of that check's OWN items (the retail line totals).
    expect(rA.total).toBe("8.97"); // 1×1.50 + round(0.300×24.90)=7.47
    expect(rB.total).toBe("1.50");
    expect(rC.total).toBe("1.50");

    // (4) Coherent per-check DESGLOSE — each invoice's breakdown corresponds to its OWN items:
    //   - A carries BOTH rates (21% agua + 10% jamón); B and C carry only 21%.
    //   - Each check's Σ(base+tax) == its own total (there is no aggregate bill to reconcile).
    expect(new Set(rA.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00", "10.00"]));
    expect(new Set(rB.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00"]));
    expect(new Set(rC.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00"]));
    for (const r of [rA, rB, rC]) {
      const sum = r.vatBreakdown.reduce((acc, v) => acc + Number(v.base) + Number(v.tax), 0);
      expect(sum.toFixed(2)).toBe(r.total);
    }
    // Exact desgloses, difference-method (base = round(gross/(1+rate)), tax = gross − base):
    //   A agua  1.50 / 1.21 → 1.24 base, 0.26 tax
    //   A jamón 7.47 / 1.10 → 6.79 base, 0.68 tax
    //   B / C agua 1.50 → 1.24 base, 0.26 tax
    expect(rA.vatBreakdown).toEqual([
      { rate: "10.00", base: "6.79", tax: "0.68" }, // 0.300 kg jamón, check A's first line
      { rate: "21.00", base: "1.24", tax: "0.26" }, // 1 agua
    ]);
    expect(rB.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);
    expect(rC.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);

    // (5) Each registro is tied to its OWN check via sales.working_order_id (the idempotency key).
    const filedFor = await asApp(cfg, (tx) =>
      tx.select({ workingOrderId: sales.workingOrderId }).from(sales),
    );
    expect(new Set(filedFor.map((s) => s.workingOrderId))).toEqual(new Set([a, b, c]));

    // (6) Each check's agua row stands for exactly one portion, and the three are different ones.
    const aguaLinks = await asApp(cfg, (tx) =>
      tx
        .select({ workingOrderId: sales.workingOrderId, portionId: saleLinePortions.portionId })
        .from(saleLinePortions)
        .innerJoin(saleLines, eq(saleLines.id, saleLinePortions.saleLineId))
        .innerJoin(sales, eq(sales.id, saleLines.saleId))
        .where(eq(saleLines.vatRate, 2100)),
    );
    expect(aguaLinks.map((link) => link.workingOrderId).sort()).toEqual([a, b, c].sort());
    expect(new Set(aguaLinks.map((link) => link.portionId)).size).toBe(3);
  });

  it("on a tab written before portions, a part of the agua line still files on its own check", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const deps = { db: suite.db, backend, clock };

    const { tabId, a, b, c, rA, rB, rC } = await splitIntoThreeChecks(
      seeded,
      { ...deps, admission: testTradingAdmission() },
      "grouped",
    );

    const { registros, originLines, filed } = await asApp(cfg, async (tx) => ({
      registros: await tx.select({ id: registrosFacturacion.id }).from(registrosFacturacion),
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
    expect(registros.length).toBe(3);
    const seqs = [seqOf(rA), seqOf(rB), seqOf(rC)].sort((x, y) => x - y);
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1, seqs[0]! + 2]);
    expect([rA.total, rB.total, rC.total]).toEqual(["8.97", "1.50", "1.50"]);
    expect(rA.vatBreakdown).toEqual([
      { rate: "10.00", base: "6.79", tax: "0.68" },
      { rate: "21.00", base: "1.24", tax: "0.26" },
    ]);
    expect(rB.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);
    expect(rC.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);
    expect(originLines).toEqual([]);
    expect(
      filed
        .map((row) => [row.workingOrderId, row.vatRate, row.quantity])
        .sort((x, y) => String(x).localeCompare(String(y))),
    ).toEqual(
      [
        [a, 2100, 1000],
        [a, 1000, 300],
        [b, 2100, 1000],
        [c, 2100, 1000],
      ].sort((x, y) => String(x).localeCompare(String(y))),
    );
  });

  it("partitions the items — every unit filed on exactly ONE check, quantity conserved, origin emptied", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const deps = { db: suite.db, backend, clock };

    const { tabId, a } = await splitIntoThreeChecks(seeded, {
      ...deps,
      admission: testTradingAdmission(),
    });

    const { originLines, filed, filedForOrigin } = await asApp(cfg, async (tx) => {
      // The emptied origin: 0 working_order_lines, and it files NOTHING (never paid → no sales row).
      const originLines = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId));
      // Every filed sale_line, tagged with its check, partitioned by vat_rate (the single 10% jamón
      // line vs the three 21% agua lines).
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
    const totalAgua = filed21.reduce((n, f) => n + Number(f.quantity), 0);
    const totalJamon = filed10.reduce((n, f) => n + Number(f.quantity), 0);
    expect(totalAgua).toBe(3); // 1 + 1 + 1, no unit created or destroyed
    expect(totalJamon.toFixed(3)).toBe("0.300"); // moved whole to check A

    // PARTITION: the 10%-rate (jamón) quantity appears on EXACTLY ONE check (no double-file).
    const checksWith10 = new Set(filed10.map((f) => f.workingOrderId));
    expect(checksWith10).toEqual(new Set([a]));
  });

  it("paying a check twice files exactly ONE registro (sale-idempotency replay)", async () => {
    const { cfg, aguaId, tableId, offers } = await setupVenue();
    const deps = { db: suite.db, backend, clock };
    // Open a 2× agua tab and split ONE agua onto a detached check — the working order under proof.
    const { tabId } = await asApp(cfg, (tx) =>
      openPartyTab(tx, cfg, {
        tableId,
        lines: offers.toOfferLines([{ productId: aguaId, quantity: "2" }]),
      }),
    );
    const { billId: checkId } = await asApp(cfg, (tx) =>
      splitPartyBill(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );

    // Pay the SAME check twice, sequentially (a lost-response retry): the second pay sees `settled`
    // and replays the existing ticket rather than filing again — a check gets the same replay as any
    // tab.
    const first = await payWorkingOrder({ ...deps, admission: testTradingAdmission() }, cfg, {
      id: checkId,
      tender: { method: "cash", amount: "2.00" },
      lines: [],
    });
    const second = await payWorkingOrder({ ...deps, admission: testTradingAdmission() }, cfg, {
      id: checkId,
      tender: { method: "cash", amount: "2.00" },
      lines: [],
    });

    // The retry returns the SAME invoice number + total — the original ticket re-derived, not a new file.
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.total).toBe(first.total);

    // Exactly one registro is tied to this check after both payments. The returned
    // invoice number also stays the same on replay.
    const forCheck = await asApp(cfg, (tx) =>
      tx
        .select({ id: registrosFacturacion.id })
        .from(registrosFacturacion)
        .innerJoin(sales, eq(sales.id, registrosFacturacion.saleId))
        .where(eq(sales.workingOrderId, checkId)),
    );
    expect(forCheck.length).toBe(1);
  });
});
