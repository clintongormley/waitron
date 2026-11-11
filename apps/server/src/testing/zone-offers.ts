import { and, eq, inArray, isNull } from "drizzle-orm";
import { catalogues, floorZones, products, readVenue } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { addProducts, createCatalogue, menuItems, requireMenuRoot } from "@waitron/catalogue";
import {
  configureZone,
  createDepartment,
  departmentReceipts,
  setRoutingCell,
  setZoneSalePolicyOverride,
  listDepartments,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";

import { publishWorkingMenu } from "./publish-menu.js";

export interface ZoneOffers {
  zoneId: string;
  menuId: string;
  /** The menu-item id offering `productId` in this zone; throws naming the product otherwise. */
  offerFor(productId: string): string;
  toOfferLines<L extends { productId: string }>(
    lines: L[],
  ): (Omit<L, "productId"> & { menuItemId: string })[];
}

export interface OfferProductsOptions {
  /** `"counter"` (default) is the venue's counter-default zone, created if the venue has none;
   *  `"tables"` is a zone of its own for dining tables. */
  zone?: "counter" | "tables" | { zoneId: string };
  orderStart?: "table" | "counter";
  paidWhen?: "prepay" | "ticket_then_pay";
  productIds?: readonly string[];
}

const MENU_NAME = "Test offers";
const COUNTER_ZONE = "Test counter";
const TABLES_ZONE = "Test tables";

/**
 * Offer products in a service zone from a menu of this helper's own, so a test can sell them on the
 * zoned path. The menu is never one the suite made, so the prices this writes never overwrite the
 * suite's own. Each product sits on the menu's top level with no menu price, so it sells at the
 * product's own price. The menu is published, so a till sells what the products were when this
 * ran. Idempotent: call it again after adding products or to publish a product change.
 */
export async function offerProducts(
  tx: Transaction,
  _cfg: unknown,
  options: OfferProductsOptions = {},
): Promise<ZoneOffers> {
  const zone = options.zone ?? "counter";
  const orderStart = options.orderStart ?? (zone === "tables" ? "table" : "counter");
  const zoneId = await resolveZone(tx, zone, orderStart);
  if (options.paidWhen !== undefined) {
    await setZoneSalePolicyOverride(tx, zoneId, "paidWhen", options.paidWhen);
  }

  const menuId = await ownMenu(tx);
  await offerMenuThroughZone(tx, zoneId, menuId);

  const productIds = [...new Set(options.productIds ?? (await topLevelProducts(tx)))];
  const offerByProduct = await placeOnTopLevel(tx, menuId, productIds);
  await publishWorkingMenu(tx, menuId);

  const offerFor = (productId: string): string => {
    const menuItemId = offerByProduct.get(productId);
    if (menuItemId === undefined) {
      throw new Error(`offerProducts: product ${productId} has no offer in zone ${zoneId}`);
    }
    return menuItemId;
  };
  return {
    zoneId,
    menuId,
    offerFor,
    toOfferLines: (lines) =>
      lines.map(({ productId, ...rest }) => ({ ...rest, menuItemId: offerFor(productId) })),
  };
}

async function resolveZone(
  tx: Transaction,
  zone: NonNullable<OfferProductsOptions["zone"]>,
  orderStart: "table" | "counter",
): Promise<string> {
  let zoneId: string;
  if (typeof zone === "object") {
    zoneId = zone.zoneId;
  } else if (zone === "counter") {
    const [counter] = await tx
      .select({ zoneId: zoneServicePolicies.zoneId })
      .from(zoneServicePolicies)
      .where(and(eq(zoneServicePolicies.isCounterDefault, true)));
    zoneId = counter?.zoneId ?? (await floorZone(tx, COUNTER_ZONE));
  } else {
    zoneId = await floorZone(tx, TABLES_ZONE);
  }

  const [policy] = await tx
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(eq(zoneServicePolicies.zoneId, zoneId));
  const departmentId = policy?.departmentId ?? (await department(tx, orderStart));
  const location = await readVenue(tx);
  await tx
    .insert(departmentReceipts)
    .values({
      departmentId,
      receipt: { operationDescription: location.operationDescription },
    })
    .onConflictDoNothing({ target: departmentReceipts.departmentId });
  await configureZone(tx, { zoneId, departmentId, orderStart });
  if (zone === "counter") {
    await tx
      .update(zoneServicePolicies)
      .set({ isCounterDefault: true })
      .where(eq(zoneServicePolicies.zoneId, zoneId));
  }
  return zoneId;
}

async function floorZone(tx: Transaction, name: string): Promise<string> {
  const where = and(eq(floorZones.name, name));
  const [existing] = await tx.select({ id: floorZones.id }).from(floorZones).where(where);
  if (existing !== undefined) return existing.id;
  const [created] = await tx.insert(floorZones).values({ name }).returning({ id: floorZones.id });
  return created!.id;
}

async function department(tx: Transaction, orderStart: "table" | "counter"): Promise<string> {
  const active = (await listDepartments(tx)).find((row) => row.active);
  if (active !== undefined) return active.id;
  return (await createDepartment(tx, { name: "Test department", orderStart })).id;
}

/**
 * Puts every product on the menu's top level at its own price, and returns each one's menu-item
 * id. A product already there keeps its membership and has its row reset, as a repeat call expects.
 */
async function placeOnTopLevel(
  tx: Transaction,
  menuId: string,
  productIds: string[],
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  await addProducts(tx, await requireMenuRoot(tx, menuId), productIds);
  const ofMenu = and(eq(menuItems.menuId, menuId), inArray(menuItems.productId, productIds));
  await tx.update(menuItems).set({ grossPrice: null }).where(ofMenu);
  const rows = await tx
    .select({ id: menuItems.id, productId: menuItems.productId })
    .from(menuItems)
    .where(ofMenu);
  return new Map(rows.map((row) => [row.productId, row.id]));
}

async function ownMenu(tx: Transaction): Promise<string> {
  const [existing] = await tx
    .select({ id: catalogues.id })
    .from(catalogues)
    .where(eq(catalogues.name, MENU_NAME));
  return existing?.id ?? (await createCatalogue(tx, { name: MENU_NAME })).id;
}

async function topLevelProducts(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .innerJoin(
      catalogues,
      and(eq(catalogues.id, products.catalogueId), eq(catalogues.active, true)),
    )
    .where(isNull(products.parentId))
    .orderBy(products.id);
  return rows.map((row) => row.id);
}

/** Test-only: route one top-level product to a station in every zone; a later call replaces it. */
export async function routeProductTo(
  tx: Transaction,
  productId: string,
  stationId: string,
): Promise<void> {
  await setRoutingCell(
    tx,
    { row: { kind: "product", productId }, zoneId: null },
    { kind: "station", stationId },
  );
}

/** Test-only: route a category to a station in every zone. */
export async function routeCategoryTo(
  tx: Transaction,
  categoryId: string,
  stationId: string,
): Promise<void> {
  await setRoutingCell(
    tx,
    { row: { kind: "category", categoryId }, zoneId: null },
    { kind: "station", stationId },
  );
}
