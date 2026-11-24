import {
  withTransaction,
  workingOrders,
  nowIso,
  workingOrderLines,
  kitchenCourses,
  type Transaction,
  ticketItems,
  printJobs,
  orderGroups,
} from "@waitron/db";
import { EACH_UNIT, createProduct } from "@waitron/menu";
import { sql, eq, and, isNull, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { deleteCourse } from "./course-delete.js";
import type { TicketState } from "./kitchen-print.js";
import { createStation, createCourse, setProductCourse } from "./kitchen.js";
import { readScopedPassBoard } from "./pass-board.js";
import { seedPendingCardPayment } from "./testing/bill-payment-fixture.js";
import { fireTableKitchenOrder } from "./testing/kitchen-table-order.js";
import { setLineCourse, sendLines } from "./testing/order-writer-fixture.js";
import { openPartyTab, serveLine } from "./testing/serve-line.js";
import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { routingOnce, fireLines } from "./working-order-kitchen-fire.js";
import { advanceTicketItem, bumpBillReady } from "./working-order-kitchen-service.js";
import { listStationQueue } from "./working-order-station-queue.js";
import {
  setupVenue,
  db,
  makeProduct,
  placeOrderWith,
  line,
  ticketItemRows,
  createOfferedOrder,
  fireableLines,
  CONTENT_LANGUAGE,
  addExtra,
  passItems,
  minutesAgo,
  courseItemsFor,
  byLine,
  fireProductLine,
  makeTable,
  addRound,
  attachedPrinter,
  OPERATOR,
  firedCourseAcrossTwoStations,
} from "./testing/working-order.test-support.js";

describe("advanceTicketItem / listStationQueue (bump + queue)", () => {
  it("bumps a line queued→preparing→ready, and a Ready line still to serve back to preparing", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const waterProduct = await makeProduct(tx, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        line(coffeeProduct),
        line(waterProduct),
      ]); // both → Kitchen, queued

      const items = await ticketItemRows(tx, orderId);
      expect(items.map((i) => i.state)).toEqual(["queued", "queued"]);

      // Per-line bump: item[0] walks queued → preparing → ready.
      await advanceTicketItem(tx, items[0]!.id, "preparing");
      await advanceTicketItem(tx, items[0]!.id, "ready");

      await advanceTicketItem(tx, items[0]!.id, "preparing");
      expect((await ticketItemRows(tx, orderId))[0]!.state).toBe("preparing");
      await advanceTicketItem(tx, items[0]!.id, "ready");

      await advanceTicketItem(tx, items[1]!.id, "preparing");

      const queue = await listStationQueue(tx, kitchenStation.id);
      const group = queue.find((g) => g.orderId === orderId)!;
      expect(group.items).toHaveLength(2);
      expect(group.items.map((i) => i.state).sort()).toEqual(["preparing", "ready"]);

      await advanceTicketItem(tx, items[1]!.id, "ready");
      const readied = await listStationQueue(tx, kitchenStation.id);
      expect(readied.find((g) => g.orderId === orderId)!.items.map((i) => i.state)).toEqual([
        "ready",
        "ready",
      ]);
    });
  });

  it("advanceTicketItem refuses a skip (queued→ready), to='queued', and a nonexistent item", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(coffeeProduct)]);
      const [item] = await ticketItemRows(tx, orderId);

      // Skipping preparing (queued → ready) matches no row — `ready`'s only legal predecessor is
      // `preparing` — so the empty `returning` refuses it.
      await expect(advanceTicketItem(tx, item!.id, "ready")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: item!.id },
      });
      // No state legally advances INTO queued — refused before any query.
      await expect(advanceTicketItem(tx, item!.id, "queued")).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "to" },
      });
      // An absent id matches no row and is refused as an unknown item.
      const missing = randomUUID();
      await expect(advanceTicketItem(tx, missing, "preparing")).rejects.toMatchObject({
        code: "ticket_item.not_found",
        params: { ticketItemId: missing },
      });
      // The refusals changed nothing.
      const [after] = await ticketItemRows(tx, orderId);
      expect(after!.state).toBe("queued");
    });
  });

  it("advanceTicketItem refuses a garbage or missing `to` as management.request_invalid on `to`, not a raw TypeError", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(coffeeProduct)]);
      const [item] = await ticketItemRows(tx, orderId);

      // A garbage `to` — not a key of TICKET_TRANSITIONS. The till route casts `body.to as TicketState`
      // with no route-level screen, so this is reachable at runtime despite the narrower static type.
      await expect(
        advanceTicketItem(tx, item!.id, "garbage" as unknown as TicketState),
      ).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "to" },
      });
      // A missing `to` — an absent JSON field reaches here as `undefined` the same way.
      await expect(
        advanceTicketItem(tx, item!.id, undefined as unknown as TicketState),
      ).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "to" },
      });

      // Neither refusal changed the item's state.
      const [after] = await ticketItemRows(tx, orderId);
      expect(after!.state).toBe("queued");
    });
  });

  it("listStationQueue groups a station's items by order oldest-first, dropping collected and abandoned orders", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const barStation = await createStation(tx, { name: "Counter" });
      const coffeeProduct = await makeProduct(tx, {});
      const glassProduct = await makeProduct(tx, { stationId: barStation.id });

      // Order 1 → Kitchen (two lines), then order 2 → Kitchen (one line) + one line to Counter.
      const { id: order1 } = await placeOrderWith(tx, cfg, [
        line(coffeeProduct),
        line(coffeeProduct),
      ]);
      const { id: order2 } = await placeOrderWith(tx, cfg, [
        line(coffeeProduct),
        line(glassProduct),
      ]);

      // Give the ordering fixture distinct times.
      await tx.execute(
        sql`update ticket_items set queued_at = '2026-07-20T10:00:00Z' where working_order_line_id in (select id from working_order_lines where working_order_id = ${order1})`,
      );
      await tx.execute(
        sql`update ticket_items set queued_at = '2026-07-20T10:01:00Z' where working_order_line_id in (select id from working_order_lines where working_order_id = ${order2})`,
      );
      const kitchenQueue = await listStationQueue(tx, kitchenStation.id);
      expect(kitchenQueue.map((g) => g.orderId)).toEqual([order1, order2]);
      expect(kitchenQueue[0]!.items).toHaveLength(2);
      expect(kitchenQueue[1]!.items).toHaveLength(1);
      const barQueue = await listStationQueue(tx, barStation.id);
      expect(barQueue.map((g) => g.orderId)).toEqual([order2]);
      expect(barQueue[0]!.items).toHaveLength(1);

      // Collecting order 1 (handover marker) drops it from the station queue.
      await tx
        .update(workingOrders)
        .set({ collectedAt: nowIso() })
        .where(eq(workingOrders.id, order1));
      expect((await listStationQueue(tx, kitchenStation.id)).map((g) => g.orderId)).toEqual([
        order2,
      ]);

      // Abandoning order 2 drops it too — the queue is empty at Kitchen.
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, order2));
      expect(await listStationQueue(tx, kitchenStation.id)).toEqual([]);
    });
  });

  it("lists bills sent in one send by order number, whichever bill was fired first", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const earlier = randomUUID();
      const later = randomUUID();
      const { orderNumber: earlierNumber } = await createOfferedOrder(tx, cfg, earlier, [
        line(coffeeProduct),
      ]);
      const { orderNumber: laterNumber } = await createOfferedOrder(tx, cfg, later, [
        line(coffeeProduct),
      ]);
      expect(laterNumber).toBeGreaterThan(earlierNumber);

      // One send for both bills, as a group release fires them: the higher number is written first.
      const routing = routingOnce(tx, new Date());
      await fireLines(tx, cfg, later, await fireableLines(tx, later), { routing });
      await fireLines(tx, cfg, earlier, await fireableLines(tx, earlier), { routing });

      const queue = await listStationQueue(tx, kitchenStation.id);
      expect(queue.map((g) => g.queuedAt)).toEqual([
        routing.at.toISOString(),
        routing.at.toISOString(),
      ]);
      expect(queue.map((g) => g.orderNumber)).toEqual([earlierNumber, laterNumber]);
    });
  });

  it("carries each line's snapshotted kitchen name + quantity, items ordered by line_no", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      // Line 1 → 2× Espresso, line 2 → 3× Water, both routed to the default station. Grouped, as a
      // counter order written before portions, so each item carries a quantity other than one.
      const { id: orderId } = await placeOrderWith(
        tx,
        cfg,
        [
          { productId: coffeeId, quantity: "2" },
          { productId: waterId, quantity: "3" },
        ],
        "grouped",
      );

      const [group] = await listStationQueue(tx, kitchenStation.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(2);
      // Items in line_no order, each carrying the line's snapshotted kitchen name + quantity (the
      // stored count read back as "2.000"/"3.000") — what the kitchen display turns into "2× Espresso".
      // Neither product carries a kitchen name of its own, so each falls back to its staff name.
      expect(group!.items[0]).toMatchObject({
        name: "Espresso",
        unitPrecision: 0,
        quantity: "2.000",
      });
      expect(group!.items[0]!.unitName).toEqual({
        [CONTENT_LANGUAGE]: EACH_UNIT.abbreviation.es,
      });
      expect(group!.items[1]).toMatchObject({
        name: "Water",
        unitPrecision: 0,
        quantity: "3.000",
      });
      expect(group!.items[1]!.unitName).toEqual({
        [CONTENT_LANGUAGE]: EACH_UNIT.abbreviation.es,
      });
    });
  });

  it("attaches extras no cell decides as sub-items on listStationQueue and the pass board", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const largeExtra = await addExtra(tx, coffeeId, "ES large");
      const oatMilkExtra = await addExtra(tx, coffeeId, "Oat milk");
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [
            {
              listId: largeExtra.listId,
              picks: [{ productId: largeExtra.productId, quantity: 1 }],
            },
            {
              listId: oatMilkExtra.listId,
              picks: [{ productId: oatMilkExtra.productId, quantity: 1 }],
            },
          ],
        },
      ]);

      // The station queue: ONE item (the parent dish), carrying both options as modifier sub-items, in
      // selection (line_no) order, each by its kitchen name.
      const [group] = await listStationQueue(tx, kitchenStation.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(1);
      // Each option declared no allergens/diet, so its own list is empty (`addAllergens: null`,
      // `suitableFor: []`) — the shape the KDS renders per extra beside the dish's own.
      expect(group!.items[0]!.modifiers).toEqual([
        { name: "ES large", perDish: 1, addAllergens: null, suitableFor: [] },
        {
          name: "Oat milk",
          perDish: 1,
          addAllergens: null,
          suitableFor: [],
        },
      ]);

      const expoItem = (await passItems(tx))[0]!;
      expect(expoItem.modifiers).toEqual([
        { name: "ES large", perDish: 1, addAllergens: null, suitableFor: [] },
        {
          name: "Oat milk",
          perDish: 1,
          addAllergens: null,
          suitableFor: [],
        },
      ]);
    });
  });

  // Order-line customisation: the station/expo reads surface the SNAPSHOTTED
  // per-line `note` so the cook sees it. Read off `ticket_items` (the snapshot frozen at fire), never
  // the live line — a later draft edit must not change what the kitchen already sees.
  it("surfaces a fired line's snapshotted note on listStationQueue and the pass board", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: coffeeId, quantity: "1", note: "No onion" },
      ]);

      const [group] = await listStationQueue(tx, kitchenStation.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(1);
      expect(group!.items[0]!.note).toBe("No onion");

      const expoItem = (await passItems(tx))[0]!;
      expect(expoItem.note).toBe("No onion");

      // A later DRAFT edit of the parent line does NOT move the fired snapshot the kitchen reads.
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            isNull(workingOrderLines.parentLineId),
          ),
        );
      await tx
        .update(workingOrderLines)
        .set({ note: "con cebolla" })
        .where(eq(workingOrderLines.id, parent!.id));
      const [afterEdit] = await listStationQueue(tx, kitchenStation.id);
      expect(afterEdit!.items[0]!.note).toBe("No onion");
    });
  });

  // A plain line (no note) surfaces null — the belt-and-braces default so a cook never sees a phantom
  // instruction.
  it("surfaces a null note for a plain fired line", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      await placeOrderWith(tx, cfg, [{ productId: coffeeId, quantity: "1" }]);

      const [group] = await listStationQueue(tx, kitchenStation.id);
      expect(group!.items[0]!.note).toBeNull();
      expect((await passItems(tx))[0]!.note).toBeNull();
    });
  });

  // Modifier↔allergen — the KDS station/expo reads attach each fired dish line's OWN allergen profile:
  // the parent product's published allergens, with no modifier contribution. Each extra's own list is
  // shown separately. Display-only; no fiscal path.
  it("attaches the dish's own allergens, ignoring a gluten-removing option", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      // A gluten burger with a "gluten-free bun" option: base `{gluten: contains}`. The option states no
      // allergens of its own; the dish shows its OWN gluten (options are never folded into the dish).
      const burger = await createProduct(tx, {
        categoryId: null,
        name: "Hamburguesa",
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
        allergens: { gluten: { kinds: ["wheat" as const] } },
      });
      const gfBun = await addExtra(tx, burger.id, "Gluten-free bread");
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        {
          productId: burger.id,
          quantity: "1",
          extras: [{ listId: gfBun.listId, picks: [{ productId: gfBun.productId, quantity: 1 }] }],
        },
      ]);
      // The parent dish line (parentLineId IS NULL) — the key the queue item is attached under.
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            sql`${workingOrderLines.parentLineId} is null`,
          ),
        );
      const parentLineId = parent!.id;

      const queue = await listStationQueue(tx, kitchenStation.id);
      const item = queue
        .flatMap((g) => g.items)
        .find((i) => i.workingOrderLineId === parentLineId)!;
      expect(item.asServed.allergens).toEqual({ gluten: { kinds: ["wheat" as const] } });
      expect(item.asServed.pending).toBe(false);

      const expoItem = (await passItems(tx))[0]!;
      expect(expoItem.asServed.allergens).toEqual({ gluten: { kinds: ["wheat" as const] } });
      expect(expoItem.asServed.pending).toBe(false);
    });
  });

  // A dish whose OWN allergens are unreviewed (products.allergens NULL) stays `pending` — the dish
  // shows only its own (unknown) allergens, and an attached option never changes that.
  it("marks the as-served profile pending when the dish's base allergens are unreviewed", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await makeProduct(tx, {}); // no allergens → published NULL
      const opt = await addExtra(tx, dish, "Extra");
      await placeOrderWith(tx, cfg, [
        {
          productId: dish,
          quantity: "1",
          extras: [{ listId: opt.listId, picks: [{ productId: opt.productId, quantity: 1 }] }],
        },
      ]);
      const item = (await listStationQueue(tx, kitchenStation.id))[0]!.items[0]!;
      expect(item.asServed.pending).toBe(true);
      expect(item.asServed.allergens).toEqual({});
    });
  });

  // A PLAIN, modifier-less dish whose base is unreviewed (products.allergens NULL, NO options at all)
  // still gets an as-served profile attached to its parent line — the server errs safe and marks the
  // plate `pending` so the KDS shows it unverified. (Divergence from the till, which SUPPRESSES the row
  // for this same case — pinned in basket.test.ts. Kept as-is: the KDS is deliberately the cautious one.)
  it("attaches a pending profile to a plain, modifier-less unreviewed dish (KDS errs safe)", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await makeProduct(tx, {}); // no allergens → published NULL
      await placeOrderWith(tx, cfg, [line(dish)]); // no options at all
      const item = (await listStationQueue(tx, kitchenStation.id))[0]!.items[0]!;
      expect(item.modifiers).toEqual([]);
      expect(item.asServed.pending).toBe(true);
      expect(item.asServed.allergens).toEqual({});
      const expoItem = (await passItems(tx))[0]!;
      expect(expoItem.modifiers).toEqual([]);
      expect(expoItem.asServed.pending).toBe(true);
      expect(expoItem.asServed.allergens).toEqual({});
    });
  });

  // An option that ADDS an allergen is not merged into the dish's profile — the dish shows its OWN
  // allergens, and the option's added allergen is shown separately.
  it("attaches the dish's own allergens, ignoring an added allergen from an option", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await createProduct(tx, {
        categoryId: null,
        name: "Ensalada",
        pricingUnit: "each",
        unitPrice: "7.00",
        vatClass: "general",
        allergens: { gluten: { kinds: ["wheat" as const] } },
      });
      const nuts = await addExtra(tx, dish.id, "Con nueces", {
        add: { nuts: { kinds: ["almonds" as const] } },
      });
      await placeOrderWith(tx, cfg, [
        {
          productId: dish.id,
          quantity: "1",
          extras: [{ listId: nuts.listId, picks: [{ productId: nuts.productId, quantity: 1 }] }],
        },
      ]);
      const item = (await listStationQueue(tx, kitchenStation.id))[0]!.items[0]!;
      expect(item.asServed.allergens).toEqual({ gluten: { kinds: ["wheat" as const] } });
      expect(item.asServed.pending).toBe(false);
    });
  });

  it("shows the dish's own vegan declaration when an option is selected", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await createProduct(tx, {
        categoryId: null,
        name: "Crema",
        pricingUnit: "each",
        unitPrice: "6.00",
        vatClass: "general",
        dietaryDeclarations: ["vegan"],
      });
      const dairyFree = await addExtra(tx, dish.id, "Dairy-free", {
        suitableFor: [],
      });
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        {
          productId: dish.id,
          quantity: "1",
          extras: [
            { listId: dairyFree.listId, picks: [{ productId: dairyFree.productId, quantity: 1 }] },
          ],
        },
      ]);
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            sql`${workingOrderLines.parentLineId} is null`,
          ),
        );
      const parentLineId = parent!.id;

      const queue = await listStationQueue(tx, kitchenStation.id);
      const item = queue
        .flatMap((g) => g.items)
        .find((i) => i.workingOrderLineId === parentLineId)!;
      expect(item.asServedDiet).toEqual({ vegan: "yes", vegetarian: "yes", contains: [] });

      const expoItem = (await passItems(tx))[0]!;
      expect(expoItem.asServedDiet!.vegan).toBe("yes");
      expect(expoItem.asServedDiet).toEqual({ vegan: "yes", vegetarian: "yes", contains: [] });
    });
  });

  // A selected option that invalidates no-meat does not withhold the dish's vegan/vegetarian claims:
  // the dish keeps its OWN declared claims, and the option's meat is shown separately.
  it("keeps the dish's own vegan/vegetarian claims regardless of a selected invalidating option", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await createProduct(tx, {
        categoryId: null,
        name: "Ensalada",
        pricingUnit: "each",
        unitPrice: "7.00",
        vatClass: "general",
        dietaryDeclarations: ["vegan"],
      });
      const bacon = await addExtra(tx, dish.id, "Con bacon", {
        add: { milk: {} },
        suitableFor: ["halal"],
      });
      await placeOrderWith(tx, cfg, [
        {
          productId: dish.id,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
      ]);

      const stationItem = (await listStationQueue(tx, kitchenStation.id))[0]!.items[0]!;
      expect(stationItem.asServedDiet).toEqual({
        vegan: "yes",
        vegetarian: "yes",
        contains: [],
      });
      // The dish is NOT folded, but the extra carries its OWN allergens/suitability on the KDS wire so the
      // station display shows the extra's own list beside the dish's own.
      expect(stationItem.modifiers[0]).toMatchObject({
        addAllergens: { milk: {} },
        suitableFor: ["halal"],
      });
      const expoItem = (await passItems(tx))[0]!;
      expect(expoItem.asServedDiet).toEqual({
        vegan: "yes",
        vegetarian: "yes",
        contains: [],
      });
      expect(expoItem.modifiers[0]).toMatchObject({
        addAllergens: { milk: {} },
        suitableFor: ["halal"],
      });
    });
  });

  it("reads unknown suitability when a product has no direct declarations", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await makeProduct(tx, {});
      await placeOrderWith(tx, cfg, [line(dish)]);

      const item = (await listStationQueue(tx, kitchenStation.id))[0]!.items[0]!;
      expect(item.asServedDiet).toEqual({ vegan: "unknown", vegetarian: "unknown", contains: [] });

      const expoItem = (await passItems(tx))[0]!;
      expect(expoItem.asServedDiet).toEqual({
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      });
    });
  });

  // Kitchen timing alerts — the group carries the station's thresholds (Controller
  // Ruling A), each item its own age band classified against them.
  it("bands each item by the station's thresholds and carries them on the group", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true }); // 5/10/15 defaults
      const coffeeProduct = await makeProduct(tx, {});
      const waterProduct = await makeProduct(tx, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        line(coffeeProduct),
        line(waterProduct),
      ]);
      const items = await ticketItemRows(tx, orderId);

      // Backdate item[0] past the station's default overdue threshold (10) but under forgotten (15);
      // item[1] stays fresh.
      await tx.execute(
        sql`update ticket_items set queued_at = ${minutesAgo(12)} where id = ${items[0]!.id}`,
      );

      const [group] = await listStationQueue(tx, kitchenStation.id);
      expect(group!.thresholds).toEqual({
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      });
      const backdated = group!.items.find((i) => i.id === items[0]!.id)!;
      const fresh = group!.items.find((i) => i.id === items[1]!.id)!;
      expect(backdated.band).toBe("overdue");
      expect(fresh.band).toBe("fresh");
      // Each item carries its OWN queued_at (not just the group's oldest-line anchor) — the widget's
      // TickingClock re-derives the band from this plus the group's thresholds between refreshes.
      expect(typeof backdated.queuedAt).toBe("string");
      expect(typeof fresh.queuedAt).toBe("string");
      expect(backdated.queuedAt).not.toBe(fresh.queuedAt);
    });
  });
});
describe("waiter line release / hold-and-fire", () => {
  it("auto-fires the earliest course, holds later ones, and waiter line release keeps its same-course sibling held", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const soup = await makeProduct(tx, {});
      const steak = await makeProduct(tx, {});
      const sibling = await makeProduct(tx, {});
      await setProductCourse(tx, soup, starterCourse.id);
      await setProductCourse(tx, steak, mainCourse.id);
      await setProductCourse(tx, sibling, mainCourse.id);

      const orderId = await fireTableKitchenOrder(tx, cfg, [
        line(soup),
        line(steak),
        line(sibling),
      ]);
      const items = await courseItemsFor(tx, orderId);
      expect(byLine(items, soup).firedAt).not.toBeNull(); // earliest course auto-fired
      expect(byLine(items, steak).firedAt).toBeNull(); // later course held

      // A held item cannot advance — the kitchen must not bump food it has not been told to start.
      await expect(
        advanceTicketItem(tx, byLine(items, steak).id, "preparing"),
      ).rejects.toMatchObject({ code: "ticket.item_held" });

      await fireProductLine(tx, cfg, orderId, steak);
      const afterFire = await courseItemsFor(tx, orderId);
      expect(byLine(afterFire, steak).firedAt).not.toBeNull();
      expect(byLine(afterFire, sibling).firedAt).toBeNull();

      await advanceTicketItem(tx, byLine(afterFire, steak).id, "preparing");
      const advanced = await courseItemsFor(tx, orderId);
      expect(byLine(advanced, steak).state).toBe("preparing");
    });
  });

  it("a null-course line fires immediately (treated as earliest) even while a real later course is held", async () => {
    // §2b: a null course_id has no display_order and fires immediately. Proven alongside a genuine
    // coursed hold: the loose (courseless) line fires at once while the later Mains line waits.
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const loose = await makeProduct(tx, {}); // no course → null
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);

      const orderId = await fireTableKitchenOrder(tx, cfg, [
        line(loose),
        line(starter),
        line(main),
      ]);
      const items = await courseItemsFor(tx, orderId);
      expect(byLine(items, loose).firedAt).not.toBeNull(); // null course fires immediately
      expect(byLine(items, starter).firedAt).not.toBeNull(); // earliest real course fires
      expect(byLine(items, main).firedAt).toBeNull(); // later course held
    });
  });

  it("line release is idempotent — re-firing an already-fired dish leaves its timestamps untouched", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);

      const orderId = await fireTableKitchenOrder(tx, cfg, [line(starter), line(main)]);

      // The earliest course (Starters) auto-fired; re-firing it must NOT restamp — its WHERE
      // (`fired_at IS NULL`) matches nothing already-fired.
      const beforeEnt = byLine(await courseItemsFor(tx, orderId), starter).firedAt;
      await fireProductLine(tx, cfg, orderId, starter);
      expect(byLine(await courseItemsFor(tx, orderId), starter).firedAt).toBe(beforeEnt);

      await fireProductLine(tx, cfg, orderId, main);
      const firstStamp = byLine(await courseItemsFor(tx, orderId), main).firedAt;
      expect(firstStamp).not.toBeNull();
      await fireProductLine(tx, cfg, orderId, main);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).toBe(firstStamp);
    });
  });

  it("across tab rounds: a later round holds a late course, and joins one already fired for the order", async () => {
    // The incremental tab path (addTabRound fires round by round), where the fired-vs-held decision is
    // taken over the WHOLE order, not just the current round. Two behaviours a single-round place cannot
    // reach: (1) a later round of ONLY a late course stays held — decided by the courses of PRIOR rounds,
    // not the round in hand (without them the round would see itself as the sole, hence earliest, course
    // and wrongly auto-fire); (2) a later item of a course already fired for the order joins it and fires
    // immediately, even when that course is NOT the earliest.
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const post = await createCourse(tx, { name: "Desserts", displayOrder: 2 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      const dessert = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      await setProductCourse(tx, dessert, post.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      // Round 1: starter (Starters, earliest) auto-fires; main (Mains) is held.
      await addRound(tx, cfg, tabId, [line(starter), line(main)]);
      let items = await courseItemsFor(tx, tabId);
      expect(byLine(items, starter).firedAt).not.toBeNull();
      expect(byLine(items, main).firedAt).toBeNull();

      // Round 2: dessert (Desserts) ALONE. It is NOT the order's earliest (Starters from round 1 is), so
      // it stays held — decisive proof the earliest is taken over prior rounds, not this batch (a
      // batch-only min would make Desserts its own earliest and fire it).
      await addRound(tx, cfg, tabId, [line(dessert)]);
      items = await courseItemsFor(tx, tabId);
      expect(byLine(items, dessert).firedAt).toBeNull();

      // Release Mains explicitly — now fired for the order though it is not the earliest course.
      await fireProductLine(tx, cfg, tabId, main);
      expect(byLine(await courseItemsFor(tx, tabId), main).firedAt).not.toBeNull();

      // Round 3: another main. Mains is already fired for this order, so this new item joins the
      // fired course and fires at once — the `firedCourseIds` branch, isolated (Mains is not the
      // earliest). Dessert (Desserts, still unfired) remains held.
      await addRound(tx, cfg, tabId, [line(main)]);
      items = await courseItemsFor(tx, tabId);
      const mains = items.filter((i) => i.productId === main);
      expect(mains).toHaveLength(2);
      expect(mains.every((i) => i.firedAt !== null)).toBe(true);
      expect(byLine(items, dessert).firedAt).toBeNull();
    });
  });

  it("releases a HELD course's items after deletion while its historical course row exists", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);

      const orderId = await fireTableKitchenOrder(tx, cfg, [line(starter), line(main)]);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).toBeNull(); // Mains held

      await deleteCourse(tx, mainCourse.id);
      await fireProductLine(tx, cfg, orderId, main);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).not.toBeNull(); // released
    });
  });

  it("course editing rejects an unknown course with course.not_found", async () => {
    const { cfg } = await setupVenue();
    const orderId = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      return fireTableKitchenOrder(tx, cfg, [line(starter), line(main)]);
    });
    const missing = randomUUID();
    await expect(
      withTransaction(db, (tx) => setLineCourse(tx, orderId, 2, missing)),
    ).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: missing },
    });
  });
});
describe("setLineCourse (move a held line to another course)", () => {
  it("moves a HELD line to another course, updating both course_id snapshots", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const post = await createCourse(tx, { name: "Desserts", displayOrder: 2 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      // Ring both: starter (Starters, earliest) auto-fires; main (Mains) is HELD — it is line 2.
      await addRound(tx, cfg, tabId, [line(starter), line(main)]);
      const before = await courseItemsFor(tx, tabId);
      expect(byLine(before, main).firedAt).toBeNull(); // held — a later course
      expect(byLine(before, main).courseId).toBe(mainCourse.id); // its snapshot sits on Mains

      await setLineCourse(tx, tabId, 2, post.id);

      // The open-tab line AND its held ticket item snapshot both moved to Desserts…
      const [lineRow] = await tx
        .select({ courseId: workingOrderLines.courseId })
        .from(workingOrderLines)
        .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, 2)));
      expect(lineRow!.courseId).toBe(post.id);
      const after = await courseItemsFor(tx, tabId);
      expect(byLine(after, main).courseId).toBe(post.id);
      expect(byLine(after, main).firedAt).toBeNull(); // …and it is STILL held — a move does not fire it
    });
  });

  it("clears a held line's course to null (fire-earliest), updating both snapshots", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [line(starter), line(main)]);

      // A null target clears the course (skipping the requireLiveCourse screen).
      await setLineCourse(tx, tabId, 2, null);

      const [lineRow] = await tx
        .select({ courseId: workingOrderLines.courseId })
        .from(workingOrderLines)
        .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, 2)));
      expect(lineRow!.courseId).toBeNull();
      expect(byLine(await courseItemsFor(tx, tabId), main).courseId).toBeNull();
    });
  });

  it("refuses to re-course a FIRED line (ticket.already_fired)", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      // A lone Starters line is the order's earliest (only) course, so it auto-fires at round-send.
      await addRound(tx, cfg, tabId, [line(starter)]);
      expect(byLine(await courseItemsFor(tx, tabId), starter).firedAt).not.toBeNull();

      // Mains is a valid LIVE course, so requireLiveCourse passes — the FIRED guard is what refuses.
      await expect(setLineCourse(tx, tabId, 1, mainCourse.id)).rejects.toMatchObject({
        code: "ticket.already_fired",
        params: { workingOrderId: tabId },
      });
    });
  });

  it("refuses an unknown OR retired target course (course.not_found)", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const retired = await createCourse(tx, { name: "Desserts", displayOrder: 1 });
      await tx
        .update(kitchenCourses)
        .set({ active: false })
        .where(eq(kitchenCourses.id, retired.id));
      const starter = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [line(starter)]);

      // An id naming no course of this venue — screened by requireLiveCourse BEFORE the line is resolved.
      const missing = randomUUID();
      await expect(setLineCourse(tx, tabId, 1, missing)).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: missing },
      });
      // A DEACTIVATED course is not a valid new target either (liveness, not mere existence).
      await expect(setLineCourse(tx, tabId, 1, retired.id)).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: retired.id },
      });
    });
  });

  it("throws tab.line_not_found for a line_no not on the tab", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const starter = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [line(starter)]);

      // A live target course, so we get PAST requireLiveCourse to the line-resolution miss.
      await expect(setLineCourse(tx, tabId, 999, starterCourse.id)).rejects.toMatchObject({
        code: "tab.line_not_found",
        params: { tabId, lineNo: 999 },
      });
    });
  });

  it("moves a held line to another course while a card is at the reader for its bill", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const post = await createCourse(tx, { name: "Desserts", displayOrder: 2 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [line(starter), line(main)]);
      const billPaymentId = await seedPendingCardPayment(tx, tabId);

      await setLineCourse(tx, tabId, 2, post.id);

      const after = await courseItemsFor(tx, tabId);
      expect(byLine(after, main).courseId).toBe(post.id);
      expect(byLine(after, main).firedAt).toBeNull();
      expect(tx.all(sql`select state from bill_payments where id = ${billPaymentId}`)).toEqual([
        { state: "pending" },
      ]);
    });
  });
});
// sendLines releases selected held items, refreshes queue time and enqueues their kitchen prints.
// These cases exercise those writes and the skip of already-fired items.
describe("sendLines (fire specific held lines / send-all)", () => {
  /** A fixed instant well in the past — an aged `queued_at` the send's refresh moves off, so the
   *  refresh is observable. */
  const AGED = "2000-01-01T00:00:00.000Z";

  /** Read `(fired_at, queued_at)` for a tab's ticket items, keyed by the line's `line_no` (two lines can
   *  share a product, so `byLine` — which keys on product — cannot address them individually here). */
  async function itemsByLineNo(
    tx: Transaction,
    tabId: string,
  ): Promise<Map<number, { firedAt: string | null; queuedAt: string }>> {
    const rows = await tx
      .select({
        lineNo: workingOrderLines.lineNo,
        firedAt: ticketItems.firedAt,
        queuedAt: ticketItems.queuedAt,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
      .where(eq(workingOrderLines.workingOrderId, tabId));
    return new Map(rows.map((r) => [r.lineNo, { firedAt: r.firedAt, queuedAt: r.queuedAt }]));
  }

  it("fires a SUBSET of held lines (refreshing queued_at) and leaves the rest held", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main1 = await makeProduct(tx, {});
      const main2 = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main1, mainCourse.id);
      await setProductCourse(tx, main2, mainCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      // Ring three: starter (Starters, earliest) auto-fires as line 1; both Mains mains are HELD
      // — main1 is line 2, main2 is line 3.
      await addRound(tx, cfg, tabId, [line(starter), line(main1), line(main2)]);
      // Age the held lines' queued_at so the send's refresh is distinguishable from the ring stamp.
      await tx
        .update(ticketItems)
        .set({ queuedAt: AGED })
        .where(
          and(
            inArray(
              ticketItems.workingOrderLineId,
              sql`(select id from working_order_lines where working_order_id = ${tabId})`,
            ),
            isNull(ticketItems.firedAt),
          ),
        );

      const before = await itemsByLineNo(tx, tabId);
      // Read the stored aged stamp back rather than assuming the literal round-trips, and use THAT
      // as the baseline the refresh must move off.
      const agedStamp = before.get(2)!.queuedAt;
      expect(before.get(2)!.firedAt).toBeNull(); // main1 held
      expect(before.get(3)!.firedAt).toBeNull(); // main2 held
      expect(before.get(3)!.queuedAt).toBe(agedStamp); // both held lines aged identically

      await sendLines(tx, cfg, tabId, [2]);

      const after = await itemsByLineNo(tx, tabId);
      // Line 2 fired, and its queued_at was refreshed off the aged value to the send instant (== fired_at).
      expect(after.get(2)!.firedAt).not.toBeNull();
      expect(after.get(2)!.queuedAt).not.toBe(agedStamp);
      expect(after.get(2)!.queuedAt).toBe(after.get(2)!.firedAt);
      // Line 3 is untouched — still held, queued_at still the aged value.
      expect(after.get(3)!.firedAt).toBeNull();
      expect(after.get(3)!.queuedAt).toBe(agedStamp);
    });
  });

  it("an empty line list releases EVERY held line (send-all together)", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const post = await createCourse(tx, { name: "Desserts", displayOrder: 2 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      const dessert = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      await setProductCourse(tx, dessert, post.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      // starter (line 1) auto-fires; main (line 2, Mains) and dessert (line 3, Desserts) are held.
      await addRound(tx, cfg, tabId, [line(starter), line(main), line(dessert)]);
      const before = await itemsByLineNo(tx, tabId);
      expect(before.get(2)!.firedAt).toBeNull();
      expect(before.get(3)!.firedAt).toBeNull();

      // Empty list ⇒ release every remaining held line, regardless of course.
      await sendLines(tx, cfg, tabId, []);

      const after = await itemsByLineNo(tx, tabId);
      expect(after.get(1)!.firedAt).not.toBeNull(); // starter still fired
      expect(after.get(2)!.firedAt).not.toBeNull(); // main released
      expect(after.get(3)!.firedAt).not.toBeNull(); // dessert released
    });
  });

  it("is idempotent — an already-fired line in the set is left untouched", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      await addRound(tx, cfg, tabId, [line(starter), line(main)]);
      // Send line 2 once — it fires. Age line 1's (already-fired) stamps so a re-fire that wrongly matched
      // it would move them.
      await sendLines(tx, cfg, tabId, [2]);
      await tx
        .update(ticketItems)
        .set({ firedAt: AGED, queuedAt: AGED })
        .where(
          and(
            inArray(
              ticketItems.workingOrderLineId,
              sql`(select id from working_order_lines where working_order_id = ${tabId})`,
            ),
            eq(
              ticketItems.workingOrderLineId,
              tx
                .select({ id: workingOrderLines.id })
                .from(workingOrderLines)
                .where(
                  and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, 1)),
                ),
            ),
          ),
        );

      const aged = await itemsByLineNo(tx, tabId);
      const agedFired = aged.get(1)!.firedAt;
      const agedQueued = aged.get(1)!.queuedAt;

      // Sending line 1 (already fired) matches no HELD row — its aged stamps stay put (the fired_at IS
      // NULL predicate skips it), so the timestamps are not overwritten.
      await sendLines(tx, cfg, tabId, [1]);
      const after = await itemsByLineNo(tx, tabId);
      expect(after.get(1)!.firedAt).toBe(agedFired);
      expect(after.get(1)!.queuedAt).toBe(agedQueued);
    });
  });

  it("a held line produces NO kitchen print until sent, then exactly one after", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      // A printer per station, so the HELD line's print can be counted in isolation from the auto-fired
      // starter's (which prints at Kitchen the moment it is rung).
      await attachedPrinter(tx, { name: "Kitchen", isDefault: true }, "P-Kitchen");
      const { station: barStation, printerId: barPrinterId } = await attachedPrinter(
        tx,
        { name: "Counter" },
        "P-Counter",
      );

      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {}); // → Kitchen (default)
      const main = await makeProduct(tx, { stationId: barStation.id });
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      // Ring both: starter auto-fires (prints at Kitchen); main (Mains, Counter) is HELD — no Counter
      // print yet, because a held line prints only when it is sent.
      await addRound(tx, cfg, tabId, [line(starter), line(main)]);
      const allJobsBefore = await tx.select({ id: printJobs.id }).from(printJobs);
      const barJobsBefore = await tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, barPrinterId));
      expect(barJobsBefore).toHaveLength(0); // the HELD Counter line has NOT printed
      // (Kitchen already has the auto-fired starter's ticket, so the outbox is not simply empty.)
      expect(allJobsBefore.length).toBeGreaterThan(0);

      // Send the held line — its kitchen print is enqueued now.
      await sendLines(tx, cfg, tabId, [2]);
      const barJobsAfter = await tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, barPrinterId));
      expect(barJobsAfter).toHaveLength(1);
    });
  });

  it("sends a held line while a card is at the reader for its bill", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [line(starter), line(main)]);
      const billPaymentId = await seedPendingCardPayment(tx, tabId);
      expect((await itemsByLineNo(tx, tabId)).get(2)!.firedAt).toBeNull();

      await sendLines(tx, cfg, tabId, [2]);

      expect((await itemsByLineNo(tx, tabId)).get(2)!.firedAt).not.toBeNull();
      expect(tx.all(sql`select state from bill_payments where id = ${billPaymentId}`)).toEqual([
        { state: "pending" },
      ]);
    });
  });
});
describe("bumpBillReady — pass card preparation without dispatch", () => {
  it("pass card Ready crosses courses including no course", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const counter = await createStation(tx, { name: "Counter" });
      const starters = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mains = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const soup = await makeProduct(tx, {});
      const main = await makeProduct(tx, { stationId: counter.id });
      const water = await makeProduct(tx, {});
      await setProductCourse(tx, soup, starters.id);
      await setProductCourse(tx, main, mains.id);
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(main), line(water)]);
      const before = await courseItemsFor(tx, orderId);
      expect(before).toHaveLength(3);
      expect(before.map((item) => item.courseId)).toEqual(
        expect.arrayContaining([starters.id, mains.id, null]),
      );
      expect(before.every((item) => item.state === "queued" && item.firedAt !== null)).toBe(true);

      await bumpBillReady(tx, orderId);

      expect((await courseItemsFor(tx, orderId)).map((item) => item.state)).toEqual([
        "ready",
        "ready",
        "ready",
      ]);
    });
  });

  it("skips held items and leaves ready and newly fired items undispatched", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      await setProductCourse(tx, starter, starterCourse.id);
      await setProductCourse(tx, main, mainCourse.id);
      const orderId = await fireTableKitchenOrder(tx, cfg, [line(starter), line(main)]);

      await bumpBillReady(tx, orderId);
      let items = await courseItemsFor(tx, orderId);
      expect(byLine(items, main).state).toBe("queued");
      expect(byLine(items, main).firedAt).toBeNull();
      expect(byLine(items, starter).state).toBe("ready");

      await tx
        .update(ticketItems)
        .set({ requestedAt: nowIso() })
        .where(eq(ticketItems.id, byLine(items, main).id));
      await bumpBillReady(tx, orderId);
      items = await courseItemsFor(tx, orderId);
      expect(byLine(items, main).state).toBe("queued");
      expect(byLine(items, main).firedAt).toBeNull();

      await fireProductLine(tx, cfg, orderId, main);
      items = await courseItemsFor(tx, orderId);
      expect(byLine(items, main).state).toBe("queued");
    });
  });

  it("pass card Ready leaves grouped siblings unchanged", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const soup = await makeProduct(tx, {});
      const main = await makeProduct(tx, {});
      const orderId = await fireTableKitchenOrder(tx, cfg, [line(soup), line(main)]);
      const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, orderId));
      const [group] = await tx
        .insert(orderGroups)
        .values({
          partyId: order!.partyId!,
          position: 0,
          state: "fired",
          firedAt: nowIso(),
          submittedBy: OPERATOR,
        })
        .returning();
      await tx
        .update(workingOrderLines)
        .set({ groupId: group!.id })
        .where(
          and(eq(workingOrderLines.workingOrderId, orderId), eq(workingOrderLines.productId, main)),
        );
      const groupedBefore = byLine(await courseItemsFor(tx, orderId), main);

      await bumpBillReady(tx, orderId);

      const items = await courseItemsFor(tx, orderId);
      expect(byLine(items, soup).state).toBe("ready");
      expect(byLine(items, main)).toEqual(groupedBefore);
    });
  });

  it("leaves every item unchanged for an unknown bill", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { orderId } = await firedCourseAcrossTwoStations(tx, cfg);
      const before = await courseItemsFor(tx, orderId);
      await bumpBillReady(tx, randomUUID());
      expect(await courseItemsFor(tx, orderId)).toEqual(before);
      expect(before.every((i) => i.state === "queued")).toBe(true);
    });
  });

  it("bill Ready preserves an already-served no-course line", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const soup = await makeProduct(tx, {});
      const water = await makeProduct(tx, {});
      const orderId = await fireTableKitchenOrder(tx, cfg, [line(soup), line(water)]);
      await serveLine(tx, cfg, orderId, 2);
      const before = byLine(await courseItemsFor(tx, orderId), water);
      expect(before.state).toBe("queued");
      expect(before.firedAt).not.toBeNull();
      expect(before.courseId).toBeNull();
      const board = await readScopedPassBoard(tx, { stationIds: null, zoneIds: null });
      expect(board.inProgress.flatMap((card) => card.items.map((item) => item.id))).toEqual([
        byLine(await courseItemsFor(tx, orderId), soup).id,
      ]);
      await bumpBillReady(tx, orderId);
      const after = await courseItemsFor(tx, orderId);
      expect(byLine(after, soup).state).toBe("ready");
      expect(byLine(after, water)).toEqual(before);
    });
  });

  it("keeps original ready timestamps and item facts on a repeated bump", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { orderId } = await firedCourseAcrossTwoStations(tx, cfg);
      await bumpBillReady(tx, orderId);
      const read = () =>
        ticketItemsWithBill(tx).where(eq(workingOrderLines.workingOrderId, orderId));
      const readied = await read();
      expect(readied).toHaveLength(2);
      expect(readied.every((i) => i.state === "ready" && i.readyAt !== null)).toBe(true);
      await tx
        .update(ticketItems)
        .set({ readyAt: "2026-10-20T12:00:00.000Z" })
        .where(
          inArray(
            ticketItems.workingOrderLineId,
            sql`(select id from working_order_lines where working_order_id = ${orderId})`,
          ),
        );
      const first = await read();
      await bumpBillReady(tx, orderId);
      expect(await read()).toEqual(first);
    });
  });
});
