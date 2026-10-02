import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { locations, tills, workingOrderLines, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createExtraList,
  createProduct,
  readContentLanguages,
  writeProductModifiers,
} from "@waitron/catalogue";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "../till-config.js";
import { createOpenOrder, fireLines } from "../working-order.js";
import { offerProducts } from "./zone-offers.js";
import { seedLegacySellingUnits } from "./seed-units.js";

const LOCALE = "es-ES";
let db: Database;
export function useSplitExtrasDb(database: Database): void {
  db = database;
}

export interface Venue {
  cfg: TillConfig;
  catalogueId: string;
}

/** A fresh location, till, node and assigned catalogue, returning the till's config. */
export async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  // Inserted through the table definitions, not as raw SQL: the ids and `created_at` come from
  // `$defaultFn` generators, which a raw insert never reaches.
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const catalogueId = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    return cat.id;
  });
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  return { cfg, catalogueId };
}

export type ProductLine = {
  productId: string;
  quantity: string;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
  note?: string;
};

/** Open a working order in the counter zone, selling each line through the zone's offer for its
 *  product. Call once the suite's products, stations and extras are final: the offers' routes mirror
 *  the active claim or default station each product would have taken. */
export async function createOfferedOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  lines: ProductLine[],
): ReturnType<typeof createOpenOrder> {
  const offers = await offerProducts(tx, cfg);
  return createOpenOrder(tx, cfg, id, offers.toOfferLines(lines), null, {
    zoneId: offers.zoneId,
  });
}

/** Open a working order carrying `lines` and fire it, returning the order id. Passes every persisted
 *  line, children included, to `fireLines`, so the parent-only filter under test is `fireLines`' own. */
export async function fireNewOrder(
  tx: Transaction,
  cfg: TillConfig,
  lines: ProductLine[],
): Promise<string> {
  const id = randomUUID();
  await createOfferedOrder(tx, cfg, id, lines);
  const fired = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return id;
}

/** Offer one optional, uncapped extras list on `dishId`, returning the list id and the offered
 *  products' ids in order. Callers choose whether these products have a folder claim. */
export async function addExtras(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
  dishId: string,
  items: {
    name: string;
    customerName?: string;
    kitchenName?: string;
    maxQuantity?: number;
    categoryId?: string;
  }[],
): Promise<{ listId: string; productIds: string[] }> {
  const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
  const productIds: string[] = [];
  for (const item of items) {
    const { id } = await createProduct(tx, {
      catalogueId,
      categoryId: item.categoryId ?? null,
      name: item.name,
      ...(item.customerName === undefined
        ? {}
        : { customerName: { [defaultLanguage]: item.customerName } }),
      ...(item.kitchenName === undefined ? {} : { kitchenName: item.kitchenName }),
      pricingUnit: "each",
      unitPrice: "0.50",
      vatClass: "reduced",
    });
    productIds.push(id);
  }
  const list = await createExtraList(
    tx,
    {
      name: "Extras",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: null,
      active: true,
      items: productIds.map((productId, index) => ({
        productId,
        maxQuantity: items[index]!.maxQuantity ?? 1,
        preselected: false,
        price: null,
      })),
    },
    cfg.locale,
  );
  await writeProductModifiers(tx, dishId, [{ kind: "extras", id: list.id }]);
  return { listId: list.id, productIds };
}
