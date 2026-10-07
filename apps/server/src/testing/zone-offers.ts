import { and, eq, inArray, isNull } from "drizzle-orm";
import { catalogues, floorZones, products } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  addProducts,
  createCatalogue,
  menuItems,
  requireMenuRoot,
  resolveAccessibleCatalogueIds,
} from "@waitron/catalogue";
import type { ServiceMode } from "@waitron/module";
import {
  configureZone,
  createDepartment,
  createException,
  setClaim,
  setZoneSalePolicyOverride,
  listDepartments,
  zoneAllDayMenus,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import type { TillConfig } from "../till-config.js";
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
  /** Defaults to `"prepay"`, or `"table_tab"` for `zone: "tables"`. */
  serviceMode?: ServiceMode;
  paidWhen?: "prepay" | "ticket_then_pay";
  /** Defaults to every top-level product of the location's accessible catalogues. */
  productIds?: readonly string[];
}

type Cfg = Pick<TillConfig, "locationId">;

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
  cfg: Cfg,
  options: OfferProductsOptions = {},
): Promise<ZoneOffers> {
  const zone = options.zone ?? "counter";
  const serviceMode = options.serviceMode ?? (zone === "tables" ? "table_tab" : "prepay");
  const zoneId = await resolveZone(tx, cfg, zone, serviceMode);
  if (options.paidWhen !== undefined) {
    await setZoneSalePolicyOverride(tx, cfg, zoneId, "paidWhen", options.paidWhen);
  }

  const menuId = await ownMenu(tx);
  const [own] = await tx
    .select({ menuId: zoneAllDayMenus.menuId })
    .from(zoneAllDayMenus)
    .where(eq(zoneAllDayMenus.zoneId, zoneId));
  await offerMenuThroughZone(tx, cfg, zoneId, menuId, { makeDefault: own === undefined });

  const productIds = [...new Set(options.productIds ?? (await topLevelProducts(tx, cfg)))];
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
  cfg: Cfg,
  zone: NonNullable<OfferProductsOptions["zone"]>,
  serviceMode: ServiceMode,
): Promise<string> {
  let zoneId: string;
  if (typeof zone === "object") {
    zoneId = zone.zoneId;
  } else if (zone === "counter") {
    const [counter] = await tx
      .select({ zoneId: zoneServicePolicies.zoneId })
      .from(zoneServicePolicies)
      .where(
        and(
          eq(zoneServicePolicies.locationId, cfg.locationId),
          eq(zoneServicePolicies.isCounterDefault, true),
        ),
      );
    zoneId = counter?.zoneId ?? (await floorZone(tx, cfg, COUNTER_ZONE));
  } else {
    zoneId = await floorZone(tx, cfg, TABLES_ZONE);
  }

  const [policy] = await tx
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(eq(zoneServicePolicies.zoneId, zoneId));
  const departmentId = policy?.departmentId ?? (await department(tx, cfg, serviceMode));
  await configureZone(tx, cfg, { zoneId, departmentId, serviceMode });
  if (zone === "counter") {
    await tx
      .update(zoneServicePolicies)
      .set({ isCounterDefault: true })
      .where(eq(zoneServicePolicies.zoneId, zoneId));
  }
  return zoneId;
}

async function floorZone(tx: Transaction, cfg: Cfg, name: string): Promise<string> {
  const where = and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.name, name));
  const [existing] = await tx.select({ id: floorZones.id }).from(floorZones).where(where);
  if (existing !== undefined) return existing.id;
  const [created] = await tx
    .insert(floorZones)
    .values({ locationId: cfg.locationId, name })
    .returning({ id: floorZones.id });
  return created!.id;
}

async function department(tx: Transaction, cfg: Cfg, serviceMode: ServiceMode): Promise<string> {
  const active = (await listDepartments(tx, cfg)).find((row) => row.active);
  if (active !== undefined) return active.id;
  return (
    await createDepartment(tx, cfg, { name: "Test department", defaultServiceMode: serviceMode })
  ).id;
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

async function topLevelProducts(tx: Transaction, cfg: Cfg): Promise<string[]> {
  const { ids } = await resolveAccessibleCatalogueIds(tx, cfg.locationId);
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.catalogueId, ids), isNull(products.parentId)))
    .orderBy(products.id);
  return rows.map((row) => row.id);
}

/** Test-only: route one top-level product to a station on every order, as an exception. */
export async function routeProductTo(
  tx: Transaction,
  cfg: Cfg,
  productId: string,
  stationId: string,
): Promise<void> {
  await createException(tx, cfg, {
    zoneId: null,
    categoryId: null,
    productId,
    target: { kind: "station", stationId },
  });
}

/** Test-only: a station claims a folder. */
export async function claimFolderFor(
  tx: Transaction,
  cfg: Cfg,
  categoryId: string,
  stationId: string,
): Promise<void> {
  await setClaim(tx, cfg, categoryId, { kind: "station", stationId });
}
