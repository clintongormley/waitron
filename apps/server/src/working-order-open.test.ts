import {
  withTransaction,
  workingOrderLines,
  workingOrders,
  captureError,
  isUniqueViolation,
  nowIso,
  diningTables,
  departments,
  ticketItems,
  kitchenStations,
  printJobs,
} from "@waitron/db";
import { seedVenueSettings, seedActivityActor, seedBusinessDay } from "@waitron/db/testing/seed.js";
import * as menu from "@waitron/menu";
import {
  createProduct,
  addProductToMenu,
  setProductVariants,
  setMenuVariants,
  createCategory,
} from "@waitron/menu";
import {
  setZoneSalePolicyOverride,
  setRoutingCell,
  setStationToday,
  WEEK_DISPLAY_ORDER,
  replaceMenuWeek,
  readHolidayFacts,
} from "@waitron/venue-service";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createStation, createCourse, setProductCourse } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { readScopedPassBoard } from "./pass-board.js";
import { readTabLines } from "./stored-order-lines.js";
import { abandonHeldOrder, addTabRound, updateOrderLine } from "./testing/order-writer-fixture.js";
import { boardItems, EVERY } from "./testing/pass-board-probe.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { openPartyTab } from "./testing/serve-line.js";
import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { getHeldOrder } from "./working-order-held-read.js";
import { fireLines } from "./working-order-kitchen-fire.js";
import { createOpenOrder, parkOrder } from "./working-order-open.js";
import { listStationQueue } from "./working-order-station-queue.js";
import {
  setupVenue,
  db,
  seedVariantOffer,
  insertRoute,
  LOCALE,
  CONTENT_LANGUAGE,
  parkProducts,
  counterOffers,
  line,
  routeCategory,
  makeProduct,
  insertContextlessLines,
  fireableLines,
  ticketItemsFor,
  fireContextless,
  makeTable,
  addRound,
  OPERATOR,
  attachedPrinter,
  courseItemsFor,
  byLine,
  addExtra,
} from "./working-order.test-support.js";

describe("a sold variant line carries its product and relative variant names", () => {
  const STAFF = "Coffee (Large)";
  const KITCHEN = "COF (LG)";

  it("shows the product and variant names on the tab, the station queue and the pass, and hands the retrieve screen both names", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const orderId = randomUUID();
    const { tabLines, stationItems, expoItems } = await withTransaction(db, async (tx) => {
      const { offerId, variantId, productId } = await seedVariantOffer(tx, menuId);
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      await insertRoute(tx, { zoneId, productId, stationId: kitchenStation.id });
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [{ menuItemId: offerId, variantId, quantity: "1" }],
        null,
        { zoneId },
      );
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
        .where(eq(workingOrderLines.workingOrderId, orderId));
      await fireLines(tx, cfg, orderId, fired);
      return {
        tabLines: await readTabLines(tx, orderId),
        stationItems: (await listStationQueue(tx, kitchenStation.id))[0]!.items,
        expoItems: boardItems(await readScopedPassBoard(tx, EVERY)),
      };
    });
    // `getHeldOrder` opens its own transaction, so it runs outside the block above.
    const held = await getHeldOrder({ db }, orderId);

    expect(tabLines.map((l) => l.name)).toEqual([STAFF]);
    expect(stationItems.map((i) => i.name)).toEqual([KITCHEN]);
    expect(expoItems.map((i) => i.name)).toEqual([KITCHEN]);
    expect(held.lines.map((l) => [l.product?.name, l.product?.variantName])).toEqual([
      ["Coffee", "Large"],
    ]);
    // The frozen customer halves reach it too, still apart — the staff name is what the till shows,
    // but a retrieved line that later prints must not have lost its customer text.
    expect(held.lines.map((l) => l.product?.customerName)).toEqual([
      { [LOCALE]: "Freshly ground coffee" },
    ]);
    expect(held.lines.map((l) => l.product?.variantCustomerName)).toEqual([
      { [LOCALE]: "Large cup" },
    ]);
  });

  it("brings a held variant line back with the variant's own VAT class, and the variant's allergens as before", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const orderId = randomUUID();
    await withTransaction(db, async (tx) => {
      const seeded = await seedVariantOffer(tx, menuId);
      await menu.updateProduct(tx, seeded.productId, { allergens: { milk: {} } });
      await menu.updateProduct(tx, seeded.variantId, {
        vatClass: "reduced",
        allergens: { soybeans: {} },
      });
      await publishWorkingMenu(tx, menuId);
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [{ menuItemId: seeded.offerId, variantId: seeded.variantId, quantity: "1" }],
        null,
        { zoneId },
      );
    });
    const held = await getHeldOrder({ db }, orderId);

    expect(
      held.lines.map((l) => [l.product?.vatClass, Object.keys(l.product?.allergens ?? {})]),
    ).toEqual([["reduced", ["soybeans"]]]);
  });

  it("names the variant's parent product and the offer on the tab line, as the retrieve screen maps them", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const orderId = randomUUID();
    const { seeded, tabLines } = await withTransaction(db, async (tx) => {
      const seeded = await seedVariantOffer(tx, menuId);
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [{ menuItemId: seeded.offerId, variantId: seeded.variantId, quantity: "1" }],
        null,
        { zoneId },
      );
      return { seeded, tabLines: await readTabLines(tx, orderId) };
    });
    const held = await getHeldOrder({ db }, orderId);

    expect(tabLines).toHaveLength(1);
    expect(tabLines[0]).toMatchObject({
      productId: seeded.variantId,
      parentProductId: seeded.productId,
      menuItemId: seeded.offerId,
    });
    expect(held.lines[0]).toMatchObject({
      productId: tabLines[0]!.parentProductId,
      variantId: tabLines[0]!.productId,
      menuItemId: tabLines[0]!.menuItemId,
    });
  });
});
describe("parkOrder", () => {
  it("freezes the product's staff name and the variant's three names, each falling back alone", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const id = randomUUID();
    const seeded = await withTransaction(db, async (tx) => {
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
      // "Large" carries all three names; "Small" carries only its staff name, so the row it freezes
      // shows each of the other two falling back on its own.
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
      return { offerId: offer.id, large: variants[0]!.id, small: variants[1]!.id };
    });

    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: seeded.offerId, variantId: seeded.large, quantity: "1" },
        { menuItemId: seeded.offerId, variantId: seeded.small, quantity: "1" },
      ],
    });

    const frozen = await db.execute<{
      name: string;
      variant_name: string | null;
      descriptions: string;
      variant_descriptions: string | null;
      kitchen_name: string | null;
      variant_kitchen_name: string | null;
    }>(sql`
      select name, variant_name, descriptions, variant_descriptions, kitchen_name,
             variant_kitchen_name
      from working_order_lines where working_order_id = ${id} order by line_no`);
    // The two description columns hold JSON in a TEXT column, and a RAW read returns the stored
    // text — the parse is drizzle's column mapping, which `db.execute` does not go through.
    const frozenRows = frozen.rows.map((row) => ({
      ...row,
      descriptions: JSON.parse(row.descriptions) as Record<string, string>,
      variant_descriptions:
        row.variant_descriptions === null
          ? null
          : (JSON.parse(row.variant_descriptions) as Record<string, string>),
    }));
    expect(frozenRows).toEqual([
      {
        name: "Coffee",
        variant_name: "Large",
        descriptions: { [LOCALE]: "Freshly ground coffee" },
        variant_descriptions: { [LOCALE]: "Large cup" },
        kitchen_name: "COF",
        variant_kitchen_name: "LG",
      },
      {
        name: "Coffee",
        variant_name: "Small",
        descriptions: { [LOCALE]: "Freshly ground coffee" },
        variant_descriptions: { [LOCALE]: "Small" },
        kitchen_name: "COF",
        variant_kitchen_name: null,
      },
    ]);
  });

  it("prices the selected menu offer and freezes its service context", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    const id = randomUUID();

    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });

    // Read straight from the column, which counts whole cents: 325 is the locked 3.25. Nothing
    // converts here, so this asserts the stored COUNT. The cast is a no-op on this engine — the
    // column is already an integer and the driver hands it back as a number — and is kept only so
    // the select list says which JavaScript type the assertion below is written against.
    const line = await db.execute<{ unit_price_gross: number }>(sql`
      select cast(unit_price_gross as int) as unit_price_gross
      from working_order_lines where working_order_id = ${id}`);
    const context = await db.execute<{ zone_id: string; service_mode: string }>(sql`
      select zone_id, service_mode from working_orders where id = ${id}`);
    const attribution = await db.execute<{
      menu_item_id: string;
      menu_name: string;
      department_name: string;
    }>(sql`
      select menu_item_id, menu_name, department_name
      from working_order_lines where working_order_id = ${id}`);
    expect(line.rows).toEqual([{ unit_price_gross: 325 }]);
    expect(context.rows).toEqual([{ zone_id: zoneId, service_mode: "prepay" }]);
    expect(attribution.rows).toEqual([
      {
        menu_item_id: premiumCoffeeOfferId,
        menu_name: "Premium menu",
        department_name: "Restaurant",
      },
    ]);
  });

  it("freezes a quick order's zone payment timing when it opens", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    await db.execute(sql`
      update floor_zones set paid_when = 'ticket_then_pay' where id = ${zoneId}`);

    const first = randomUUID();
    await parkOrder({ db }, cfg, {
      id: first,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });
    await db.execute(sql`
      update floor_zones set paid_when = 'prepay' where id = ${zoneId}`);
    const second = randomUUID();
    await parkOrder({ db }, cfg, {
      id: second,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });

    const contexts = await db.execute<{ working_order_id: string; service_mode: string }>(sql`
      select id as working_order_id, service_mode from working_orders
      where id in (${first}, ${second})`);
    expect(new Map(contexts.rows.map((row) => [row.working_order_id, row.service_mode]))).toEqual(
      new Map([
        [first, "ticket_then_pay"],
        [second, "prepay"],
      ]),
    );
  });

  it("loads one zone-offer snapshot for a basket with repeated offers", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    const listOffers = vi.spyOn(VENUE_SERVICE, "listZoneOffers");
    try {
      await parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [
          { menuItemId: premiumCoffeeOfferId, quantity: "1" },
          { menuItemId: premiumCoffeeOfferId, quantity: "1" },
        ],
      });
      expect(listOffers).toHaveBeenCalledTimes(1);
    } finally {
      listOffers.mockRestore();
    }
  });

  it("parks an open working order with number 1 and its priced lines", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();

    const { orderNumber } = await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "2" }],
      label: "John",
    });
    expect(orderNumber).toBe(1);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo).toMatchObject({
      status: "open",
      label: "John",
      orderNumber: 1,
      nodeId: cfg.nodeId,
      source: "device",
      deviceId: cfg.origin.deviceId,
      settledAt: null,
    });

    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(2);
    // Each of the two coffees is its own line, carrying its product FK + quantity AND the full
    // display snapshot priceBasket produced: 1.50 gross each. `line_total` on this DRAFT is the
    // GROSS 1.50 (the customer-facing total the held list shows), NOT the net base the FILED sale
    // line carries; `vat_class` is the product's class, general. Each number is read straight off
    // the row, so each is the whole number its own scale stores: 150 is that gross 1.50 in cents,
    // and 1000 is one unit in thousandths.
    for (const [at, lineNo] of [
      [0, 1],
      [1, 2],
    ] as const) {
      expect(lines[at]).toMatchObject({
        productId: coffeeId,
        lineNo,
        quantity: 1000,
        descriptions: { [LOCALE]: "Espresso" },
        unitPriceGross: 150,
        vatClass: "general",
        lineTotal: 150,
        category: "ES drinks",
      });
    }
  });

  it("stores a quantity as whole thousandths", async () => {
    // The scaled-integer quantity on `working_order_lines`, pinned as a COUNT. Nothing else does:
    // every other assertion in this file reads a quantity back through a converter, so a
    // conversion applied at the wrong scale on BOTH sides would round-trip and pass. The quantity
    // carries three decimal places on purpose — 1.500 is the one figure that separates thousandths
    // (1500) from cents (150) and from a bare unit count (1 or 2).
    const { cfg, coffeeId, kgUnitId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      // Espresso is priced `each` by default, and `assertQuantityPrecision` refuses a fractional
      // quantity on it; the kg unit's precision of 3 is what admits 1.500.
      await menu.assignProductUnit(tx, coffeeId, kgUnitId);
    });
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "1.500" }],
    });

    // Read as TEXT rather than through drizzle, so what is asserted is the number the column holds
    // and not a driver's or an engine's rendering of it.
    const stored = await db.execute<{ quantity: string; vat_class: string }>(sql`
      select cast(quantity as text) as quantity, vat_class
      from working_order_lines where working_order_id = ${id}`);
    // 1.500 kg is 1500 thousandths.
    expect(stored.rows).toEqual([{ quantity: "1500", vat_class: "general" }]);
  });

  it("parks a multi-line order without a label, snapshotting a category-less line as null", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const id = randomUUID();

    const { orderNumber } = await parkProducts(cfg, {
      id,
      // Two lines in a deliberate order, so the per-line product_id zip (line i ← req.lines[i]) is
      // proven for more than index 0.
      lines: [
        { productId: coffeeId, quantity: "1" },
        { productId: waterId, quantity: "3" },
      ],
    });
    // A fresh taxpayer/node, so this park's own first allocation is 1.
    expect(orderNumber).toBe(1);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.label).toBeNull();

    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ lineNo: 1, productId: coffeeId, category: "ES drinks" });
    // `quantity` is read straight off the column, so 1000 is one unit as a count of thousandths:
    // the three waters are three lines. The category-less product's lines snapshot NULL, the
    // other branch of `?? null`.
    for (const [at, lineNo] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ] as const) {
      expect(lines[at]).toMatchObject({ lineNo, productId: waterId, quantity: 1000 });
      expect(lines[at]!.category).toBeNull();
    }
  });

  it("refuses an empty basket (sale.empty_basket) and an offer the zone does not hold (service_zone.offer_not_allowed)", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const offers = await counterOffers();
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    await expect(parkProducts(cfg, { id: randomUUID(), lines: [] })).rejects.toMatchObject({
      code: "sale.empty_basket",
    });

    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId: offers.zoneId,
        lines: [{ menuItemId: UUID_NOT_IN_CAT, quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "service_zone.offer_not_allowed",
      params: { zoneId: offers.zoneId, menuItemId: UUID_NOT_IN_CAT },
    });

    // The refusal aborts the whole transaction: even the good line beside it leaves no working order
    // behind (the refuse-empty guard runs before the tx; the offer guard inside it).
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId: offers.zoneId,
        lines: [
          { menuItemId: offers.offerFor(coffeeId), quantity: "1" },
          { menuItemId: UUID_NOT_IN_CAT, quantity: "1" },
        ],
      }),
    ).rejects.toMatchObject({ code: "service_zone.offer_not_allowed" });
    const parked = await withTransaction(db, async (tx) => {
      return tx.select().from(workingOrders);
    });
    expect(parked).toHaveLength(0);
  });

  it("replays the existing order on a re-sent park, creating no second order", async () => {
    // This case is a SEQUENTIAL lost-response retry: the first park commits, then the re-sent park
    // with the SAME client-minted id collides against that already-committed row. It is NOT
    // concurrency — one caller replaying its own committed write. The CONCURRENT park backstop,
    // two callers racing the same id, is proven separately in
    // `working-order.pay-and-dispatch.test.ts` ("parkOrder concurrent replay").
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    const lines = [{ productId: coffeeId, quantity: "2" }];

    const first = await parkProducts(cfg, { id, lines, label: "John" });
    expect(first.orderNumber).toBe(1);

    // The re-sent park (a lost-response retry) REPLAYS the committed order rather than PK-colliding into
    // an opaque 500 — same id, same allocated number, nothing new filed.
    const replay = await parkProducts(cfg, { id, lines, label: "John" });
    expect(replay).toEqual({ id, orderNumber: 1, serviceMode: "prepay" });

    // Exactly ONE order and its two coffee lines survive: the replay re-inserted neither the order
    // nor its lines.
    const orders = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(orders).toHaveLength(1);
    const woLines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(woLines.map(({ lineNo, quantity }) => [lineNo, quantity])).toEqual([
      [1, 1000],
      [2, 1000],
    ]);
  });

  it("returns the mode saved at park even after the zone's payment flow changes", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const offers = await counterOffers();
    const id = randomUUID();
    const req = {
      id,
      zoneId: offers.zoneId,
      lines: offers.toOfferLines([{ productId: coffeeId, quantity: "1" }]),
    };
    const setMode = (mode: "prepay" | "ticket_then_pay") =>
      withTransaction(db, (tx) => setZoneSalePolicyOverride(tx, offers.zoneId, "paidWhen", mode));

    await setMode("ticket_then_pay");
    const parked = await parkOrder({ db }, cfg, req);
    await setMode("prepay");

    expect(parked).toMatchObject({ serviceMode: "ticket_then_pay" });
    expect(await parkOrder({ db }, cfg, req)).toEqual(parked);
    expect(await getHeldOrder({ db }, id)).toMatchObject({ serviceMode: "ticket_then_pay" });
  });

  it("replays the ORIGINAL order when a re-sent park carries a DIFFERENT basket (id is the idempotency key)", async () => {
    // The replay is keyed on the id ALONE and files nothing, so a re-park whose lines DIFFER from the
    // committed order does NOT update it — the original composition survives and the differing basket is
    // discarded. This is deliberate idempotency (the id is the key, exactly like pay's replay), and it is
    // WHY the till must route a retrieved-and-EDITED order's re-hold through `updateWorkingOrder`, not a
    // re-park: re-parking an edit would silently drop it (see `#onParkOrder` / `#syncIfDirty` in apps/till).
    const { cfg, coffeeId, waterId } = await setupVenue();
    const id = randomUUID();

    const first = await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "1" }],
    });
    expect(first.orderNumber).toBe(1);

    // Re-park the SAME id with a different product and quantity. It replays the original, unchanged.
    const replay = await parkProducts(cfg, {
      id,
      lines: [{ productId: waterId, quantity: "5" }],
    });
    expect(replay).toEqual({ id, orderNumber: 1, serviceMode: "prepay" });

    // The one surviving line is the ORIGINAL Espresso line — the re-park's Water line was never inserted.
    const woLines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(woLines).toHaveLength(1);
    // Straight off the column: 1000 is the original one unit, as a count of thousandths.
    expect(woLines[0]).toMatchObject({ productId: coffeeId, quantity: 1000 });
  });

  it("re-throws when the colliding id is no longer an open order", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    const lines = [{ productId: coffeeId, quantity: "1" }];

    await parkProducts(cfg, { id, lines });
    // Abandon it: the row PERSISTS (status 'abandoned'), not a delete — a re-park's id still
    // PK-collides, but the committed row is no longer open.
    await abandonHeldOrder({ db }, cfg, id);

    // The re-park collides on the committed (now abandoned) row. Not being `open`, it is NOT a replayable
    // held order, so the ORIGINAL driver refusal is re-thrown rather than a result fabricated. Not
    // `.rejects.toMatchObject({ code })`: `code` is the same string for every failure (below);
    // `isUniqueViolation` reads `errcode` wherever it sits in the cause chain.
    //
    // `node:sqlite` puts `"ERR_SQLITE_ERROR"` on `code` for every failure alike and the
    // discriminating value on `errcode`, so no string code separates a duplicate key from anything
    // else here; and SQLite reports a duplicate key two ways — 1555 for a primary key, 2067 for any
    // other unique index (packages/db/src/sql-state.ts). `UNIQUE_VIOLATION` holds both, so the
    // claim is that the collision surfaced as a duplicate key.
    const error = await captureError(() => parkProducts(cfg, { id, lines }));
    expect(isUniqueViolation(error)).toBe(true);

    // The failed re-park did not resurrect the abandoned row.
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.status).toBe("abandoned");
  });
});
describe("seating from order start", () => {
  it("seats a party when order start is table and the old style is prepay", async () => {
    const { cfg, zoneId } = await setupVenue();
    const tableId = randomUUID();
    await withTransaction(db, async (tx) => {
      await tx.execute(
        sql`update departments set order_start = 'table' where id in (select id from departments )`,
      );
      await tx.execute(
        sql`insert into dining_tables (id, label, zone_id, created_at) values (${tableId}, 'New table service', ${zoneId}, ${nowIso()})`,
      );
      await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, tableId));
      const opened = await openPartyTab(tx, cfg, { tableId });
      expect(
        (await tx.execute(sql`select service_mode from working_orders where id = ${opened.tabId}`))
          .rows,
      ).toEqual([{ service_mode: "table_tab" }]);
    });
  });

  it.each([false, true])(
    "refuses seating in counter service (zone override: %s)",
    async (zoneOverride) => {
      const { cfg, zoneId } = await setupVenue();
      await db.execute(
        sql`update departments set order_start = 'table' where id in (select id from departments )`,
      );
      const tableId = randomUUID();
      await withTransaction(db, async (tx) => {
        if (zoneOverride) {
          await tx.execute(
            sql`update floor_zones set order_start = 'counter' where id = ${zoneId}`,
          );
        } else {
          await tx.execute(
            sql`update departments set order_start = 'counter' where id in (select id from departments )`,
          );
        }
        await tx.execute(
          sql`insert into dining_tables (id, label, zone_id, created_at) values (${tableId}, 'Counter table', ${zoneId}, ${nowIso()})`,
        );
        await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, tableId));
      });
      await expect(
        withTransaction(db, (tx) => openPartyTab(tx, cfg, { tableId })),
      ).rejects.toMatchObject({ code: "service_zone.mode_incompatible" });
      expect(
        (await db.execute(sql`select party_id from party_tables where table_id = ${tableId}`)).rows,
      ).toEqual([]);
    },
  );
});
describe("openTab service context", () => {
  it("derives the service zone from the table and prices its menu offer", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.execute(sql`update departments set order_start = 'table'
        where id in (select id from departments )`);
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Offer table', ${zoneId}, ${nowIso()})
        returning id`);
      await tx
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, table.rows[0]!.id));

      const { tabId } = await openPartyTab(tx, cfg, {
        tableId: table.rows[0]!.id,
        lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
      });

      const priced = await tx.execute<{ unit_price_gross: number }>(sql`
        select cast(unit_price_gross as int) as unit_price_gross
        from working_order_lines where working_order_id = ${tabId}`);
      const context = await tx.execute<{ zone_id: string; service_mode: string }>(sql`
        select zone_id, service_mode from working_orders where id = ${tabId}`);
      expect(priced.rows).toEqual([{ unit_price_gross: 325 }]);
      expect(context.rows).toEqual([{ zone_id: zoneId, service_mode: "table_tab" }]);
    });
  });

  it("uses the tab's stored zone for later menu-offer rounds", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const [offer] = (
        await tx.execute<{ product_id: string }>(
          sql`select product_id from menu_items where id = ${premiumCoffeeOfferId}`,
        )
      ).rows;
      await insertRoute(tx, { zoneId, productId: offer!.product_id, stationId: station.id });
      await tx.execute(sql`update departments set order_start = 'table'
        where id in (select id from departments )`);
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Round table', ${zoneId}, ${nowIso()})
        returning id`);
      await tx
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, table.rows[0]!.id));
      const { tabId } = await openPartyTab(tx, cfg, { tableId: table.rows[0]!.id });

      await addTabRound(tx, cfg, tabId, [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }]);

      const line = await tx.execute<{ unit_price_gross: number; menu_item_id: string }>(sql`
        select cast(unit_price_gross as int) as unit_price_gross, menu_item_id
        from working_order_lines where working_order_id = ${tabId}`);
      expect(line.rows).toEqual([{ unit_price_gross: 325, menu_item_id: premiumCoffeeOfferId }]);
    });
  });

  it("routes the same product to the station configured for each table zone", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const department = await tx.execute<{ id: string }>(sql`
        select id from departments `);
      await tx.execute(sql`update departments set order_start = 'table'
        where id in (select id from departments )`);
      const downstairsZone = await tx.execute<{ id: string }>(sql`
        insert into floor_zones (id, name, department_id, created_at)
        values (${randomUUID()}, 'Downstairs', ${department.rows[0]!.id}, ${nowIso()}) returning id`);
      await tx.execute(
        sql`update floor_zones set department_id = ${department.rows[0]!.id} where id = ${downstairsZone.rows[0]!.id}`,
      );
      await tx.execute(
        sql`update floor_zones set order_start = 'table' where id = ${downstairsZone.rows[0]!.id}`,
      );
      const upstairsBar = await createStation(tx, { name: "Upstairs bar" });
      const downstairsBar = await createStation(tx, { name: "Downstairs bar" });
      const product = await tx.execute<{ category_id: string }>(sql`
        select category_id from products where id = ${coffeeId}`);
      await insertRoute(tx, {
        zoneId,
        categoryId: product.rows[0]!.category_id,
        stationId: upstairsBar.id,
      });
      await insertRoute(tx, {
        zoneId: downstairsZone.rows[0]!.id,
        categoryId: product.rows[0]!.category_id,
        stationId: downstairsBar.id,
      });

      const upstairsTable = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Upstairs', ${zoneId}, ${nowIso()})
        returning id`);
      await tx
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, upstairsTable.rows[0]!.id));
      const downstairsTable = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Downstairs', ${downstairsZone.rows[0]!.id},
          ${nowIso()})
        returning id`);
      await tx
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, downstairsTable.rows[0]!.id));
      const upstairs = await openPartyTab(tx, cfg, { tableId: upstairsTable.rows[0]!.id });
      const downstairs = await openPartyTab(tx, cfg, { tableId: downstairsTable.rows[0]!.id });

      await addTabRound(tx, cfg, upstairs.tabId, [
        { menuItemId: premiumCoffeeOfferId, quantity: "1" },
      ]);
      await addTabRound(tx, cfg, downstairs.tabId, [
        { menuItemId: premiumCoffeeOfferId, quantity: "1" },
      ]);

      const routed = await tx.execute<{ working_order_id: string; station_id: string }>(sql`
        select l.working_order_id, t.station_id from ticket_items t join working_order_lines l on l.id = t.working_order_line_id
        where l.working_order_id in (${upstairs.tabId}, ${downstairs.tabId})
        order by l.working_order_id`);
      expect(new Map(routed.rows.map((row) => [row.working_order_id, row.station_id]))).toEqual(
        new Map([
          [upstairs.tabId, upstairsBar.id],
          [downstairs.tabId, downstairsBar.id],
        ]),
      );
    });
  });

  it("stores an explicitly no-preparation offer without creating a kitchen ticket", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.execute(sql`update departments set order_start = 'table'
        where id in (select id from departments )`);
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: coffeeId }, zoneId },
        { kind: "no_preparation" },
      );
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Deli shelf', ${zoneId}, ${nowIso()})
        returning id`);
      await tx
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, table.rows[0]!.id));
      const { tabId } = await openPartyTab(tx, cfg, { tableId: table.rows[0]!.id });

      await addTabRound(tx, cfg, tabId, [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }]);

      const counts = await tx.execute<{ lines: number; tickets: number }>(sql`
        select
          (select cast(count(*) as int) from working_order_lines where working_order_id = ${tabId}) as lines,
          (select cast(count(*) as int) from ticket_items where working_order_line_id in (select id from working_order_lines where working_order_id = ${tabId})) as tickets`);
      expect(counts.rows).toEqual([{ lines: 1, tickets: 0 }]);
    });
  });

  it("refuses to open a table tab in a counter-mode zone", async () => {
    const { cfg, zoneId } = await setupVenue("prepay");
    await withTransaction(db, async (tx) => {
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Counter table', ${zoneId}, ${nowIso()})
        returning id`);
      await tx
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, table.rows[0]!.id));
      await expect(openPartyTab(tx, cfg, { tableId: table.rows[0]!.id })).rejects.toMatchObject({
        code: "service_zone.mode_incompatible",
        params: { zoneId, expected: "table_tab", actual: "prepay" },
      });
    });
  });
});
describe("createOpenOrder's menu reads (perf)", () => {
  afterEach(() => vi.restoreAllMocks());

  // Behaviour alone can't tell (an empty basket yields an empty order either way), so the read is
  // spied on, with a real line in the next case as the control.
  it("does not read the invoice languages for an empty basket", async () => {
    const { cfg } = await setupVenue();
    const spy = vi.spyOn(menu, "readInvoiceLocales");
    await withTransaction(db, async (tx) => {
      await createOpenOrder(tx, cfg, randomUUID(), [], null);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads the invoice languages once, and never `listAvailableProducts`, for a non-empty basket", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const offers = await counterOffers();
    const venueRead = vi.spyOn(menu, "readInvoiceLocales");
    const productList = vi.spyOn(menu, "listAvailableProducts");
    await withTransaction(db, async (tx) => {
      await createOpenOrder(tx, cfg, randomUUID(), offers.toOfferLines([line(coffeeId)]), null, {
        zoneId: offers.zoneId,
      });
    });
    expect(productList).not.toHaveBeenCalled();
    expect(venueRead).toHaveBeenCalledTimes(1);
  });

  // The line's customer text is keyed by the VENUE's invoice locales, read at pricing time —
  // not by the till's `[cfg.locale]`, which this case leaves at one locale.
  it("keys each stored line's customer text by the venue's invoice locales", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const offers = await counterOffers();
    await seedVenueSettings(db, { invoiceLocales: [LOCALE, "en-GB"] });
    const id = randomUUID();
    await withTransaction(db, async (tx) => {
      await createOpenOrder(tx, cfg, id, offers.toOfferLines([line(coffeeId)]), null, {
        zoneId: offers.zoneId,
      });
    });
    const stored = await db
      .select({ descriptions: workingOrderLines.descriptions })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(stored.map((row) => Object.keys(row.descriptions).sort())).toEqual([
      ["en-GB", LOCALE].sort(),
    ]);
  });
});
describe("opening hours", () => {
  it("uses the default when today's destinations loop through two closed stations", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
      );
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
      const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const downstairs = await createStation(tx, { name: "Downstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const secondProduct = await makeProduct(tx, { categoryId: drinks.id });
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [], null);
      await insertContextlessLines(tx, orderId, [product, secondProduct]);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T18:00:00Z"));
      try {
        await setStationToday(
          tx,
          upstairs.id,
          "closed",
          new Date(),
          await seedActivityActor(tx),
          downstairs.id,
        );
        await setStationToday(
          tx,
          downstairs.id,
          "closed",
          new Date(),
          await seedActivityActor(tx),
          upstairs.id,
        );
        await fireLines(tx, cfg, orderId, await fireableLines(tx, orderId));
        expect(await ticketItemsFor(tx, orderId)).toEqual([
          { productId: product, stationId: kitchen.id, state: "queued" },
          { productId: secondProduct, stationId: kitchen.id, state: "queued" },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("routes to the destination chosen when closing for today", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
      );
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const downstairs = await createStation(tx, { name: "Downstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T19:00:00Z"));
      try {
        await setStationToday(
          tx,
          upstairs.id,
          "closed",
          new Date(),
          await seedActivityActor(tx),
          downstairs.id,
        );
        const { id } = await fireContextless(tx, cfg, [product]);
        expect((await ticketItemsFor(tx, id))[0]!.stationId).toBe(downstairs.id);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("routes only new work to today's chosen destination, leaving sent work as it was", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
      );
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const downstairs = await createStation(tx, { name: "Downstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      vi.useFakeTimers({ toFake: ["Date"] });
      // Friday 2 October, 20:00 in Madrid.
      vi.setSystemTime(new Date("2026-10-02T18:00:00Z"));
      try {
        const first = await fireContextless(tx, cfg, [product]);
        const recorded = () =>
          Promise.all([
            ticketItemsWithBill(tx).where(eq(workingOrderLines.workingOrderId, first.id)),
            tx
              .select()
              .from(workingOrderLines)
              .where(eq(workingOrderLines.workingOrderId, first.id)),
          ]);
        const before = await recorded();
        expect(before[0].map((item) => item.stationId)).toEqual([upstairs.id]);

        await setStationToday(
          tx,
          upstairs.id,
          "closed",
          new Date(),
          await seedActivityActor(tx),
          downstairs.id,
        );
        const second = await fireContextless(tx, cfg, [product]);
        expect((await ticketItemsFor(tx, second.id))[0]!.stationId).toBe(downstairs.id);
        expect(await recorded()).toEqual(before);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("still fires and routes a sale's work when every department is Closed", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
      );
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const departmentRows = await tx.select({ id: departments.id }).from(departments);
      expect(departmentRows.length).toBeGreaterThan(0);
      const closedWeek = WEEK_DISPLAY_ORDER.map((weekday) => ({ weekday, slots: [] }));
      for (const row of departmentRows)
        await replaceMenuWeek(tx, row.id, closedWeek, new Date(), 1);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T18:00:00Z"));
      try {
        const { id } = await fireContextless(tx, cfg, [product]);
        expect(await ticketItemsFor(tx, id)).toEqual([
          { productId: product, stationId: upstairs.id, state: "queued" },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("ignores opening hours when the venue clock is unreadable", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Mars/Base"}) where module = 'business_day'`,
      );
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T20:00:00Z"));
      try {
        const { id } = await fireContextless(tx, cfg, [product]);
        expect((await ticketItemsFor(tx, id))[0]!.stationId).toBe(upstairs.id);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("keeps a sent dish's station when its note changes after that station closes", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
      );
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
      const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T18:30:00Z"));
      try {
        await addRound(tx, cfg, tabId, [line(product)]);
        expect((await ticketItemsFor(tx, tabId))[0]!.stationId).toBe(upstairs.id);
        await setStationToday(tx, upstairs.id, "closed", new Date(), await seedActivityActor(tx));
        const [{ revision }] = await tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, tabId));
        await updateOrderLine(tx, cfg, tabId, 1, { portionLineNos: [], note: "No ice" }, revision!);
        const [item] = await ticketItemsFor(tx, tabId);
        expect(item!.stationId).toBe(upstairs.id);
        expect(
          (
            await tx
              .select({ note: ticketItems.note })
              .from(ticketItems)
              .innerJoin(
                workingOrderLines,
                eq(workingOrderLines.id, ticketItems.workingOrderLineId),
              )
              .where(eq(workingOrderLines.workingOrderId, tabId))
          )[0]!.note,
        ).toBe("No ice");
        const [parent] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, tabId));
        await tx
          .update(workingOrderLines)
          .set({ makeAtStationId: upstairs.id })
          .where(eq(workingOrderLines.id, parent!.id));
        const [{ revision: nextRevision }] = await tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, tabId));
        await updateOrderLine(
          tx,
          cfg,
          tabId,
          1,
          { portionLineNos: [], quantity: "2" },
          nextRevision!,
          OPERATOR,
        );
        const lines = await tx
          .select({ id: workingOrderLines.id, makeAtStationId: workingOrderLines.makeAtStationId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, tabId));
        expect(lines).toHaveLength(2);
        expect(lines.every((line) => line.makeAtStationId === upstairs.id)).toBe(true);
        expect(
          (await ticketItemsFor(tx, tabId)).every((item) => item.stationId === upstairs.id),
        ).toBe(true);
        await tx
          .update(kitchenStations)
          .set({ active: false })
          .where(eq(kitchenStations.id, upstairs.id));
        const [{ revision: lastRevision }] = await tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, tabId));
        await updateOrderLine(
          tx,
          cfg,
          tabId,
          1,
          { portionLineNos: [], note: "No lemon" },
          lastRevision!,
        );
        expect(
          await tx
            .select({ stationId: ticketItems.stationId, note: ticketItems.note })
            .from(ticketItems)
            .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
            .where(eq(workingOrderLines.workingOrderId, tabId))
            .orderBy(sql`${ticketItems}.rowid`),
        ).toEqual([
          { stationId: upstairs.id, note: "No ice" },
          { stationId: kitchen.id, note: "No lemon" },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("sends added units to the sent dish's closed station without a make-at choice", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
      );
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T18:30:00Z"));
      try {
        await addRound(tx, cfg, tabId, [line(product)]);
        const [original] = await tx
          .select({ id: workingOrderLines.id, makeAtStationId: workingOrderLines.makeAtStationId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, tabId));
        expect(original!.makeAtStationId).toBeNull();
        expect((await ticketItemsFor(tx, tabId))[0]!.stationId).toBe(upstairs.id);

        await setStationToday(tx, upstairs.id, "closed", new Date(), await seedActivityActor(tx));
        const [{ revision }] = await tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, tabId));
        await updateOrderLine(
          tx,
          cfg,
          tabId,
          1,
          { portionLineNos: [], quantity: "2" },
          revision!,
          OPERATOR,
        );

        const lines = await tx
          .select({ id: workingOrderLines.id, makeAtStationId: workingOrderLines.makeAtStationId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, tabId));
        expect(lines).toHaveLength(2);
        expect(lines.every((row) => row.makeAtStationId === null)).toBe(true);
        const sent = await tx
          .select({ lineId: ticketItems.workingOrderLineId, stationId: ticketItems.stationId })
          .from(ticketItems)
          .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
          .where(eq(workingOrderLines.workingOrderId, tabId));
        expect(sent).toHaveLength(2);
        expect(new Map(sent.map((item) => [item.lineId, item.stationId]))).toEqual(
          new Map(lines.map((row) => [row.id, upstairs.id])),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("uses one clock reading for both routing and the fire stamp", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await (async () => {
        await tx.run(
          sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
        );
        await seedBusinessDay(tx, { dayCutover: "21:00:00" });
      })();
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const downstairs = await createStation(tx, { name: "Downstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      await setStationToday(
        tx,
        upstairs.id,
        "closed",
        new Date("2026-10-02T19:00:00Z"),
        await seedActivityActor(tx),
        downstairs.id,
      );
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [], null);
      await insertContextlessLines(tx, orderId, [product]);
      const lines = await fireableLines(tx, orderId);
      const RealDate = globalThis.Date;
      const start = RealDate.parse("2026-10-02T18:59:59.999Z");
      let reads = 0;
      class MovingDate extends RealDate {
        constructor();
        constructor(value: string | number | Date);
        constructor(value?: string | number | Date) {
          super(value === undefined ? start + reads++ : value);
        }
        static override now() {
          return start + reads++;
        }
      }
      try {
        globalThis.Date = MovingDate as DateConstructor;
        await fireLines(tx, cfg, orderId, lines);
      } finally {
        globalThis.Date = RealDate;
      }
      const [item] = await ticketItemsFor(tx, orderId);
      expect(item!.stationId).toBe(upstairs.id);
      const [stamp] = await tx
        .select({ firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(stamp!.firedAt).toBe("2026-10-02T18:59:59.999Z");
    });
  });

  it("sends a no-preparation dish only when its line chooses a station", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const station = await createStation(tx, { name: "Bar" });
      const drinks = await createCategory(tx, { name: "Bottles" });
      await routeCategory(tx, drinks.id, { kind: "no_preparation" });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [], null);
      await insertContextlessLines(tx, orderId, [product, product]);
      const lines = await fireableLines(tx, orderId);
      await tx
        .update(workingOrderLines)
        .set({ makeAtStationId: station.id })
        .where(eq(workingOrderLines.id, lines[1]!.id));
      await fireLines(tx, cfg, orderId, lines);
      const items = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        workingOrderLineId: lines[1]!.id,
        stationId: station.id,
      });
    });
  });

  it("refuses a closed station with no active default before writing and honors a stored choice", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
      );
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
      const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, kitchen.id));
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [], null);
      await insertContextlessLines(tx, orderId, [product]);
      const lines = await fireableLines(tx, orderId);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T18:00:00Z"));
      try {
        await setStationToday(tx, upstairs.id, "closed", new Date(), await seedActivityActor(tx));
        await expect(fireLines(tx, cfg, orderId, lines)).rejects.toMatchObject({
          code: "station.no_replacement",
          params: { stationId: upstairs.id, productIds: [product] },
        });
        expect(await ticketItemsFor(tx, orderId)).toEqual([]);
        expect(await fireLines(tx, cfg, orderId, lines, { unroutable: "skip" })).toEqual(lines);
        const off = await createStation(tx, { name: "Off bar" });
        await tx
          .update(kitchenStations)
          .set({ active: false })
          .where(eq(kitchenStations.id, off.id));
        await tx
          .update(workingOrderLines)
          .set({ makeAtStationId: off.id })
          .where(eq(workingOrderLines.id, lines[0]!.id));
        await expect(fireLines(tx, cfg, orderId, lines)).rejects.toMatchObject({
          code: "station.no_replacement",
        });
        expect(await ticketItemsFor(tx, orderId)).toEqual([]);
        await tx
          .update(workingOrderLines)
          .set({ makeAtStationId: upstairs.id })
          .where(eq(workingOrderLines.id, lines[0]!.id));
        await fireLines(tx, cfg, orderId, lines);
        expect((await ticketItemsFor(tx, orderId))[0]!.stationId).toBe(upstairs.id);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
describe("a sale on a Spanish public holiday", () => {
  // Monday 12 October 2026, Spain's national day, and the ordinary Monday a week before, each at
  // 20:00 in Seville.
  const HOLIDAY = "2026-10-12";
  const ORDINARY = "2026-10-05";

  it("uses the same routing and prices on a public holiday until a station closes for today", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const { upstairs, downstairs, product } = await withTransaction(db, async (tx) => {
      await tx.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Europe/Madrid"}) where module = 'business_day'`,
      );
      await seedVenueSettings(tx, { province: "Sevilla", city: "Sevilla" });
      expect(await readHolidayFacts(tx, HOLIDAY, HOLIDAY)).toEqual([
        expect.objectContaining({ date: HOLIDAY, scope: "national" }),
      ]);
      expect(await readHolidayFacts(tx, ORDINARY, ORDINARY)).toEqual([]);
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const upstairs = await createStation(tx, { name: "Upstairs bar" });
      const downstairs = await createStation(tx, { name: "Downstairs bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: upstairs.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      return { upstairs, downstairs, product };
    });

    /** Parks a priced sale of two coffees and fires one drink, at 20:00 in Seville on `date`. */
    const saleOn = async (date: string) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${date}T18:00:00Z`));
      try {
        const parked = await parkProducts(cfg, {
          id: randomUUID(),
          lines: [{ productId: coffeeId, quantity: "2" }],
        });
        const fired = await withTransaction(db, (tx) => fireContextless(tx, cfg, [product]));
        return { parked: parked.id, fired: fired.id };
      } finally {
        vi.useRealTimers();
      }
    };
    const priced = (orderId: string) =>
      db
        .select({
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
          descriptions: workingOrderLines.descriptions,
          unitPriceGross: workingOrderLines.unitPriceGross,
          vatClass: workingOrderLines.vatClass,
          lineTotal: workingOrderLines.lineTotal,
          category: workingOrderLines.category,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
    const tickets = (orderId: string) => withTransaction(db, (tx) => ticketItemsFor(tx, orderId));
    const recorded = (orderId: string) =>
      Promise.all([
        db.select().from(workingOrders).where(eq(workingOrders.id, orderId)),
        db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, orderId)),
        ticketItemsWithBill(db).where(eq(workingOrderLines.workingOrderId, orderId)),
      ]);

    const ordinary = await saleOn(ORDINARY);
    const holiday = await saleOn(HOLIDAY);
    // Each of the two coffees is its own line.
    const coffee = expect.objectContaining({
      productId: coffeeId,
      unitPriceGross: 150,
      lineTotal: 150,
    });
    expect(await priced(holiday.parked)).toEqual([coffee, coffee]);
    expect(await priced(holiday.parked)).toEqual(await priced(ordinary.parked));
    expect(await tickets(holiday.fired)).toEqual([
      { productId: product, stationId: upstairs.id, state: "queued" },
    ]);
    expect(await tickets(holiday.fired)).toEqual(await tickets(ordinary.fired));

    const before = await Promise.all([recorded(holiday.parked), recorded(holiday.fired)]);
    const [specialDay, specialDate] = [randomUUID(), randomUUID()];
    await withTransaction(db, async (tx) => {
      await tx.execute(sql`insert into special_days (id, name, repeats_yearly)
        values (${specialDay}, 'Upstairs closed', 0)`);
      await tx.execute(sql`insert into special_day_dates (id, special_day_id, date, closed_all_day)
        values (${specialDate}, ${specialDay}, ${HOLIDAY}, 0)`);
    });
    await withTransaction(db, async (tx) =>
      setStationToday(
        tx,
        upstairs.id,
        "closed",
        new Date(`${HOLIDAY}T10:00:00Z`),
        await seedActivityActor(tx),
        downstairs.id,
      ),
    );
    const afterSpecialDate = await saleOn(HOLIDAY);
    expect(await tickets(afterSpecialDate.fired)).toEqual([
      { productId: product, stationId: downstairs.id, state: "queued" },
    ]);
    expect(await priced(afterSpecialDate.parked)).toEqual(await priced(ordinary.parked));
    expect(await Promise.all([recorded(holiday.parked), recorded(holiday.fired)])).toEqual(before);
  });
});
// Coursing editing — `hold` on send. A round line may carry `hold: true`; the test helper
// `addTabRound` puts that marker on the line's dish rows and hands them to `fireLines`, which
// inserts the held line with `fired_at NULL` REGARDLESS of its course — greyed on the KDS, no
// kitchen print — until a later `sendLines`/`fireOrderLines` releases it. Transient: read at fire
// time, never stored. These cases prove the hold short-circuit and the parent correlation under
// modifier expansion.
// ---------------------------------------------------------------------------------------------------
describe("addTabRound hold-on-send", () => {
  it("holds a line marked hold:true even when its course would auto-fire, printing only the fired line", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { printerId: kitchenPrinterId } = await attachedPrinter(
        tx,
        { name: "Kitchen", isDefault: true },
        "P-Kitchen",
      );
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const olives = await makeProduct(tx, {});
      const bread = await makeProduct(tx, {});
      await setProductCourse(tx, olives, starterCourse.id);
      await setProductCourse(tx, bread, starterCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      // Both starters sit in the EARLIEST course, so both WOULD auto-fire — but line 2 carries hold:true.
      await addRound(tx, cfg, tabId, [
        { productId: olives, quantity: "1" },
        { productId: bread, quantity: "1", hold: true },
      ]);

      // Both lines get a ticket item; only the un-held one is fired.
      const items = await courseItemsFor(tx, tabId);
      expect(items).toHaveLength(2);
      expect(byLine(items, olives).firedAt).not.toBeNull(); // fired (earliest course)
      expect(byLine(items, bread).firedAt).toBeNull(); // HELD despite the earliest course

      // Exactly one kitchen print — the fired line only; the held line prints nothing until sent.
      const jobs = await tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, kitchenPrinterId));
      expect(jobs).toHaveLength(1);
    });
  });

  it("correlates hold to the right PARENT when a modifier expands the row count (modifier line first)", async () => {
    // The correlation guard. The MODIFIED product is rung FIRST, so its child modifier row
    // sits BETWEEN the two parents in `priceOrderLines`'s output — a naive position map (one that did not
    // skip child rows) would slide hold onto the wrong parent and hold the modified dish instead of the
    // plain one. No courses, so both parents fire by the null-course rule and ONLY hold decides which stays
    // held, isolating the correlation from coursing.
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { printerId: kitchenPrinterId } = await attachedPrinter(
        tx,
        { name: "Kitchen", isDefault: true },
        "P-Kitchen",
      );
      const modified = await makeProduct(tx, {});
      const plain = await makeProduct(tx, {});
      const extra = await addExtra(tx, modified, "Extra");
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      await addRound(tx, cfg, tabId, [
        {
          productId: modified,
          quantity: "1",
          extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] }],
          hold: false,
        },
        { productId: plain, quantity: "1", hold: true },
      ]);

      const items = await courseItemsFor(tx, tabId);
      expect(items).toHaveLength(2);
      expect(byLine(items, modified).firedAt).not.toBeNull(); // the modified dish (+ child) fires
      expect(byLine(items, plain).firedAt).toBeNull(); // the PLAIN dish is the one held

      // Only the fired modified dish printed; the held plain dish and the child modifier print nothing.
      const jobs = await tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, kitchenPrinterId));
      expect(jobs).toHaveLength(1);
    });
  });
});
