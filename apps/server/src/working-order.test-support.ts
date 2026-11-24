import {
  type Database,
  type Transaction,
  units,
  withTransaction,
  nowIso,
  workingOrders,
  workingOrderLines,
  diningTables,
  ticketItems,
  products,
  routingCells,
} from "@waitron/db";
import { seedVenue, seedNode } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock, FiscalBackend } from "@waitron/fiscal";
import * as menu from "@waitron/menu";
import {
  createMenu,
  createCategory,
  createProduct,
  assignMenuToVenue,
  addProductToMenu,
  setProductVariants,
  setMenuVariants,
  listAvailableProducts,
  priceBasket,
} from "@waitron/menu";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  type ExtraSelection,
  type OptionSelection,
  centsToDecimal,
  type AllergenMap,
  type DietaryLabel,
} from "@waitron/shared";
import { setRoutingCell, type RouteTarget } from "@waitron/venue-service";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import { sql, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createStation, createCourse, setProductCourse } from "./kitchen.js";
import { readScopedPassBoard } from "./pass-board.js";
import { attachPrinterToStation } from "./station-printers.js";
import type { OrderFlow } from "./testing/bill-payment-fixture.js";
import { ensureOperator } from "./testing/cancel-line.js";
import { openGroupedCounterOrder } from "./testing/grouped-counter-order.js";
import {
  updateHeldOrder,
  addTabRound,
  addGroupedTabRound,
} from "./testing/order-writer-fixture.js";
import { boardItems, EVERY } from "./testing/pass-board-probe.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { deviceRequestCfg } from "./testing/session-device.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { type ZoneOffers, offerProducts, routeProductTo } from "./testing/zone-offers.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { fireLines } from "./working-order-kitchen-fire.js";
import { fireOrderLines } from "./working-order-kitchen-service.js";
import { parkOrder, createOpenOrder } from "./working-order-open.js";

export const LOCALE = "es-ES";
/** An ISO timestamp `minutes` in the past, for backdating a `queued_at` that a band assertion reads. */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
export let db: Database;
beforeAll(() => {
  db = suite.db;
});
interface SeededVenue {
  cfg: DeviceRequestConfig;

  menuId: string;
  /** The `each`-priced "Espresso" product (VAT general/21%, category "ES drinks"). */
  coffeeId: string;
  /** A second `each` product with NO category, so its priced line carries `category: null`. */
  waterId: string;
  zoneId: string;
  coffeeOfferId: string;
  premiumCoffeeOfferId: string;
  eachUnitId: string;
  kgUnitId: string;
}
/** Every dish on the whole pass board, card by card. */
export async function passItems(tx: Transaction) {
  return boardItems(await readScopedPassBoard(tx, EVERY));
}
export async function setupVenue(orderFlow: OrderFlow = "prepay"): Promise<SeededVenue> {
  const eachUnitId = randomUUID();
  const kgUnitId = randomUUID();
  await db.insert(units).values([
    {
      staffName: "Staff unit",
      staffAbbreviation: "su",
      id: eachUnitId,
      seedKey: "each",
      name: { en: "each" },
      abbreviation: { en: "ea" },
      precision: 0,
      hardwareUnit: null,
    },
    {
      staffName: "Staff unit",
      staffAbbreviation: "su",
      id: kgUnitId,
      seedKey: "kg",
      name: { en: "kg" },
      abbreviation: { en: "kg" },
      precision: 3,
      hardwareUnit: "kg",
    },
  ]);
  await seedVenue(db, {
    name: "Counter",
    invoiceLocales: [LOCALE],
  });
  const nodeId = await seedNode(db);
  await withTransaction(db, (tx) => ensureOperator(tx, OPERATOR));

  const { coffeeId, waterId, menuId, zoneId, coffeeOfferId, premiumCoffeeOfferId } =
    await withTransaction(db, async (tx) => {
      const cat = await createMenu(tx, { name: "Menu" });
      const drinksCategory = await createCategory(tx, { name: "ES drinks" });
      const coffeeProduct = await createProduct(tx, {
        categoryId: drinksCategory.id,
        name: "Espresso",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      // Deliberately category-less, so its priced line snapshots `category: null` — the other side
      // of `parkOrder`'s `?? null`.
      const waterProduct = await createProduct(tx, {
        categoryId: null,
        name: "Water",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      await assignMenuToVenue(tx, cat.id);
      const premium = await createMenu(tx, { name: "Premium menu" });
      const coffeeOffer = await addProductToMenu(tx, {
        menuId: cat.id,
        productId: coffeeProduct.id,
        grossPrice: "2.50",
      });
      const premiumCoffeeOffer = await addProductToMenu(tx, {
        menuId: premium.id,
        productId: coffeeProduct.id,
        grossPrice: "3.25",
      });
      // `departments.id`/`floor_zones.id` and both tables' `created_at` are `$defaultFn`
      // generators a raw insert never reaches, so they are supplied here.
      const departmentId = randomUUID();
      const zoneId = randomUUID();
      const createdAt = nowIso();
      await tx.execute(sql`
      insert into departments
        (id, name, trading_name, created_at)
      values (${departmentId}, 'Restaurant', 'Restaurant', ${createdAt})`);
      await tx.execute(sql`
      insert into floor_zones (id, name, department_id, created_at)
      values (${zoneId}, 'Counter', ${departmentId}, ${createdAt})`);
      await tx.execute(
        sql`update floor_zones set department_id = ${departmentId}, is_counter_default = true where id = ${zoneId}`,
      );
      await tx.execute(sql`
      update departments set order_start = 'counter', paid_when = ${orderFlow === "ticket_then_pay" ? "ticket_then_pay" : "prepay"}
      where id = ${departmentId}`);

      await offerMenuThroughZone(tx, zoneId, cat.id, {
        makeDefault: true,
      });
      await offerMenuThroughZone(tx, zoneId, premium.id, {
        displayOrder: 1,
      });
      await publishWorkingMenu(tx, cat.id);
      await publishWorkingMenu(tx, premium.id);
      return {
        coffeeId: coffeeProduct.id,
        waterId: waterProduct.id,
        menuId: cat.id,
        zoneId,
        coffeeOfferId: coffeeOffer.id,
        premiumCoffeeOfferId: premiumCoffeeOffer.id,
      };
    });

  const cfg = await deviceRequestCfg(suite.db, {
    nodeId: brandNodeId(nodeId),
    // `parkOrder` reads neither series nor locale/invoiceLocales; fresh values keep the shape whole.
    seriesId: brandSeriesId(randomUUID()),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    simplifiedInvoiceLimit: null,
    // Defaults to prepay (park/list/retrieve/update/abandon don't dispatch on the mode); the KDS fire
    // tests pass "ticket_then_pay" so placeOrder takes the non-fiscal placing path.
  });
  return {
    cfg,
    coffeeId,
    waterId,
    menuId,
    zoneId,
    coffeeOfferId,
    premiumCoffeeOfferId,
    eachUnitId,
    kgUnitId,
  };
}
/** A second area in `setupVenue`'s department, offering `menuId`, and not the counter's default. */
export async function secondArea(menuId: string): Promise<string> {
  return withTransaction(db, async (tx) => {
    const zoneId = randomUUID();
    await tx.execute(sql`
      insert into floor_zones (id, name, department_id, created_at)
      select ${zoneId}, 'Terrace', department_id, ${nowIso()} from floor_zones limit 1`);
    await offerMenuThroughZone(tx, zoneId, menuId);
    return zoneId;
  });
}
/** A basket line naming the product it sells; {@link ZoneOffers.toOfferLines} turns it into an offer line. */
export interface ProductLine {
  productId: string;
  quantity: string;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
  note?: string;
}
/**
 * Every product the venue's menu holds now, offered in its counter zone (`setupVenue`'s) from
 * the test helper's own menu at the product's own price. Call it after the menu is final.
 */
export function counterOffers(): Promise<ZoneOffers> {
  return withTransaction(db, (tx) => offerProducts(tx));
}
/** `parkOrder` for a basket named by product, sold through each product's counter-zone offer. */
export async function parkProducts(
  cfg: DeviceRequestConfig,
  req: { id: string; label?: string; lines: ProductLine[] },
): Promise<{ id: string; orderNumber: number }> {
  const offers = await counterOffers();
  return parkOrder({ db }, cfg, {
    ...req,
    zoneId: offers.zoneId,
    lines: offers.toOfferLines(req.lines),
  });
}
/** `updateHeldOrder` for a basket named by product, each line naming its counter-zone offer. */
export async function updateProducts(
  cfg: DeviceRequestConfig,
  id: string,
  req: {
    label?: string;
    revision?: number;
    lines: (ProductLine & { workingOrderLineId?: string })[];
  },
): Promise<number> {
  const offers = await counterOffers();
  return updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
    ...req,
    revision: req.revision ?? (await revisionOf(id)),
    lines: offers.toOfferLines(req.lines),
  });
}
/** The order's current revision, for an edit whose test is not about the out-of-date check; 0 for
 * an order that does not exist. */
export async function revisionOf(orderId: string): Promise<number> {
  const [row] = await db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row?.revision ?? 0;
}
/**
 * The venue's default content language — what the order path widens a plain staff name under when it
 * freezes an options answer, and the key a product's customer-name map has to use to be read back.
 */
export const CONTENT_LANGUAGE = "es";
/** Attach one more list to a product without dropping what it already carries: `writeProductModifiers`
 *  replaces the whole set. */
export async function attachModifierList(
  tx: Transaction,
  productId: string,
  ref: { kind: "extras" | "options"; id: string },
): Promise<void> {
  const carried = (await menu.readProductModifiers(tx, [productId])).get(productId) ?? [];
  await menu.writeProductModifiers(tx, productId, [
    ...carried.map((each) => ({ kind: each.kind, id: each.id })),
    ref,
  ]);
}
/**
 * An extras list offering ONE product, attached to `dishId`. Its three names all differ, and so do
 * the offered product's, so a surface reading the wrong one of the six fails (CLAUDE.md §3).
 *
 * `price` is the list item's own — `null` makes it borrow the offered product's `unitPrice`, which is
 * deliberately different, so a child priced at `unitPrice` when a `price` was given means the offer
 * was never read.
 */
export async function addExtraList(
  tx: Transaction,
  dishId: string,
  label: string,
  opts: {
    price?: string | null;
    unitPrice?: string;
    vatClass?: "general" | "reduced" | "super_reduced" | "zero";
    maxQuantity?: number | null;
    minPicks?: number;
    maxPicks?: number | null;
    active?: boolean;
  } = {},
): Promise<{ listId: string; productId: string }> {
  const offered = await createProduct(tx, {
    categoryId: null,
    name: `${label} staff`,
    customerName: { [CONTENT_LANGUAGE]: `${label} customer` },
    kitchenName: `${label} kitchen`,
    pricingUnit: "each",
    unitPrice: opts.unitPrice ?? "9.99",
    vatClass: opts.vatClass ?? "general",
  });
  const list = await menu.createExtraList(
    tx,
    {
      name: `${label} list staff`,
      customerName: { [CONTENT_LANGUAGE]: `${label} list customer` },
      kitchenName: `${label} list kitchen`,
      minPicks: opts.minPicks ?? 0,
      maxPicks: opts.maxPicks === undefined ? null : opts.maxPicks,
      active: opts.active ?? true,
      items: [
        {
          productId: offered.id,
          maxQuantity: opts.maxQuantity === undefined ? 1 : opts.maxQuantity,
          preselected: false,
          price: opts.price === undefined ? "0.50" : opts.price,
        },
      ],
    },
    LOCALE,
  );
  await attachModifierList(tx, dishId, { kind: "extras", id: list.id });
  return { listId: list.id, productId: offered.id };
}
/**
 * An options list of one or more labels, attached to `dishId`. Every ACTIVE options list a dish
 * carries MUST be answered, so a fixture that adds one commits every line ordering that dish to
 * answering it.
 */
export async function addOptionList(
  tx: Transaction,
  dishId: string,
  label: string,
  labelNames: string[] = [label],
): Promise<{ listId: string; labelIds: string[] }> {
  const list = await menu.createOptionList(
    tx,
    {
      name: `${label} list staff`,
      customerName: { [CONTENT_LANGUAGE]: `${label} list customer` },
      kitchenName: `${label} list kitchen`,
      defaultLabelId: null,
      active: true,
      labels: labelNames.map((each) => ({
        name: `${each} staff`,
        customerName: { [CONTENT_LANGUAGE]: `${each} customer` },
        kitchenName: `${each} kitchen`,
        available: true,
      })),
    },
    LOCALE,
  );
  await attachModifierList(tx, dishId, { kind: "options", id: list.id });
  return { listId: list.id, labelIds: list.labels.map((each) => each.id) };
}
/**
 * Publish one "Coffee" product with a "Large" variant on `menuId`, both carrying a
 * customer-facing name of their own that DIFFERS from their staff name, and return the offer and
 * variant ids. The two customer names differ from the staff names on purpose: a label built from the
 * staff names, or from the product's customer name alone, reads differently from the variant's own,
 * so a reader that drops the variant is tellable apart from one that keeps it.
 */
export async function seedVariantOffer(
  tx: Transaction,
  menuId: string,
): Promise<{ offerId: string; variantId: string; smallVariantId: string; productId: string }> {
  const product = await createProduct(tx, {
    categoryId: null,
    name: "Coffee",
    customerName: { [CONTENT_LANGUAGE]: "Freshly ground coffee" },
    kitchenName: "COF",
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
  });
  const offer = await addProductToMenu(tx, {
    menuId: menuId,
    productId: product.id,
    grossPrice: "2.50",
  });
  const variants = await setProductVariants(
    tx,
    product.id,
    [
      {
        name: "Large",
        customerName: { [CONTENT_LANGUAGE]: "Large cup" },
        kitchenName: "LG",
        image: null,
        unitPrice: "3.00",
        available: true,
      },
      {
        name: "Small",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "2.00",
        available: true,
      },
    ],
    LOCALE,
  );
  await setMenuVariants(tx, offer.id, [
    { variantId: variants[0]!.id, price: "3.20" },
    { variantId: variants[1]!.id, price: "2.20" },
  ]);
  await publishWorkingMenu(tx, menuId);
  return {
    offerId: offer.id,
    variantId: variants[0]!.id,
    smallVariantId: variants[1]!.id,
    productId: product.id,
  };
}
/**
 * Read a working order and its lines back RAW, for computing what
 * `listHeldOrders`/`getHeldOrder` should independently return. `openedAt` is the actual persisted
 * value, so a `toEqual` on the list carries every field rather than an `objectContaining` that
 * would let an unasserted key slip through (CLAUDE.md §4).
 */
export async function readOrder(id: string): Promise<{
  openedAt: string;
  lineTotals: string[];
}> {
  const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
  const lines = await db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  return { openedAt: wo!.openedAt, lineTotals: lines.map((l) => centsToDecimal(l.lineTotal)) };
}
/**
 * The GROSS (VAT-inclusive) basket total the operator saw for `lines` — the products' own prices
 * through `priceBasket`, which is what the offers `offerProducts` publishes charge (each offer's
 * price is left blank, so it sells at its product's), then take its `.total`. This is
 * the number every other surface shows (the basket grand total, the printed ticket), and the
 * invariant a held-orders `total` MUST equal EXACTLY. Derived independently
 * of the persisted `line_total` column, so a held total computed from the NET base fails
 * against it (2 × 1.50 gross is 3.00 here, not the net 2.48 the fiscal line carries).
 */
export async function grossBasketTotal(
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return withTransaction(db, async (tx) => {
    const { products: available } = await listAvailableProducts(tx);
    const byId = new Map(available.map((p) => [p.id, p]));
    // A menu row is not priceable as read: its customer-facing text is resolved from
    // `name`/`customerName` by `product-presentation.ts` first, exactly as `priceOrderLines` does.
    const items = lines.map((l) => {
      const product = byId.get(l.productId)!;
      return {
        product: {
          ...product,
          descriptions: menu.customerPresentationText(
            {
              name: product.name,
              customerName: product.customerName,
              kitchenName: null,
              variantName: null,
              variantCustomerName: null,
              variantKitchenName: null,
            },
            LOCALE,
          ).product,
        },
        quantity: l.quantity,
      };
    });
    return priceBasket(items, "2026-09-27").total;
  });
}
/** Drive a parked order to a terminal status by UPDATE, the transition the enforce trigger allows. */
export async function setStatus(id: string, status: "settled" | "abandoned"): Promise<void> {
  await withTransaction(db, async (tx) => {
    // `settled` demands a settled_at (working_orders_settled_at_ck is a biconditional); `abandoned`
    // demands it stay NULL. The BEFORE UPDATE enforce_transition trigger permits open→either.
    if (status === "settled") {
      await tx.execute(
        sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${id}`,
      );
    } else {
      await tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id}`);
    }
  });
}
/**
 * Insert an open order on ANOTHER node at the venue. The row exists to prove reads are
 * venue-wide (#259): a promoted node inherits the venue's open tabs even though they are
 * tagged with the dead node's id. `node_id` is the foreign node's on purpose.
 */
export async function seedForeignNodeOrder(cfg: DeviceRequestConfig): Promise<string> {
  const id = randomUUID();
  const otherNode = await seedNode(db);
  await db.execute(sql`
    insert into working_orders (id, source, device_id, node_id, order_number, status, opened_at, dining)
    values (${id}, 'device', ${cfg.origin.deviceId}, ${otherNode},
      (select coalesce(max(order_number), 0) + 1 from working_orders), 'open', ${nowIso()}, 'eat_in')`);
  return id;
}
/** The accountable operator a placing amendment is attributed to (a fixed fixture uuid — only ever
 *  stored, never joined; mirrors working-order.pay-and-dispatch.test.ts's OPERATOR). */
export const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";
/** A trusted-clock stub: placeOrder reads only `now()` for its amendment's wall-clock. */
export const stubClock = {
  now: () => ({ instant: new Date(), offsetMinutes: 0 }),
} as unknown as TrustedClock;
/** A fiscal-backend stub — never touched on the non-`ticket_then_pay` placing paths these tests exercise. */
export const stubBackend = {} as unknown as FiscalBackend;
/** A basket line for a product at quantity 1 — the shape createOpenOrder/fireLines consume. */
export const line = (productId: string) => ({ productId, quantity: "1" });
/** Create a sellable product, optionally filed in a category or routed by a product cell. */
export async function makeProduct(
  tx: Transaction,
  route: { categoryId?: string; stationId?: string },
): Promise<string> {
  const { id } = await createProduct(tx, {
    categoryId: route.categoryId ?? null,
    name: `P-${randomUUID().slice(0, 8)}`,
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
  });
  if (route.stationId !== undefined) {
    await routeProductTo(tx, id, route.stationId);
  }
  return id;
}
/** Create a station, an active cloud-poll printer, and attach the printer to it — the createStation +
 *  createPrinter + attachPrinterToStation trio the print-on-fire / correction-slip tests repeat verbatim.
 *  Returns the created station and the printer id (call sites use whichever they need). */
export async function attachedPrinter(
  tx: Transaction,
  station: { name: string; isDefault?: boolean },
  printerName: string,
): Promise<{ station: Awaited<ReturnType<typeof createStation>>; printerId: string }> {
  const created = await createStation(tx, station);
  const { id: printerId } = await createPrinter(tx, {
    name: printerName,
    transport: "cloud_poll",
    pollId: `poll-${randomUUID()}`,
  });
  await attachPrinterToStation(tx, {
    stationId: created.id,
    printerId,
  });
  return { station: created, printerId };
}
/** The helper's table-service zone, every current product offered in it. */
export function tableOffers(tx: Transaction): Promise<ZoneOffers> {
  return offerProducts(tx, { zone: "tables" });
}
/** Insert an active dining table in the table-service zone and return its id (for the openTab →
 *  addRound path). */
export async function makeTable(tx: Transaction): Promise<string> {
  const { zoneId } = await tableOffers(tx);
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into dining_tables (id, label, zone_id, created_at)
    values (${randomUUID()}, ${`T-${randomUUID().slice(0, 8)}`}, ${zoneId},
      ${nowIso()})
    returning id`);
  await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, rows[0]!.id));
  return rows[0]!.id;
}
/** `addTabRound` for a round named by product, each line sold through its table-zone offer. */
export async function addRound(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  tabId: string,
  lines: (ProductLine & { courseId?: string | null; hold?: boolean })[],
  add = addTabRound,
): Promise<void> {
  const offers = await tableOffers(tx);
  await add(tx, cfg, tabId, offers.toOfferLines(lines));
}
/** {@link addRound} with each line stored as one row holding its whole quantity. */
export const addGroupedRound: typeof addRound = (tx, cfg, tabId, lines) =>
  addRound(tx, cfg, tabId, lines, addGroupedTabRound);
/** `createOpenOrder` for a basket named by product, sold through each product's counter-zone offer. */
export async function createOfferedOrder(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  id: string,
  lines: ProductLine[],
  shape: "portions" | "grouped" = "portions",
): Promise<{ orderNumber: number }> {
  const offers = await offerProducts(tx);
  if (shape === "grouped") {
    return openGroupedCounterOrder(tx, cfg, id, offers.toOfferLines(lines), {
      zoneId: offers.zoneId,
    });
  }
  return createOpenOrder(tx, cfg, id, offers.toOfferLines(lines), null, {
    zoneId: offers.zoneId,
  });
}
export async function placeOrderWith(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  // `note` is the per-line KDS customisation (non-fiscal) — `createOpenOrder` validates
  // and persists it on the parent dish line, and `fireLines` snapshots it onto the ticket.
  lines: ProductLine[],
  shape: "portions" | "grouped" = "portions",
): Promise<{ id: string }> {
  const id = randomUUID();
  await createOfferedOrder(tx, cfg, id, lines, shape);
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
  return { id };
}
/**
 * Open an order with no service context and one line per product, then fire it. Raw lines let the
 * routing tests exercise orders without a service zone; price and name are fixture placeholders.
 */
export async function fireContextless(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  productIds: string[],
): Promise<{ id: string }> {
  const id = randomUUID();
  await createOpenOrder(tx, cfg, id, [], null);
  await insertContextlessLines(tx, id, productIds);
  await fireLines(tx, cfg, id, await fireableLines(tx, id));
  return { id };
}
export async function insertContextlessLines(
  tx: Transaction,
  orderId: string,
  productIds: string[],
  quantity = 1000,
): Promise<void> {
  await tx.insert(workingOrderLines).values(
    productIds.map((productId, index) => ({
      workingOrderId: orderId,
      lineNo: index + 1,
      productId,
      name: "Line",
      descriptions: { [LOCALE]: "Line" },
      quantity,
      unitPriceGross: 150,
      vatClass: "general",
      takeawayVatClass: "general",
      lineTotal: (quantity * 150) / 1000,
    })),
  );
}
/** Attach a fresh one-product extras list to `dishId`, priced 0.50 at the reduced rate — the shape a
 *  line's `extras: [{ listId, picks: [{ productId }] }]` picks from, for the child-line tests.
 *
 *  The extra's OWN allergens and dietary labels live on the PRODUCT the list offers, which is where
 *  the kitchen and expo reads take them from. Omitted leaves `allergens` null and the declarations
 *  empty. */
export async function addExtra(
  tx: Transaction,
  dishId: string,
  name: string,
  overlay?: {
    add?: AllergenMap;
    suitableFor?: DietaryLabel[];
  },
): Promise<{ listId: string; productId: string }> {
  const offered = await createProduct(tx, {
    categoryId: null,
    name,
    pricingUnit: "each",
    unitPrice: "9.99",
    vatClass: "reduced",
    ...(overlay?.add === undefined ? {} : { allergens: overlay.add }),
    ...(overlay?.suitableFor === undefined ? {} : { dietaryDeclarations: overlay.suitableFor }),
  });
  const list = await menu.createExtraList(
    tx,
    {
      name: `${name} list`,
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: 1,
      active: true,
      items: [{ productId: offered.id, maxQuantity: 1, preselected: false, price: "0.50" }],
    },
    LOCALE,
  );
  await attachModifierList(tx, dishId, { kind: "extras", id: list.id });
  return { listId: list.id, productId: offered.id };
}
/** The order's ticket items joined back to each line's product, for asserting where each line routed. */
export async function ticketItemsFor(
  tx: Transaction,
  orderId: string,
): Promise<{ productId: string | null; stationId: string; state: string }[]> {
  return tx
    .select({
      productId: workingOrderLines.productId,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId));
}
export const byProduct = (
  items: { productId: string | null; stationId: string; state: string }[],
  productId: string,
) => items.find((i) => i.productId === productId)!;
/** The order's ticket items joined to their line, in line_no order — each item's id (the bump target),
 *  line and current state, so a test can address item[0]/item[1] deterministically. */
export async function ticketItemRows(
  tx: Transaction,
  orderId: string,
): Promise<{ id: string; lineNo: number; state: string }[]> {
  return tx
    .select({ id: ticketItems.id, lineNo: workingOrderLines.lineNo, state: ticketItems.state })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}
/** The order's ticket items joined to their line, carrying the fields the hold-and-fire tests read:
 *  the item id (the bump target), its product (to key by line), its snapshotted course and
 *  `fired_at` (NULL = held). */
export async function courseItemsFor(
  tx: Transaction,
  orderId: string,
): Promise<
  {
    id: string;
    productId: string | null;
    courseId: string | null;
    firedAt: string | null;
    state: string;
  }[]
> {
  return tx
    .select({
      id: ticketItems.id,
      productId: workingOrderLines.productId,
      courseId: ticketItems.courseId,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId));
}
export const byLine = <T extends { productId: string | null }>(items: T[], productId: string): T =>
  items.find((i) => i.productId === productId)!;
export async function firedCourseAcrossTwoStations(
  tx: Transaction,
  cfg: DeviceRequestConfig,
): Promise<{ orderId: string; courseId: string }> {
  await createStation(tx, { name: "Kitchen", isDefault: true });
  const barStation = await createStation(tx, { name: "Counter" });
  const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
  const soup = await makeProduct(tx, {}); // → Kitchen (default)
  const olives = await makeProduct(tx, { stationId: barStation.id });
  await setProductCourse(tx, soup, starterCourse.id);
  await setProductCourse(tx, olives, starterCourse.id);
  const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);
  return { orderId, courseId: starterCourse.id };
}
/** Every stored row of an order, in line order, with the columns an edit must leave alone. */
export async function storedRows(id: string) {
  return db
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      name: workingOrderLines.name,
      descriptions: workingOrderLines.descriptions,
      kitchenName: workingOrderLines.kitchenName,
      category: workingOrderLines.category,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
      vatClass: workingOrderLines.vatClass,
      note: workingOrderLines.note,
      extraListId: workingOrderLines.extraListId,
      sentAt: workingOrderLines.sentAt,
      servedAt: workingOrderLines.servedAt,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
}
// ---------------------------------------------------------------------------------------------------
// Variants as products: a variant is sold as the product it is. The line's `product_id` names the variant; the parent's three
// frozen names sit beside the variant's own; the price and VAT are the variant's EFFECTIVE values; and
// the kitchen treats the line as its parent would, unless the variant overrides the field.
// ---------------------------------------------------------------------------------------------------

/**
 * "Wine by the glass" (reduced, category "Wines", course First, sulphites, vegan) on the venue's
 * zone menu, with two variants: "125 ml" sets nothing but its staff name and price, so every other
 * field reads its parent's; "175 ml" sets its own customer and kitchen names, VAT, course,
 * allergens and dietary declarations, so a reader of the parent's value gets it wrong. 175 ml also
 * still stores a category of its own ("Glasses"), which a variant never reads: its category is
 * always its parent's.
 */
export async function seedWine(tx: Transaction, menuId: string) {
  const wineCategory = await createCategory(tx, { name: "Wines" });
  const glassesCategory = await createCategory(tx, { name: "Glasses" });
  const firstCourse = await createCourse(tx, { name: "First", displayOrder: 1 });
  const secondCourse = await createCourse(tx, { name: "Second", displayOrder: 2 });
  const parent = await createProduct(tx, {
    categoryId: wineCategory.id,
    name: "Wine by the glass",
    customerName: { [CONTENT_LANGUAGE]: "House wine" },
    kitchenName: "WINE",
    pricingUnit: "each",
    unitPrice: "4.00",
    vatClass: "reduced",
    allergens: { sulphites: {} },
    dietaryDeclarations: ["vegan"],
  });
  await setProductCourse(tx, parent.id, firstCourse.id);
  const offer = await addProductToMenu(tx, {
    menuId: menuId,
    productId: parent.id,
    grossPrice: null,
  });
  const [wine125, wine175] = await setProductVariants(
    tx,
    parent.id,
    [
      {
        name: "125 ml",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "4.50",
        available: true,
      },
      {
        name: "175 ml",
        customerName: { [CONTENT_LANGUAGE]: "Large glass" },
        kitchenName: "V175",
        image: null,
        unitPrice: "5.50",
        available: true,
      },
    ],
    LOCALE,
  );
  await tx
    .update(products)
    .set({
      vatClass: "general",
      categoryId: glassesCategory.id,
      courseId: secondCourse.id,
      allergens: { gluten: { kinds: ["wheat" as const] } },
      dietaryDeclarations: ["halal"],
    })
    .where(eq(products.id, wine175!.id));
  await publishWorkingMenu(tx, menuId);
  return {
    parentId: parent.id,
    offerId: offer.id,
    wine125: wine125!.id,
    wine175: wine175!.id,
    wineCategoryId: wineCategory.id,
    glassesCategoryId: glassesCategory.id,
    firstCourseId: firstCourse.id,
    secondCourseId: secondCourse.id,
  };
}
/** The lines of `orderId` as `fireLines` takes them, in line order. */
export async function fireableLines(tx: Transaction, orderId: string) {
  return tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}
export async function fireProductLine(
  tx: Transaction,
  cfg: Parameters<typeof fireOrderLines>[1],
  orderId: string,
  productId: string,
) {
  const lines = (await fireableLines(tx, orderId)).filter((row) => row.productId === productId);
  expect(lines.length).toBeGreaterThan(0);
  await fireOrderLines(
    tx,
    cfg,
    orderId,
    lines.map((row) => row.id),
  );
}
export async function categoryStations(
  tx: Transaction,
  categoryIds: readonly string[],
): Promise<Record<string, string | null>> {
  const rows = await tx
    .select({ categoryId: routingCells.categoryId, stationId: routingCells.stationId })
    .from(routingCells)
    .where(inArray(routingCells.categoryId, [...categoryIds]));
  return Object.fromEntries(rows.map((row) => [row.categoryId!, row.stationId]));
}
export async function insertRoute(
  tx: Transaction,
  route: { zoneId?: string; productId?: string; categoryId?: string; stationId: string },
): Promise<void> {
  const row =
    route.productId !== undefined
      ? { kind: "product" as const, productId: route.productId }
      : route.categoryId !== undefined
        ? { kind: "category" as const, categoryId: route.categoryId }
        : { kind: "all" as const };
  await setRoutingCell(
    tx,
    { row, zoneId: route.zoneId ?? null },
    { kind: "station", stationId: route.stationId },
  );
}
/** Routes a category in every zone. */
export async function routeCategory(
  tx: Transaction,
  categoryId: string,
  target: RouteTarget,
): Promise<void> {
  await setRoutingCell(tx, { row: { kind: "category", categoryId }, zoneId: null }, target);
}
