import {
  workingOrderLines,
  workingOrders,
  withTransaction,
  billPayments,
  refunds,
  type Transaction,
} from "@waitron/db";
import * as menu from "@waitron/menu";
import { createProduct, createCategory } from "@waitron/menu";
import type { OptionSelection } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createStation } from "./kitchen.js";
import { readStoredOrder } from "./stored-order-lines.js";
import {
  type OrderFlow,
  seedPendingCardPayment,
  billRefundFields,
} from "./testing/bill-payment-fixture.js";
import { cancelItemForTest } from "./testing/cancel-line.js";
import { heldRow } from "./testing/held-row.js";
import {
  abandonHeldOrder,
  placeOrder,
  updateOrderLine,
  setWorkingOrderLabel,
  updateHeldOrder,
} from "./testing/order-writer-fixture.js";
import { republishMenus } from "./testing/publish-menu.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { listHeldOrders, getHeldOrder } from "./working-order-held-read.js";
import { parkOrder, createOpenOrder } from "./working-order-open.js";
import {
  setupVenue,
  parkProducts,
  db,
  readOrder,
  setStatus,
  seedForeignNodeOrder,
  updateProducts,
  stubBackend,
  stubClock,
  OPERATOR,
  addExtraList,
  addOptionList,
  LOCALE,
  attachModifierList,
  createOfferedOrder,
  counterOffers,
  CONTENT_LANGUAGE,
  revisionOf,
  storedRows,
  insertContextlessLines,
} from "./testing/working-order.test-support.js";

describe("abandonHeldOrder", () => {
  it("requires Cancel item before forgetting a sent zero-price dish", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    await db
      .update(workingOrderLines)
      .set({ sentAt: "2026-11-11T10:00:00.000Z", unitPriceGross: 0, lineTotal: 0 })
      .where(eq(workingOrderLines.workingOrderId, id));
    const before = await readOrder(id);
    await expect(abandonHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "ticket.already_fired",
    });
    expect(await readOrder(id)).toEqual(before);
  });

  it("flips an open order to abandoned and drops it from the held list, leaving settled_at null", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    expect((await listHeldOrders({ db })).map((o) => o.id)).toEqual([id]);

    await abandonHeldOrder({ db }, cfg, id);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    // abandoned is terminal and carries NO settled_at (the settled_at biconditional): only `settled`
    // may set it. The held list, filtered to status = 'open', no longer shows the order.
    expect(wo).toMatchObject({ status: "abandoned", settledAt: null });
    expect(await listHeldOrders({ db })).toEqual([]);
  });

  it("throws working_order.not_open on an already-abandoned order", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    await abandonHeldOrder({ db }, cfg, id);

    await expect(abandonHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });
  });

  it("throws working_order.not_open on a settled order and on an absent id", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(abandonHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });

    const missing = randomUUID();
    await expect(abandonHeldOrder({ db }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: missing },
    });
  });

  it("abandons an open order from ANOTHER node of the same taxpayer — reads are venue-wide", async () => {
    const { cfg } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);

    await expect(abandonHeldOrder({ db }, cfg, foreign)).resolves.toBeUndefined();
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, foreign));
    expect(wo).toMatchObject({ status: "abandoned", settledAt: null });
  });
});
describe("an order whose card payment is in flight", () => {
  async function payingHeldOrder(orderFlow?: OrderFlow) {
    const venue = await setupVenue(orderFlow);
    // Placing fires the line, which needs a station to reach.
    await withTransaction(db, (tx) => createStation(tx, { name: "Kitchen", isDefault: true }));
    const id = randomUUID();
    await parkProducts(venue.cfg, { id, lines: [{ productId: venue.coffeeId, quantity: "1" }] });
    await seedPendingCardPayment(db, id);
    const [before] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    return { ...venue, id, before: { order: before, lines } };
  }

  async function unchanged(id: string, before: { order: unknown; lines: unknown }) {
    const [order] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect({ order, lines }).toEqual(before);
  }

  it("refuses a whole-order save, changing nothing", async () => {
    const { cfg, coffeeId, id, before } = await payingHeldOrder();

    await expect(
      updateProducts(cfg, id, { lines: [{ productId: coffeeId, quantity: "2" }] }),
    ).rejects.toMatchObject({ code: "order.payment_in_flight", params: { workingOrderId: id } });
    await unchanged(id, before);
  });

  it("refuses abandoning it, which would leave the payment nothing to settle", async () => {
    const { cfg, id, before } = await payingHeldOrder();

    await expect(abandonHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "order.payment_in_flight",
      params: { workingOrderId: id },
    });
    await unchanged(id, before);
  });

  it("refuses placing it", async () => {
    const { cfg, id, before } = await payingHeldOrder("ticket_then_pay");

    await expect(
      placeOrder(
        { admission: testTradingAdmission(), db, backend: stubBackend, clock: stubClock },
        cfg,
        id,
        OPERATOR,
      ),
    ).rejects.toMatchObject({ code: "order.payment_in_flight", params: { workingOrderId: id } });
    await unchanged(id, before);
  });

  /** A received card payment of the bill, and a refund of it the provider has not answered. */
  async function pendingRefund(cfg: DeviceRequestConfig, id: string): Promise<void> {
    const [payment] = await db
      .insert(billPayments)
      .values({
        workingOrderId: id,
        submissionId: randomUUID(),
        fingerprint: "f",
        kind: "contribution",
        method: "card",
        applied: 100,
        state: "received",
        receivedAt: new Date().toISOString(),
        requestedBy: OPERATOR,
        source: cfg.origin.source,
        deviceId: cfg.origin.deviceId,
      })
      .returning({ id: billPayments.id });
    await db.insert(refunds).values({
      billPaymentId: payment!.id,
      ...billRefundFields(db, cfg.nodeId, payment!.id),
      submissionId: randomUUID(),
      fingerprint: "f",
      appliedAmount: 100,
      reason: "r",
      authorizedBy: OPERATOR,
      requestedBy: OPERATOR,
      source: cfg.origin.source,
      deviceId: cfg.origin.deviceId,
      state: "pending",
    });
  }

  /** The order and its lines as `before` holds them, but for `note` on the dish line. */
  async function onlyNoteChanged(
    id: string,
    before: { order: unknown; lines: (typeof workingOrderLines.$inferSelect)[] },
    note: string,
  ) {
    const [order] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(order).toEqual({
      ...(before.order as object),
      revision: (before.order as { revision: number }).revision + 1,
    });
    expect(lines).toEqual(before.lines.map((row) => ({ ...row, note })));
  }

  function expectPaymentPending(id: string) {
    expect(db.all(sql`select state from bill_payments where working_order_id = ${id}`)).toEqual([
      { state: "pending" },
    ]);
  }

  it("takes a dish's note and keeps its reader payment pending", async () => {
    const { cfg, id, before } = await payingHeldOrder();

    await withTransaction(db, (tx) =>
      updateOrderLine(tx, cfg, id, 1, { note: "No salt" }, before.order!.revision),
    );

    await onlyNoteChanged(id, before, "No salt");
    expectPaymentPending(id);
  });

  it("takes a dish's note while a card refund waits on its bill", async () => {
    const venue = await setupVenue();
    await withTransaction(db, (tx) => createStation(tx, { name: "Kitchen", isDefault: true }));
    const id = randomUUID();
    await parkProducts(venue.cfg, { id, lines: [{ productId: venue.coffeeId, quantity: "1" }] });
    await pendingRefund(venue.cfg, id);
    const [order] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));

    await withTransaction(db, (tx) =>
      updateOrderLine(tx, venue.cfg, id, 1, { note: "No salt" }, order!.revision),
    );

    await onlyNoteChanged(id, { order, lines }, "No salt");
    expect(
      await db
        .select({ state: refunds.state })
        .from(refunds)
        .innerJoin(billPayments, eq(billPayments.id, refunds.billPaymentId))
        .where(eq(billPayments.workingOrderId, id)),
    ).toEqual([{ state: "pending" }]);
  });

  it("renames the bill and keeps its reader payment pending", async () => {
    const { cfg, coffeeId, id, before } = await payingHeldOrder();

    await setWorkingOrderLabel(db, id, { label: "Window", revision: before.order!.revision });
    const [renamed] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(renamed).toEqual({
      ...before.order,
      label: "Window",
      revision: before.order!.revision + 1,
    });

    const [line] = before.lines;
    await updateProducts(cfg, id, {
      label: "Terrace",
      lines: [{ productId: coffeeId, quantity: "1", workingOrderLineId: line!.id }],
    });
    const [saved] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(saved).toEqual({
      ...before.order,
      label: "Terrace",
      revision: before.order!.revision + 2,
    });
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual(before.lines);
    expectPaymentPending(id);
  });

  it("still refuses a quantity change, with or without a note, writing nothing", async () => {
    const { cfg, id, before } = await payingHeldOrder();

    for (const patch of [{ quantity: "2" }, { quantity: "2", note: "No salt" }]) {
      await expect(
        withTransaction(db, (tx) => updateOrderLine(tx, cfg, id, 1, patch, before.order!.revision)),
      ).rejects.toMatchObject({ code: "order.payment_in_flight", params: { workingOrderId: id } });
    }
    await unchanged(id, before);
  });

  const UNRESOLVED = [
    { money: "a card at the reader", code: "order.payment_in_flight" },
    { money: "a card refund waiting", code: "bill.refund_in_progress" },
  ] as const;

  /**
   * A held, unsent coffee answering a two-label options list, beside an extras list it picks
   * nothing from and a second station it could be made at, with `money` unresolved on its bill.
   */
  async function unresolvedCoffee(money: (typeof UNRESOLVED)[number]["money"]) {
    const venue = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const bar = await createStation(tx, { name: "Bar" });
      const extra = await addExtraList(tx, venue.coffeeId, "Bacon");
      const options = await addOptionList(tx, venue.coffeeId, "Cooking", ["Rare", "Well done"]);
      return { barId: bar.id, extra, options };
    });
    const answer = (label: number) => [
      { listId: seeded.options.listId, labelId: seeded.options.labelIds[label]! },
    ];
    const id = randomUUID();
    await parkProducts(venue.cfg, {
      id,
      lines: [{ productId: venue.coffeeId, quantity: "1", options: answer(0) }],
    });
    if (money === "a card at the reader") {
      await seedPendingCardPayment(db, id);
    } else {
      await pendingRefund(venue.cfg, id);
    }
    const [order] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(lines).toEqual([expect.objectContaining({ sentAt: null, makeAtStationId: null })]);
    return { ...venue, ...seeded, answer, id, before: { order: order!, lines } };
  }

  /** The order as `before` holds it, a revision on, its one line changed only by `change`; any
   * card refund still waiting. */
  async function onlyLineChanged(
    id: string,
    before: { order: typeof workingOrders.$inferSelect; lines: unknown[] },
    change: Partial<typeof workingOrderLines.$inferSelect>,
  ) {
    const [order] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(order).toEqual({ ...before.order, revision: before.order.revision + 1 });
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual(before.lines.map((row) => ({ ...(row as object), ...change })));
    for (const refund of await db.select().from(refunds)) expect(refund.state).toBe("pending");
  }

  // A sale line files its own options answer, and a whole-order card files the answers it priced.
  it.each(UNRESOLVED)(
    "still refuses a dish's options answer with $money, writing nothing",
    async ({ money, code }) => {
      const { cfg, answer, id, before } = await unresolvedCoffee(money);

      await expect(
        withTransaction(db, (tx) =>
          updateOrderLine(tx, cfg, id, 1, { options: answer(1) }, before.order.revision),
        ),
      ).rejects.toMatchObject({ code });
      await unchanged(id, before);
    },
  );

  it.each(UNRESOLVED)(
    "still refuses an options answer through a whole-order save with $money, writing nothing",
    async ({ money, code }) => {
      const { cfg, answer, id, before, coffeeId } = await unresolvedCoffee(money);

      await expect(
        updateProducts(cfg, id, {
          revision: before.order.revision,
          lines: [
            {
              productId: coffeeId,
              quantity: "1",
              options: answer(1),
              workingOrderLineId: before.lines[0]!.id,
            },
          ],
        }),
      ).rejects.toMatchObject({ code });
      await unchanged(id, before);
    },
  );

  it.each(UNRESOLVED)("takes where an unsent dish is made with $money", async ({ money }) => {
    const { cfg, barId, id, before } = await unresolvedCoffee(money);

    await withTransaction(db, (tx) =>
      updateOrderLine(tx, cfg, id, 1, { makeAt: barId }, before.order.revision),
    );

    await onlyLineChanged(id, before, { makeAtStationId: barId });
  });

  it.each(UNRESOLVED)(
    "still refuses an added extra with $money, writing nothing",
    async ({ money, code }) => {
      const { cfg, extra, id, before } = await unresolvedCoffee(money);

      await expect(
        withTransaction(db, (tx) =>
          updateOrderLine(
            tx,
            cfg,
            id,
            1,
            {
              extras: [
                { listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] },
              ],
            },
            before.order.revision,
          ),
        ),
      ).rejects.toMatchObject({ code });
      await unchanged(id, before);
    },
  );

  it.each(UNRESOLVED)(
    "still refuses a quantity change beside an options answer with $money, writing nothing",
    async ({ money, code }) => {
      const { cfg, answer, id, before } = await unresolvedCoffee(money);

      await expect(
        withTransaction(db, (tx) =>
          updateOrderLine(
            tx,
            cfg,
            id,
            1,
            { quantity: "2", options: answer(1) },
            before.order.revision,
          ),
        ),
      ).rejects.toMatchObject({ code });
      await unchanged(id, before);
    },
  );
});
describe("frozen answers through a fractional quantity edit", () => {
  it("keeps three frozen 50 g picks per dish when a held edit omits extras", async () => {
    const { cfg, coffeeId, kgUnitId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const extra = await createProduct(tx, {
        categoryId: null,
        name: "Ham",
        unitId: kgUnitId,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const list = await menu.createExtraList(
        tx,
        {
          name: "Ham list",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 3,
          active: true,
          items: [
            {
              productId: extra.id,
              portion: "0.050",
              maxQuantity: 3,
              preselected: false,
              price: null,
            },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });
      return { extraId: extra.id, listId: list.id };
    });
    // Grouped, as a counter order written before portions: the raise scales a line of several
    // dishes, which a portion never is.
    const id = randomUUID();
    await withTransaction(db, (tx) =>
      createOfferedOrder(
        tx,
        cfg,
        id,
        [
          {
            productId: coffeeId,
            quantity: "2",
            extras: [
              { listId: seeded.listId, picks: [{ productId: seeded.extraId, quantity: 3 }] },
            ],
          },
        ],
        "grouped",
      ),
    );
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(before[1]).toMatchObject({ quantity: 300, priceQuantity: 50, lineTotal: 6 });

    await withTransaction(db, (tx) =>
      updateOrderLine(tx, cfg, id, 1, { portionLineNos: [], quantity: "3" }, 0),
    );

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({
      id: before[1]!.id,
      quantity: 450,
      priceQuantity: 50,
      unitPriceGross: 1,
      lineTotal: 9,
    });
  });

  it("reads a frozen priced portion separately from the physical held quantity", async () => {
    const { cfg, coffeeOfferId, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: coffeeOfferId, quantity: "1" }],
    });
    await db
      .update(workingOrderLines)
      .set({ quantity: 150, priceQuantity: 50, unitPriceGross: 1, lineTotal: 3 })
      .where(eq(workingOrderLines.workingOrderId, id));

    const read = await withTransaction(db, (tx) => readStoredOrder(tx, id));
    expect(read.gross.lines[0]).toMatchObject({
      quantity: "0.150",
      priceQuantity: "0.050",
      grossUnitPrice: "0.01",
      lineGross: "0.03",
    });
  });

  it.each(["menu", "product"])(
    "preserves the answers on a %s-priced offer and the locked price when a weighed dish's quantity changes",
    async (source) => {
      const { cfg, coffeeId, coffeeOfferId, zoneId, kgUnitId } = await setupVenue();
      // A WEIGHED dish: the quantity edit below moves a fraction, which is where the decimal
      // arithmetic behind keeping a stored line is most likely to go wrong. The answer is an OPTIONS one
      // because it makes no child line — an extras pick on a dish sold by weight is refused, by the
      // test below this one.
      const cupOptions = await withTransaction(db, async (tx) => {
        await menu.assignProductUnit(tx, coffeeId, kgUnitId);
        const list = await addOptionList(tx, coffeeId, "Taza", ["ES large"]);
        await republishMenus(tx);
        return list;
      });
      const options = [{ listId: cupOptions.listId, labelId: cupOptions.labelIds[0]! }];
      // The product-priced offer carries no price of its own, so it sells at the product's.
      const menuItemId =
        source === "menu" ? coffeeOfferId : (await counterOffers()).offerFor(coffeeId);
      const result = await parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [{ menuItemId, quantity: "0.500", options }],
      });
      const held = await getHeldOrder({ db }, result.id);
      expect(held.lines).toHaveLength(1);
      const frozen = [
        {
          listId: cupOptions.listId,
          listName: { [CONTENT_LANGUAGE]: "Taza list staff" },
          listCustomerName: { [CONTENT_LANGUAGE]: "Taza list customer" },
          listKitchenName: "Taza list kitchen",
          labelName: { [CONTENT_LANGUAGE]: "ES large staff" },
          labelCustomerName: { [CONTENT_LANGUAGE]: "ES large customer" },
          labelKitchenName: "ES large kitchen",
        },
      ];
      expect(held.lines[0]).toMatchObject({ optionSnapshots: frozen });
      const stored = await db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, result.id))
        .orderBy(workingOrderLines.lineNo);
      expect(stored).toHaveLength(1);
      const lockedGross = stored[0]!.unitPriceGross;

      // The menu moves under the parked order; the locked line must not follow it.
      await db.execute(sql`update products set unit_price = 9900 where id = ${coffeeId}`);
      await db.execute(sql`update menu_items set gross_price = 9900 where id = ${coffeeOfferId}`);

      await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, result.id, {
        revision: await revisionOf(result.id),
        lines: [
          {
            workingOrderLineId: held.lines[0]!.workingOrderLineId,
            menuItemId,
            quantity: "1.000",
            options,
          },
        ],
      });
      const updated = await db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, result.id))
        .orderBy(workingOrderLines.lineNo);
      expect(updated).toHaveLength(1);
      expect(updated[0]).toMatchObject({
        // Off the column: 1000 is the edited one unit, as a count of thousandths.
        quantity: 1000,
        unitPriceGross: lockedGross,
        // One unit of the locked gross, so the total is that gross unchanged.
        lineTotal: lockedGross,
      });
      expect(updated[0]!.optionSnapshots).toEqual(frozen);
    },
  );

  it("refuses an extras pick on a menu offer whose dish is sold by weight", async () => {
    const { cfg, coffeeId, coffeeOfferId, zoneId, kgUnitId } = await setupVenue();
    const bacon = await withTransaction(db, async (tx) => {
      await menu.assignProductUnit(tx, coffeeId, kgUnitId);
      const attached = await addExtraList(tx, coffeeId, "Bacon", { price: "1.00" });

      await republishMenus(tx);
      return attached;
    });
    // A child is priced at `dishQuantity × pickQuantity`, so half a kilo of dish carrying one extra
    // would bill half an extra.
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [
          {
            menuItemId: coffeeOfferId,
            quantity: "0.500",
            extras: [
              { listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "extras.unsupported_product",
      params: { productId: coffeeId, soldBy: "weight" },
    });
  });

  it("refuses an extras pick on a dish sold in millilitres", async () => {
    const { cfg, coffeeId, coffeeOfferId, zoneId } = await setupVenue();
    const bacon = await withTransaction(db, async (tx) => {
      const ml = await menu.createUnit(
        tx,
        {
          staffName: "Millilitre",
          staffAbbreviation: "ml",
          name: { [CONTENT_LANGUAGE]: "Mililitro" },
          abbreviation: { [CONTENT_LANGUAGE]: "ml" },
          precision: 0,
          measure: true,
        },
        LOCALE,
      );
      await menu.assignProductUnit(tx, coffeeId, ml.id);
      const attached = await addExtraList(tx, coffeeId, "Bacon", { price: "1.00" });

      await republishMenus(tx);
      return attached;
    });
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [
          {
            menuItemId: coffeeOfferId,
            quantity: "250",
            extras: [
              { listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "extras.unsupported_product",
      params: { productId: coffeeId, soldBy: "measure" },
    });
  });
});
/**
 * What `updateHeldOrder` keeps on a stored line it edits.
 *
 * The reorder cases exist because the order a dish's lists are offered in is a stored position a
 * save re-numbers: a line parked before a reorder keeps the OLD one while the rebuilt side comes back
 * in the new one, and an edit must not read that as a changed answer. These two cases reorder through
 * `writeProductModifiers` (`packages/menu/src/product-modifiers.ts`), which is one of the three
 * columns that carry that position — `docs/developers/modifiers.md` lists all three.
 */
describe("what a held-order edit preserves and what it replaces", () => {
  it("keeps the line's id and locked price when two options lists change places", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const cookingOptions = await addOptionList(tx, coffeeId, "Cooking", ["Solo"]);
      const cupOptions = await addOptionList(tx, coffeeId, "Taza", ["ES large"]);
      await republishMenus(tx);
      return { cookingOptions, cupOptions };
    });
    const options = [
      { listId: seeded.cookingOptions.listId, labelId: seeded.cookingOptions.labelIds[0]! },
      { listId: seeded.cupOptions.listId, labelId: seeded.cupOptions.labelIds[0]! },
    ];
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1", options }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(before).toHaveLength(1);

    // The manager swaps the two lists over, and the menu price moves, so a re-priced line would
    // show it. Replacing the whole set is the point here, so this goes straight to
    // `writeProductModifiers` rather than through `attachModifierList`, which exists to ADD one
    // without disturbing the rest.
    await withTransaction(db, async (tx) => {
      await menu.writeProductModifiers(tx, coffeeId, [
        { kind: "options", id: seeded.cupOptions.listId },
        { kind: "options", id: seeded.cookingOptions.listId },
      ]);
    });
    await db.execute(sql`
      update menu_items set gross_price = 9900 where id = ${premiumCoffeeOfferId}`);
    await withTransaction(db, republishMenus);

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: premiumCoffeeOfferId,
          quantity: "2",
          options,
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // The dish keeps its line, and the raise adds a second dish beside it. One unit each, as a
    // count of thousandths off the column, at the offer's 3.25 at park time, not the 99.00 it now
    // costs — read straight off the row, so 325 is that amount in whole cents; the two together
    // are the 6.50 one line of two was.
    expect(after).toHaveLength(2);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[1]!.id).not.toBe(before[0]!.id);
    for (const line of after) {
      expect(line).toMatchObject({ quantity: 1000, unitPriceGross: 325, lineTotal: 325 });
      expect(line.optionSnapshots).toEqual(before[0]!.optionSnapshots);
    }
  });

  it("keeps each extras child on its own row when two extras lists change places", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const bacon = await addExtraList(tx, coffeeId, "Bacon", { price: "1.00" });
      const milkExtra = await addExtraList(tx, coffeeId, "Milk", {
        price: "0.30",
        maxQuantity: 3,
      });
      return { bacon, milkExtra };
    });
    // The two picks differ, so a child that took the OTHER pick's count lands on a different
    // quantity — which is what makes the dish x picks arithmetic visible here rather than assumed.
    const extras = [
      { listId: seeded.bacon.listId, picks: [{ productId: seeded.bacon.productId, quantity: 1 }] },
      {
        listId: seeded.milkExtra.listId,
        picks: [{ productId: seeded.milkExtra.productId, quantity: 3 }],
      },
    ];
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "1", extras }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(before).toHaveLength(3);

    // Replacing the whole set, as above.
    await withTransaction(db, async (tx) => {
      await menu.writeProductModifiers(tx, coffeeId, [
        { kind: "extras", id: seeded.milkExtra.listId },
        { kind: "extras", id: seeded.bacon.listId },
      ]);
    });
    await db.execute(sql`update products set unit_price = 9900 where id = ${coffeeId}`);

    await updateProducts(cfg, id, {
      lines: [{ workingOrderLineId: before[0]!.id, productId: coffeeId, quantity: "2", extras }],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // Every stored row keeps its id, its quantity and the price it was sold at; the raise adds a
    // second dish with its own two picks at those prices, each child keeping its OWN pick's count —
    // so a child that took the other list's count would show 3 bacon or 1 milk. Every column is
    // read straight off the row, each at its own scale: the money in whole cents, the quantities
    // in whole thousandths.
    const row = (line: (typeof after)[number]) => [
      line.parentLineId,
      line.productId,
      line.quantity,
      line.unitPriceGross,
      line.lineTotal,
    ];
    expect(after.slice(0, 3).map((line) => line.id)).toEqual(before.map((line) => line.id));
    expect(after.slice(0, 3).map(row)).toEqual(before.map(row));
    expect(after).toHaveLength(6);
    const copy = after[3]!;
    expect(new Set(after.map((line) => line.id)).size).toBe(6);
    // The dish at its own 1.50; bacon at 1.00 for one pick; milk at 0.30 for three picks.
    expect(row(copy)).toEqual([null, coffeeId, 1000, 150, 150]);
    expect(
      after
        .slice(4)
        .map(row)
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ).toEqual(
      [
        [copy.id, seeded.bacon.productId, 1000, 100, 100],
        [copy.id, seeded.milkExtra.productId, 3000, 30, 90],
      ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    );
    expect(before.map(row)).toEqual([
      [null, coffeeId, 1000, 150, 150],
      [before[0]!.id, seeded.bacon.productId, 1000, 100, 100],
      [before[0]!.id, seeded.milkExtra.productId, 3000, 30, 90],
    ]);
  });

  it("prices both picks now when two lists offering the same product exchange their counts: each is a new pick", async () => {
    const { cfg, coffeeId } = await setupVenue();
    // One wine, offered by two of the dish's lists at two prices.
    const seeded = await withTransaction(db, async (tx) => {
      const cheap = await addExtraList(tx, coffeeId, "Wine", {
        price: "1.00",
        maxQuantity: 3,
      });
      const dear = await menu.createExtraList(
        tx,
        {
          name: "Premium wine list staff",
          customerName: { [CONTENT_LANGUAGE]: "Premium wine list customer" },
          kitchenName: "Premium wine list kitchen",
          minPicks: 0,
          maxPicks: null,
          active: true,
          items: [
            { productId: cheap.productId, maxQuantity: 3, preselected: false, price: "3.00" },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: dear.id });
      return { wineId: cheap.productId, cheapListId: cheap.listId, dearListId: dear.id };
    });
    const picks = (cheapQuantity: number, dearQuantity: number) => [
      {
        listId: seeded.cheapListId,
        picks: [{ productId: seeded.wineId, quantity: cheapQuantity }],
      },
      { listId: seeded.dearListId, picks: [{ productId: seeded.wineId, quantity: dearQuantity }] },
    ];
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "1", extras: picks(1, 2) }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // One off the 1.00 list and two off the 3.00 one, in whole cents off the column.
    expect(
      before.filter((line) => line.parentLineId !== null).map((line) => line.lineTotal),
    ).toEqual([100, 600]);

    // The two picks change places: two of the cheap one and one of the dear one, same dish count.
    await updateProducts(cfg, id, {
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          productId: coffeeId,
          quantity: "1",
          extras: picks(2, 1),
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(
      after.filter((line) => line.parentLineId !== null).map((line) => line.lineTotal),
    ).toEqual([200, 300]);
  });

  it("prices a pick now when it moves to another list offering the same product: it is a new pick", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const cheap = await addExtraList(tx, coffeeId, "Wine", { price: "1.00" });
      const dear = await menu.createExtraList(
        tx,
        {
          name: "Premium wine list staff",
          customerName: { [CONTENT_LANGUAGE]: "Premium wine list customer" },
          kitchenName: "Premium wine list kitchen",
          minPicks: 0,
          maxPicks: null,
          active: true,
          items: [
            { productId: cheap.productId, maxQuantity: 3, preselected: false, price: "3.00" },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: dear.id });
      return { wineId: cheap.productId, cheapListId: cheap.listId, dearListId: dear.id };
    });
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [
            { listId: seeded.cheapListId, picks: [{ productId: seeded.wineId, quantity: 1 }] },
          ],
        },
      ],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(
      before.filter((line) => line.parentLineId !== null).map((line) => line.lineTotal),
    ).toEqual([100]);

    // ONE pick, moved off the 1.00 list onto the 3.00 one. The product and the count are the same,
    // and neither is what changed.
    await updateProducts(cfg, id, {
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          productId: coffeeId,
          quantity: "1",
          extras: [
            { listId: seeded.dearListId, picks: [{ productId: seeded.wineId, quantity: 1 }] },
          ],
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(
      after.filter((line) => line.parentLineId !== null).map((line) => line.lineTotal),
    ).toEqual([300]);
  });

  it("keeps an extra's list and stored price on a quantity-only edit when two lists offer it", async () => {
    // Spec §11.7 example 7, as far as a quantity-only edit reaches it: Extra cheese on "Toppings"
    // at 1.00 and on "Premium toppings" at 1.50, and the line took it from Premium toppings.
    const { cfg, coffeeId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const toppings = await addExtraList(tx, coffeeId, "Queso", { price: "1.00" });
      const premium = await menu.createExtraList(
        tx,
        {
          name: "Premium toppings list staff",
          customerName: { [CONTENT_LANGUAGE]: "Premium toppings list customer" },
          kitchenName: "Premium toppings list kitchen",
          minPicks: 0,
          maxPicks: null,
          active: true,
          items: [
            { productId: toppings.productId, maxQuantity: 1, preselected: false, price: "1.50" },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: premium.id });
      return { cheeseId: toppings.productId, premiumListId: premium.id };
    });
    const extras = [
      { listId: seeded.premiumListId, picks: [{ productId: seeded.cheeseId, quantity: 1 }] },
    ];
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1", extras }] });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(before.map((line) => [line.extraListId, line.unitPriceGross])).toEqual([
      [null, 150],
      [seeded.premiumListId, 150],
    ]);

    // Premium toppings' cheese rises to 1.80 underneath the edit.
    await db.execute(sql`
      update extra_list_items set price = 180 where list_id = ${seeded.premiumListId}`);
    await updateProducts(cfg, id, {
      lines: [{ workingOrderLineId: before[0]!.id, productId: coffeeId, quantity: "2", extras }],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // Both rows keep their ids, the cheese its list and the 1.50 it was sold at; the raise adds a
    // second dish whose cheese takes the same list and the same 1.50, not the 1.80 it now costs.
    expect(
      after.map((line) => [
        line.id,
        line.parentLineId,
        line.extraListId,
        line.unitPriceGross,
        line.lineTotal,
      ]),
    ).toEqual([
      [before[0]!.id, null, null, 150, 150],
      [before[1]!.id, before[0]!.id, seeded.premiumListId, 150, 150],
      [after[2]!.id, null, null, 150, 150],
      [after[3]!.id, after[2]!.id, seeded.premiumListId, 150, 150],
    ]);
    expect(new Set(after.map((line) => line.id)).size).toBe(4);
  });

  it("keeps the line and its price when the answer itself changed: an answer carries no price", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    const cookingOptions = await withTransaction(db, async (tx) => {
      const list = await addOptionList(tx, coffeeId, "Cooking", ["Solo", "Cortado"]);
      await republishMenus(tx);
      return list;
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCoffeeOfferId,
          quantity: "1",
          options: [{ listId: cookingOptions.listId, labelId: cookingOptions.labelIds[0]! }],
        },
      ],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    await db.execute(sql`
      update menu_items set gross_price = 9900 where id = ${premiumCoffeeOfferId}`);
    await withTransaction(db, republishMenus);

    // Same dish, same quantity, a DIFFERENT label off the same list.
    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: premiumCoffeeOfferId,
          quantity: "1",
          options: [{ listId: cookingOptions.listId, labelId: cookingOptions.labelIds[1]! }],
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(after[0]!.id).toEqual(before[0]!.id);
    // The 3.25 it was sold at, not today's 99.00 (plan D10), in whole cents off the column.
    expect(after[0]!.unitPriceGross).toEqual(325);
    expect(after[0]!.optionSnapshots[0]).toMatchObject({
      labelName: { [CONTENT_LANGUAGE]: "Cortado staff" },
    });
  });

  it("refuses an edit whose new answer breaks the list's own rules", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const bacon = await withTransaction(db, async (tx) => {
      return addExtraList(tx, coffeeId, "Bacon", { price: "1.00" });
    });
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
      ],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    // Two of an item capped at one: the list's own rules apply to the edited picks.
    await expect(
      updateProducts(cfg, id, {
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            productId: coffeeId,
            quantity: "1",
            extras: [
              { listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 2 }] },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "extras.limit_exceeded",
      params: { extraListId: bacon.listId },
    });
    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(after.map((line) => line.id)).toEqual(before.map((line) => line.id));
  });

  /**
   * A names-only snapshot cannot tell a rename from a different answer
   * (`docs/developers/modifiers.md`), so the renamed answer is frozen as a changed one; an answer
   * carries no price, so the line keeps its own (plan D10).
   */
  it("keeps the price of a held line whose options list was renamed between the two sends, freezing the new name", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    const cookingOptions = await withTransaction(db, async (tx) => {
      const list = await addOptionList(tx, coffeeId, "Cooking", ["Solo"]);
      await republishMenus(tx);
      return list;
    });
    const options = [{ listId: cookingOptions.listId, labelId: cookingOptions.labelIds[0]! }];
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1", options }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    await db.execute(
      sql`update option_lists set name = 'Renamed staff' where id = ${cookingOptions.listId}`,
    );
    await db.execute(sql`
      update menu_items set gross_price = 9900 where id = ${premiumCoffeeOfferId}`);
    await withTransaction(db, republishMenus);

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: premiumCoffeeOfferId,
          quantity: "2",
          options,
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // The dish keeps its line, and the raise adds a second dish beside it; both at the 3.25 it
    // was sold at, not today's 99.00, in whole cents off the column, and both freeze the new name.
    expect(after).toHaveLength(2);
    expect(after[0]!.id).toEqual(before[0]!.id);
    expect(after[1]!.id).not.toEqual(before[0]!.id);
    for (const line of after) {
      expect(line.unitPriceGross).toEqual(325);
      expect(line.optionSnapshots[0]).toMatchObject({
        listName: { [CONTENT_LANGUAGE]: "Renamed staff" },
      });
    }
  });

  describe("a parked dish not yet sent, whose recorded answer the menu no longer matches", () => {
    async function parkAnswered() {
      const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
      const [cooking, sauce] = await withTransaction(db, async (tx) => {
        const lists = [
          await addOptionList(tx, coffeeId, "Cooking", ["Medium rare", "Well done"]),
          await addOptionList(tx, coffeeId, "Sauce", ["Pepper"]),
        ];
        await republishMenus(tx);
        return lists;
      });
      const answers = [
        { listId: cooking!.listId, labelId: cooking!.labelIds[0]! },
        { listId: sauce!.listId, labelId: sauce!.labelIds[0]! },
      ];
      const id = randomUUID();
      await parkOrder({ db }, cfg, {
        id,
        zoneId,
        lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1", options: answers }],
      });
      const lines = () =>
        db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id))
          .orderBy(workingOrderLines.lineNo);
      const [dish] = await lines();
      expect(dish!.sentAt).toBeNull();
      const save = async (options: OptionSelection[], quantity = "1") =>
        updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
          revision: await revisionOf(id),
          lines: [
            {
              workingOrderLineId: dish!.id,
              menuItemId: premiumCoffeeOfferId,
              quantity,
              options,
            },
          ],
        });
      return { cfg, id, coffeeId, cooking: cooking!, answers, dish: dish!, lines, save };
    }
    type Parked = Awaited<ReturnType<typeof parkAnswered>>;

    const changes: {
      change: string;
      apply: (tx: Transaction, parked: Parked) => unknown;
      resend?: true;
    }[] = [
      {
        change: "its list was renamed",
        apply: (tx, { cooking }) =>
          tx.execute(sql`update option_lists set name = 'Doneness' where id = ${cooking.listId}`),
      },
      {
        change: "its label was renamed",
        apply: (tx, { cooking }) =>
          tx.execute(
            sql`update option_labels set name = 'Pink' where id = ${cooking.labelIds[0]!}`,
          ),
      },
      {
        change: "its label was withdrawn",
        apply: (tx, { cooking }) =>
          tx.execute(
            sql`update option_labels set available = 0 where id = ${cooking.labelIds[0]!}`,
          ),
      },
      {
        change: "its label was withdrawn and a stale till still names it",
        apply: (tx, { cooking }) =>
          tx.execute(
            sql`update option_labels set available = 0 where id = ${cooking.labelIds[0]!}`,
          ),
        resend: true,
      },
      {
        change: "its list was deleted",
        apply: (tx, { cooking }) => menu.deleteOptionList(tx, cooking.listId),
      },
    ];

    it.each(changes)(
      "keeps the answer and records no change when $change",
      async ({ apply, resend }) => {
        const parked = await parkAnswered();
        await withTransaction(db, async (tx) => {
          await apply(tx, parked);
          await republishMenus(tx);
        });
        const revision = await revisionOf(parked.id);

        await parked.save(resend ? parked.answers : parked.answers.slice(1));

        expect(await parked.lines()).toEqual([parked.dish]);
        expect(await revisionOf(parked.id)).toBe(revision);
      },
    );

    it("keeps the answer on both dishes when the quantity is raised", async () => {
      const parked = await parkAnswered();
      await withTransaction(db, async (tx) => {
        await tx.execute(
          sql`update option_lists set name = 'Doneness' where id = ${parked.cooking.listId}`,
        );
        await republishMenus(tx);
      });

      await parked.save(parked.answers.slice(1), "2");

      const after = await parked.lines();
      expect(after).toHaveLength(2);
      for (const line of after) expect(line.optionSnapshots).toEqual(parked.dish.optionSnapshots);
    });

    it("still refuses a list added after parking that nothing recorded could have answered", async () => {
      const parked = await parkAnswered();
      const added = await withTransaction(db, async (tx) => {
        const list = await addOptionList(tx, parked.coffeeId, "Milk", ["Oat"]);
        await republishMenus(tx);
        return list;
      });

      await expect(parked.save(parked.answers)).rejects.toMatchObject({
        code: "options.label_required",
        params: { optionListId: added.listId },
      });
      expect(await parked.lines()).toEqual([parked.dish]);
    });

    it("refuses a new Milk list even after the Cooking list is deleted", async () => {
      const parked = await parkAnswered();
      const milk = await withTransaction(db, async (tx) => {
        await menu.deleteOptionList(tx, parked.cooking.listId);
        const list = await addOptionList(tx, parked.coffeeId, "Milk", ["Oat"]);
        await republishMenus(tx);
        return list;
      });
      const sauce = parked.answers[1]!;
      const revision = await revisionOf(parked.id);

      await expect(parked.save([sauce])).rejects.toMatchObject({
        code: "options.label_required",
        params: { optionListId: milk.listId },
      });
      expect(await parked.lines()).toEqual([parked.dish]);
      expect(await revisionOf(parked.id)).toBe(revision);

      const answers = [sauce, { listId: milk.listId, labelId: milk.labelIds[0]! }];
      await parked.save(answers);
      const [saved] = await parked.lines();
      expect(saved!.optionSnapshots).toHaveLength(3);
      expect(saved!.optionSnapshots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            listId: parked.cooking.listId,
            labelName: { [CONTENT_LANGUAGE]: "Medium rare staff" },
          }),
          expect.objectContaining({
            listId: sauce.listId,
            labelName: { [CONTENT_LANGUAGE]: "Pepper staff" },
          }),
          expect.objectContaining({
            listId: milk.listId,
            labelName: { [CONTENT_LANGUAGE]: "Oat staff" },
          }),
        ]),
      );
      const savedRevision = await revisionOf(parked.id);
      await parked.save(answers);
      expect(await revisionOf(parked.id)).toBe(savedRevision);
    });

    it("saves one Cooking answer when staff answer a re-created Cooking list", async () => {
      const parked = await parkAnswered();
      const cooking = await withTransaction(db, async (tx) => {
        await menu.deleteOptionList(tx, parked.cooking.listId);
        const list = await addOptionList(tx, parked.coffeeId, "Cooking", ["Well done"]);
        await republishMenus(tx);
        return list;
      });
      await parked.save([
        parked.answers[1]!,
        { listId: cooking.listId, labelId: cooking.labelIds[0]! },
      ]);

      const [saved] = await parked.lines();
      expect(
        saved!.optionSnapshots.map(({ listId, labelName }) => [
          listId,
          labelName[CONTENT_LANGUAGE],
        ]),
      ).toEqual([
        [parked.answers[1]!.listId, "Pepper staff"],
        [cooking.listId, "Well done staff"],
      ]);
    });

    it("replaces the answer when staff pick a different one", async () => {
      const parked = await parkAnswered();

      await parked.save([
        { listId: parked.cooking.listId, labelId: parked.cooking.labelIds[1]! },
        parked.answers[1]!,
      ]);

      const [after] = await parked.lines();
      expect(after!.optionSnapshots.map((answer) => answer.labelName)).toEqual([
        { [CONTENT_LANGUAGE]: "Well done staff" },
        { [CONTENT_LANGUAGE]: "Pepper staff" },
      ]);
    });

    it("refuses leaving out an answer the menu still matches beside one it no longer does", async () => {
      const parked = await parkAnswered();
      await withTransaction(db, async (tx) => {
        await menu.deleteOptionList(tx, parked.cooking.listId);
        await republishMenus(tx);
      });

      await expect(parked.save([])).rejects.toMatchObject({
        code: "options.label_required",
        params: { optionListId: parked.answers[1]!.listId },
      });
      expect(await parked.lines()).toEqual([parked.dish]);
    });

    it("saves the new wording of a re-sent answer beside one the menu no longer matches", async () => {
      const parked = await parkAnswered();
      const [cooking, pepper] = parked.dish.optionSnapshots;
      await withTransaction(db, async (tx) => {
        await tx.execute(
          sql`update option_labels set available = 0 where id = ${parked.cooking.labelIds[0]!}`,
        );
        await tx.execute(
          sql`update option_labels set kitchen_name = 'New pepper kitchen' where id = ${parked.answers[1]!.labelId}`,
        );
        await republishMenus(tx);
      });

      await parked.save(parked.answers.slice(1), "2");

      const after = await parked.lines();
      expect(after).toHaveLength(2);
      for (const line of after) {
        expect(line.optionSnapshots).toEqual([
          cooking,
          { ...pepper, labelKitchenName: "New pepper kitchen" },
        ]);
      }
    });

    it("keeps the answer of a deleted list when staff change another answer", async () => {
      const parked = await parkAnswered();
      const pepper = parked.dish.optionSnapshots[1];
      await withTransaction(db, async (tx) => {
        await menu.deleteOptionList(tx, parked.answers[1]!.listId);
        await republishMenus(tx);
      });

      await parked.save([{ listId: parked.cooking.listId, labelId: parked.cooking.labelIds[1]! }]);

      const [after] = await parked.lines();
      expect(after!.optionSnapshots.map((answer) => answer.labelName)).toEqual([
        { [CONTENT_LANGUAGE]: "Well done staff" },
        { [CONTENT_LANGUAGE]: "Pepper staff" },
      ]);
      expect(after!.optionSnapshots[1]).toEqual(pepper);

      const revision = await revisionOf(parked.id);
      await parked.save([{ listId: parked.cooking.listId, labelId: parked.cooking.labelIds[1]! }]);
      expect(await revisionOf(parked.id)).toBe(revision);
    });

    it("keeps the deleted list answer once staff answer a renamed list", async () => {
      const parked = await parkAnswered();
      await withTransaction(db, async (tx) => {
        await tx.execute(
          sql`update option_lists set name = 'Doneness' where id = ${parked.cooking.listId}`,
        );
        await menu.deleteOptionList(tx, parked.answers[1]!.listId);
        await republishMenus(tx);
      });

      await parked.save([{ listId: parked.cooking.listId, labelId: parked.cooking.labelIds[1]! }]);

      const [after] = await parked.lines();
      expect(after!.optionSnapshots.map((answer) => answer.listName)).toEqual([
        { [CONTENT_LANGUAGE]: "Doneness" },
        parked.dish.optionSnapshots[1]!.listName,
      ]);
    });

    it("leaves a change through the single-line edit to replace every answer", async () => {
      const parked = await parkAnswered();
      await withTransaction(db, async (tx) => {
        await menu.deleteOptionList(tx, parked.answers[1]!.listId);
        await republishMenus(tx);
      });
      const revision = await revisionOf(parked.id);

      await withTransaction(db, (tx) =>
        updateOrderLine(
          tx,
          parked.cfg,
          parked.id,
          parked.dish.lineNo,
          {
            portionLineNos: [],
            options: [{ listId: parked.cooking.listId, labelId: parked.cooking.labelIds[1]! }],
          },
          revision,
        ),
      );

      const [after] = await parked.lines();
      expect(after!.optionSnapshots.map((answer) => answer.labelName)).toEqual([
        { [CONTENT_LANGUAGE]: "Well done staff" },
      ]);
    });
  });

  /**
   * The body a till line sends is the same one an edit sends, so an edit that carries no `options`
   * key is refused exactly as a first order would be — `validateOptionSelections`
   * (`packages/menu/src/option-contract.ts`) walks the dish's ACTIVE lists and throws for the
   * first one no answer names. A whole-order save reaches it through `editUnsentLineOptions` unless
   * only unmatched answers are missing.
   *
   * The next case is the control: the same edit body against a dish carrying NO options list, which
   * succeeds — so the refusal below is the options list and not the shape of the edit.
   */
  it("refuses a quantity-only edit that names no answer for an active options list", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    const cookingOptions = await withTransaction(db, async (tx) => {
      const list = await addOptionList(tx, coffeeId, "Cooking", ["Solo"]);
      await republishMenus(tx);
      return list;
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCoffeeOfferId,
          quantity: "1",
          options: [{ listId: cookingOptions.listId, labelId: cookingOptions.labelIds[0]! }],
        },
      ],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            menuItemId: premiumCoffeeOfferId,
            quantity: "2",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "options.label_required",
      params: { optionListId: cookingOptions.listId },
    });
  });

  it("accepts the same quantity-only edit on a dish carrying no options list", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        { workingOrderLineId: before[0]!.id, menuItemId: premiumCoffeeOfferId, quantity: "2" },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // The dish keeps its line, and the raise adds a second dish beside it: one unit each, as a
    // count of thousandths off the column.
    expect(after.map((line) => line.quantity)).toEqual([1000, 1000]);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[1]!.id).not.toBe(before[0]!.id);
  });
});
/**
 * Plan D10 and spec §10.3 and §11.2: a saved order keeps its facts. An edit prices only what it
 * adds — a new line, an extra added to a line, a line whose menu item or variant changed — and a
 * note or an options answer carries no price.
 */
describe("editing a saved order prices only what the edit adds", () => {
  async function menuVenue() {
    const venue = await setupVenue();
    const { cfg } = venue;
    const seeded = await withTransaction(db, async (tx) => {
      const mains = await createCategory(tx, { name: "Mains" });
      const product = (name: string, unitPrice: string, categoryId: string | null = null) =>
        createProduct(tx, {
          categoryId,
          name: `${name} staff`,
          customerName: { [CONTENT_LANGUAGE]: `${name} customer` },
          kitchenName: `${name} kitchen`,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
        });
      const lemonade = await product("Lemonade", "3.00");
      const water = await product("Water", "2.00");
      const burger = await product("Burger", "12.00", mains.id);
      const coffee = await product("Coffee", "1.40");
      const cheese = await addExtraList(tx, burger.id, "Cheese", { price: "1.00" });
      const bacon = await addExtraList(tx, burger.id, "Bacon", { price: "1.20" });
      return {
        lemonade: lemonade.id,
        water: water.id,
        burger: burger.id,
        coffee: coffee.id,
        cheese,
        bacon,
      };
    });
    return { ...venue, cfg, ...seeded };
  }

  it("keeps every stored line's price and facts, and prices the added extra and the new line now", async () => {
    const { cfg, lemonade, water, burger, coffee, cheese, bacon } = await menuVenue();
    const cheesePick = {
      listId: cheese.listId,
      picks: [{ productId: cheese.productId, quantity: 1 }],
    };
    const baconPick = {
      listId: bacon.listId,
      picks: [{ productId: bacon.productId, quantity: 1 }],
    };
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [
        { productId: lemonade, quantity: "1" },
        { productId: water, quantity: "1" },
        { productId: burger, quantity: "1", extras: [cheesePick] },
      ],
    });
    const before = await storedRows(id);
    expect(before.map((row) => [row.lineNo, row.unitPriceGross])).toEqual([
      [1, 300],
      [2, 200],
      [3, 1200],
      [4, 100],
    ]);

    // Every price moves underneath the order, and two products are renamed.
    await db.execute(sql`update products set unit_price = 250 where id = ${lemonade}`);
    await db.execute(
      sql`update products set unit_price = 180, name = 'Renamed' where id = ${water}`,
    );
    await db.execute(
      sql`update products set unit_price = 1300, name = 'Renamed' where id = ${burger}`,
    );
    await db.execute(sql`update extra_list_items set price = 120 where list_id = ${cheese.listId}`);
    await db.execute(sql`update extra_list_items set price = 150 where list_id = ${bacon.listId}`);

    await updateProducts(cfg, id, {
      lines: [
        { workingOrderLineId: before[0]!.id, productId: lemonade, quantity: "1" },
        { workingOrderLineId: before[1]!.id, productId: water, quantity: "1", note: "No ice" },
        {
          workingOrderLineId: before[2]!.id,
          productId: burger,
          quantity: "1",
          extras: [cheesePick, baconPick],
        },
        { productId: coffee, quantity: "1" },
      ],
    });

    const after = await storedRows(id);
    const byId = new Map(after.map((row) => [row.id, row]));
    // The lemonade is untouched, and the water gains its note alone.
    expect(byId.get(before[0]!.id)).toEqual(before[0]);
    expect(byId.get(before[1]!.id)).toEqual({ ...before[1]!, note: "No ice" });
    // The burger and its cheese keep their rows, names and prices. They move together after the
    // highest line number, so the new bacon stays with its dish.
    expect(byId.get(before[2]!.id)).toEqual({ ...before[2]!, lineNo: 5 });
    expect(byId.get(before[3]!.id)).toEqual({ ...before[3]!, lineNo: 6 });
    const added = after.filter((row) => !before.some((old) => old.id === row.id));
    expect(
      added.map((row) => [row.lineNo, row.productId, row.parentLineId, row.unitPriceGross]),
    ).toEqual([
      [7, bacon.productId, before[2]!.id, 150],
      [8, coffee, null, 140],
    ]);
  });

  it("changes a note on its own row, keeping the line's id and price", async () => {
    const { cfg, water } = await menuVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: water, quantity: "2" }] });
    const before = await storedRows(id);
    await db.execute(sql`update products set unit_price = 900 where id = ${water}`);

    await updateProducts(cfg, id, {
      lines: heldRow(
        before.map((row) => row.id),
        "2",
        { productId: water, note: "Warm" },
      ),
    });

    expect(await storedRows(id)).toEqual(before.map((row) => ({ ...row, note: "Warm" })));
  });

  it("numbers a line that replaces another after the order's highest line number", async () => {
    const { cfg, lemonade, water } = await menuVenue();
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [
        { productId: lemonade, quantity: "1" },
        { productId: water, quantity: "1" },
      ],
    });
    const before = await storedRows(id);

    // The first line is dropped from the basket and the second is kept.
    await updateProducts(cfg, id, {
      lines: [
        { workingOrderLineId: before[1]!.id, productId: water, quantity: "1" },
        { productId: lemonade, quantity: "2" },
      ],
    });

    const after = await storedRows(id);
    // The two lemonades are two lines, both numbered past the order's highest.
    expect(after.map((row) => [row.id === before[1]!.id, row.lineNo, row.productId])).toEqual([
      [true, 2, water],
      [false, 3, lemonade],
      [false, 4, lemonade],
    ]);
  });

  it("changes one line's options answer through the one-line edit, at its stored price, leaving what the patch omits", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    const cookingOptions = await withTransaction(db, async (tx) => {
      const list = await addOptionList(tx, coffeeId, "Cooking", ["Solo", "Cortado"]);
      await republishMenus(tx);
      return list;
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCoffeeOfferId,
          quantity: "1",
          note: "Caliente",
          options: [{ listId: cookingOptions.listId, labelId: cookingOptions.labelIds[0]! }],
        },
      ],
    });
    const [before] = await storedRows(id);
    await db.execute(
      sql`update menu_items set gross_price = 9900 where id = ${premiumCoffeeOfferId}`,
    );
    await withTransaction(db, republishMenus);

    await withTransaction(db, (tx) =>
      updateOrderLine(
        tx,
        cfg,
        id,
        1,
        {
          portionLineNos: [],
          options: [{ listId: cookingOptions.listId, labelId: cookingOptions.labelIds[1]! }],
        },
        0,
      ),
    );

    expect(await storedRows(id)).toEqual([before]);
    const [line] = await db
      .select({ optionSnapshots: workingOrderLines.optionSnapshots })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(line!.optionSnapshots[0]).toMatchObject({
      labelName: { [CONTENT_LANGUAGE]: "Cortado staff" },
    });
  });

  it("lowers a line of an order with no service context in place, and refuses what it has no offer to check", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await withTransaction(db, async (tx) => {
      await createOpenOrder(tx, cfg, id, [], null);
      await insertContextlessLines(tx, id, [coffeeId], 2000);
    });

    await withTransaction(db, (tx) => cancelItemForTest(tx, cfg, id, 1, "1"));
    expect((await storedRows(id)).map((row) => [row.quantity, row.lineTotal])).toEqual([
      [1000, 150],
    ]);
    // A raise is checked against the offer, and so is an extras answer; the line names none.
    for (const patch of [
      { quantity: "2", portionLineNos: [] },
      { extras: [], portionLineNos: [] },
    ]) {
      await expect(
        withTransaction(db, (tx) => updateOrderLine(tx, cfg, id, 1, patch, 1)),
      ).rejects.toMatchObject({
        code: "order.service_context_missing",
        params: { workingOrderId: id },
      });
    }
  });

  it("keeps an extra from the list it was taken from, whatever that list later charges or offers", async () => {
    // Spec §11.7 example 7: Extra cheese on "Toppings" at 1.00 and on "Premium toppings" at 1.50,
    // and the line took it from Premium toppings.
    const { cfg, coffeeId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const toppings = await addExtraList(tx, coffeeId, "Queso", { price: "1.00" });
      const premium = await menu.createExtraList(
        tx,
        {
          name: "Premium toppings list staff",
          customerName: { [CONTENT_LANGUAGE]: "Premium toppings list customer" },
          kitchenName: "Premium toppings list kitchen",
          minPicks: 0,
          maxPicks: null,
          active: true,
          items: [
            { productId: toppings.productId, maxQuantity: 1, preselected: false, price: "1.50" },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: premium.id });
      return { cheeseId: toppings.productId, toppingsId: toppings.listId, premiumId: premium.id };
    });
    const fromList = (listId: string) => [
      { listId, picks: [{ productId: seeded.cheeseId, quantity: 1 }] },
    ];
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "1", extras: fromList(seeded.premiumId) }],
    });
    const [dish] = await storedRows(id);
    const editNote = (note: string, extras = fromList(seeded.premiumId)) =>
      updateProducts(cfg, id, {
        lines: [{ workingOrderLineId: dish!.id, productId: coffeeId, quantity: "1", note, extras }],
      });
    const cheese = async () =>
      (await storedRows(id))
        .filter((row) => row.parentLineId !== null)
        .map((row) => [row.extraListId, row.unitPriceGross]);

    await editNote("One");
    expect(await cheese()).toEqual([[seeded.premiumId, 150]]);

    await db.execute(
      sql`update extra_list_items set price = 180 where list_id = ${seeded.premiumId}`,
    );
    await editNote("Two");
    expect(await cheese()).toEqual([[seeded.premiumId, 150]]);

    await db.execute(sql`delete from extra_list_items where list_id = ${seeded.premiumId}`);
    await editNote("Three");
    expect(await cheese()).toEqual([[seeded.premiumId, 150]]);

    // A pick from the other list is a new pick, priced from that list now.
    await editNote("Four", fromList(seeded.toppingsId));
    expect(await cheese()).toEqual([[seeded.toppingsId, 100]]);
  });
});
describe("deleted lists", () => {
  it.each(["options", "extras"] as const)(
    "adds a dish after its %s list is deleted without republishing",
    async (kind) => {
      const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
      const listId = await withTransaction(db, async (tx) => {
        const list =
          kind === "options"
            ? await addOptionList(tx, coffeeId, "Cooking")
            : await addExtraList(tx, coffeeId, "Side", { minPicks: 1 });
        await republishMenus(tx);
        return list.listId;
      });
      await withTransaction(db, (tx) =>
        kind === "options" ? menu.deleteOptionList(tx, listId) : menu.deleteExtraList(tx, listId),
      );
      for (const republish of [false, true]) {
        if (republish) await withTransaction(db, (tx) => republishMenus(tx));
        const id = randomUUID();
        await parkOrder({ db }, cfg, {
          id,
          zoneId,
          lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
        });
        const lines = await db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id));
        expect(lines.map((line) => [line.productId, line.lineTotal])).toEqual([[coffeeId, 325]]);
      }
    },
  );
});
