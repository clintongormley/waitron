import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { locations, tills, workingOrderLines, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
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
import type { DeviceRequestConfig, TillConfig } from "../till-config.js";
import { deviceRequestCfg } from "./session-device.js";
import { createStation } from "../kitchen.js";
import { createPrinter } from "@waitron/printing";
import { attachPrinterToStation } from "../station-printers.js";
import { createWatcher, setPrinterWatcher } from "../watchers.js";
import { setClaim } from "@waitron/venue-service";
import { createTable } from "../tables.js";
import { seatTable } from "../parties.js";
import { OPERATOR } from "./party-venue.js";
import { createOpenOrder, fireLines } from "../working-order.js";
import { offerProducts } from "./zone-offers.js";
import { seedLegacySellingUnits } from "./seed-units.js";

const LOCALE = "es-ES";
let db: Database;
export function useSplitExtrasDb(database: Database): void {
  db = database;
}

export interface Venue {
  cfg: DeviceRequestConfig;
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
  const cfg = await deviceRequestCfg(db, {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
    orderFlow: "prepay",
  } satisfies TillConfig);
  return { cfg, catalogueId };
}

/** A reusable table and counter venue for the split-extra send, release and edit suites. */
export async function setupSplitExtrasVenue() {
  const { cfg, catalogueId } = await setupVenue();
  const built = await withTransaction(db, async (tx) => {
    const stations = {
      grill: (await createStation(tx, cfg, { name: "Grill" })).id,
      fryer: (await createStation(tx, cfg, { name: "Fryer" })).id,
      kitchen: (await createStation(tx, cfg, { name: "Kitchen", isDefault: true })).id,
      bar: (await createStation(tx, cfg, { name: "Bar" })).id,
    };
    const printers = {} as Record<"grill" | "fryer" | "kitchen" | "bar" | "pass", string>;
    for (const station of ["grill", "fryer", "kitchen", "bar"] as const) {
      const printer = await createPrinter(
        tx,
        { locationId: cfg.locationId },
        {
          name: `${station} printer`,
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        },
      );
      printers[station] = printer.id;
      await attachPrinterToStation(tx, { stationId: stations[station], printerId: printer.id });
    }
    const pass = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      {
        name: "Pase",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      },
    );
    printers.pass = pass.id;
    const watcher = await createWatcher(tx, cfg, {
      name: "Pase",
      runsPass: true,
      everyStation: false,
      stationIds: [stations.grill, stations.fryer],
      everyZone: true,
      zoneIds: [],
    });
    await setPrinterWatcher(tx, cfg, pass.id, watcher.id);

    const food = await createCategory(tx, { name: "Food" });
    const burgers = await createCategory(tx, { name: "Burgers", parentId: food.id });
    const extras = await createCategory(tx, { name: "Extras" });
    const sides = await createCategory(tx, { name: "Sides", parentId: extras.id });
    const toppings = await createCategory(tx, { name: "Toppings", parentId: extras.id });
    const sauces = await createCategory(tx, { name: "Sauces", parentId: extras.id });
    const drinks = await createCategory(tx, { name: "Drinks" });
    const bottled = await createCategory(tx, { name: "Bottled", parentId: drinks.id });
    const folders = {
      food: food.id,
      burgers: burgers.id,
      extras: extras.id,
      sides: sides.id,
      toppings: toppings.id,
      sauces: sauces.id,
      drinks: drinks.id,
      bottled: bottled.id,
    };
    await setClaim(tx, cfg, burgers.id, { kind: "station", stationId: stations.grill });
    await setClaim(tx, cfg, sides.id, { kind: "station", stationId: stations.fryer });
    await setClaim(tx, cfg, sauces.id, { kind: "no_preparation" });
    await setClaim(tx, cfg, bottled.id, { kind: "no_preparation" });

    const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
    const product = async (
      name: string,
      customer: string,
      kitchen: string,
      categoryId: string,
      allergens?: { gluten: { presence: "contains"; source: string } },
    ) =>
      (
        await createProduct(tx, {
          catalogueId,
          categoryId,
          name,
          customerName: { [defaultLanguage]: customer },
          kitchenName: kitchen,
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "general",
          ...(allergens === undefined ? {} : { allergens }),
        })
      ).id;
    const products = {
      burger: await product("Burger", "Hamburguesa clásica", "BURG", burgers.id),
      chips: await product("Chips", "Patatas fritas", "CHIPS", sides.id, {
        gluten: { presence: "contains", source: "wheat" },
      }),
      cheese: await product("Cheese", "Queso extra", "QUESO", toppings.id),
      sauce: await product("Sauce", "Salsa brava", "SALSA", sauces.id),
      water: await product("Water", "Agua mineral", "AGUA", bottled.id),
      onionRings: await product("Onion rings", "Aros de cebolla", "AROS", sides.id),
    };
    const listItems = [products.chips, products.onionRings, products.cheese, products.sauce].map(
      (productId) => ({ productId, maxQuantity: 2, preselected: false, price: null }),
    );
    const burgerList = await createExtraList(
      tx,
      {
        name: "Burger extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: listItems,
      },
      cfg.locale,
    );
    const waterList = await createExtraList(
      tx,
      {
        name: "Water extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: listItems,
      },
      cfg.locale,
    );
    await writeProductModifiers(tx, products.burger, [{ kind: "extras", id: burgerList.id }]);
    await writeProductModifiers(tx, products.water, [{ kind: "extras", id: waterList.id }]);
    const lists = { burger: burgerList.id, water: waterList.id };
    const tables = await offerProducts(tx, cfg, { zone: "tables" });
    const counter = await offerProducts(tx, cfg, { zone: "counter" });
    const tableId = (await createTable(tx, cfg, { label: "Split extras", zoneId: tables.zoneId }))
      .id;
    const seated = await seatTable(tx, cfg, { tableId, guestCount: null, operatorId: OPERATOR });
    const party = { tableId, zoneId: tables.zoneId, partyId: seated.partyId, tabId: seated.tabId };
    return { stations, printers, folders, products, lists, tables, counter, party };
  });
  return { cfg, catalogueId, ...built };
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
type ExtraItem = {
  name: string;
  customerName?: string;
  kitchenName?: string;
  maxQuantity?: number;
  categoryId?: string;
};
type NamedExtraItem = ExtraItem & { customerName: string; kitchenName: string };

export function addExtras(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
  dishId: string,
  items: NamedExtraItem[],
): Promise<{ listId: string; productIds: string[] }>;
/** Use only when a kitchen-print case asserts the fixture's exact staff name on paper. */
export function addExtras(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
  dishId: string,
  items: ExtraItem[],
  options: { staffNameOnly: true },
): Promise<{ listId: string; productIds: string[] }>;
export async function addExtras(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
  dishId: string,
  items: ExtraItem[],
  options?: { staffNameOnly: true },
): Promise<{ listId: string; productIds: string[] }> {
  const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
  const productIds: string[] = [];
  for (const item of items) {
    if (
      options?.staffNameOnly !== true &&
      (item.customerName === undefined ||
        item.kitchenName === undefined ||
        new Set([item.name, item.customerName, item.kitchenName]).size !== 3)
    )
      throw new Error("addExtras: three distinct names required");
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
