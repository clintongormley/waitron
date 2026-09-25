import { and, eq, inArray, isNull } from "drizzle-orm";
import { catalogues, categories, floorZones, kitchenStations, products } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  addProducts,
  createCatalogue,
  menuDetails,
  menuItems,
  readProductModifiers,
  resolveAccessibleCatalogueIds,
  setMenuItemExtraLists,
} from "@waitron/catalogue";
import type { ServiceMode } from "@waitron/module";
import {
  allowMenuInZone,
  configureZone,
  createDepartment,
  createPreparationRoute,
  deletePreparationRoute,
  listDepartments,
  listPreparationRoutes,
  updatePreparationRoute,
  zoneServicePolicies,
} from "@waitron/venue-service";
import type { TillConfig } from "../till-config.js";

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
  /** Defaults to `cfg.orderFlow`, or `"table_tab"` for `zone: "tables"`. */
  serviceMode?: ServiceMode;
  /** Defaults to every top-level product of the location's accessible catalogues. */
  productIds?: readonly string[];
  /** `"mirror-legacy"` (default) writes, per product, the venue-wide product route to the station
   *  `fireLines`' context-less chain would pick; `"none"` writes and removes no route. */
  routes?: "mirror-legacy" | "none";
}

type Cfg = Pick<TillConfig, "locationId" | "orderFlow">;

const MENU_NAME = "Test offers";
const COUNTER_ZONE = "Test counter";
const TABLES_ZONE = "Test tables";

/**
 * Offer products in a service zone from a menu of this helper's own, so a test can sell them on the
 * zoned path. The menu is never one the suite made, so the prices this writes never overwrite the
 * suite's own. Each product sits on the menu's top level with no menu price, so it sells at the
 * product's own price. Idempotent: call it again after adding products or changing stations.
 */
export async function offerProducts(
  tx: Transaction,
  cfg: Cfg,
  options: OfferProductsOptions = {},
): Promise<ZoneOffers> {
  const zone = options.zone ?? "counter";
  const serviceMode = options.serviceMode ?? (zone === "tables" ? "table_tab" : cfg.orderFlow);
  const zoneId = await resolveZone(tx, cfg, zone, serviceMode);

  const menuId = await ownMenu(tx);
  const [policy] = await tx
    .select({ defaultMenuId: zoneServicePolicies.defaultMenuId })
    .from(zoneServicePolicies)
    .where(eq(zoneServicePolicies.zoneId, zoneId));
  await allowMenuInZone(tx, cfg, zoneId, menuId, { makeDefault: policy!.defaultMenuId === null });

  const productIds = [...new Set(options.productIds ?? (await topLevelProducts(tx, cfg)))];
  const offerByProduct = await placeOnTopLevel(tx, menuId, productIds);
  const modifiers = await readProductModifiers(tx, productIds);
  for (const productId of productIds) {
    const extras = (modifiers.get(productId.toLowerCase()) ?? []).filter(
      (ref) => ref.kind === "extras",
    );
    await setMenuItemExtraLists(
      tx,
      offerByProduct.get(productId)!,
      extras.map((ref) => ({ listId: ref.id, items: [] })),
    );
  }

  if ((options.routes ?? "mirror-legacy") === "mirror-legacy") {
    await mirrorLegacyRoutes(tx, cfg, productIds);
  }

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
 * Puts every product on the menu's top level at its own price and switched on, and returns each
 * one's menu-item id. A product already there keeps its membership and has its row reset, as a
 * repeat call expects.
 */
async function placeOnTopLevel(
  tx: Transaction,
  menuId: string,
  productIds: string[],
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const [details] = await tx
    .select({ rootSectionId: menuDetails.rootSectionId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  await addProducts(tx, details!.rootSectionId, productIds);
  const ofMenu = and(eq(menuItems.menuId, menuId), inArray(menuItems.productId, productIds));
  await tx.update(menuItems).set({ grossPrice: null, active: true }).where(ofMenu);
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

/**
 * The context-less chain in `fireLines` (working-order.ts): the product's station, else its
 * category's, else the location's active default. A variant is not offered here, so a product's own
 * station is its effective one.
 */
async function mirrorLegacyRoutes(
  tx: Transaction,
  cfg: Cfg,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const [fallback] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.isDefault, true),
        eq(kitchenStations.active, true),
      ),
    );
  const rows = await tx
    .select({
      id: products.id,
      productStationId: products.stationId,
      categoryStationId: categories.stationId,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(inArray(products.id, [...productIds]));
  const existing = new Map(
    (await listPreparationRoutes(tx, cfg))
      .filter((route) => route.zoneId === null && route.productId !== null)
      .map((route) => [route.productId!, route]),
  );
  for (const row of rows) {
    const stationId = row.productStationId ?? row.categoryStationId ?? fallback?.id ?? null;
    const route = existing.get(row.id);
    if (stationId === null) {
      if (route !== undefined) await deletePreparationRoute(tx, cfg, route.id);
      continue;
    }
    const input = { productId: row.id, target: { kind: "station" as const, stationId } };
    if (route === undefined) await createPreparationRoute(tx, cfg, input);
    else if (route.stationId !== stationId || route.noPreparation) {
      await updatePreparationRoute(tx, cfg, route.id, input);
    }
  }
}
