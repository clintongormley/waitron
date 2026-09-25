import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { withTransaction } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  rawCentsToDecimal,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { openTab, transferLines } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

/**
 * H2 after a partial transfer: each tab files its own single fiscal record, at its own locked price.
 * The sibling `transfer-lines.test.ts` never pays a tab, so this is the only case that transfers and
 * then settles both tabs.
 */
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored — the identical stub `till-sale.test.ts` uses. */
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
      throw new Error("transfer-lines: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface SeededVenue {
  cfg: TillConfig;
  available: AvailableProduct[];
  /** "Café" — each, 1.50 gross, general(21%). */
  cafe: AvailableProduct;
  /** "Agua" — each, 2.00 gross, general(21%). Same rate as café, so a two-line basket has one VAT group. */
  agua: AvailableProduct;
}

/**
 * Stand up a fresh chained venue + registered SIF, then seed a catalogue and read back two
 * `each`/general(21%) products.
 */
async function setupVenue(): Promise<SeededVenue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
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
        tillName: "Caja 1",
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

  const cfg = tillConfigFromVenue(venue);
  const available = await withTransaction(suite.db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return (await listAvailableProducts(tx, cfg.locationId)).products;
  });
  const cafe = available.find((p) => p.name === "Café")!;
  const agua = available.find((p) => p.name === "Agua")!;
  return { cfg, available, cafe, agua };
}

/**
 * A fresh venue with two open tabs, each on its own dining table, each holding café×4. Returns the tab
 * (working_order) ids to transfer between.
 */
async function setupTwoTabs(): Promise<{
  cfg: TillConfig;
  tabA: string;
  tabB: string;
  cafe: AvailableProduct;
}> {
  const { cfg, cafe } = await setupVenue();
  const { tabA, tabB } = await withTransaction(suite.db, async (tx) => {
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const a = await createTable(tx, cfg, { label: "A", zoneId: offers.zoneId });
    const b = await createTable(tx, cfg, { label: "B", zoneId: offers.zoneId });
    const ta = await openTab(tx, cfg, {
      tableId: a.id,
      lines: [{ menuItemId: offers.offerFor(cafe.id), quantity: "4" }],
    });
    const tb = await openTab(tx, cfg, {
      tableId: b.id,
      lines: [{ menuItemId: offers.offerFor(cafe.id), quantity: "4" }],
    });
    return { tabA: ta.tabId, tabB: tb.tabId };
  });
  return { cfg, tabA, tabB, cafe };
}

/** How many `sales` rows reference this working order. */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** How many chained `registros_facturacion` rows exist for this working order's sale. */
async function registroCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/**
 * The IMMUTABLE filed `sales.total` for this working order's sale. The witness that each tab files
 * at its OWN locked composition, not a re-price at pay.
 */
async function filedSaleTotal(workingOrderId: string): Promise<string> {
  const { rows } = await suite.db.execute<{ total: string }>(sql`
    select cast(total as text) as total from sales where working_order_id = ${workingOrderId}
  `);
  return rawCentsToDecimal(rows[0]!.total);
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("transfer-lines: resolveClient must never be called by recordSale")),
  });
});

describe("H2 — after a partial transfer, each tab files its OWN single registro (no double-file, no re-price)", () => {
  it("transfer 1 café A→B, then pay BOTH tabs → exactly one sale + one registro each, at the locked price", async () => {
    const { cfg, tabA, tabB } = await setupTwoTabs(); // A: café×4, B: café×4
    await withTransaction(suite.db, async (tx) => {
      await transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]); // A→B: 1 café (partial split)
    });

    // A now holds café×3; B holds café×4 + café×1. `lines: []` files from the stored locked lines.
    const deps = { db: suite.db, backend, clock };
    const paidA = await payWorkingOrder(deps, cfg, {
      id: tabA,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });
    const paidB = await payWorkingOrder(deps, cfg, {
      id: tabB,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });

    // Each tab files EXACTLY one sale + one chained registro — no café double-files (every café lives on
    // exactly one tab after the split), the H2 invariant the transfer must preserve.
    expect(await saleCount(tabA)).toBe(1);
    expect(await saleCount(tabB)).toBe(1);
    expect(await registroCount(tabA)).toBe(1);
    expect(await registroCount(tabB)).toBe(1);

    // Filed at the LOCKED café price (1.50), never re-priced by the transfer: A = 3 × 1.50, B = 5 × 1.50.
    // Read back from the IMMUTABLE `sales.total` too, not only the returned object.
    expect(paidA.total).toBe("4.50"); // 3 × 1.50
    expect(paidB.total).toBe("7.50"); // (4 + 1) × 1.50
    expect(await filedSaleTotal(tabA)).toBe("4.50");
    expect(await filedSaleTotal(tabB)).toBe("7.50");
  });
});
