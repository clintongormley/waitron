import { describe, expect, it } from "vitest";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  saleLines,
  sales,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createMenuItem,
  createMenuSection,
  createProduct,
  readProductEditor,
  writeProductModifiers,
} from "@waitron/catalogue";
import { VerifactuBackend, registerSif, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import { preparationRoutes } from "@waitron/venue-service";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable, createZone, listTables, setTablePlacement } from "./tables.js";
import {
  addTabRound,
  advanceTicketItem,
  fireLines,
  markLineServed,
  openTab,
  type TicketState,
} from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import "./errors.js";

// FP-1's single most important test — the fiscal firewall (spec §4 / CLAUDE.md §5). `served_at` is a
// `working_order_lines` field the pay path never reads: `payWorkingOrder` files from the tab's STORED
// locked lines (`priceStoredOrder` reads product/quantity/unit_price_gross, not `served_at`), so
// whether a line was served can never reach `computeHuella`. This proves that BEHAVIOURALLY, at the
// pay-path layer where `served_at` actually exists (the structural half — that no fiscal source even
// names the field — is the commit body's grep). Two tabs built from the IDENTICAL basket, one with
// every line served and one with none, must file registros with the IDENTICAL huella.
//
// A genuine chained fiscal record filed through the real pay path against a real migrated venue
// database, the same reason `till-sale.test.ts` seeds one. The huella comparison itself is
// deterministic either way; the value is a stronger end-to-end receipt.
//
// Nothing here establishes what the deployment role, which no longer exists, may read or write.
const LOCALE = "es-ES";

// TWO databases, one shop in each — the one-tenant-per-database rework of what used to be two tenants
// in one clone (see `seedShop`). Each `useVenueDb` call makes its OWN temporary directory inside its
// OWN `beforeAll` and closes over its own handle (`packages/db/src/testing/venue-db.ts`, the
// `let directory` / `mkdtemp` pair inside `useVenueDb`), so these are two independent databases;
// each holds exactly one tenant and one fiscal chain.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const suiteB = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/**
 * A clock FROZEN at one instant, so both pays stamp the SAME `issued_at` — and therefore the SAME
 * `FechaExpedicionFactura` and `FechaHoraHusoGenRegistro` reach `computeHuella`. This eliminates the
 * §1 confound: two real pays file at different wall-clock instants, so without a frozen clock their
 * huellas would differ for a reason that has nothing to do with `served_at`. Same shape as
 * `till-sale.test.ts`'s `systemClock`, but the instant is a CONSTANT rather than `new Date()`.
 * `recordSale` reads `now()` once and touches neither `anchor` nor `currentAnchor`.
 */
const FROZEN_INSTANT = new Date("2026-07-20T17:20:30.000Z");
function frozenClock(): TrustedClock {
  return {
    now: () => ({
      instant: FROZEN_INSTANT,
      offsetMinutes: 120,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("served-at-huella.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

const clock: TrustedClock = frozenClock();

/** A fiscal backend bound to ONE shop's database — each database has its own, because the backend
 *  reads and files against the `db` it is constructed with. */
function makeBackend(db: Database): FiscalBackend {
  return new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("served-at-huella.test: resolveClient must never be called")),
  });
}

// A fresh, unique NIF per test. Each of the two databases this file runs against is its own, so a
// NIF never collides across databases; the counter keeps repeated tests in THIS file
// order-independent.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(80_000_000 + nifCounter).padStart(8, "0")}K`;
}

function venueRequest(nif: string): VenueRequest {
  return {
    country: "ES",
    taxId: nif,
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
  };
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

interface Shop {
  db: Database;
  backend: FiscalBackend;
  cfg: TillConfig;
  aguaId: string;
  cafeId: string;
  aguaMenuItemId: string;
  cafeMenuItemId: string;
  menuId: string;
  categoryId: string;
  tableId: string;
}

/**
 * Provision a shop in ITS OWN database, RE-REGISTER its node's SIF under the SHARED emisor NIF, seed
 * an IDENTICAL two-product catalogue, and create one dining table.
 *
 * TWO SEPARATE DATABASES are deliberate — one tenant per database, always. `registros_identidad_uq`
 * is UNIQUE on (id_emisor_factura, num_serie_factura, fecha_expedicion_factura, tipo_registro): two
 * records sharing that AEAT identity are a duplicate (AEAT error 3000) and collide. But the huella
 * hashes exactly those identity fields, so the two records this test compares MUST share them — so
 * each goes in its OWN database, where the uniqueness index never fires across the pair. The SHARED
 * emisor NIF then keeps `IDEmisorFactura` — the one hashed identity field a fresh venue would
 * otherwise vary — identical. (This replaced an earlier two-tenants-in-one-clone trick, which the
 * one-tenant-per-database change made impossible: with the tenant column gone the uniqueness index
 * is global.) This mirrors verify.test.ts's entorno test, which likewise files each record fresh
 * while pinning IDEmisorFactura to one constant (there via `altaFor`'s hardcoded TEST_NIF).
 *
 * `applyVenue` registers the node's SIF under the venue's own tax_id; re-registering under
 * `emisorNif` (registerSif revokes the old identity, mints a fresh installation number, and
 * resets the chain to empty) is what makes both shops file under one obligado NIF while each
 * starts a first record. The NumeroInstalacion is not hashed, so whether it matches between the two
 * shops or not cannot move the huella (with each shop in its own database the per-NIF counter resets,
 * so they in fact match). Run inside withTransaction — exactly how applyVenue itself runs
 * registerSif.
 */
async function seedShop(db: Database, emisorNif: string): Promise<Shop> {
  const venue = await applyVenue(planVenue(venueRequest(nextNif()), ALL_MODULES), {
    db,
    modules: ALL_MODULES,
  });
  const cfg = tillConfigFromVenue(venue);
  await withTransaction(db, (tx) =>
    registerSif(tx, {
      nodeId: cfg.nodeId,
      nif: emisorNif,
      idSistemaInformatico: "W1",
    }),
  );
  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Café solo",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, cfg.locationId, cat.id);
    const section = await createMenuSection(tx, {
      menuId: cat.id,
      name: { [LOCALE]: "Bebidas" },
    });
    const aguaMenuItem = await createMenuItem(tx, {
      menuId: cat.id,
      productId: agua.id,
      sectionId: section.id,
      grossPrice: "1.50",
    });
    const cafeMenuItem = await createMenuItem(tx, {
      menuId: cat.id,
      productId: cafe.id,
      sectionId: section.id,
      grossPrice: "2.00",
    });
    const table = await createTable(tx, cfg, { label: "T1" });
    return {
      aguaId: agua.id,
      cafeId: cafe.id,
      aguaMenuItemId: aguaMenuItem.id,
      cafeMenuItemId: cafeMenuItem.id,
      menuId: cat.id,
      categoryId: bebidas.id,
      tableId: table.id,
    };
  });
  return { db, backend: makeBackend(db), cfg, ...seeded };
}

/**
 * Open the identical two-line tab, optionally serve EVERY line, then pay it through the real pay path
 * with the FROZEN clock, returning the filed registro's huella. `payWorkingOrder` establishes its own
 * `withTransaction`, files from the tab's STORED locked lines, and chains registro #1 on this
 * shop's node — asserted here to be exactly one row at secuencia 1, so the huella is genuinely that of
 * a first record.
 */
async function openServeAndPay(
  shop: Shop,
  serveEveryLine: boolean,
): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, aguaId, cafeId, aguaMenuItemId, cafeMenuItemId, tableId } = shop;
  const { tabId } = await withTransaction(db, async (tx) => {
    const table = (await listTables(tx, cfg)).find((candidate) => candidate.id === tableId);
    const lines =
      table?.zoneId === null
        ? [
            { productId: aguaId, quantity: "1" },
            { productId: cafeId, quantity: "1" },
          ]
        : [
            { menuItemId: aguaMenuItemId, quantity: "1" },
            { menuItemId: cafeMenuItemId, quantity: "1" },
          ];
    return openTab(tx, cfg, {
      tableId,
      lines,
    });
  });

  if (serveEveryLine) {
    await withTransaction(db, async (tx) => {
      await markLineServed(tx, cfg, tabId, 1);
      await markLineServed(tx, cfg, tabId, 2);
    });
  }

  await payWorkingOrder({ db, backend, clock }, cfg, {
    id: tabId,
    lines: [],
    tender: { method: "cash", amount: "10.00" },
  });

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: registrosFacturacion.huella, secuencia: registrosFacturacion.secuencia })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly registro #1 on this shop's fresh chain
    expect(rows[0]!.secuencia).toBe(1);
    return rows[0]!.huella;
  });
  return { tabId, huella };
}

/** `served_at` per line, in line_no order — the field this test differs between the two tabs. */
async function servedAtByLine(shop: Shop, tabId: string): Promise<(string | null)[]> {
  return withTransaction(shop.db, async (tx) => {
    const rows = await tx
      .select({ lineNo: workingOrderLines.lineNo, servedAt: workingOrderLines.servedAt })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    return rows.map((r) => r.servedAt);
  });
}

describe("served_at is not part of the huella", () => {
  it("files an IDENTICAL huella whether every line was served or none — served_at never enters the fiscal record", async () => {
    // TWO shops in SEPARATE databases, ONE shared emisor NIF → same IDEmisorFactura; each its own node
    // → its own chain, so each files A/1 as a first record. With emisor-NIF + basket + chain-position +
    // (frozen) clock all fixed, `served_at` is the ONLY thing that differs between the two filings.
    const emisorNif = nextNif();
    const shopServed = await seedShop(suite.db, emisorNif);
    const shopUnserved = await seedShop(suiteB.db, emisorNif);

    const served = await openServeAndPay(shopServed, true); // every line served
    const unserved = await openServeAndPay(shopUnserved, false); // no line served

    // The invariant. A FAILURE here means `served_at` leaked into the filed record (CLAUDE.md §5:
    // our own metadata must never enter computeHuella) — STOP and report, do NOT adjust the test.
    expect(served.huella).toBe(unserved.huella);
    // Not a trivial pass: a real uppercase-hex SHA-256 digest, so "both null/empty → equal" cannot
    // masquerade as the invariant holding.
    expect(served.huella).toMatch(/^[0-9A-F]{64}$/);

    // Self-check (mirrors verify.test.ts's entorno test): confirm the two tabs GENUINELY differ in
    // `served_at`. Every line of the served tab carries a timestamp; every line of the unserved tab is
    // NULL. Without this, a silent break in the serve plumbing would leave BOTH tabs unserved and this
    // test would pass while differing nothing — no longer testing what its name claims.
    const servedTimes = await servedAtByLine(shopServed, served.tabId);
    const unservedTimes = await servedAtByLine(shopUnserved, unserved.tabId);
    expect(servedTimes).toHaveLength(2);
    expect(servedTimes.every((t) => t !== null)).toBe(true);
    expect(unservedTimes).toHaveLength(2);
    expect(unservedTimes.every((t) => t === null)).toBe(true);
  });
});

/**
 * Place this shop's table on the FP-2 floor-plan canvas: create a live zone (`setTablePlacement`
 * requires one — a placement needs a live table AND a live zone) and write real canvas coordinates,
 * shape and rotation. The values are concrete and non-trivial so the self-check below can pin them.
 */
async function placeTable(shop: Shop): Promise<void> {
  await withTransaction(shop.db, async (tx) => {
    const zone = await createZone(tx, shop.cfg, { name: "Terraza" });
    const department = await tx.execute<{ department_id: string }>(sql`
      select department_id
      from zone_service_policies
      where location_id = ${shop.cfg.locationId}
      limit 1`);
    // Three statements where PostgreSQL took one. `zone_service_policies_default_allowed_fk` — the
    // composite key on (zone_id, default_menu_id) into `zone_menus` — was DEFERRABLE INITIALLY
    // DEFERRED there, and sqlite-core has no deferrable option, so it lands at the statement
    // (`packages/venue-service/src/schema/service.ts`, the comment above that key). The two tables
    // point at each other, so neither can be inserted complete first: the policy row goes in with a
    // NULL default (which satisfies the key), then `zone_menus`, then the policy is updated to name
    // it. Measured: naming the menu in the INSERT gives `FOREIGN KEY constraint failed`, and the
    // control is this ordering, which the case now passes on. The end state is the same row.
    await tx.execute(sql`
      insert into zone_service_policies
        (location_id, zone_id, department_id, service_mode, default_menu_id)
      values (
        ${shop.cfg.locationId}, ${zone.id},
        ${department.rows[0]!.department_id}, 'table_tab', null
      )`);
    await tx.execute(sql`
      insert into zone_menus (zone_id, menu_id)
      values (${zone.id}, ${shop.menuId})`);
    await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${shop.menuId}
      where zone_id = ${zone.id}`);
    // Through the table definition: `preparation_routes.id` is a `$defaultFn` generator
    // (`packages/venue-service/src/schema/service.ts:180`), which a raw statement never reaches.
    await tx.insert(preparationRoutes).values({
      locationId: shop.cfg.locationId,
      categoryId: shop.categoryId,
      stationId: null,
      noPreparation: true,
    });
    await setTablePlacement(tx, shop.cfg, shop.tableId, {
      zoneId: zone.id,
      posX: 500,
      posY: 250,
      shape: "square",
      rotation: 15,
    });
  });
}

/** A table's four FP-2 placement columns — `null` on every one for an unplaced walk-up table. */
interface Placement {
  posX: number | null;
  posY: number | null;
  shape: string | null;
  rotation: number | null;
}

/** This shop's table's placement, read back through the real `listTables` projection (the Task-7b
 *  read side). */
async function placementOf(shop: Shop): Promise<Placement> {
  return withTransaction(shop.db, async (tx) => {
    const table = (await listTables(tx, shop.cfg)).find((t) => t.id === shop.tableId);
    expect(table).toBeDefined();
    return {
      posX: table!.posX,
      posY: table!.posY,
      shape: table!.shape,
      rotation: table!.rotation,
    };
  });
}

// FP-2's fiscal firewall (spec §4 / CLAUDE.md §5). Placement (`pos_x`/`pos_y`/`shape`/`rotation`)
// lives on `dining_tables`, which the pay path never reads — `payWorkingOrder` files from the tab's
// STORED locked lines, and no fiscal source (`record-sale.ts`, `backend.ts`, `registro-row.ts`) even
// names a placement column (the structural half — see the commit body's grep). This proves the same
// BEHAVIOURALLY: two shops file the IDENTICAL basket, one from a table PLACED on the floor plan and
// one from an unplaced walk-up, and must file registros with the IDENTICAL huella. Placement sits on
// `dining_tables` — structurally even further from the huella than `served_at` (a working_order_lines
// field) was.
describe("table placement is not part of the huella", () => {
  it("files an IDENTICAL huella whether the table is placed on the floor plan or a walk-up — placement never enters the fiscal record", async () => {
    // TWO shops in SEPARATE databases, ONE shared emisor NIF → same IDEmisorFactura; each its own node
    // → its own chain, so each files A/1 as a first record. With emisor-NIF + basket + chain-position +
    // (frozen) clock all fixed, table PLACEMENT is the ONLY thing that differs between the two filings.
    const emisorNif = nextNif();
    const shopPlaced = await seedShop(suite.db, emisorNif);
    const shopWalkup = await seedShop(suiteB.db, emisorNif);

    // Place shopPlaced's table on the canvas; shopWalkup's table stays unplaced (a walk-up).
    await placeTable(shopPlaced);

    // Neither line served on either tab — serving is irrelevant to this test and kept CONSTANT so it
    // cannot confound; PLACEMENT is the sole difference.
    const placed = await openServeAndPay(shopPlaced, false);
    const walkup = await openServeAndPay(shopWalkup, false);

    // The invariant. A FAILURE here means a placement field leaked into the filed record (CLAUDE.md
    // §5: our own metadata must never enter computeHuella) — STOP and report, do NOT adjust the test.
    expect(placed.huella).toBe(walkup.huella);
    // Not a trivial pass: a real uppercase-hex SHA-256 digest, so "both null/empty → equal" cannot
    // masquerade as the invariant holding.
    expect(placed.huella).toMatch(/^[0-9A-F]{64}$/);

    // Self-check (§1: a measurement where both answers look alike measures nothing). Confirm the two
    // tables GENUINELY differ in placement: the placed table carries the exact coordinates/shape/
    // rotation just written; the walk-up table is unplaced (all four columns NULL). Without this, a
    // silent break in the placement plumbing would leave BOTH tables unplaced and this test would pass
    // while differing nothing — no longer testing what its name claims.
    const placedPlacement = await placementOf(shopPlaced);
    const walkupPlacement = await placementOf(shopWalkup);
    expect(placedPlacement).toEqual({ posX: 500, posY: 250, shape: "square", rotation: 15 });
    expect(walkupPlacement).toEqual({ posX: null, posY: null, shape: null, rotation: null });
  });
});

/**
 * Open the identical two-line tab, run its lines through the FULL KDS-1 kitchen lifecycle, then pay it
 * through the real pay path with the FROZEN clock — so the registro is filed with the order's KDS state
 * fully populated:
 *   1. `fireLines` inserts one `ticket_items` row per line, each routed + snapshotted to the venue's
 *      seeded default station ('Cocina', `is_default = true` — applyVenue seeds it, so `fireLines`'s
 *      fallback resolves and no `station.no_default` fires);
 *   2. every item is advanced `queued → preparing → ready` via the real `advanceTicketItem`;
 *   3. the order-level `collected_at` handover marker (KDS-1 §3e) is stamped.
 * All THREE happen BEFORE the pay files the registro, so this world's filing carries live ticket items in
 * `ready` and a set `collected_at`. Returns the filed huella (asserted, as the sibling helper does, to be
 * registro #1 at secuencia 1).
 *
 * `collected_at` is stamped by a direct UPDATE rather than `collectOrder`, deliberately: `collectOrder`
 * would file through a DIFFERENT settle path, and this test's whole point is that the two worlds differ in
 * KDS state ALONE — filing path held constant at `payWorkingOrder`, exactly as the served/placement
 * siblings do. `collected_at` is a plain nullable `working_orders` column (no CHECK ties it to a status),
 * and a tab pay leaves it untouched (`markCollected = false`, till-sale.ts), so the value set here survives
 * to the self-check.
 */
async function openKitchenLifecycleAndPay(shop: Shop): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, aguaId, cafeId, tableId } = shop;
  const { tabId } = await withTransaction(db, async (tx) => {
    return openTab(tx, cfg, {
      tableId,
      lines: [
        { productId: aguaId, quantity: "1" },
        { productId: cafeId, quantity: "1" },
      ],
    });
  });

  await withTransaction(db, async (tx) => {
    // Fire the tab's two stored lines to the kitchen (each falls to the seeded default station — neither
    // product nor category names a route), then walk each ticket item queued→preparing→ready.
    const lines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        courseId: workingOrderLines.courseId,
        parentLineId: workingOrderLines.parentLineId,
        note: workingOrderLines.note,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    await fireLines(tx, cfg, tabId, lines);
    const items = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, tabId));
    for (const item of items) {
      await advanceTicketItem(tx, cfg, item.id, "preparing");
      await advanceTicketItem(tx, cfg, item.id, "ready");
    }
    // The order-level customer-handover marker (KDS-1 §3e) — stamped here so this world files WITH it set.
    await tx
      .update(workingOrders)
      .set({ collectedAt: FROZEN_INSTANT.toISOString() })
      .where(eq(workingOrders.id, tabId));
  });

  await payWorkingOrder({ db, backend, clock }, cfg, {
    id: tabId,
    lines: [],
    tender: { method: "cash", amount: "10.00" },
  });

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: registrosFacturacion.huella, secuencia: registrosFacturacion.secuencia })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly registro #1 on this shop's fresh chain
    expect(rows[0]!.secuencia).toBe(1);
    return rows[0]!.huella;
  });
  return { tabId, huella };
}

/** An order's KDS-1 state — the `state` of every ticket item fired from it (empty when the order was never
 *  fired) and its order-level `collected_at` handover marker. The two fields the self-check pins to prove
 *  the kitchen-lifecycle world and the plain world GENUINELY differ. */
interface KdsState {
  ticketStates: TicketState[];
  collectedAt: string | null;
}

async function kdsStateOf(shop: Shop, tabId: string): Promise<KdsState> {
  return withTransaction(shop.db, async (tx) => {
    const items = await tx
      .select({ state: ticketItems.state })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, tabId));
    const [order] = await tx
      .select({ collectedAt: workingOrders.collectedAt })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId));
    return { ticketStates: items.map((i) => i.state), collectedAt: order!.collectedAt };
  });
}

// KDS-1's fiscal firewall (spec §4 / CLAUDE.md §5). The KDS fields — `ticket_items` (a whole new table)
// and `working_orders.collected_at` (the handover marker) — live entirely off the fiscal path:
// `payWorkingOrder` files from the tab's STORED locked lines, and no fiscal source (`record-sale.ts`,
// `backend.ts`, `registro-row.ts`) even NAMES a station/ticket/collected_at field (the structural half —
// the commit body's grep, zero hits). This proves the same BEHAVIOURALLY: two shops file the IDENTICAL
// basket, one whose order ran the full kitchen lifecycle (fired → routed → advanced to ready → collected)
// and one filed plain, and must file registros with the IDENTICAL huella. `collected_at` is the KDS field
// STRUCTURALLY closest to the huella — a `working_orders` column touched in the SAME settle UPDATE that
// files the record (till-sale.ts) — which is exactly why it is pinned here.
describe("KDS state (ticket items + collected_at) is not part of the huella", () => {
  it("files an IDENTICAL huella whether the order ran the full kitchen lifecycle or was filed plain — no KDS field enters the fiscal record", async () => {
    // TWO shops in SEPARATE databases, ONE shared emisor NIF → same IDEmisorFactura; each its own node
    // → its own chain, so each files A/1 as a first record. With emisor-NIF + basket + chain-position +
    // (frozen) clock all fixed, the order's KDS STATE is the ONLY thing that differs between the two filings.
    const emisorNif = nextNif();
    const shopKitchen = await seedShop(suite.db, emisorNif);
    const shopPlain = await seedShop(suiteB.db, emisorNif);

    const kitchen = await openKitchenLifecycleAndPay(shopKitchen); // fired → ready → collected
    const plain = await openServeAndPay(shopPlain, false); // never fired; not collected

    // The invariant. A FAILURE here means a KDS field (a ticket item, its station, or collected_at) leaked
    // into the filed record (CLAUDE.md §5: our own metadata must never enter computeHuella) — STOP and
    // report, do NOT adjust the test; fix the LEAK.
    expect(kitchen.huella).toBe(plain.huella);
    // Not a trivial pass: a real uppercase-hex SHA-256 digest, so "both null/empty → equal" cannot
    // masquerade as the invariant holding.
    expect(kitchen.huella).toMatch(/^[0-9A-F]{64}$/);

    // Self-check (§1: a measurement where both answers look alike measures nothing). Confirm the two orders
    // GENUINELY differ in KDS state: the kitchen order carries two ticket items both advanced to `ready`
    // and a set `collected_at`; the plain order was never fired (no ticket items) and never collected.
    // Without this, a silent break in the fire/advance/collect plumbing would leave BOTH orders plain and
    // this test would pass while differing nothing — no longer testing what its name claims.
    const kitchenState = await kdsStateOf(shopKitchen, kitchen.tabId);
    const plainState = await kdsStateOf(shopPlain, plain.tabId);
    expect(kitchenState.ticketStates).toEqual(["ready", "ready"]);
    expect(kitchenState.collectedAt).not.toBeNull();
    expect(plainState.ticketStates).toEqual([]);
    expect(plainState.collectedAt).toBeNull();

    // Negative control (§1: a control in the other direction). Prove the self-check DISCRIMINATES rather
    // than passing vacuously: were the two worlds identical, the assertions above could NOT both hold. The
    // kitchen world's states are not the plain world's empty set, and vice versa — so a fire that silently
    // did nothing (leaving BOTH plain) would be caught by the `toEqual(["ready","ready"])` above, and a
    // collect that silently ran on both would be caught by the `toBeNull()` below.
    expect(() => expect(plainState.ticketStates).toEqual(["ready", "ready"])).toThrow();
    expect(() => expect(kitchenState.ticketStates).toEqual([])).toThrow();
    expect(() => expect(plainState.collectedAt).not.toBeNull()).toThrow();
  });
});

/**
 * Offer a ONE-item extras list on this shop's `agua` product and return the list's id with the
 * offered product's. The picked product's fiscal-bearing fields — `name`, the offer's `price` and
 * the product's `vatClass` — are held CONSTANT across the two shops (the constants below); the ONLY
 * thing `overlay` varies is the extra product's catalogue allergen declaration, which the ring path
 * never reads. The list is optional and caps the pick at one, so the ring can pick this one product,
 * expanding the dish into a parent row + a single child row whose name/price/vat are frozen from
 * these constants (`buildLineExtras`, modifier-selection.ts, copies the product's three names, the
 * offer's price and the product's VAT class and NOTHING else — the declaration is structurally
 * excluded there). `agua` is each-priced, so the ring accepts an extra on it.
 */
const EXTRA_PRODUCT_NAME = "Panecillo";
const EXTRA_PRICE = "0.50";
const EXTRA_VAT_CLASS = "general" as const;

type OverlayAllergens = Record<string, { presence: "contains" | "may_contain"; source?: string }>;

async function attachExtra(
  shop: Shop,
  overlay: { allergens: OverlayAllergens | null },
): Promise<{ listId: string; productId: string }> {
  return withTransaction(shop.db, async (tx) => {
    const panecillo = await createProduct(tx, {
      catalogueId: shop.menuId,
      categoryId: null,
      name: EXTRA_PRODUCT_NAME,
      pricingUnit: "each",
      unitPrice: EXTRA_PRICE,
      vatClass: EXTRA_VAT_CLASS,
      ...(overlay.allergens === null ? {} : { allergens: overlay.allergens }),
    });
    const list = await createExtraList(
      tx,
      {
        name: "Pan",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [
          { productId: panecillo.id, maxQuantity: 1, preselected: false, price: EXTRA_PRICE },
        ],
      },
      shop.cfg.locale,
    );
    await writeProductModifiers(tx, shop.aguaId, [{ kind: "extras", id: list.id }]);
    return { productId: panecillo.id, listId: list.id };
  });
}

/**
 * Open a two-line tab — `agua` WITH the extra `productId` picked from `listId` (→ a parent dish row +
 * one child row) plus a plain `cafe` — then pay it through the real pay path with the FROZEN clock, and
 * return the filed registro's huella. Same helper shape as `openServeAndPay`/`openKitchenLifecycleAndPay`:
 * `payWorkingOrder` files from the tab's STORED locked lines and chains registro #1 on this shop's node,
 * asserted to be exactly one row at secuencia 1 so the huella is genuinely that of a first record.
 */
async function openWithExtraAndPay(
  shop: Shop,
  extra: { listId: string; productId: string },
): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, aguaId, cafeId, tableId } = shop;
  // Open the tab empty, then ADD a round carrying the pick — `openTab` takes only plain
  // `{productId, quantity}` lines, while `addTabRound` is the path that accepts `extras` and expands
  // the dish into a parent row + one child row (working-order.ts `priceOrderLines`).
  const { tabId } = await withTransaction(db, async (tx) => {
    return openTab(tx, cfg, { tableId });
  });
  await withTransaction(db, async (tx) => {
    await addTabRound(tx, cfg, tabId, [
      {
        productId: aguaId,
        quantity: "1",
        extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] }],
      },
      { productId: cafeId, quantity: "1" },
    ]);
  });

  await payWorkingOrder({ db, backend, clock }, cfg, {
    id: tabId,
    lines: [],
    tender: { method: "cash", amount: "10.00" },
  });

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: registrosFacturacion.huella, secuencia: registrosFacturacion.secuencia })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly registro #1 on this shop's fresh chain
    expect(rows[0]!.secuencia).toBe(1);
    return rows[0]!.huella;
  });
  return { tabId, huella };
}

/** How many child modifier lines (`parent_line_id IS NOT NULL`) were FILED on the sale this tab paid
 *  into — proves the option was genuinely rung into a child `sale_lines` row, not silently dropped. The
 *  sale is found by its `working_order_id` back-pointer (the pay path stamps it, till-sale.ts). */
async function filedChildLineCount(shop: Shop, tabId: string): Promise<number> {
  return withTransaction(shop.db, async (tx) => {
    const rows = await tx
      .select({ id: saleLines.id })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(eq(sales.workingOrderId, tabId), isNotNull(saleLines.parentLineId)));
    return rows.length;
  });
}

/** This shop's extra product's own allergen declaration, read back through `readProductEditor` (the
 *  authoring read side) — the field the self-check pins to prove the two shops GENUINELY differ. */
async function overlayOf(shop: Shop, productId: string): Promise<OverlayAllergens | null> {
  return withTransaction(shop.db, async (tx) => {
    const product = await readProductEditor(tx, productId);
    return product.allergens;
  });
}

// The modifier↔allergen firewall (spec §7 / CLAUDE.md §5). An extra product's allergen declaration is
// a CATALOGUE field the sale path never reads: when a dish's extra is rung into a child line,
// `buildLineExtras` (modifier-selection.ts) freezes ONLY the product's three names, the offer's price
// and the product's VAT class onto that line — the declaration is not among them — and nothing in
// `sale_lines` or `record-sale.ts` names an allergen column at all (the structural half — the commit
// body's grep, zero hits). The as-served allergen profile is computed on DISPLAY read paths (till/KDS)
// only. This proves the same BEHAVIOURALLY: two shops file the IDENTICAL basket with the IDENTICAL
// extra (same name/price/vat), one shop's extra product declaring an allergen and the other's
// declaring none, and must file registros with the IDENTICAL huella.
describe("an extra's allergen declaration is not part of the huella", () => {
  it("files an IDENTICAL huella whether the picked extra declares an allergen or none — the declaration never enters the fiscal record", async () => {
    // TWO shops in SEPARATE databases, ONE shared emisor NIF → same IDEmisorFactura; each its own node
    // → its own chain, so each files A/1 as a first record. With emisor-NIF + basket + picked extra
    // (name/price/vat) + chain-position + (frozen) clock all fixed, the extra's allergen DECLARATION is
    // the ONLY thing that differs between the two filings.
    const emisorNif = nextNif();
    const shopOverlay = await seedShop(suite.db, emisorNif);
    const shopPlain = await seedShop(suiteB.db, emisorNif);

    // Both extra products are byte-identical in name/price/vatClass (the constants) so the child
    // sale_lines are identical; only the catalogue allergen declaration differs.
    const overlayExtra = await attachExtra(shopOverlay, {
      allergens: { gluten: { presence: "contains" } },
    });
    const plainExtra = await attachExtra(shopPlain, { allergens: null });

    const overlay = await openWithExtraAndPay(shopOverlay, overlayExtra);
    const plain = await openWithExtraAndPay(shopPlain, plainExtra);

    // The invariant. A FAILURE here means an allergen field leaked into the filed record (CLAUDE.md §5:
    // our own metadata must never enter computeHuella) — STOP and report, do NOT adjust the test; fix
    // the LEAK.
    expect(overlay.huella).toBe(plain.huella);
    // Not a trivial pass: a real uppercase-hex SHA-256 digest, so "both null/empty → equal" cannot
    // masquerade as the invariant holding.
    expect(overlay.huella).toMatch(/^[0-9A-F]{64}$/);

    // Self-check (§1: a measurement where both answers look alike measures nothing). Confirm the two
    // shops' extras GENUINELY differ in declaration: the overlay shop's product declares `gluten`; the
    // plain shop's product declares nothing (NULL). Without this, a silent break in the declaration
    // plumbing would leave BOTH products bare and this test would pass while differing nothing — no
    // longer testing what its name claims.
    const overlayAdd = await overlayOf(shopOverlay, overlayExtra.productId);
    const plainAdd = await overlayOf(shopPlain, plainExtra.productId);
    expect(overlayAdd).toEqual({ gluten: { presence: "contains" } });
    expect(plainAdd).toBeNull();

    // Second self-check: the extra was GENUINELY rung into a child `sale_lines` row on BOTH sales (one
    // per sale — the agua's single pick). Without this, an extra silently dropped on the ring path
    // would leave both sales childless and the huella equality would hold VACUOUSLY, no longer
    // exercising the modifier↔fiscal boundary the test name claims.
    expect(await filedChildLineCount(shopOverlay, overlay.tabId)).toBe(1);
    expect(await filedChildLineCount(shopPlain, plain.tabId)).toBe(1);
  });
});
