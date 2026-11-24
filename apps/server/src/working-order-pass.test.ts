import { withTransaction, workingOrders, nowIso, diningTables, kitchenStations } from "@waitron/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createStation, createCourse, setProductCourse } from "./kitchen.js";
import { readScopedPassBoard } from "./pass-board.js";
import { setupPartyVenue, seat, orderForParty, split, join, inTx } from "./testing/party-venue.js";
import {
  EVERY,
  boardOrderIds,
  boardCards,
  boardItems,
  cardOf,
} from "./testing/pass-board-probe.js";
import { openPartyTab, serveLine } from "./testing/serve-line.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  setupVenue,
  db,
  makeProduct,
  placeOrderWith,
  line,
  fireProductLine,
  courseItemsFor,
  tableOffers,
  addRound,
  minutesAgo,
  passItems,
  makeTable,
  ticketItemRows,
} from "./working-order.test-support.js";

describe("the pass board (cross-station expo/pass read)", () => {
  it("shows one order's two-station single-course dishes with their station names and course, excluding collected/abandoned orders", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const barStation = await createStation(tx, { name: "Counter" });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      // Two products in the SAME course, routed to DIFFERENT stations — the cross-station shape.
      const soup = await makeProduct(tx, {}); // → Kitchen (default)
      const olives = await makeProduct(tx, { stationId: barStation.id });
      await setProductCourse(tx, soup, starterCourse.id);
      await setProductCourse(tx, olives, starterCourse.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);

      const board = await readScopedPassBoard(tx, EVERY);
      expect(boardOrderIds(board)).toEqual([orderId]);
      expect(boardCards(board).some((card) => "away" in card)).toBe(false);
      const items = boardItems(board);
      // Both dishes in the one course, each labelled with its OWN station — the join listStationQueue omits.
      expect(items).toHaveLength(2);
      const starterCourseSnapshot = { id: starterCourse.id, name: "Starters", displayOrder: 0 };
      expect(items.map((i) => i.course)).toEqual([starterCourseSnapshot, starterCourseSnapshot]);
      expect(items.map((i) => i.stationName).sort()).toEqual(["Counter", "Kitchen"]);
      expect(items.every((i) => i.state === "queued")).toBe(true);
      expect(items.every((i) => i.firedAt !== null)).toBe(true);
      expect(items.every((i) => !("awayAt" in i))).toBe(true);
      // The display snapshot rides through: `name` is the resolved kitchen label, `qty` the
      // quantity as a three-place decimal string.
      const soupItem = items.find((i) => i.stationName === "Kitchen")!;
      // The fixture seeds no kitchen name, so the label is the product's staff name (`P-<uuid>`),
      // a plain string rather than a locale map.
      expect(soupItem.name).toMatch(/^P-/);
      expect(typeof soupItem.qty).toBe("string");

      // A COLLECTED order and an ABANDONED order are both excluded, the same two listStationQueue drops.
      const { id: collected } = await placeOrderWith(tx, cfg, [line(soup)]);
      await tx
        .update(workingOrders)
        .set({ collectedAt: nowIso() })
        .where(eq(workingOrders.id, collected));
      const { id: abandoned } = await placeOrderWith(tx, cfg, [line(soup)]);
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, abandoned));

      expect(boardOrderIds(await readScopedPassBoard(tx, EVERY))).toEqual([orderId]);
    });
  });

  it("keeps counter course labels in display order and releases every course", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(main), line(starter)]);

      const board = await readScopedPassBoard(tx, EVERY);
      const [d0, d1] = boardItems(board);
      expect([d0!.course?.name, d1!.course?.name]).toEqual(["Starters", "Mains"]);
      expect(d0!.firedAt).not.toBeNull(); // earliest course auto-fired
      expect(boardCards(board).some((card) => "away" in card)).toBe(false);
      expect(d1!.firedAt).not.toBeNull(); // Counter Send releases every course.

      await fireProductLine(tx, cfg, orderId, main);

      const after = await readScopedPassBoard(tx, EVERY);
      expect(boardOrderIds(after)).toEqual([orderId]);
      const afterItems = boardItems(after);
      expect(afterItems.find((i) => i.course?.id === starterCourse.id)).not.toHaveProperty(
        "awayAt",
      );
      expect(afterItems.find((i) => i.course?.id === mainCourse.id)!.firedAt).not.toBeNull(); // released
      expect(boardCards(after).some((card) => "away" in card)).toBe(false);
    });
  });

  it("keeps every unserved item on the pass board", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const a = await makeProduct(tx, {});
      const b = await makeProduct(tx, {});
      await setProductCourse(tx, a, starterCourse.id);
      await setProductCourse(tx, b, starterCourse.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(a), line(b)]);
      const items = await courseItemsFor(tx, orderId);

      expect(boardOrderIds(await readScopedPassBoard(tx, EVERY))).toEqual([orderId]);

      const board = await readScopedPassBoard(tx, EVERY);
      expect(boardOrderIds(board)).toEqual([orderId]);
      expect(
        boardItems(board)
          .map((item) => item.id)
          .sort(),
      ).toEqual(items.map((item) => item.id).sort());
    });
  });

  it("surfaces the dining-table label for a tab and omits it for a walk-up, and ages the tab's card from its first sent dish", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {}); // null course → fires immediately

      // A party's tab at a known-labelled table.
      const { zoneId } = await tableOffers(tx);
      const { rows } = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Table 5', ${zoneId}, ${nowIso()})
        returning id`);
      await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, rows[0]!.id));
      const tableId = rows[0]!.id;
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [line(coffeeProduct)]);

      // A WALK-UP counter order, no table → tableLabel omitted.
      const { id: walkup } = await placeOrderWith(tx, cfg, [line(coffeeProduct)]);

      const board = await readScopedPassBoard(tx, EVERY);
      const orders = boardCards(board).flatMap((c) => c.orders);
      const tab = orders.find((o) => o.orderId === tabId)!;
      expect(tab.tableLabel).toBe("Table 5");
      const walk = orders.find((o) => o.orderId === walkup)!;
      expect(walk.tableLabel).toBeUndefined();
      const tabCard = cardOf(board, (c) => c.orders.some((o) => o.orderId === tabId));
      expect(tabCard.requestedAt).not.toBeNull();
      expect(tabCard.requestedAt).toBe(tabCard.items[0]!.firedAt);
    });
  });

  it("names a counter order after the table it is delivered to, not its own label", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const { rows } = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, label, zone_id, created_at)
        values (${randomUUID()}, 'Terrace 8', ${(await offerProducts(tx)).zoneId}, ${nowIso()})
        returning id`);
      await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, rows[0]!.id));
      const { id } = await placeOrderWith(tx, cfg, [line(coffeeProduct)]);
      await tx
        .update(workingOrders)
        .set({ deliveryTableId: rows[0]!.id, label: "Luis" })
        .where(eq(workingOrders.id, id));

      const order = boardCards(await readScopedPassBoard(tx, EVERY))
        .flatMap((c) => c.orders)
        .find((o) => o.orderId === id)!;
      expect(order.tableLabel).toBe("Terrace 8");
    });
  });

  it("names a joined party's tables together on every bill of the party (spec decision 9)", async () => {
    const v = await setupPartyVenue(db);
    const table4Id = await v.table("Table 4");
    const table5Id = await v.table("Table 5");
    const { partyId, tabId } = await seat(v, table4Id);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    await join(v, partyId, table5Id);

    const board = await inTx(v, (tx) => readScopedPassBoard(tx, EVERY));
    const orders = boardCards(board).flatMap((card) => card.orders);

    expect(Object.fromEntries(orders.map((order) => [order.orderId, order.tableLabel]))).toEqual({
      [tabId]: "Table 4, 5",
      [checkId]: "Table 4, 5",
    });
  });

  // Kitchen timing alerts — the expo spans stations, so PER-ITEM thresholds
  // (Controller Ruling A) prove the join resolved each item's OWN station, not another's (CLAUDE.md §3's
  // correlated-subquery caution: a wrong join binds to the wrong row silently).
  it("carries each item's own station thresholds and band", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true }); // 5/10/15 defaults
      const barStation = await createStation(tx, { name: "Counter" });
      // Distinct thresholds so a per-item mix-up (Counter's item reading Kitchen's thresholds, or vice
      // versa) would fail this test rather than passing by coincidence on identical defaults.
      await tx
        .update(kitchenStations)
        .set({ warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 6 })
        .where(eq(kitchenStations.id, barStation.id));
      const soup = await makeProduct(tx, {}); // → Kitchen (default)
      const olives = await makeProduct(tx, { stationId: barStation.id });

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);
      const items = await courseItemsFor(tx, orderId);
      const soupItem = items.find((i) => i.productId === soup)!;
      const oliveItem = items.find((i) => i.productId === olives)!;

      // Backdate the Counter item past ITS OWN overdue threshold (4) but nowhere near Kitchen's (10).
      await tx.execute(
        sql`update ticket_items set queued_at = ${minutesAgo(5)} where id = ${oliveItem.id}`,
      );

      const outItems = await passItems(tx);
      const soupOut = outItems.find((i) => i.id === soupItem.id)!;
      const oliveOut = outItems.find((i) => i.id === oliveItem.id)!;

      expect(soupOut.thresholds).toEqual({
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      });
      expect(soupOut.band).toBe("fresh");
      expect(oliveOut.thresholds).toEqual({
        warmAfterMinutes: 2,
        overdueAfterMinutes: 4,
        forgottenAfterMinutes: 6,
      });
      expect(oliveOut.band).toBe("overdue"); // 5 >= 4 (overdue), < 6 (forgotten)
      expect(typeof oliveOut.queuedAt).toBe("string");
      const board = await readScopedPassBoard(tx, EVERY);
      expect(
        cardOf(board, (c) => c.items.some((i) => i.id === soupItem.id))
          .items.map((i) => i.id)
          .sort(),
      ).toEqual([soupItem.id, oliveItem.id].sort());
    });
  });

  it("drops a served line and its timing band from the pass board", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true }); // 5/10/15 defaults
      const coffeeProduct = await makeProduct(tx, {});
      const waterProduct = await makeProduct(tx, {});
      const tableId = await makeTable(tx);
      // Serving is a command on a party, so this needs a party's tab rather than `placeOrderWith`'s
      // order.
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [line(coffeeProduct), line(waterProduct)]);

      const rows = await ticketItemRows(tx, tabId);
      // Backdate line 1 past overdue (10); line 2 stays fresh.
      await tx.execute(
        sql`update ticket_items set queued_at = ${minutesAgo(12)} where id = ${rows[0]!.id}`,
      );

      const bands = async () =>
        Object.fromEntries((await passItems(tx)).map((item) => [item.id, item.band]));
      expect(await bands()).toEqual({ [rows[0]!.id]: "overdue", [rows[1]!.id]: "fresh" });

      // Serve the overdue line — it drops off the clock. Line 2 is still unserved but fresh.
      await serveLine(tx, cfg, tabId, rows[0]!.lineNo);
      expect(await bands()).toEqual({ [rows[1]!.id]: "fresh" });
    });
  });
});
