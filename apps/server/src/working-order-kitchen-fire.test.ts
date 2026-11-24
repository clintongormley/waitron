import {
  withTransaction,
  workingOrderLines,
  kitchenStations,
  ticketItems,
  nowIso,
  diningTables,
  orderGroups,
  orderEvents,
  workingOrders,
} from "@waitron/db";
import { createCategory, updateCategory, addProductToMenu } from "@waitron/menu";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createStation, createCourse, setProductCourse } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { addTabRound, placeOrder } from "./testing/order-writer-fixture.js";
import { republishMenus } from "./testing/publish-menu.js";
import { openPartyTab } from "./testing/serve-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { routeCategoryTo, routeProductTo } from "./testing/zone-offers.js";
import { fireLines } from "./working-order-kitchen-fire.js";
import { fireOrderLines } from "./working-order-kitchen-service.js";
import { createOpenOrder } from "./working-order-open.js";
import {
  setupVenue,
  db,
  routeCategory,
  makeProduct,
  fireContextless,
  byProduct,
  ticketItemsFor,
  LOCALE,
  fireableLines,
  insertContextlessLines,
  placeOrderWith,
  line,
  makeTable,
  addRound,
  parkProducts,
  stubBackend,
  stubClock,
  OPERATOR,
} from "./testing/working-order.test-support.js";

describe("fireLines (routing resolver + snapshot)", () => {
  it("fires a zone-less order at the station that claimed its folder", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const bar = await createStation(tx, { name: "Bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await routeCategory(tx, drinks.id, { kind: "station", stationId: bar.id });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const { id } = await fireContextless(tx, cfg, [product]);
      expect(byProduct(await ticketItemsFor(tx, id), product).stationId).toBe(bar.id);
    });
  });

  it("sends a line with no product to the active default and refuses it when that station is off", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
      const id = randomUUID();
      await createOpenOrder(tx, cfg, id, [], null);
      await tx.insert(workingOrderLines).values({
        workingOrderId: id,
        lineNo: 1,
        productId: null,
        name: "Handwritten",
        descriptions: { [LOCALE]: "Handwritten" },
        quantity: 1000,
        unitPriceGross: 150,
        vatClass: "general",
        takeawayVatClass: "general",
        lineTotal: 150,
      });
      const [line] = await fireableLines(tx, id);
      await fireLines(tx, cfg, id, [line!]);
      expect((await ticketItemsFor(tx, id))[0]!.stationId).toBe(kitchen.id);
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, kitchen.id));
      await expect(fireLines(tx, cfg, id, [line!])).rejects.toEqual(
        expect.objectContaining({ code: "station.no_default", params: { dishes: "Handwritten" } }),
      );
      await expect(fireLines(tx, cfg, id, [line!], { unroutable: "skip" })).rejects.toEqual(
        expect.objectContaining({ code: "station.no_default", params: { dishes: "Handwritten" } }),
      );
    });
  });

  it("sends a no-preparation counter dish without a service zone despite a holding flag", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const drinks = await createCategory(tx, { name: "Bottles" });
      await routeCategory(tx, drinks.id, { kind: "no_preparation" });
      const product = await makeProduct(tx, { categoryId: drinks.id });
      const course = await createCourse(tx, { name: "Bottles" });
      const id = randomUUID();
      await createOpenOrder(tx, cfg, id, [], null);
      await insertContextlessLines(tx, id, [product]);
      await tx
        .update(workingOrderLines)
        .set({ courseId: course.id })
        .where(eq(workingOrderLines.workingOrderId, id));
      const [line] = await fireableLines(tx, id);
      await fireLines(tx, cfg, id, [{ ...line!, hold: true }]);
      const stamp = async () =>
        (
          await tx
            .select({ sentAt: workingOrderLines.sentAt })
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, id))
        )[0]!.sentAt;
      expect(await ticketItemsFor(tx, id)).toEqual([]);
      expect(await stamp()).toEqual(expect.any(String));
      await fireOrderLines(
        tx,
        cfg,
        id,
        (await fireableLines(tx, id)).map((row) => row.id),
      );
      const sentAt = await stamp();
      expect(sentAt).toEqual(expect.any(String));
      expect(await ticketItemsFor(tx, id)).toEqual([]);
      await fireOrderLines(
        tx,
        cfg,
        id,
        (await fireableLines(tx, id)).map((row) => row.id),
      );
      expect(await stamp()).toBe(sentAt);
    });
  });

  it("routes a product cell before its category cell and the default and snapshots the station at fire time", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const barStation = await createStation(tx, { name: "Counter" });
      const drinks = await createCategory(tx, { name: "Glasses" });
      await routeCategoryTo(tx, drinks.id, barStation.id);
      const beerProduct = await makeProduct(tx, { categoryId: drinks.id });
      const coffeeProduct = await makeProduct(tx, {
        categoryId: drinks.id,
        stationId: kitchenStation.id,
      });

      const { id: orderId } = await fireContextless(tx, cfg, [beerProduct, coffeeProduct]);
      const items = await ticketItemsFor(tx, orderId);
      expect(byProduct(items, beerProduct).stationId).toBe(barStation.id);
      expect(byProduct(items, coffeeProduct).stationId).toBe(kitchenStation.id);
      expect(items.every((i) => i.state === "queued")).toBe(true);

      // Re-route the category AFTER firing. The already-fired item is SNAPSHOTTED, so it does NOT move —
      // the rule (re-categorising a product later never reroutes food already sent).
      await routeCategoryTo(tx, drinks.id, kitchenStation.id);
      const after = await ticketItemsFor(tx, orderId);
      expect(byProduct(after, beerProduct).stationId).toBe(barStation.id);
    });
  });

  it("routes a product by its main category, and freezes the category on its line", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
      const bar = await createStation(tx, { name: "Bar" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      const food = await createCategory(tx, { name: "Food" });
      await routeCategoryTo(tx, drinks.id, bar.id);
      await routeCategoryTo(tx, food.id, kitchen.id);
      const product = await makeProduct(tx, { categoryId: drinks.id });

      // The raw unzoned order checks routing; the offered order freezes the sale category.
      const { id: routedId } = await fireContextless(tx, cfg, [product]);
      expect(byProduct(await ticketItemsFor(tx, routedId), product).stationId).toBe(bar.id);
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(product)]);
      const [before] = await tx
        .select({ category: workingOrderLines.category })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(before).toEqual({ category: "Drinks" });

      await updateCategory(tx, drinks.id, {
        name: "Cocktails",
        parentId: food.id,
      });
      const [after] = await tx
        .select({ category: workingOrderLines.category })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(after).toEqual({ category: "Drinks" });
    });
  });

  it("snapshots the line note at fire, and a later draft edit never moves the fired ticket (non-fiscal)", async () => {
    // The note counterpart of "Re-route the category AFTER firing" above: a fired ticket_items
    // row is a SNAPSHOT (like station_id/course_id), so editing the working_order_line afterwards must
    // NOT rewrite food already sent to the pass. tabs.test.ts pins that fire CAPTURES
    // the value; this pins that it stays FROZEN against a later edit — the immutability half.
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const p = await makeProduct(tx, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: p, quantity: "1", note: "No onion" },
      ]);

      const [before] = await tx
        .select({ note: ticketItems.note })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(before).toEqual({ note: "No onion" });

      await tx
        .update(workingOrderLines)
        .set({ note: "con cebolla" })
        .where(eq(workingOrderLines.workingOrderId, orderId));

      // Self-contained guard: confirm the DRAFT actually
      // changed, so the ticket_items assertion below cannot pass merely because the update no-op'd.
      const [draft] = await tx
        .select({ note: workingOrderLines.note })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(draft).toEqual({ note: "con cebolla" });

      // The already-fired ticket is UNCHANGED — the snapshot did not move.
      const [after] = await tx
        .select({ note: ticketItems.note })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(after).toEqual({ note: "No onion" });
    });
  });

  it("refuses to fire when the venue has no default station (station.no_default)", async () => {
    const { cfg } = await setupVenue(); // no default station created
    await withTransaction(db, async (tx) => {
      const uncategorised = await makeProduct(tx, {}); // no product/category route
      const refusal = await fireContextless(tx, cfg, [uncategorised]).catch((e: unknown) => e);
      expect(refusal).toMatchObject({ code: "station.no_default" });
      expect((refusal as { params: unknown }).params).toEqual({ dishes: "Line" });
    });
  });

  it("refuses to fire when the only default station is inactive in stored data (station.no_default)", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, kitchenStation.id));
      const uncategorised = await makeProduct(tx, {}); // no product/category route
      await expect(fireContextless(tx, cfg, [uncategorised])).rejects.toEqual(
        expect.objectContaining({ code: "station.no_default", params: { dishes: "Line" } }),
      );
    });
  });

  it("a re-fire of an already-fired line is refused ticket.already_fired", async () => {
    const { cfg } = await setupVenue();
    const orderId = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const p = await makeProduct(tx, {});
      const { id } = await placeOrderWith(tx, cfg, [line(p)]);
      return id;
    });
    // A SECOND fire of the same lines is refused because each line already holds a ticket item.
    await expect(
      withTransaction(db, async (tx) => {
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
      }),
    ).rejects.toMatchObject({
      code: "ticket.already_fired",
      params: { workingOrderId: orderId },
    });
  });

  it("addTabRound fires the appended round's lines to the resolved station (the tab round-send)", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      await addRound(tx, cfg, tabId, [line(coffeeProduct)]);

      const items = await ticketItemsFor(tx, tabId);
      expect(items).toHaveLength(1);
      expect(items[0]!.stationId).toBe(kitchenStation.id);
      expect(items[0]!.state).toBe("queued");
    });
  });

  it("routes a round with repeated products from one venue-service snapshot", async () => {
    const { cfg, zoneId, menuId, premiumCoffeeOfferId, coffeeId, waterId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.execute(sql`update departments set order_start = 'table'
        where id in (select id from departments )`);
      const bar = await createStation(tx, { name: "Bar", isDefault: true });
      const kitchen = await createStation(tx, { name: "Kitchen" });
      const product = await tx.execute<{ category_id: string }>(sql`
        select category_id from products where id = ${coffeeId}`);
      await routeCategoryTo(tx, product.rows[0]!.category_id, bar.id);
      await routeProductTo(tx, waterId, kitchen.id);
      const waterOffer = await addProductToMenu(tx, {
        menuId: menuId,
        productId: waterId,
        grossPrice: "2.00",
      });
      await republishMenus(tx);
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Two of a kind', ${zoneId}, ${nowIso()})
        returning id`);
      await tx
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, table.rows[0]!.id));
      const { tabId } = await openPartyTab(tx, cfg, { tableId: table.rows[0]!.id });

      const routingAt = vi.spyOn(VENUE_SERVICE, "routingAt");
      try {
        await addTabRound(tx, cfg, tabId, [
          { menuItemId: premiumCoffeeOfferId, quantity: "1" },
          { menuItemId: premiumCoffeeOfferId, quantity: "1" },
          { menuItemId: waterOffer.id, quantity: "1" },
        ]);
        expect(routingAt).toHaveBeenCalledTimes(1);
        const items = await ticketItemsFor(tx, tabId);
        expect(items).toHaveLength(3);
        const stationsOf = (productId: string) =>
          items.filter((item) => item.productId === productId).map((item) => item.stationId);
        expect(stationsOf(coffeeId)).toEqual([bar.id, bar.id]);
        expect(stationsOf(waterId)).toEqual([kitchen.id]);
      } finally {
        routingAt.mockRestore();
      }
    });
  });
});
describe("placeOrder fire ticket items", () => {
  it("placeOrder fires one ticket item per line to the resolved station (Mode T)", async () => {
    const { cfg } = await setupVenue("ticket_then_pay");
    const { kitchenStationId, coffeeProduct } = await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const p = await makeProduct(tx, {});
      return { kitchenStationId: kitchenStation.id, coffeeProduct: p };
    });

    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [line(coffeeProduct)] });
    await placeOrder(
      { admission: testTradingAdmission(), db, backend: stubBackend, clock: stubClock },
      cfg,
      id,
      OPERATOR,
    );

    const items = await withTransaction(db, async (tx) => {
      return ticketItemsFor(tx, id);
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.stationId).toBe(kitchenStationId);
    expect(items[0]!.state).toBe("queued");
  });

  it("parking stamps no line sent; placing sends every counter course", async () => {
    const { cfg } = await setupVenue("ticket_then_pay");
    const { coffeeProduct, dessertProduct } = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starters = await createCourse(tx, { name: "Starters", displayOrder: 1 });
      const desserts = await createCourse(tx, { name: "Desserts", displayOrder: 3 });
      const coffeeProduct = await makeProduct(tx, {});
      const dessertProduct = await makeProduct(tx, {});
      await setProductCourse(tx, coffeeProduct, starters.id);
      await setProductCourse(tx, dessertProduct, desserts.id);
      return { coffeeProduct, dessertProduct };
    });
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [line(coffeeProduct), line(dessertProduct)] });
    const sentAt = async () =>
      (
        await db
          .select({ sentAt: workingOrderLines.sentAt })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id))
          .orderBy(workingOrderLines.lineNo)
      ).map((row) => row.sentAt !== null);
    expect(await sentAt()).toEqual([false, false]);

    await placeOrder(
      { admission: testTradingAdmission(), db, backend: stubBackend, clock: stubClock },
      cfg,
      id,
      OPERATOR,
    );

    expect(await sentAt()).toEqual([true, true]);
    // Counter Send releases both recorded courses.
    const items = await db
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(items.map((item) => item.firedAt !== null)).toEqual([true, true]);
  });

  it("places and fires every counter course, putting no line in a group", async () => {
    const { cfg } = await setupVenue("ticket_then_pay");
    const { coffeeProduct, dessertProduct } = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starters = await createCourse(tx, { name: "Starters", displayOrder: 1 });
      const desserts = await createCourse(tx, { name: "Desserts", displayOrder: 3 });
      const coffeeProduct = await makeProduct(tx, {});
      const dessertProduct = await makeProduct(tx, {});
      await setProductCourse(tx, coffeeProduct, starters.id);
      await setProductCourse(tx, dessertProduct, desserts.id);
      return { coffeeProduct, dessertProduct };
    });
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [line(coffeeProduct), line(dessertProduct)] });
    const fired = async () =>
      (
        await db
          .select({ firedAt: ticketItems.firedAt })
          .from(ticketItems)
          .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
          .where(eq(workingOrderLines.workingOrderId, id))
          .orderBy(workingOrderLines.lineNo)
      ).map((item) => item.firedAt !== null);

    await placeOrder(
      { admission: testTradingAdmission(), db, backend: stubBackend, clock: stubClock },
      cfg,
      id,
      OPERATOR,
    );
    expect(await fired()).toEqual([true, true]);
    await withTransaction(db, async (tx) =>
      fireOrderLines(
        tx,
        cfg,
        id,
        (await fireableLines(tx, id)).map((row) => row.id),
      ),
    );

    expect(await fired()).toEqual([true, true]);
    const lines = await db
      .select({ groupId: workingOrderLines.groupId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(lines).toEqual([{ groupId: null }, { groupId: null }]);
    expect(await db.select().from(orderGroups)).toEqual([]);
    expect(
      await db
        .select()
        .from(orderEvents)
        .where(sql`${orderEvents.kind} like 'group.%'`),
    ).toEqual([]);
  });

  it("keeps a placed counter's released dishes after a sold-out change and repeated line release", async () => {
    const { cfg } = await setupVenue("ticket_then_pay");
    const { coffeeProduct, dessertProduct } = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starters = await createCourse(tx, { name: "Starters", displayOrder: 1 });
      const desserts = await createCourse(tx, { name: "Desserts", displayOrder: 3 });
      const coffeeProduct = await makeProduct(tx, {});
      const dessertProduct = await makeProduct(tx, {});
      await setProductCourse(tx, coffeeProduct, starters.id);
      await setProductCourse(tx, dessertProduct, desserts.id);
      return { coffeeProduct, dessertProduct };
    });
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [line(coffeeProduct), line(dessertProduct)] });
    await placeOrder(
      { admission: testTradingAdmission(), db, backend: stubBackend, clock: stubClock },
      cfg,
      id,
      OPERATOR,
    );
    await db.execute(sql`update products set available = 0 where id = ${dessertProduct}`);
    const revision = async () =>
      (
        await db
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, id))
      )[0]!.revision;
    const placedAt = await revision();

    await withTransaction(db, async (tx) =>
      fireOrderLines(
        tx,
        cfg,
        id,
        (await fireableLines(tx, id)).map((row) => row.id),
      ),
    );

    // Only an open order's revision counts writes: a placed order's lines cannot be edited.
    expect(await revision()).toBe(placedAt);

    const items = await db
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(items.map((item) => item.firedAt !== null)).toEqual([true, true]);
  });

  it("placeOrder sends a recorded dish after it sells out", async () => {
    const { cfg } = await setupVenue("ticket_then_pay");
    const coffeeProduct = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      return makeProduct(tx, {});
    });
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [line(coffeeProduct)] });
    await db.execute(sql`update products set available = 0 where id = ${coffeeProduct}`);

    await expect(
      placeOrder(
        { admission: testTradingAdmission(), db, backend: stubBackend, clock: stubClock },
        cfg,
        id,
        OPERATOR,
      ),
    ).resolves.toEqual({ id, status: "placed" });
    const [order] = await db
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    expect(order!.status).toBe("placed");
    expect(
      await db
        .select({ firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual([{ firedAt: expect.any(String) }]);
  });

  it("placeOrder refuses an archived recorded dish without placing or sending it", async () => {
    const { cfg } = await setupVenue("ticket_then_pay");
    const coffeeProduct = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      return makeProduct(tx, {});
    });
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [line(coffeeProduct)] });
    const linesOf = () =>
      db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id));
    const before = await linesOf();
    await db.execute(sql`update products set active = 0 where id = ${coffeeProduct}`);

    await expect(
      placeOrder(
        { admission: testTradingAdmission(), db, backend: stubBackend, clock: stubClock },
        cfg,
        id,
        OPERATOR,
      ),
    ).rejects.toMatchObject({ code: "product.unavailable", params: { productId: coffeeProduct } });
    const [order] = await db
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    expect(order!.status).toBe("open");
    expect(await linesOf()).toEqual(before);
    expect(
      await db
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual([]);
  });
});
describe("line release on an order with no service context", () => {
  it("releases the held course and stamps its line sent", async () => {
    const { cfg } = await setupVenue();
    const { id } = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starters = await createCourse(tx, { name: "Starters", displayOrder: 1 });
      const desserts = await createCourse(tx, { name: "Desserts", displayOrder: 3 });
      const soup = await makeProduct(tx, {});
      const custardProduct = await makeProduct(tx, {});
      const id = randomUUID();
      await createOpenOrder(tx, cfg, id, [], null);
      await insertContextlessLines(tx, id, [soup, custardProduct]);
      await tx.execute(sql`
        update working_order_lines
        set course_id = case line_no when 1 then ${starters.id} else ${desserts.id} end
        where working_order_id = ${id}`);
      await fireLines(tx, cfg, id, await fireableLines(tx, id));
      await fireOrderLines(
        tx,
        cfg,
        id,
        (await fireableLines(tx, id)).map((row) => row.id),
      );
      return { id };
    });

    const lines = await db
      .select({ sentAt: workingOrderLines.sentAt, firedAt: ticketItems.firedAt })
      .from(workingOrderLines)
      .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines.map((line) => [line.sentAt !== null, line.firedAt !== null])).toEqual([
      [true, true],
      [true, true],
    ]);
  });
});
