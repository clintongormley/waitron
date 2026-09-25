import { randomUUID } from "node:crypto";
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
import { registerSif, VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { addTabRound, openTab } from "./working-order.js";
import { payWorkingOrder, recordTillSale } from "./till-sale.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import "./errors.js";

/**
 * Tabs end to end through a real `VerifactuBackend`: what paying a tab files, and that a refusal
 * files nothing. A tab goes from `open` straight to `settled`, never `placed`, so it files nothing
 * until it is paid.
 *
 * H2: the huella does not depend on whether the order was a tab or delivered to a table. Two
 * filings with the same huella share the AEAT identity `registros_identidad_uq` is keyed on, so each
 * goes in its own database (`secondVenueSharingNif`).
 *
 * Nothing here stages concurrent `openTab` or `addTabRound` calls: the one-open-tab rule and
 * contiguous line numbers are covered only sequentially.
 */
const LOCALE = "es-ES";

const venueDbOptions = { migrations: migrationOptionsFor(manifestSets(), null), timeoutMs: 60_000 };

const suite = useVenueDb(venueDbOptions);
// Used only by the H2 cases.
const suiteB = useVenueDb(venueDbOptions);

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
  /** 1.50 gross. */
  cafe: AvailableProduct;
  /** 2.00 gross, at café's VAT rate, so a two-line basket has one VAT group. */
  agua: AvailableProduct;
  counter: ZoneOffers;
  tables: ZoneOffers;
}

async function setupVenue(db: Database = suite.db): Promise<SeededVenue> {
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
    { db, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const { available, counter, tables } = await withTransaction(db, async (tx) => {
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
    return {
      available: (await listAvailableProducts(tx, cfg.locationId)).products,
      counter: await offerProducts(tx, cfg),
      tables: await offerProducts(tx, cfg, { zone: "tables" }),
    };
  });
  const cafe = available.find((p) => p.name === "Café")!;
  const agua = available.find((p) => p.name === "Agua")!;
  return { cfg, cafe, agua, counter, tables };
}

async function seedTable(
  cfg: TillConfig,
  label: string,
  db: Database = suite.db,
  zoneId?: string,
): Promise<string> {
  return withTransaction(db, async (tx) => {
    const { id } = await createTable(tx, cfg, { label, zoneId });
    return id;
  });
}

// `resolveClient` rejects: filing a sale never contacts AEAT.
let backend: FiscalBackend;
let backendB: FiscalBackend;
let clock: TrustedClock;

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
      throw new Error("tabs.filing.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

beforeAll(() => {
  clock = systemClock();
  const makeBackend = (db: Database): FiscalBackend =>
    new VerifactuBackend({
      clock,
      db,
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
      resolveClient: () =>
        Promise.reject(
          new Error("tabs.filing.test: resolveClient must never be called by recordSale"),
        ),
    });
  backend = makeBackend(suite.db);
  backendB = makeBackend(suiteB.db);
});

/** The predicate is read raw, so SQLite returns it as 1 or 0. */
async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  const { rows } = await suite.db.execute<{ status: string; settled: number }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled === 1 };
}

async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

async function registroCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

describe("pay closes the tab (reuses payWorkingOrder → recordSale UNCHANGED)", () => {
  it("openTab + addTabRound → payWorkingOrder settles it, files one sale + registro, table reads free", async () => {
    const { cfg, cafe, agua, tables } = await setupVenue();
    const tableId = await seedTable(cfg, "Pay-1", suite.db, tables.zoneId);
    const deps = { db: suite.db, backend, clock };

    const { tabId } = await withTransaction(suite.db, async (tx) => {
      return openTab(tx, cfg, {
        tableId,
        lines: [{ menuItemId: tables.offerFor(cafe.id), quantity: "1" }],
      });
    });
    await withTransaction(suite.db, async (tx) => {
      return addTabRound(tx, cfg, tabId, [{ menuItemId: tables.offerFor(agua.id), quantity: "1" }]);
    });

    // Paying by id files the stored lines; `lines` is ignored.
    const res = await payWorkingOrder(deps, cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(res.total).toBe("3.50");
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(tabId)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(tabId)).toBe(1);
    expect(await registroCount(tabId)).toBe(1);

    const { rows } = await suite.db.execute<{ n: string }>(sql`
      select cast(count(*) as text) as n
      from dining_tables dt join working_orders wo on wo.id = dt.tab_id
      where dt.id = ${tableId} and wo.status = 'open'`);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("paying an EMPTY tab is refused sale.empty_basket (a domain 4xx), files nothing — not an opaque 500", async () => {
    const { cfg } = await setupVenue();
    const tableId = await seedTable(cfg, "Empty-pay");
    const deps = { db: suite.db, backend, clock };

    const { tabId } = await withTransaction(suite.db, async (tx) => {
      return openTab(tx, cfg, { tableId });
    });

    await expect(
      payWorkingOrder(deps, cfg, {
        id: tabId,
        lines: [],
        tender: { method: "cash", amount: "5.00" },
      }),
    ).rejects.toMatchObject({ code: "sale.empty_basket" });

    // A refused pay files no sale and no record, and the tab stays open.
    expect(await orderState(tabId)).toEqual({ status: "open", settledAtSet: false });
    expect(await saleCount(tabId)).toBe(0);
    expect(await registroCount(tabId)).toBe(0);
  });
});

/** Pinned to one instant, so two independent filings hash the same timestamps. */
function fixedClock(instant: Date): TrustedClock {
  return {
    now: () => ({
      instant,
      offsetMinutes: 60,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("tabs.filing.test: anchor() unused");
    },
    currentAnchor: () => null,
  };
}

async function nifOf(db: Database = suite.db): Promise<string> {
  const { rows } = await db.execute<{ tax_id: string }>(
    sql`select tax_id from tenants where id = 1`,
  );
  return rows[0]!.tax_id;
}

/**
 * A venue in a second database whose node files under `nif` instead of its own, so its
 * `IDEmisorFactura` matches the first venue's. It must be a second database: two filings with the
 * same huella share `registros_identidad_uq`'s key (issuer NIF, number, date, record type).
 */
async function secondVenueSharingNif(nif: string, db: Database = suiteB.db): Promise<SeededVenue> {
  const venue = await setupVenue(db);
  await withTransaction(db, async (tx) => {
    await registerSif(tx, {
      nodeId: venue.cfg.nodeId,
      nif,
      idSistemaInformatico: "W1",
    });
  });
  return venue;
}

async function filedHuella(workingOrderId: string, db: Database = suite.db): Promise<string> {
  const { rows } = await db.execute<{ huella: string }>(sql`
    select r.huella from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}`);
  return rows[0]!.huella;
}

describe("H2: the huella is independent of whether the order was a tab", () => {
  it("the SAME basket filed walk-up and from a tab yields the identical huella", async () => {
    const at = new Date("2026-08-17T19:20:30+01:00");
    const clockFixed = fixedClock(at);
    const depsA = { db: suite.db, backend, clock: clockFixed };
    const depsB = { db: suiteB.db, backend: backendB, clock: clockFixed };

    const { cfg: cfgA, cafe: cafeA, counter: counterA } = await setupVenue();
    const nifA = await nifOf();
    const walkUpId = randomUUID();
    await payWorkingOrder(depsA, cfgA, {
      id: walkUpId,
      zoneId: counterA.zoneId,
      lines: [{ menuItemId: counterA.offerFor(cafeA.id), quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    const { cfg: cfgB, cafe: cafeB, tables: tablesB } = await secondVenueSharingNif(nifA);
    const tableId = await seedTable(cfgB, "H2-tab", suiteB.db, tablesB.zoneId);
    const { tabId } = await withTransaction(suiteB.db, async (tx) => {
      return openTab(tx, cfgB, {
        tableId,
        lines: [{ menuItemId: tablesB.offerFor(cafeB.id), quantity: "1" }],
      });
    });
    await payWorkingOrder(depsB, cfgB, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    // Without this, an `openTab` that stopped setting `tab_id` would make the equality below vacuous.
    const tabPointers = await suiteB.db.execute<{ n: string }>(
      sql`select cast(count(*) as text) as n from dining_tables where tab_id = ${tabId}`,
    );
    const walkUpPointers = await suite.db.execute<{ n: string }>(
      sql`select cast(count(*) as text) as n from dining_tables where tab_id = ${walkUpId}`,
    );
    expect(Number(tabPointers.rows[0]!.n)).toBe(1);
    expect(Number(walkUpPointers.rows[0]!.n)).toBe(0);

    // Both orders carry a null `delivery_table_id`, so this covers only the `tab_id` back-pointer;
    // the column has its own case below.
    expect(await filedHuella(tabId, suiteB.db)).toBe(await filedHuella(walkUpId, suite.db));
  });
});

async function deliveryTableOf(
  workingOrderId: string,
  db: Database = suite.db,
): Promise<string | null> {
  const { rows } = await db.execute<{ d: string | null }>(
    sql`select delivery_table_id as d from working_orders where id = ${workingOrderId}`,
  );
  return rows[0]!.d;
}

describe("counter delivery (deliveryTableId on a walk-up sale)", () => {
  it("records delivery_table_id on the walk-up order and files one sale (it is NOT a tab)", async () => {
    const { cfg, cafe, counter } = await setupVenue();
    const tableId = await seedTable(cfg, "Del-1");
    const deps = { db: suite.db, backend, clock };

    const id = randomUUID();
    const res = await recordTillSale(deps, cfg, {
      workingOrderId: id,
      zoneId: counter.zoneId,
      lines: [{ menuItemId: counter.offerFor(cafe.id), quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
      deliveryTableId: tableId,
    });
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await deliveryTableOf(id)).toBe(tableId);
    const { rows } = await suite.db.execute<{ n: string }>(
      sql`select cast(count(*) as text) as n from dining_tables where tab_id = ${id}`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("a deliveryTableId naming no table is refused table.not_found (a domain 4xx, not a raw 500)", async () => {
    const { cfg, cafe, counter } = await setupVenue();
    const deps = { db: suite.db, backend, clock };
    const orderId = randomUUID();
    const missingTableId = randomUUID();

    // The column's foreign key would also refuse; this asserts the domain code checked before it.
    await expect(
      recordTillSale(deps, cfg, {
        workingOrderId: orderId,
        zoneId: counter.zoneId,
        lines: [{ menuItemId: counter.offerFor(cafe.id), quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
        deliveryTableId: missingTableId,
      }),
    ).rejects.toMatchObject({ code: "table.not_found", params: { tableId: missingTableId } });

    expect(await saleCount(orderId)).toBe(0);
    const { rows } = await suite.db.execute<{ n: string }>(
      sql`select cast(count(*) as text) as n from working_orders where id = ${orderId}`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("H2 (column): the huella is independent of delivery_table_id", () => {
  it("two counter sales differing ONLY in delivery_table_id yield the identical huella", async () => {
    const at = new Date("2026-08-17T19:20:30+01:00");
    const clockFixed = fixedClock(at);
    const depsA = { db: suite.db, backend, clock: clockFixed };
    const depsB = { db: suiteB.db, backend: backendB, clock: clockFixed };

    const { cfg: cfgA, cafe: cafeA, counter: counterA } = await setupVenue();
    const nifA = await nifOf();
    const tableA = await seedTable(cfgA, "H2col-A");
    const deliveredId = randomUUID();
    await recordTillSale(depsA, cfgA, {
      workingOrderId: deliveredId,
      zoneId: counterA.zoneId,
      lines: [{ menuItemId: counterA.offerFor(cafeA.id), quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
      deliveryTableId: tableA,
    });

    const { cfg: cfgB, cafe: cafeB, counter: counterB } = await secondVenueSharingNif(nifA);
    const walkUpId = randomUUID();
    await recordTillSale(depsB, cfgB, {
      workingOrderId: walkUpId,
      zoneId: counterB.zoneId,
      lines: [{ menuItemId: counterB.offerFor(cafeB.id), quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // Without this, a sale that stopped writing the column would make the equality below vacuous.
    expect(await deliveryTableOf(deliveredId, suite.db)).toBe(tableA);
    expect(await deliveryTableOf(walkUpId, suiteB.db)).toBe(null);

    expect(await filedHuella(deliveredId, suite.db)).toBe(await filedHuella(walkUpId, suiteB.db));
  });
});
