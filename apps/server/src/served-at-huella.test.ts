import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { asAppUser, ticketItems, withTenant, workingOrderLines, workingOrders } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend, registerSif, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import type { TillConfig } from "./till-config.js";
import { createTable, createZone, listTables, setTablePlacement } from "./tables.js";
import {
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
// Real Postgres, not PGlite: a genuine chained fiscal record filed by the app role through the real
// pay path, the same reason `till-sale.test.ts` uses `useTemplateDb`. The huella comparison itself is
// deterministic either way; the value is a stronger end-to-end receipt.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

let backend: FiscalBackend;
let clock: TrustedClock;

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

// A fresh, unique NIF per test. The clone this suite runs against is its own database (useTemplateDb
// clones per file), so this never collides with any other suite; the counter keeps repeated tests in
// THIS file order-independent.
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
    },
  };
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface Shop {
  cfg: TillConfig;
  aguaId: string;
  cafeId: string;
  tableId: string;
}

/**
 * Provision a shop under its OWN fresh tenant, RE-REGISTER its node's SIF under the SHARED emisor NIF,
 * seed an IDENTICAL two-product catalogue, and create one dining table.
 *
 * TWO SEPARATE tenants are deliberate. `registros_identidad_uq` is PER TENANT on (id_emisor_factura,
 * num_serie_factura, fecha_expedicion_factura, tipo_registro): two records sharing that AEAT identity
 * inside one tenant are a duplicate (AEAT error 3000) and collide. But the huella hashes exactly those
 * identity fields, so the two records this test compares MUST share them — so each goes in its OWN
 * tenant, where identidad_uq (tenant-scoped) never fires. The SHARED emisor NIF then keeps
 * `IDEmisorFactura` — the one hashed identity field a fresh tenant would otherwise vary — identical.
 * This mirrors verify.test.ts's entorno test, which likewise uses a fresh tenant per record while
 * pinning IDEmisorFactura to one constant (there via `altaFor`'s hardcoded TEST_NIF).
 *
 * `applyVenue` registers the node's SIF under the tenant's own tax_id; re-registering under `emisorNif`
 * (registerSif revokes the old identity, mints a fresh installation number, and resets the chain to
 * empty) is what makes both shops file under one obligado NIF while each starts a first record. The
 * NumeroInstalacion differs between the two shops (a per-NIF counter) but is not hashed. Run as the
 * owner under the tenant GUC — exactly how applyVenue itself runs registerSif (no asAppUser).
 */
async function seedShop(emisorNif: string): Promise<Shop> {
  const venue = await applyVenue(planVenue(venueRequest(nextNif())), { db: suite.admin });
  const cfg = tillConfigFromVenue(venue);
  await withTenant(suite.admin, cfg.tenantId, (tx) =>
    registerSif(tx, {
      tenantId: cfg.tenantId,
      nodeId: cfg.nodeId,
      nif: emisorNif,
      idSistemaInformatico: "W1",
    }),
  );
  const seeded = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua mineral" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café solo" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, cfg.locationId, cat.id);
    const table = await createTable(tx, cfg, { label: "T1" });
    return { aguaId: agua.id, cafeId: cafe.id, tableId: table.id };
  });
  return { cfg, ...seeded };
}

/**
 * Open the identical two-line tab, optionally serve EVERY line, then pay it through the real pay path
 * with the FROZEN clock, returning the filed registro's huella. `payWorkingOrder` establishes its own
 * `withTenant`/`asAppUser`, files from the tab's STORED locked lines, and chains registro #1 on this
 * shop's node — asserted here to be exactly one row at secuencia 1, so the huella is genuinely that of
 * a first record.
 */
async function openServeAndPay(
  shop: Shop,
  serveEveryLine: boolean,
): Promise<{ tabId: string; huella: string }> {
  const { cfg, aguaId, cafeId, tableId } = shop;
  const { tabId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return openTab(tx, cfg, {
      tableId,
      lines: [
        { productId: aguaId, quantity: "1" },
        { productId: cafeId, quantity: "1" },
      ],
    });
  });

  if (serveEveryLine) {
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await markLineServed(tx, cfg, tabId, 1);
      await markLineServed(tx, cfg, tabId, 2);
    });
  }

  await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
    id: tabId,
    lines: [],
    tender: { method: "cash", amount: "10.00" },
  });

  const huella = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
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
async function servedAtByLine(cfg: TillConfig, tabId: string): Promise<(string | null)[]> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const rows = await tx
      .select({ lineNo: workingOrderLines.lineNo, servedAt: workingOrderLines.servedAt })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    return rows.map((r) => r.servedAt);
  });
}

beforeAll(() => {
  clock = frozenClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("served-at-huella.test: resolveClient must never be called")),
  });
});

describe("served_at is not part of the huella", () => {
  it("files an IDENTICAL huella whether every line was served or none — served_at never enters the fiscal record", async () => {
    // TWO shops (own tenants), ONE shared emisor NIF → same IDEmisorFactura; each its own node → its
    // own chain, so each files A/1 as a first record. With emisor-NIF + basket + chain-position +
    // (frozen) clock all fixed, `served_at` is the ONLY thing that differs between the two filings.
    const emisorNif = nextNif();
    const shopServed = await seedShop(emisorNif);
    const shopUnserved = await seedShop(emisorNif);

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
    const servedTimes = await servedAtByLine(shopServed.cfg, served.tabId);
    const unservedTimes = await servedAtByLine(shopUnserved.cfg, unserved.tabId);
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
  await withTenant(suite.admin, shop.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const zone = await createZone(tx, shop.cfg, { name: "Terraza" });
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
  return withTenant(suite.admin, shop.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
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
    // TWO shops (own tenants), ONE shared emisor NIF → same IDEmisorFactura; each its own node → its
    // own chain, so each files A/1 as a first record. With emisor-NIF + basket + chain-position +
    // (frozen) clock all fixed, table PLACEMENT is the ONLY thing that differs between the two filings.
    const emisorNif = nextNif();
    const shopPlaced = await seedShop(emisorNif);
    const shopWalkup = await seedShop(emisorNif);

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
 * to the self-check. app_user holds UPDATE on `working_orders` (the settle path writes it as app_user).
 */
async function openKitchenLifecycleAndPay(shop: Shop): Promise<{ tabId: string; huella: string }> {
  const { cfg, aguaId, cafeId, tableId } = shop;
  const { tabId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return openTab(tx, cfg, {
      tableId,
      lines: [
        { productId: aguaId, quantity: "1" },
        { productId: cafeId, quantity: "1" },
      ],
    });
  });

  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    // Fire the tab's two stored lines to the kitchen (each falls to the seeded default station — neither
    // product nor category names a route), then walk each ticket item queued→preparing→ready.
    const lines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        courseId: workingOrderLines.courseId,
        parentLineId: workingOrderLines.parentLineId,
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

  await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
    id: tabId,
    lines: [],
    tender: { method: "cash", amount: "10.00" },
  });

  const huella = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
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
  return withTenant(suite.admin, shop.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
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
    // TWO shops (own tenants), ONE shared emisor NIF → same IDEmisorFactura; each its own node → its
    // own chain, so each files A/1 as a first record. With emisor-NIF + basket + chain-position +
    // (frozen) clock all fixed, the order's KDS STATE is the ONLY thing that differs between the two filings.
    const emisorNif = nextNif();
    const shopKitchen = await seedShop(emisorNif);
    const shopPlain = await seedShop(emisorNif);

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
