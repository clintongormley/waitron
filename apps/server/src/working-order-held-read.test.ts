import { withTransaction, products } from "@waitron/db";
import { createProduct } from "@waitron/menu";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createStation } from "./kitchen.js";
import { openPartyTab } from "./testing/serve-line.js";
import { listHeldOrders } from "./working-order-held-read.js";
import { advanceTicketItem } from "./working-order-kitchen-service.js";
import { parkOrder } from "./working-order-open.js";
import { listStationQueue } from "./working-order-station-queue.js";
import {
  setupVenue,
  db,
  parkProducts,
  grossBasketTotal,
  readOrder,
  makeProduct,
  makeTable,
  addRound,
  line,
  courseItemsFor,
  byLine,
  setStatus,
  secondArea,
  seedForeignNodeOrder,
  addOptionList,
  placeOrderWith,
  CONTENT_LANGUAGE,
  passItems,
} from "./testing/working-order.test-support.js";

describe("listHeldOrders", () => {
  it("lists the venue's open orders with item counts, GROSS total and label, ordered by number", async () => {
    const { cfg, coffeeId, waterId, zoneId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.update(products).set({ name: "Coffee" }).where(eq(products.id, coffeeId));
    });
    const idA = randomUUID();
    const idB = randomUUID();

    // A: one Coffee × 2. B: Coffee × 1 and Water × 3, and NO label (the null branch). A is
    // parked first, so its order number is 1 and B's is 2 — the order the list must come back in.
    const linesA = [{ productId: coffeeId, quantity: "2" }];
    const linesB = [
      { productId: coffeeId, quantity: "1" },
      { productId: waterId, quantity: "3" },
    ];
    await parkProducts(cfg, { id: idA, lines: linesA, label: "Table 4" });
    await parkProducts(cfg, { id: idB, lines: linesB });

    // The held `total` is the GROSS (VAT-inclusive) basket total the operator saw —
    // `priceBasket(sameItems, "2026-09-27").total`, computed independently of the persisted column — NOT the
    // summed net base. A: 1.50 × 2 = 3.00 gross; B: 1.50 + 6.00 = 7.50. Both asserted as literals AND against the pricer, so the test fails if the held
    // total ever reverts to net (2.48 ≠ 3.00) or if the pricer itself drifts.
    const grossA = await grossBasketTotal(linesA);
    const grossB = await grossBasketTotal(linesB);
    expect(grossA).toBe("3.00");
    expect(grossB).toBe("7.50");

    const a = await readOrder(idA);
    const b = await readOrder(idB);

    const held = await listHeldOrders({ db });
    // One item per stored dish, each of quantity 1.
    const item = (name: string) => ({
      lineId: expect.any(String),
      name,
      quantity: "1.000",
      note: null,
      extras: [],
    });
    const coffee = item("Coffee");
    const water = item("Water");
    expect(held).toEqual([
      {
        id: idA,
        items: [coffee, coffee],
        orderNumber: 1,
        label: "Table 4",
        counts: { ordered: 2, unsent: 2, held: 0, waiting: 0, ready: 0 },
        total: grossA,
        outstanding: grossA,
        hasPayments: false,
        partyId: null,
        billNumber: null,
        billName: null,
        openedAt: a.openedAt,
        signals: [],
        zoneId,
      },
      {
        id: idB,
        items: [coffee, water, water, water],
        orderNumber: 2,
        label: null,
        counts: { ordered: 4, unsent: 4, held: 0, waiting: 0, ready: 0 },
        total: grossB,
        outstanding: grossB,
        hasPayments: false,
        partyId: null,
        billNumber: null,
        billName: null,
        openedAt: b.openedAt,
        signals: [],
        zoneId,
      },
    ]);
  });

  it("lists a party bill's counts of two held, one waiting and one ready dish", async () => {
    const { cfg } = await setupVenue();
    const tabId = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const held = await makeProduct(tx, {});
      const cooking = await makeProduct(tx, {});
      const done = await makeProduct(tx, {});
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [
        { productId: held, quantity: "2", hold: true },
        line(cooking),
        line(done),
      ]);
      const items = await courseItemsFor(tx, tabId);
      await advanceTicketItem(tx, byLine(items, done).id, "preparing");
      await advanceTicketItem(tx, byLine(items, done).id, "ready");
      return tabId;
    });

    const row = (await listHeldOrders({ db })).find((order) => order.id === tabId)!;
    expect(row.counts).toEqual({ ordered: 4, unsent: 0, held: 2, waiting: 1, ready: 1 });
    expect(row).not.toHaveProperty("itemCount");
  });

  it("reads every order's counts in the same statements for three orders as for one", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const statements = async () => {
      const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
      try {
        const held = await listHeldOrders({ db });
        return { rows: held.length, statements: prepare.mock.calls.length };
      } finally {
        prepare.mockRestore();
      }
    };
    await parkProducts(cfg, { id: randomUUID(), lines: [{ productId: coffeeId, quantity: "1" }] });
    const one = await statements();
    for (let i = 0; i < 2; i++) {
      await parkProducts(cfg, {
        id: randomUUID(),
        lines: [{ productId: coffeeId, quantity: "2" }],
      });
    }
    const three = await statements();

    expect(one.rows).toBe(1);
    expect(three.rows).toBe(3);
    expect(three.statements).toBe(one.statements);
  });

  it("omits settled and abandoned orders — the status filter is the only reason they are gone", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const openId = randomUUID();
    const abandonedId = randomUUID();
    const settledId = randomUUID();

    // All three are parked identically (same node, real lines), so the ONLY thing separating the
    // listed one from the other two is status — not a missing node_id or an empty basket.
    for (const id of [openId, abandonedId, settledId]) {
      await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    }
    await setStatus(abandonedId, "abandoned");
    await setStatus(settledId, "settled");

    const held = await listHeldOrders({ db });
    expect(held.map((o) => o.id)).toEqual([openId]);
  });

  it("names the area each order was parked in, and null for an order with none", async () => {
    const { cfg, menuId, coffeeOfferId } = await setupVenue();
    const terrace = await secondArea(menuId);
    const parked = randomUUID();
    await parkOrder({ db }, cfg, {
      id: parked,
      zoneId: terrace,
      lines: [{ menuItemId: coffeeOfferId, quantity: "1" }],
    });
    const zoneless = await seedForeignNodeOrder(cfg);

    const held = await listHeldOrders({ db });

    expect(new Map(held.map((order) => [order.id, order.zoneId]))).toEqual(
      new Map([
        [parked, terrace],
        [zoneless, null],
      ]),
    );
  });

  it("lists an open order from ANOTHER node of the same taxpayer — reads are venue-wide under warm standby", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const mine = randomUUID();
    await parkProducts(cfg, { id: mine, lines: [{ productId: coffeeId, quantity: "1" }] });
    const foreign = await seedForeignNodeOrder(cfg);
    const listed = (await listHeldOrders({ db })).map((o) => o.id);
    expect(listed).toContain(mine);
    expect(listed).toContain(foreign);
  });
});
// An options answer is frozen onto a dish that declares milk + vegan. The dish's own allergens and its
// own vegan declaration are what the station and expo snapshots show; the answer rides beside them.
it("shows the dish's own allergens and diet beside a frozen options answer", async () => {
  const { cfg } = await setupVenue();
  await withTransaction(db, async (tx) => {
    const station = await createStation(tx, { name: "Kitchen", isDefault: true });
    const product = await createProduct(tx, {
      categoryId: null,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
      allergens: { milk: {} },
      dietaryDeclarations: ["vegan"],
    });
    const milk = await addOptionList(tx, product.id, "Milk", ["Oat"]);
    const { id: orderId } = await placeOrderWith(tx, cfg, [
      {
        productId: product.id,
        quantity: "1",
        options: [{ listId: milk.listId, labelId: milk.labelIds[0]! }],
      },
    ]);
    void orderId;
    const optionSnapshots = [
      {
        listId: milk.listId,
        listName: { [CONTENT_LANGUAGE]: "Milk list staff" },
        listCustomerName: { [CONTENT_LANGUAGE]: "Milk list customer" },
        listKitchenName: "Milk list kitchen",
        labelName: { [CONTENT_LANGUAGE]: "Oat staff" },
        labelCustomerName: { [CONTENT_LANGUAGE]: "Oat customer" },
        labelKitchenName: "Oat kitchen",
      },
    ];
    const own = { allergens: { milk: {} }, pending: false };
    const ownDiet = { vegan: "yes", vegetarian: "yes", contains: [] };
    const queue = await listStationQueue(tx, station.id);
    expect(queue[0]!.items[0]!.asServed).toEqual(own);
    expect(queue[0]!.items[0]!.optionSnapshots).toEqual(optionSnapshots);
    expect(queue[0]!.items[0]!.asServedDiet).toEqual(ownDiet);
    const [expoItem] = await passItems(tx);
    expect(expoItem!.asServed).toEqual(own);
    expect(expoItem!.optionSnapshots).toEqual(optionSnapshots);
    expect(expoItem!.asServedDiet).toEqual(ownDiet);
  });
});
