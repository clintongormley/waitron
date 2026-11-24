import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import {
  clearSavedOffer,
  updateHeldOrder,
  updateOrderLine,
} from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  captureError,
  products,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { addProductToMenu, createProduct, setProductVariants, EACH_UNIT } from "@waitron/menu";
import * as menu from "@waitron/menu";
import type { ExtraSelection } from "@waitron/shared";
import { getHeldOrder, getPlacedCounterOrder, listHeldOrders } from "./working-order-held-read.js";
import { listStationQueue } from "./working-order-station-queue.js";
import { setOrderInvoiceChoice } from "./working-order-invoice.js";
import { advanceTicketItem } from "./working-order-kitchen-service.js";
import { createOpenOrder, parkOrder } from "./working-order-open.js";
import { fireLines } from "./working-order-kitchen-fire.js";
import {
  readStoredOrder,
  priceStoredOrderForIssuance,
  readTabLines,
} from "./stored-order-lines.js";
import { ticketLinesFrom } from "./receipt-lines.js";
import { createStation } from "./kitchen.js";
import { routeCategoryTo } from "./testing/zone-offers.js";
import { publishWorkingMenu, republishMenus } from "./testing/publish-menu.js";
import { VENUE_SERVICE } from "./modules.js";
import { openPartyTab, serveLine } from "./testing/serve-line.js";
import "./errors.js";
import { heldRow } from "./testing/held-row.js";

import {
  setupVenue,
  secondArea,
  db,
  seedForeignNodeOrder,
  LOCALE,
  attachModifierList,
  revisionOf,
  CONTENT_LANGUAGE,
  addExtraList,
  parkProducts,
  counterOffers,
  setStatus,
  readOrder,
  updateProducts,
  makeTable,
  addRound,
  tableOffers,
  OPERATOR,
  addOptionList,
  makeProduct,
  seedVariantOffer,
  grossBasketTotal,
  seedWine,
  categoryStations,
  insertContextlessLines,
  fireableLines,
  insertRoute,
  ticketItemsFor,
  byProduct,
  passItems,
} from "./working-order.test-support.js";

describe("getHeldOrder", () => {
  it("names the area the order was parked in, and null for an order with none", async () => {
    const { cfg, menuId, coffeeOfferId } = await setupVenue();
    const terrace = await secondArea(menuId);
    const parked = randomUUID();
    await parkOrder({ db }, cfg, {
      id: parked,
      zoneId: terrace,
      lines: [{ menuItemId: coffeeOfferId, quantity: "1" }],
    });
    const zoneless = await seedForeignNodeOrder(cfg);

    expect((await getHeldOrder({ db }, parked)).zoneId).toBe(terrace);
    expect((await getHeldOrder({ db }, zoneless)).zoneId).toBeNull();
  });

  it.each(["open", "placed"] as const)(
    "reads the invoice type stored on a %s counter order",
    async (status) => {
      const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
      const id = randomUUID();
      await parkOrder({ db }, cfg, {
        id,
        zoneId,
        lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
      });
      expect((await getHeldOrder({ db }, id)).invoiceType).toBe("F2");
      await setOrderInvoiceChoice(db, { recipientNameMaxLength: null }, cfg, id, {
        revision: 0,
        operatorId: undefined,
        expectedEdit: null,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "2 Main Street, 28013 Madrid, Madrid",
          countryCode: "ES",
        },
      });
      await db.execute(sql`update working_orders set status = ${status} where id = ${id}`);
      const read = status === "open" ? getHeldOrder : getPlacedCounterOrder;
      expect((await read({ db }, id)).invoiceType).toBe("F1");
    },
  );

  it.each(["open", "placed"] as const)(
    "reads the customer and delivery saved on a %s full-invoice counter order",
    async (status) => {
      const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
      const id = randomUUID();
      await parkOrder({ db }, cfg, {
        id,
        zoneId,
        lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
      });
      const unchosen = await getHeldOrder({ db }, id);
      expect("recipient" in unchosen).toBe(false);
      expect("invoiceDelivery" in unchosen).toBe(false);
      await setOrderInvoiceChoice(db, { recipientNameMaxLength: null }, cfg, id, {
        revision: 0,
        operatorId: undefined,
        expectedEdit: null,
        invoiceType: "F1",
        recipient: {
          taxId: "AB-09",
          identifierType: "passport",
          identifierCountryCode: "FR",
          legalName: "Cliente SL",
          address: "2 Main Street, 28013 Madrid, Madrid",
          countryCode: "ES",
        },
      });
      await db.execute(
        sql`update working_orders set status = ${status}, invoice_delivery = ${JSON.stringify({
          medium: "email",
          recipient: "customer@example.test",
          personId: "staff-1",
        })} where id = ${id}`,
      );
      const read = status === "open" ? getHeldOrder : getPlacedCounterOrder;
      const order = await read({ db }, id);
      expect(order.recipient).toEqual({
        taxId: "AB-09",
        identifierType: "passport",
        identifierCountryCode: "FR",
        legalName: "Cliente SL",
        address: "2 Main Street, 28013 Madrid, Madrid",
        countryCode: "ES",
      });
      expect(order.invoiceDelivery).toEqual({
        medium: "email",
        recipient: "customer@example.test",
      });
    },
  );

  it.each(["open", "placed"] as const)(
    "refuses a %s counter line whose stored menu offer is missing",
    async (status) => {
      const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
      const id = randomUUID();
      await parkOrder({ db }, cfg, {
        id,
        zoneId,
        lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
      });
      await clearSavedOffer(db, id);

      await db.execute(sql`update working_orders set status = ${status} where id = ${id}`);
      const read = status === "open" ? getHeldOrder : getPlacedCounterOrder;
      await expect(read({ db }, id)).rejects.toMatchObject({
        code: "order.service_context_missing",
        params: { workingOrderId: id },
      });
    },
  );

  it.each(["open", "placed"] as const)(
    "refuses a %s order when one line lacks its stored menu offer",
    async (status) => {
      const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
      const id = randomUUID();
      const park = (billId: string) =>
        parkOrder({ db }, cfg, {
          id: billId,
          zoneId,
          lines: [
            { menuItemId: premiumCoffeeOfferId, quantity: "1" },
            { menuItemId: premiumCoffeeOfferId, quantity: "2" },
          ],
        });
      await park(id);
      await db.execute(sql`update working_orders set status = ${status} where id = ${id}`);
      const read = status === "open" ? getHeldOrder : getPlacedCounterOrder;
      expect((await read({ db }, id)).lines.map((l) => l.quantity)).toEqual([
        "1.000",
        "1.000",
        "1.000",
      ]);
      const incomplete = randomUUID();
      await park(incomplete);
      await clearSavedOffer(db, incomplete, 3);
      await db.execute(sql`update working_orders set status = ${status} where id = ${incomplete}`);
      await expect(read({ db }, incomplete)).rejects.toMatchObject({
        code: "order.service_context_missing",
        params: { workingOrderId: incomplete },
      });
    },
  );

  it("keeps a missing product unresolved when its stored offer context remains", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });
    await db.execute(sql`update working_order_lines set product_id = null
      where working_order_id = ${id}`);

    expect((await getHeldOrder({ db }, id)).lines).toEqual([
      { productId: null, quantity: "1.000", makeAt: null, optionSnapshots: [] },
    ]);
  });

  it("keeps an over-precise published extra portion exact after the unit precision falls", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId, kgUnitId } = await setupVenue();
    const extra = await withTransaction(db, async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Ham",
        unitId: kgUnitId,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const list = await menu.createExtraList(
        tx,
        {
          name: "Portions",
          minPicks: 0,
          maxPicks: 3,
          items: [{ productId: product.id, portion: "0.055", maxQuantity: 3, price: null }],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });
      await republishMenus(tx);
      return { listId: list.id, productId: product.id };
    });
    await withTransaction(db, (tx) => menu.updateUnit(tx, kgUnitId, { precision: 2 }, LOCALE));
    await withTransaction(db, (tx) => republishMenus(tx));

    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCoffeeOfferId,
          quantity: "1",
          extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 3 }] }],
        },
      ],
    });

    const child = await db.execute<{
      quantity: number;
      price_quantity: number;
      unit_precision: number;
      line_total: number;
    }>(sql`select quantity, price_quantity, unit_precision, line_total from working_order_lines
      where working_order_id = ${id} and parent_line_id is not null`);
    expect(child.rows).toEqual([
      { quantity: 165, price_quantity: 55, unit_precision: 2, line_total: 3 },
    ]);
  });

  it("reads a portion-sized extra back as its per-dish picks, and saves it unchanged", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId, kgUnitId } = await setupVenue();
    const extra = await withTransaction(db, async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Ham",
        unitId: kgUnitId,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const list = await menu.createExtraList(
        tx,
        {
          name: "Portions",
          minPicks: 0,
          maxPicks: 3,
          items: [{ productId: product.id, portion: "0.055", maxQuantity: 3, price: null }],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });
      await republishMenus(tx);
      return { listId: list.id, productId: product.id };
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCoffeeOfferId,
          quantity: "2",
          extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 3 }] }],
        },
      ],
    });
    const children = sql`select cast(quantity as int) as quantity,
        cast(line_total as int) as line_total
      from working_order_lines where working_order_id = ${id} and parent_line_id is not null
      order by line_no`;
    const stored = await db.execute<{ quantity: number; line_total: number }>(children);
    expect(stored.rows).toEqual([
      { quantity: 165, line_total: 3 },
      { quantity: 165, line_total: 3 },
    ]);

    const held = await getHeldOrder({ db }, id);
    expect(held.lines.map((line) => line.extras?.map((pick) => pick.quantity))).toEqual([[3], [3]]);

    // What the till sends back when another part of the order is edited: each held pick as read.
    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: held.lines.map((line, index) => ({
        workingOrderLineId: line.workingOrderLineId!,
        menuItemId: premiumCoffeeOfferId,
        quantity: line.quantity,
        extras: [
          {
            listId: extra.listId,
            picks: (line.extras ?? []).map((pick) => ({
              productId: pick.productId!,
              quantity: pick.quantity,
            })),
          },
        ],
        ...(index === 0 ? { note: "No salt" } : {}),
      })),
    });
    expect((await db.execute<{ quantity: number; line_total: number }>(children)).rows).toEqual(
      stored.rows,
    );
  });

  it("parks weighted extras with physical quantity and the frozen per-pick basis", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId, kgUnitId } = await setupVenue();
    const extra = await withTransaction(db, async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Ham staff",
        customerName: { [CONTENT_LANGUAGE]: "Ham customer" },
        kitchenName: "Ham kitchen",
        unitId: kgUnitId,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const list = await menu.createExtraList(
        tx,
        {
          name: "Jamones staff",
          customerName: { [CONTENT_LANGUAGE]: "Jamones customer" },
          kitchenName: "Jamones kitchen",
          minPicks: 0,
          maxPicks: 3,
          active: true,
          items: [
            {
              productId: product.id,
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
      await republishMenus(tx);
      return { listId: list.id, productId: product.id };
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCoffeeOfferId,
          quantity: "2",
          extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 3 }] }],
        },
      ],
    });

    const rows = await db.execute<{
      quantity: number;
      price_quantity: number;
      unit_name: string;
      unit_precision: number;
      unit_price_gross: number;
      line_total: number;
    }>(sql`
      select quantity, price_quantity, unit_name, unit_precision, unit_price_gross, line_total
      from working_order_lines where working_order_id = ${id} and parent_line_id is not null
      order by line_no`);
    // Each dish's own three picks: 150 g, 3 cents; the two together the 300 g and 6 cents of
    // the order's picks.
    const picks = {
      quantity: 150,
      price_quantity: 50,
      unit_name: JSON.stringify({ [CONTENT_LANGUAGE]: "su" }),
      unit_precision: 3,
      unit_price_gross: 1,
      line_total: 3,
    };
    expect(rows.rows).toEqual([picks, picks]);

    const revision = await revisionOf(id);
    await withTransaction(db, (tx) =>
      updateOrderLine(tx, cfg, id, 1, { portionLineNos: [], note: "No salt" }, revision),
    );
    const after = await db.execute<{
      quantity: number;
      price_quantity: number;
      line_total: number;
    }>(sql`
      select quantity, price_quantity, line_total from working_order_lines
      where working_order_id = ${id} and parent_line_id is not null order by line_no`);
    expect(after.rows).toEqual([
      { quantity: 150, price_quantity: 50, line_total: 3 },
      { quantity: 150, price_quantity: 50, line_total: 3 },
    ]);
  });

  it("keeps a fractional item's unit snapshot after the live unit is renamed", async () => {
    const { cfg, menuId, zoneId } = await setupVenue();
    const { productId, menuItemId, unitId } = await withTransaction(db, async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into units (id, staff_name, staff_abbreviation, name, abbreviation, precision, hardware_unit)
        values (${randomUUID()}, 'Staff unit', 'su', ${JSON.stringify({ [CONTENT_LANGUAGE]: "kg" })},
          ${JSON.stringify({ [CONTENT_LANGUAGE]: "kg" })}, 3, 'kg')
        returning id`);
      const unitId = inserted.rows[0]!.id;
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Ham",
        unitId,
        unitPrice: "12.00",
        vatClass: "general",
      });
      const menuItem = await addProductToMenu(tx, {
        menuId: menuId,
        productId: product.id,
        grossPrice: "12.00",
      });
      await publishWorkingMenu(tx, menuId);
      return { productId: product.id, menuItemId: menuItem.id, unitId };
    });
    const id = randomUUID();

    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId, quantity: "0.375" }],
    });
    await db.execute(sql`
      update units set name = ${JSON.stringify({ [CONTENT_LANGUAGE]: "kilogram" })}
      where id = ${unitId}`);

    const order = await getHeldOrder({ db }, id);
    const stored = await db.execute<{
      quantity: string;
      line_total: number;
      unit_name: string;
      unit_precision: number;
    }>(sql`
      select cast(quantity as text) as quantity, cast(line_total as int) as line_total,
             unit_name, unit_precision
      from working_order_lines
      where working_order_id = ${id}`);
    // `unit_name` holds JSON in a TEXT column, and a RAW read returns the stored text — the parse
    // is drizzle's column mapping, which `db.execute` does not go through.
    const storedRows = stored.rows.map((row) => ({
      ...row,
      unit_name: JSON.parse(row.unit_name) as Record<string, string>,
    }));
    // `quantity` counts whole THOUSANDTHS, so 375 grams is stored as 375 — read as text so the
    // assertion pins the stored count rather than a driver's rendering of an eight-byte integer.
    expect(storedRows).toEqual([
      {
        quantity: "375",
        line_total: 450,
        unit_name: { [CONTENT_LANGUAGE]: "kg" },
        unit_precision: 3,
      },
    ]);
    expect(order.lines).toEqual([
      expect.objectContaining({
        productId,
        quantity: "0.375",
        product: expect.objectContaining({
          unit: {
            id: unitId,
            name: { [CONTENT_LANGUAGE]: "kg" },
            precision: 3,
            hardwareUnit: "kg",
          },
          unitPrice: "12.00",
        }),
      }),
    ]);
  });

  it("reconstructs a parked offer with its extras, customisation and locked display prices", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    const extra = await withTransaction(db, async (tx) => {
      const attached = await addExtraList(tx, coffeeId, "Milk", {
        price: "0.75",
        maxQuantity: 2,
        maxPicks: 2,
      });

      await republishMenus(tx);
      return attached;
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCoffeeOfferId,
          quantity: "2",
          extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 2 }] }],
          note: "No foam",
        },
      ],
    });

    const order = await getHeldOrder({ db }, id);

    // Each of the two coffees is its own line, with its own two picks.
    const coffee = expect.objectContaining({
      workingOrderLineId: expect.any(String),
      menuItemId: premiumCoffeeOfferId,
      productId: coffeeId,
      quantity: "1.000",
      note: "No foam",
      extras: [
        {
          productId: extra.productId,
          name: "Milk staff",
          descriptions: { [LOCALE]: "Milk customer" },
          kitchenName: "Milk kitchen",
          price: "0.75",
          quantity: 2,
          listId: extra.listId,
          addAllergens: null,
          suitableFor: [],
        },
      ],
    });
    expect(order.lines).toEqual([coffee, coffee]);
    expect(new Set(order.lines.map((line) => line.workingOrderLineId)).size).toBe(2);
  });

  it("returns the parked offer's identity and snapshots after its live product changes", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    const id = randomUUID();
    // Give the product a customer name that DIFFERS from its staff name before parking, so the two
    // frozen halves below cannot be confused for one another.
    await db.execute(sql`
      update products set customer_name = ${JSON.stringify({ [CONTENT_LANGUAGE]: "House espresso" })}
      where id = ${coffeeId}`);
    await withTransaction(db, republishMenus);
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });
    await db.execute(sql`
      update products
      set name = 'Renamed espresso',
          customer_name = ${JSON.stringify({ [CONTENT_LANGUAGE]: "Renamed house espresso" })},
          vat_class = 'reduced',
          allergens = ${JSON.stringify({ milk: {} })}
      where id = ${coffeeId}`);
    await withTransaction(db, async (tx) => {
      const menuId = (
        await tx.execute<{ menuId: string }>(
          sql`select menu_id as "menuId" from menu_items where id = ${premiumCoffeeOfferId}`,
        )
      ).rows[0]!.menuId;
      const rootId = await menu.requireMenuRoot(tx, menuId);
      const [member] = (await menu.listMembers(tx, rootId)).filter(
        ({ ref }) => ref.kind === "product" && ref.productId === coffeeId,
      );
      await menu.removeMember(tx, rootId, member!.id);
      await republishMenus(tx);
    });

    const order = await getHeldOrder({ db }, id);
    expect(order.lines).toEqual([
      expect.objectContaining({
        menuItemId: premiumCoffeeOfferId,
        productId: coffeeId,
        quantity: "1.000",
        product: expect.objectContaining({
          id: coffeeId,
          productId: coffeeId,
          menuItemId: premiumCoffeeOfferId,
          // Both frozen halves survive the rename, and they are distinct text.
          name: "Espresso",
          customerName: { [LOCALE]: "House espresso" },
          // The espresso is priced by the each (no unit), so its snapshot resolves to the synthetic
          // Each unit — frozen at park time, unaffected by the live product's switch to weight above.
          unit: {
            id: EACH_UNIT.id,
            name: { [CONTENT_LANGUAGE]: EACH_UNIT.name[CONTENT_LANGUAGE]! },
            precision: EACH_UNIT.precision,
            hardwareUnit: EACH_UNIT.hardwareUnit,
          },
          unitPrice: "3.25",
          vatClass: "general",
          category: "ES drinks",
          allergens: { milk: {} },
          menuName: "Premium menu",
        }),
      }),
    ]);
  });

  it("shows the current product allergens when retrieving a held line", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    await db.execute(sql`
      update products set allergens = ${JSON.stringify({ gluten: { kinds: ["wheat" as const] } })}
      where id = ${coffeeId}`);
    await withTransaction(db, republishMenus);
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });
    await db.execute(sql`
      update products
      set allergens = ${JSON.stringify({
        milk: {},
        sulphites: {},
      })}
      where id = ${coffeeId}`);

    const order = await getHeldOrder({ db }, id);

    expect(order.lines.map((line) => line.product?.allergens)).toEqual([
      { milk: {}, sulphites: {} },
    ]);
  });

  it("returns the open order's product/quantity lines, ordered by lineNo", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      label: "Table 7",
      lines: [
        { productId: coffeeId, quantity: "1" },
        { productId: waterId, quantity: "3" },
      ],
    });

    const offers = await counterOffers();
    const order = await getHeldOrder({ db }, id);
    // Saved selections and quantities return in lineNo order; a quantity reads back at the three
    // places `thousandthsToDecimal` renders.
    expect({
      ...order,
      lines: order.lines.map(({ productId, menuItemId, quantity, optionSnapshots }) => ({
        productId,
        menuItemId,
        quantity,
        optionSnapshots,
      })),
    }).toEqual({
      id,
      zoneId: offers.zoneId,
      serviceMode: "prepay",
      expectedEdit: null,
      orderNumber: 1,
      label: "Table 7",
      revision: 0,
      invoiceType: "F2",
      dining: "eat_in",
      diningChoice: "none",
      kitchenNote: { note: null, revision: 0, ownerRevision: 0, scope: { workingOrderId: id } },
      lines: [
        {
          productId: coffeeId,
          menuItemId: offers.offerFor(coffeeId),
          quantity: "1.000",
          optionSnapshots: [],
        },
        ...Array.from({ length: 3 }, () => ({
          productId: waterId,
          menuItemId: offers.offerFor(waterId),
          quantity: "1.000",
          optionSnapshots: [],
        })),
      ],
    });
  });

  it("throws working_order.not_found for an unknown id", async () => {
    await setupVenue();
    const missing = randomUUID();
    await expect(getHeldOrder({ db }, missing)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: missing },
    });
  });

  it("throws working_order.not_found for a settled (non-open) order — closed is not retrievable", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(getHeldOrder({ db }, id)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: id },
    });
  });

  it("retrieves an open order from ANOTHER node of the same taxpayer — reads are venue-wide", async () => {
    const { cfg } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);

    // The by-id lookup reaches the foreign-node order like the node's own — a promoted node inherits it.
    const order = await getHeldOrder({ db }, foreign);
    expect(order.id).toBe(foreign);
    expect(order.lines).toEqual([]);
  });
});

describe("updateHeldOrder", () => {
  it.each(["omit", "replace", "reduce"])(
    "refuses %s of a sent dish in a whole-basket save",
    async (change) => {
      const { cfg, coffeeId, waterId } = await setupVenue();
      await withTransaction(db, (tx) => createStation(tx, { name: "Kitchen", isDefault: true }));
      const id = randomUUID();
      await parkProducts(cfg, {
        id,
        lines: [
          { productId: coffeeId, quantity: "1" },
          { productId: waterId, quantity: "1" },
        ],
      });
      const before = await db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      await db
        .update(workingOrderLines)
        .set({ sentAt: "2026-11-11T10:00:00.000Z", quantity: 2000, unitPrecision: 3 })
        .where(eq(workingOrderLines.id, before[0]!.id));
      const sent = await readOrder(id);
      const kept = { workingOrderLineId: before[1]!.id, productId: waterId, quantity: "1" };
      const changed =
        change === "omit"
          ? [kept]
          : [
              kept,
              {
                workingOrderLineId: before[0]!.id,
                productId: change === "replace" ? waterId : coffeeId,
                quantity: change === "reduce" ? "1.5" : "2",
              },
            ];
      await expect(updateProducts(cfg, id, { lines: changed })).rejects.toMatchObject({
        code: "ticket.already_sent",
        params: { workingOrderId: id, lineId: before[0]!.id },
      });
      expect(await readOrder(id)).toEqual(sent);
    },
  );

  it("keeps extras rows and customisation on a quantity-only edit", async () => {
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = await setupVenue();
    const extra = await withTransaction(db, async (tx) => {
      const attached = await addExtraList(tx, coffeeId, "Milk", {
        price: "0.75",
        maxQuantity: 2,
        maxPicks: 2,
      });

      await republishMenus(tx);
      return attached;
    });
    const id = randomUUID();
    const picks = [{ productId: extra.productId, quantity: 2 }];
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCoffeeOfferId,
          quantity: "1",
          extras: [{ listId: extra.listId, picks }],
          note: "No foam",
        },
      ],
    });
    const before = await db.execute<{
      id: string;
      parent_line_id: string | null;
      unit_price_gross: number;
    }>(sql`
      select id, parent_line_id, cast(unit_price_gross as int) as unit_price_gross
      from working_order_lines
      where working_order_id = ${id} order by line_no`);

    await db.execute(sql`
      update menu_items set gross_price = 900 where id = ${premiumCoffeeOfferId}`);
    await db.execute(sql`
      update extra_list_items set price = 400 where list_id = ${extra.listId}`);
    await withTransaction(db, republishMenus);
    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: before.rows[0]!.id,
          menuItemId: premiumCoffeeOfferId,
          quantity: "3",
          extras: [{ listId: extra.listId, picks }],
          note: "No foam",
        },
      ],
    });

    const after = await db.execute<{
      id: string;
      parent_line_id: string | null;
      quantity: string;
      unit_price_gross: number;
      line_total: number;
    }>(sql`
      select id, parent_line_id, cast(quantity as text) as quantity,
             cast(unit_price_gross as int) as unit_price_gross, cast(line_total as int) as line_total
      from working_order_lines
      where working_order_id = ${id} order by line_no`);
    // The quantities are counts of whole thousandths: three dishes, each its own line with its two
    // picks, all at the locked prices (3 × 3.25 + 6 × 0.75, as one line of three was). The first
    // dish keeps its line and its picks' row; the raise adds two more.
    const dish = (id: unknown) => ({
      id,
      parent_line_id: null,
      quantity: "1000",
      unit_price_gross: 325,
      line_total: 325,
    });
    const milk = (id: unknown, parent: string) => ({
      id,
      parent_line_id: parent,
      quantity: "2000",
      unit_price_gross: 75,
      line_total: 150,
    });
    const added = [after.rows[2]!.id, after.rows[4]!.id];
    expect(after.rows).toEqual([
      dish(before.rows[0]!.id),
      milk(before.rows[1]!.id, before.rows[0]!.id),
      dish(added[0]),
      milk(expect.any(String), added[0]!),
      dish(added[1]),
      milk(expect.any(String), added[1]!),
    ]);
    expect(new Set(after.rows.map((row) => row.id)).size).toBe(6);
  });

  // A held-order edit in which every line is quantity-only, and which keeps a line at its stored
  // quantity or lowers it, keeps the line as rung even when its dish or an extra has since become
  // Inactive or Unavailable (spec 2026-09-20 §10: existing work is not cancelled). RAISING the
  // quantity sells more of it, so the dish and every extra the line carries must then be Active and
  // Available, and the edit is refused with the code a new order naming them gets.
  async function readLines(id: string) {
    return (
      await db.execute<{
        id: string;
        parent_line_id: string | null;
        quantity: string;
        unit_price_gross: number;
        line_total: number;
      }>(sql`
        select id, parent_line_id, cast(quantity as text) as quantity,
               cast(unit_price_gross as int) as unit_price_gross, cast(line_total as int) as line_total
        from working_order_lines where working_order_id = ${id} order by line_no`)
    ).rows;
  }

  async function parkWithExtra(quantity: string) {
    const venue = await setupVenue();
    const { cfg, zoneId, coffeeId, premiumCoffeeOfferId } = venue;
    const extra = await withTransaction(db, async (tx) => {
      const attached = await addExtraList(tx, coffeeId, "Milk", {
        price: "0.75",
        maxQuantity: 2,
        maxPicks: 2,
      });

      await republishMenus(tx);
      return attached;
    });
    const id = randomUUID();
    const extras = [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] }];
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity, extras }],
    });
    return { ...venue, extra, extras, id, before: await readLines(id) };
  }

  it("refuses a smaller measured extra portion in a whole-basket save", async () => {
    const { cfg, premiumCoffeeOfferId, id, extra, before } = await parkWithExtra("1");
    await withTransaction(db, (tx) => createStation(tx, { name: "Kitchen", isDefault: true }));
    await db
      .update(workingOrderLines)
      .set({ sentAt: "2026-11-11T10:00:00.000Z", quantity: 300, priceQuantity: 150 })
      .where(eq(workingOrderLines.id, before[1]!.id));
    const stored = await readLines(id);
    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            menuItemId: premiumCoffeeOfferId,
            quantity: "1",
            extras: [
              { listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "ticket.already_sent" });
    expect(await readLines(id)).toEqual(stored);
  });

  it("keeps a sent extra when the whole basket would omit it", async () => {
    const { cfg, premiumCoffeeOfferId, id, before } = await parkWithExtra("1");
    await db
      .update(workingOrderLines)
      .set({ sentAt: "2026-11-11T10:00:00.000Z" })
      .where(eq(workingOrderLines.id, before[1]!.id));
    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            menuItemId: premiumCoffeeOfferId,
            quantity: "1",
            extras: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "ticket.already_sent" });
    expect(await readLines(id)).toEqual(before);
  });

  it("keeps an unchanged or lowered quantity on a line whose extra has since become Unavailable, and refuses a new pick of it", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId, extra, extras, id, before } =
      await parkWithExtra("2");
    await withTransaction(db, (tx) =>
      menu.updateProduct(tx, extra.productId, { available: false }),
    );
    const dishes = before.filter((line) => line.parent_line_id === null).map((line) => line.id);
    const edit = async (quantity: string) =>
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: heldRow(dishes, quantity, { menuItemId: premiumCoffeeOfferId, extras }),
      });

    await edit("2");
    expect(await readLines(id)).toEqual(before);

    await edit("1");
    // The same two rows at the locked prices, now one dish and its one pick.
    expect(await readLines(id)).toEqual([
      { ...before[0]!, quantity: "1000", line_total: 325 },
      { ...before[1]!, quantity: "1000", line_total: 75 },
    ]);

    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1", extras }],
      }),
    ).rejects.toMatchObject({ code: "extras.invalid", params: { field: "productId" } });
  });

  it("refuses raising the quantity of a line whose extra has since become Unavailable, leaving it as parked", async () => {
    const { cfg, premiumCoffeeOfferId, extra, extras, id, before } = await parkWithExtra("1");
    await withTransaction(db, (tx) =>
      menu.updateProduct(tx, extra.productId, { available: false }),
    );

    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            menuItemId: premiumCoffeeOfferId,
            quantity: "2",
            extras,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "extras.invalid", params: { field: "productId" } });
    expect(await readLines(id)).toEqual(before);
  });

  it.each([
    ["Unavailable", { available: false }],
    ["Archived", { active: false }],
  ])(
    "refuses raising the quantity of an offer line whose dish is %s, and keeps an unchanged one",
    async (_state, patch) => {
      const { cfg, coffeeId, premiumCoffeeOfferId, extras, id, before } = await parkWithExtra("1");
      await withTransaction(db, (tx) =>
        tx.update(products).set(patch).where(eq(products.id, coffeeId)),
      );
      const edit = async (quantity: string) =>
        updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
          revision: await revisionOf(id),
          lines: [
            {
              workingOrderLineId: before[0]!.id,
              menuItemId: premiumCoffeeOfferId,
              quantity,
              extras,
            },
          ],
        });

      await expect(edit("2")).rejects.toMatchObject({
        code: "product.unavailable",
        params: { productId: coffeeId },
      });
      expect(await readLines(id)).toEqual(before);
      await edit("1");
      expect(await readLines(id)).toEqual(before);
    },
  );

  it("refuses raising the quantity of a plain offer line whose product is Unavailable", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    const before = await readLines(id);
    await withTransaction(db, (tx) => menu.updateProduct(tx, coffeeId, { available: false }));

    await expect(
      updateProducts(cfg, id, {
        lines: [{ workingOrderLineId: before[0]!.id, productId: coffeeId, quantity: "2" }],
      }),
    ).rejects.toMatchObject({ code: "product.unavailable", params: { productId: coffeeId } });
    expect(await readLines(id)).toEqual(before);
  });

  it("keeps a fired options line as fired when a save sends it back unchanged, its answer worded differently in each language", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      await menu.writeContentLanguages(tx, {
        defaultLanguage: CONTENT_LANGUAGE,
        languages: [CONTENT_LANGUAGE, "ca"],
      });
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const list = await menu.createOptionList(
        tx,
        {
          name: "Cooking list staff",
          customerName: { [CONTENT_LANGUAGE]: "Cooking customer", ca: "CA cooking client" },
          kitchenName: "Cooking list kitchen",
          defaultLabelId: null,
          active: true,
          labels: [
            {
              name: "Rare staff",
              customerName: { [CONTENT_LANGUAGE]: "Rare customer", ca: "CA rare fet client" },
              kitchenName: "Rare kitchen",
              available: true,
            },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "options", id: list.id });
      const options = [{ listId: list.id, labelId: list.labels[0]!.id }];
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [{ productId: coffeeId, quantity: "1", options }]);
      return { tabId, options, offers: await tableOffers(tx) };
    });
    const linesOf = () =>
      db
        .select({ id: workingOrderLines.id, optionSnapshots: workingOrderLines.optionSnapshots })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, seeded.tabId));
    const itemsOf = () =>
      db
        .select({ id: ticketItems.id, firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, seeded.tabId));
    const before = await linesOf();
    const firedBefore = await itemsOf();
    expect(before).toHaveLength(1);
    expect(firedBefore).toHaveLength(1);
    expect(firedBefore[0]!.firedAt).not.toBeNull();
    expect(before[0]!.optionSnapshots).toEqual([
      {
        listId: seeded.options[0]!.listId,
        listName: { [CONTENT_LANGUAGE]: "Cooking list staff" },
        listCustomerName: { [CONTENT_LANGUAGE]: "Cooking customer" },
        listKitchenName: "Cooking list kitchen",
        labelName: { [CONTENT_LANGUAGE]: "Rare staff" },
        labelCustomerName: { [CONTENT_LANGUAGE]: "Rare customer" },
        labelKitchenName: "Rare kitchen",
      },
    ]);

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, seeded.tabId, {
      revision: await revisionOf(seeded.tabId),
      operatorId: OPERATOR,
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: seeded.offers.offerFor(coffeeId),
          quantity: "1",
          options: seeded.options,
        },
      ],
    });

    // The same line, the same fired ticket item, and the same one-entry answer.
    expect(await linesOf()).toEqual(before);
    expect(await itemsOf()).toEqual(firedBefore);
  });

  it.each(["queued", "preparing"] as const)(
    "keeps a %s fired options line, and its answer's Spanish wording, when a save sends it back unchanged after the default content language became Catalan",
    async (state) => {
      const { cfg, coffeeId } = await setupVenue();
      const seeded = await withTransaction(db, async (tx) => {
        await menu.writeContentLanguages(tx, {
          defaultLanguage: CONTENT_LANGUAGE,
          languages: [CONTENT_LANGUAGE, "ca"],
        });
        await createStation(tx, { name: "Kitchen", isDefault: true });
        const list = await menu.createOptionList(
          tx,
          {
            name: "Cooking list staff",
            customerName: { [CONTENT_LANGUAGE]: "Cooking customer", ca: "CA cooking client" },
            kitchenName: "Cooking list kitchen",
            defaultLabelId: null,
            active: true,
            labels: [
              {
                name: "Rare staff",
                customerName: {
                  [CONTENT_LANGUAGE]: "Rare customer",
                  ca: "CA rare fet client",
                },
                kitchenName: "Rare kitchen",
                available: true,
              },
            ],
          },
          LOCALE,
        );
        await attachModifierList(tx, coffeeId, { kind: "options", id: list.id });
        const options = [{ listId: list.id, labelId: list.labels[0]!.id }];
        const tableId = await makeTable(tx);
        const { tabId } = await openPartyTab(tx, cfg, { tableId });
        await addRound(tx, cfg, tabId, [{ productId: coffeeId, quantity: "1", options }]);
        return { tabId, options, offers: await tableOffers(tx) };
      });
      const linesOf = () =>
        db
          .select({
            id: workingOrderLines.id,
            optionSnapshots: workingOrderLines.optionSnapshots,
            descriptions: workingOrderLines.descriptions,
            unitName: workingOrderLines.unitName,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, seeded.tabId));
      const itemsOf = () =>
        db
          .select({ id: ticketItems.id, firedAt: ticketItems.firedAt, state: ticketItems.state })
          .from(ticketItems)
          .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
          .where(eq(workingOrderLines.workingOrderId, seeded.tabId));
      if (state === "preparing") {
        const [item] = await itemsOf();
        await withTransaction(db, (tx) => advanceTicketItem(tx, item!.id, "preparing"));
      }
      const before = await linesOf();
      const firedBefore = await itemsOf();
      expect(before).toHaveLength(1);
      expect(firedBefore).toEqual([expect.objectContaining({ state })]);
      expect(firedBefore[0]!.firedAt).not.toBeNull();
      expect(before[0]!.optionSnapshots).toEqual([
        {
          listId: seeded.options[0]!.listId,
          listName: { [CONTENT_LANGUAGE]: "Cooking list staff" },
          listCustomerName: { [CONTENT_LANGUAGE]: "Cooking customer" },
          listKitchenName: "Cooking list kitchen",
          labelName: { [CONTENT_LANGUAGE]: "Rare staff" },
          labelCustomerName: { [CONTENT_LANGUAGE]: "Rare customer" },
          labelKitchenName: "Rare kitchen",
        },
      ]);

      // Catalan text for everything the default-language change asks for, then the change itself.
      await withTransaction(db, async (tx) => {
        await tx.execute(sql`update units set name = json_set(name, '$.ca', 'Unitat')`);
        await tx.execute(sql`update sections set names = json_set(names, '$.ca', 'Secció')`);
        await tx.execute(
          sql`update products set customer_name = json_set(customer_name, '$.ca', 'Producte') where customer_name is not null`,
        );
        await menu.writeContentLanguages(tx, {
          defaultLanguage: "ca",
          languages: [CONTENT_LANGUAGE, "ca"],
        });
      });
      expect((await menu.readContentLanguages(db, LOCALE)).defaultLanguage).toBe("ca");

      await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, seeded.tabId, {
        revision: await revisionOf(seeded.tabId),
        operatorId: OPERATOR,
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            menuItemId: seeded.offers.offerFor(coffeeId),
            quantity: "1",
            options: seeded.options,
          },
        ],
      });

      expect(await linesOf()).toEqual(before);
      expect(await itemsOf()).toEqual(firedBefore);
    },
  );

  it.each([
    { renamed: "customer name", column: "customer_name", state: "preparing" },
    { renamed: "kitchen name", column: "kitchen_name", state: "preparing" },
    { renamed: "staff name", column: "name", state: "preparing" },
    { renamed: "kitchen name", column: "kitchen_name", state: "served" },
    { renamed: "customer name", column: "customer_name", state: "queued" },
  ] as const)(
    "saves the whole order around a $state dish whose option's $renamed was renamed, keeping what was sent",
    async ({ column, state }) => {
      const { cfg, coffeeId } = await setupVenue();
      const seeded = await withTransaction(db, async (tx) => {
        await createStation(tx, { name: "Kitchen", isDefault: true });
        const cooking = await addOptionList(tx, coffeeId, "Cooking", ["Rare"]);
        const side = await makeProduct(tx, {});
        const added = await makeProduct(tx, {});
        const options = [{ listId: cooking.listId, labelId: cooking.labelIds[0]! }];
        const tableId = await makeTable(tx);
        const { tabId } = await openPartyTab(tx, cfg, { tableId });
        await addRound(tx, cfg, tabId, [
          { productId: coffeeId, quantity: "1", options },
          { productId: side, quantity: "1", hold: true },
        ]);
        if (state === "served") await serveLine(tx, cfg, tabId, 1);
        return { tabId, side, added, options, labelId: cooking.labelIds[0]! };
      });
      const linesOf = () =>
        db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, seeded.tabId))
          .orderBy(workingOrderLines.lineNo);
      const itemsOf = (lineId: string) =>
        db
          .select({ id: ticketItems.id, state: ticketItems.state, firedAt: ticketItems.firedAt })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, lineId));
      const [dish, side] = await linesOf();
      if (state === "preparing") {
        const [item] = await itemsOf(dish!.id);
        await withTransaction(db, (tx) => advanceTicketItem(tx, item!.id, "preparing"));
      }
      const dishItems = await itemsOf(dish!.id);
      expect(dishItems).toEqual([expect.objectContaining({ firedAt: expect.any(String) })]);
      expect(side!.sentAt).toBeNull();
      const renamedTo =
        column === "customer_name"
          ? sql`json_set(customer_name, ${`$.${CONTENT_LANGUAGE}`}, 'Medium-rare customer')`
          : sql`'Medium-rare'`;
      await withTransaction(db, async (tx) => {
        await tx.execute(
          sql`update option_labels set ${sql.identifier(column)} = ${renamedTo} where id = ${seeded.labelId}`,
        );
        await republishMenus(tx);
      });
      const offers = await withTransaction(db, (tx) => tableOffers(tx));

      await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, seeded.tabId, {
        revision: await revisionOf(seeded.tabId),
        operatorId: OPERATOR,
        label: "Window",
        lines: [
          {
            workingOrderLineId: dish!.id,
            menuItemId: offers.offerFor(coffeeId),
            quantity: "1",
            // The till omits a recorded answer when its staff wording no longer matches.
            ...(column === "name" ? {} : { options: seeded.options }),
          },
          {
            workingOrderLineId: side!.id,
            menuItemId: offers.offerFor(seeded.side),
            quantity: "1",
            note: "No salt",
          },
          { menuItemId: offers.offerFor(seeded.added), quantity: "1" },
        ],
      });

      const after = await linesOf();
      expect(after[0]).toEqual(dish);
      expect(after[0]!.optionSnapshots).toEqual(dish!.optionSnapshots);
      expect(await itemsOf(dish!.id)).toEqual(dishItems);
      expect(after.find((line) => line.id === side!.id)!.note).toBe("No salt");
      expect(after.filter((line) => line.productId === seeded.added)).toHaveLength(1);
      const [order] = await db
        .select({ label: workingOrders.label })
        .from(workingOrders)
        .where(eq(workingOrders.id, seeded.tabId));
      expect(order!.label).toBe("Window");
    },
  );

  /** A table order holding a dish answered "Rare" from a two-option list; `hold` keeps it unfired. */
  async function seedAnsweredDish(hold: boolean) {
    const { cfg, coffeeId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const cooking = await addOptionList(tx, coffeeId, "Cooking", ["Rare", "Well done"]);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [
        {
          productId: coffeeId,
          quantity: "1",
          options: [{ listId: cooking.listId, labelId: cooking.labelIds[0]! }],
          ...(hold ? { hold: true } : {}),
        },
      ]);
      return { tabId, cooking };
    });
    const [dish] = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, seeded.tabId));
    const items = () =>
      db
        .select({ id: ticketItems.id, firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, dish!.id));
    return { cfg, coffeeId, ...seeded, dish: dish!, items };
  }

  it("saves a different answer picked for a fired, not-started dish by recalling and resending it", async () => {
    const { cfg, coffeeId, tabId, cooking, dish, items } = await seedAnsweredDish(false);
    const [fired] = await items();
    expect(fired!.firedAt).not.toBeNull();
    const offers = await withTransaction(db, (tx) => tableOffers(tx));

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, tabId, {
      revision: await revisionOf(tabId),
      operatorId: OPERATOR,
      lines: [
        {
          workingOrderLineId: dish.id,
          menuItemId: offers.offerFor(coffeeId),
          quantity: "1",
          options: [{ listId: cooking.listId, labelId: cooking.labelIds[1]! }],
        },
      ],
    });

    const resent = await items();
    expect(resent).toEqual([{ id: expect.any(String), firedAt: expect.any(String) }]);
    expect(resent[0]!.id).not.toBe(fired!.id);
    const [after] = await db
      .select({ optionSnapshots: workingOrderLines.optionSnapshots })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, dish.id));
    expect(after!.optionSnapshots).toEqual([
      expect.objectContaining({ labelKitchenName: "Well done kitchen" }),
    ]);
  });

  it.each([
    { renamed: "nothing", column: null },
    { renamed: "the customer name", column: "customer_name" },
  ] as const)(
    "refuses a different answer picked for a started dish when $renamed was renamed",
    async ({ column }) => {
      const { cfg, coffeeId, tabId, cooking, dish, items } = await seedAnsweredDish(false);
      const [item] = await items();
      await withTransaction(db, (tx) => advanceTicketItem(tx, item!.id, "preparing"));
      if (column !== null)
        await withTransaction(db, async (tx) => {
          await tx.execute(
            sql`update option_labels set ${sql.identifier(column)} = json_set(customer_name, ${`$.${CONTENT_LANGUAGE}`}, 'Renamed') where id = ${cooking.labelIds[0]!}`,
          );
          await republishMenus(tx);
        });
      const offers = await withTransaction(db, (tx) => tableOffers(tx));

      await expect(
        updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, tabId, {
          revision: await revisionOf(tabId),
          operatorId: OPERATOR,
          lines: [
            {
              workingOrderLineId: dish.id,
              menuItemId: offers.offerFor(coffeeId),
              quantity: "1",
              options: [{ listId: cooking.listId, labelId: cooking.labelIds[1]! }],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "ticket.already_started" });
      const [after] = await db
        .select({ optionSnapshots: workingOrderLines.optionSnapshots })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, dish.id));
      expect(after!.optionSnapshots).toEqual(dish.optionSnapshots);
    },
  );

  it("keeps a held dish's answer, not yet fired, from an options list whose staff name was renamed", async () => {
    const { cfg, coffeeId, tabId, cooking, dish, items } = await seedAnsweredDish(true);
    expect(dish.sentAt).toBeNull();
    const held = await items();
    expect(held).toEqual([{ id: expect.any(String), firedAt: null }]);
    await withTransaction(db, async (tx) => {
      await tx.execute(
        sql`update option_labels set name = 'Medium-rare' where id = ${cooking.labelIds[0]!}`,
      );
      await republishMenus(tx);
    });
    const offers = await withTransaction(db, (tx) => tableOffers(tx));
    const revision = await revisionOf(tabId);

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, tabId, {
      revision,
      operatorId: OPERATOR,
      // The till omits a recorded answer when its staff wording no longer matches.
      lines: [
        { workingOrderLineId: dish.id, menuItemId: offers.offerFor(coffeeId), quantity: "1" },
      ],
    });

    const [after] = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, dish.id));
    expect(after).toEqual(dish);
    expect(await items()).toEqual(held);
    expect(await revisionOf(tabId)).toBe(revision);
  });

  it("keeps a sent dish's answer from an options list deleted since", async () => {
    const { cfg, coffeeId, tabId, cooking, dish } = await seedAnsweredDish(false);
    await withTransaction(db, async (tx) => {
      await menu.deleteOptionList(tx, cooking.listId);
      await republishMenus(tx);
    });
    const offers = await withTransaction(db, (tx) => tableOffers(tx));

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, tabId, {
      revision: await revisionOf(tabId),
      operatorId: OPERATOR,
      label: "Window",
      lines: [
        { workingOrderLineId: dish.id, menuItemId: offers.offerFor(coffeeId), quantity: "1" },
      ],
    });

    const [after] = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, dish.id));
    expect(after).toEqual(dish);
  });

  it.each(["dish", "variant", "extras item"] as const)(
    "refuses adding an archived %s and paying its unsent line while it remains available",
    async (kind) => {
      const extraVenue = kind === "extras item" ? await parkWithExtra("1") : null;
      const venue = extraVenue ?? (await setupVenue());
      const { cfg, zoneId, menuId, coffeeId, premiumCoffeeOfferId } = venue;
      let productId = coffeeId;
      let line: {
        menuItemId: string;
        quantity: string;
        variantId?: string;
        extras?: ExtraSelection[];
      } = {
        menuItemId: premiumCoffeeOfferId,
        quantity: "1",
      };
      let id = randomUUID();
      if (kind === "variant") {
        const offer = await withTransaction(db, (tx) => seedVariantOffer(tx, menuId));
        productId = offer.variantId;
        line = { menuItemId: offer.offerId, variantId: offer.variantId, quantity: "1" };
      }
      if (extraVenue) {
        productId = extraVenue.extra.productId;
        line.extras = extraVenue.extras;
        id = extraVenue.id;
      } else {
        await parkOrder({ db }, cfg, { id, zoneId, lines: [line] });
      }
      const before = await readLines(id);
      await db.update(products).set({ active: false }).where(eq(products.id, productId));
      expect(
        (
          await db
            .select({ active: products.active, available: products.available })
            .from(products)
            .where(eq(products.id, productId))
        )[0],
      ).toEqual({ active: false, available: true });
      const addError = (await captureError(() =>
        parkOrder({ db }, cfg, {
          id: randomUUID(),
          zoneId,
          lines: [line],
        }),
      )) as { code: string; params: unknown };
      expect(addError.code).toBe(
        kind === "variant"
          ? "product.variant_unavailable"
          : kind === "extras item"
            ? "extras.invalid"
            : "product.unavailable",
      );
      expect(addError.params).toEqual(
        kind === "variant"
          ? { variantId: productId }
          : kind === "extras item"
            ? { field: "productId" }
            : { productId },
      );
      const paymentError = (await captureError(() =>
        withTransaction(db, (tx) => priceStoredOrderForIssuance(tx, id)),
      )) as { code: string; params: unknown };
      expect(paymentError.code).toBe("product.unavailable");
      expect(paymentError.params).toEqual({ productId });
      expect(await readLines(id)).toEqual(before);
    },
  );

  it("refuses a new line for a product not sold separately, and keeps the line already held", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    const before = await readLines(id);
    await withTransaction(db, (tx) =>
      menu.updateProduct(tx, coffeeId, { ordering: "not_sold_separately" }),
    );

    await expect(
      updateProducts(cfg, id, {
        lines: [
          { workingOrderLineId: before[0]!.id, productId: coffeeId, quantity: "1" },
          { productId: coffeeId, quantity: "1" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "product.not_sold_separately",
      params: { productId: coffeeId },
    });
    expect(await readLines(id)).toEqual(before);
    await updateProducts(cfg, id, {
      lines: [
        { workingOrderLineId: before[0]!.id, productId: coffeeId, quantity: "1" },
        { productId: waterId, quantity: "1" },
      ],
    });
    const after = await readLines(id);
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
  });

  it("adds an extra to a held dish a publish made not sold separately, and refuses raising the dish", async () => {
    const { cfg, coffeeId, premiumCoffeeOfferId, extra, id, before } = await parkWithExtra("1");
    await withTransaction(db, async (tx) => {
      await menu.updateProduct(tx, coffeeId, { ordering: "not_sold_separately" });
      await republishMenus(tx);
    });
    const edit = async (dishes: string, picks: number) =>
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            menuItemId: premiumCoffeeOfferId,
            quantity: dishes,
            extras: [
              { listId: extra.listId, picks: [{ productId: extra.productId, quantity: picks }] },
            ],
          },
        ],
      });

    await expect(edit("2", 1)).rejects.toMatchObject({
      code: "product.not_sold_separately",
      params: { productId: coffeeId },
    });
    expect(await readLines(id)).toEqual(before);

    await edit("1", 2);
    const after = await readLines(id);
    expect(after[0]).toEqual(before[0]);
    expect(after.slice(1)).toEqual([
      expect.objectContaining({ parent_line_id: before[0]!.id, quantity: "2000", line_total: 150 }),
    ]);
  });

  it("keeps a raised quantity on a sellable line beside an unchanged line whose extra is sold out", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId, extra, extras } = await parkWithExtra("1");
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: premiumCoffeeOfferId, quantity: "1", extras },
        { menuItemId: premiumCoffeeOfferId, quantity: "1" },
      ],
    });
    const before = await readLines(id);
    await withTransaction(db, (tx) =>
      menu.updateProduct(tx, extra.productId, { available: false }),
    );
    await db.execute(sql`
      update menu_items set gross_price = 900 where id = ${premiumCoffeeOfferId}`);

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: premiumCoffeeOfferId,
          quantity: "1",
          extras,
        },
        { workingOrderLineId: before[2]!.id, menuItemId: premiumCoffeeOfferId, quantity: "2" },
      ],
    });

    // Same ids at the locked price: the plain dish keeps its line, and the raise adds a second
    // dish at 3.25, not re-priced at 9.00.
    const after = await readLines(id);
    expect(after).toEqual([
      before[0],
      before[1],
      before[2],
      { ...before[2]!, id: expect.any(String) },
    ]);
    expect(after[3]!.id).not.toBe(before[2]!.id);
  });

  // A JSON body can carry a `productId` the line types no longer declare. Beside a valid offer it is
  // refused, on a new line and on an otherwise quantity-only edit of a stored one alike.
  it("refuses a line naming a product beside its offer, parked or edited", async () => {
    const { cfg, zoneId, coffeeId, coffeeOfferId } = await setupVenue();
    const wireLine = (fields: object) => fields as { menuItemId: string; quantity: string };
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [wireLine({ menuItemId: coffeeOfferId, productId: coffeeId, quantity: "1" })],
      }),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "lines" },
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: coffeeOfferId, quantity: "1" }],
    });
    const [stored] = await db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [
          {
            ...wireLine({ menuItemId: coffeeOfferId, productId: coffeeId, quantity: "2" }),
            workingOrderLineId: stored!.id,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "lines" },
    });
  });

  it("keeps a quantity-only offer edit on the original line id and locked price", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });
    const before = await db.execute<{ id: string }>(sql`
      select id from working_order_lines
      where working_order_id = ${id}`);
    const lineId = before.rows[0]!.id;

    await db.execute(sql`
      update menu_items set gross_price = 900 where id = ${premiumCoffeeOfferId}`);
    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: lineId,
          menuItemId: premiumCoffeeOfferId,
          quantity: "2",
        },
      ],
    });

    const after = await db.execute<{
      id: string;
      quantity: string;
      unit_price_gross: number;
      line_total: number;
    }>(sql`
      select id, cast(quantity as text) as quantity, cast(unit_price_gross as int) as unit_price_gross,
             cast(line_total as int) as line_total
      from working_order_lines
      where working_order_id = ${id} order by line_no`);
    // Two dishes, each one unit as a count of whole thousandths, both at the locked price: the
    // first keeps its line, the raise adds the second.
    const coffee = { quantity: "1000", unit_price_gross: 325, line_total: 325 };
    expect(after.rows).toEqual([
      { id: lineId, ...coffee },
      { id: expect.any(String), ...coffee },
    ]);
    expect(after.rows[1]!.id).not.toBe(lineId);
  });

  it("keeps a new variant sent for a saved, unsent line, at that variant's price and name", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const seeded = await withTransaction(db, (tx) => seedVariantOffer(tx, menuId));
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: seeded.offerId, variantId: seeded.variantId, quantity: "1" }],
    });
    const read = () =>
      db.execute<{
        id: string;
        product_id: string;
        variant_name: string | null;
        unit_price_gross: number;
      }>(sql`
        select id, product_id, variant_name, cast(unit_price_gross as int) as unit_price_gross
        from working_order_lines where working_order_id = ${id} order by line_no`);
    const lineId = (await read()).rows[0]!.id;

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: lineId,
          menuItemId: seeded.offerId,
          variantId: seeded.smallVariantId,
          quantity: "1",
        },
      ],
    });

    const after = (await read()).rows;
    expect(after).toEqual([
      {
        id: expect.any(String),
        product_id: seeded.smallVariantId,
        variant_name: "Small",
        unit_price_gross: 220,
      },
    ]);
    expect(after[0]!.id).not.toBe(lineId);
  });

  it("keeps a saved, unsent line on its variant that has since become Unavailable when only its note or answer changes, and refuses a raise of it, an added extra and a switch to an Unavailable variant", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const { seeded, extra, served } = await withTransaction(db, async (tx) => {
      const variantOffer = await seedVariantOffer(tx, menuId);
      const attached = await addExtraList(tx, variantOffer.productId, "Syrup", { price: "0.50" });
      const asked = await addOptionList(tx, variantOffer.productId, "Served", ["Hot", "Iced"]);
      await republishMenus(tx);
      return { seeded: variantOffer, extra: attached, served: asked };
    });
    const answer = (labelId: string) => [{ listId: served.listId, labelId }];
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: seeded.offerId,
          variantId: seeded.variantId,
          quantity: "1",
          options: answer(served.labelIds[0]!),
        },
      ],
    });
    const read = () =>
      db.execute<{
        id: string;
        product_id: string;
        variant_name: string | null;
        unit_price_gross: number;
        note: string | null;
        answered: string;
      }>(sql`
        select id, product_id, variant_name, cast(unit_price_gross as int) as unit_price_gross, note,
          option_snapshots ->> '$[0].labelKitchenName' as answered
        from working_order_lines where working_order_id = ${id} order by line_no`);
    const parked = (await read()).rows[0]!;
    expect(parked.answered).toBe("Hot kitchen");
    const lineId = parked.id;
    await withTransaction(db, async (tx) => {
      await menu.updateProduct(tx, seeded.variantId, { available: false });
      await menu.updateProduct(tx, seeded.smallVariantId, { available: false });
    });

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: lineId,
          menuItemId: seeded.offerId,
          variantId: seeded.variantId,
          quantity: "1",
          note: "No foam",
          options: answer(served.labelIds[1]!),
        },
      ],
    });

    const kept = (await read()).rows;
    expect(kept).toEqual([
      {
        id: lineId,
        product_id: seeded.variantId,
        variant_name: "Large",
        unit_price_gross: 320,
        note: "No foam",
        answered: "Iced kitchen",
      },
    ]);

    const edit = async (change: {
      variantId?: string;
      quantity?: string;
      extras?: { listId: string; picks: { productId: string; quantity: number }[] }[];
    }) =>
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [
          {
            workingOrderLineId: lineId,
            menuItemId: seeded.offerId,
            variantId: seeded.variantId,
            quantity: "1",
            note: "No foam",
            options: answer(served.labelIds[1]!),
            ...change,
          },
        ],
      });

    await expect(edit({ quantity: "2" })).rejects.toMatchObject({
      code: "product.variant_unavailable",
      params: { variantId: seeded.variantId },
    });
    expect((await read()).rows).toEqual(kept);

    await expect(
      edit({
        extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] }],
      }),
    ).rejects.toMatchObject({
      code: "product.variant_unavailable",
      params: { variantId: seeded.variantId },
    });
    expect((await read()).rows).toEqual(kept);

    await expect(edit({ variantId: seeded.smallVariantId })).rejects.toMatchObject({
      code: "product.variant_unavailable",
      params: { variantId: seeded.smallVariantId },
    });
    expect((await read()).rows).toEqual(kept);
  });

  it("with two portions saved on a variant that has since become Unavailable, refuses a lowered extra, and keeps dropping one portion or removing an extra", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const { seeded, extra } = await withTransaction(db, async (tx) => {
      const variantOffer = await seedVariantOffer(tx, menuId);
      const attached = await addExtraList(tx, variantOffer.productId, "Syrup", {
        price: "0.50",
        maxQuantity: 3,
      });
      await republishMenus(tx);
      return { seeded: variantOffer, extra: attached };
    });
    const id = randomUUID();
    const syrup = (quantity: number) => [
      { listId: extra.listId, picks: [{ productId: extra.productId, quantity }] },
    ];
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: seeded.offerId,
          variantId: seeded.variantId,
          quantity: "2",
          extras: syrup(2),
        },
      ],
    });
    const held = await getHeldOrder({ db }, id);
    expect(held.lines.map((line) => [line.quantity, line.extras?.[0]?.quantity])).toEqual([
      ["1.000", 2],
      ["1.000", 2],
    ]);
    await withTransaction(db, async (tx) => {
      await menu.updateProduct(tx, seeded.variantId, { available: false });
    });
    const dishes = () =>
      db.execute<{ id: string; product_id: string }>(sql`
        select id, product_id from working_order_lines
        where working_order_id = ${id} and parent_line_id is null order by line_no`);
    const extrasNow = () =>
      db.execute<{ quantity: number }>(sql`
        select cast(quantity as int) as quantity from working_order_lines
        where working_order_id = ${id} and parent_line_id is not null order by line_no`);
    const edit = async (lines: { lineId: string; extras: ExtraSelection[] }[]) =>
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: lines.map(({ lineId, extras }) => ({
          workingOrderLineId: lineId,
          menuItemId: seeded.offerId,
          variantId: seeded.variantId,
          quantity: "1",
          extras,
        })),
      });
    const [first, second] = held.lines.map((line) => line.workingOrderLineId);

    await expect(
      edit([
        { lineId: first!, extras: syrup(1) },
        { lineId: second!, extras: syrup(1) },
      ]),
    ).rejects.toMatchObject({
      code: "product.variant_unavailable",
      params: { variantId: seeded.variantId },
    });
    expect((await extrasNow()).rows).toEqual([{ quantity: 2000 }, { quantity: 2000 }]);

    await expect(edit([{ lineId: second!, extras: syrup(2) }])).resolves.toBeDefined();
    expect((await dishes()).rows).toEqual([{ id: second!, product_id: seeded.variantId }]);
    expect((await extrasNow()).rows).toEqual([{ quantity: 2000 }]);

    await expect(edit([{ lineId: second!, extras: [] }])).resolves.toBeDefined();
    expect((await dishes()).rows).toEqual([{ id: second!, product_id: seeded.variantId }]);
    expect((await extrasNow()).rows).toEqual([]);
  });

  it("replaces an offer line using the order's stored zone and refreshes its attribution", async () => {
    const { cfg, zoneId, premiumCoffeeOfferId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "1" }],
    });

    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [{ menuItemId: premiumCoffeeOfferId, quantity: "2" }],
    });

    const line = await db.execute<{
      quantity: string;
      unit_price_gross: number;
      menu_item_id: string;
    }>(sql`
      select cast(quantity as text) as quantity, cast(unit_price_gross as int) as unit_price_gross,
             menu_item_id
      from working_order_lines where working_order_id = ${id} order by line_no`);
    // Two dishes, each one unit as a count of whole thousandths.
    const coffee = { quantity: "1000", unit_price_gross: 325, menu_item_id: premiumCoffeeOfferId };
    expect(line.rows).toEqual([coffee, coffee]);
  });

  it("replaces the lines, re-prices the total and updates the label, leaving the order row otherwise unchanged", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "2" }],
      label: "Table 4",
    });
    const [beforeSummary] = await listHeldOrders({ db });

    // A fresh basket in a deliberately different order (water first) — proving the per-line product_id
    // zip is re-applied, the new lines are numbered after the parked line's (plan D10: a number is
    // never reused within an order), and the total is re-priced authoritatively.
    const newLines = [
      { productId: waterId, quantity: "1" },
      { productId: coffeeId, quantity: "1" },
    ];
    await updateProducts(cfg, id, { lines: newLines, label: "Table 7" });

    // order_number / node_id / origin are untouched; only the label changed and the
    // status stays open (the update ran over the enforce_transition trigger, not around it).
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo).toMatchObject({
      status: "open",
      label: "Table 7",
      orderNumber: 1,
      nodeId: cfg.nodeId,
      source: "device",
      deviceId: cfg.origin.deviceId,
      settledAt: null,
    });

    // The two old espresso lines are gone; the two new lines carry the new products, numbered after them.
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ lineNo: 3, productId: waterId });
    expect(lines[1]).toMatchObject({ lineNo: 4, productId: coffeeId });

    // Re-priced: the new total differs from the parked one AND equals the GROSS basket total for the
    // replaced lines (`priceBasket(newLines, "2026-09-27").total`, computed independently of the persisted column) —
    // water 2.00 + coffee 1.50 = 3.50 gross, where the parked coffee×2 was 3.00. Asserting against the
    // gross pricer (not the summed line_total column) is what fails if the held total reverts to net.
    const grossAfter = await grossBasketTotal(newLines);
    expect(grossAfter).toBe("3.50");
    const [afterSummary] = await listHeldOrders({ db });
    expect(afterSummary!.counts.ordered).toBe(
      newLines.reduce((sum, line) => sum + Number(line.quantity), 0),
    );
    expect(afterSummary!.total).not.toBe(beforeSummary!.total);
    expect(afterSummary!.total).toBe(grossAfter);
  });

  it("clears the label to null when the update omits one — the whole request is the new state", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "1" }],
      label: "Table 4",
    });

    // No label on the update: a label is part of the order's state, so omitting it clears the
    // parked "Table 4" rather than leaving it in place.
    await updateProducts(cfg, id, { lines: [{ productId: waterId, quantity: "1" }] });

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.label).toBeNull();
  });

  it("refuses an empty basket (sale.empty_basket) and an offer the zone does not hold (service_zone.offer_not_allowed), leaving the parked lines untouched", async () => {
    const { cfg, coffeeId, zoneId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "2" }],
      label: "Table 4",
    });
    const before = await readOrder(id);
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [],
      }),
    ).rejects.toMatchObject({
      code: "sale.empty_basket",
    });
    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [{ menuItemId: UUID_NOT_IN_CAT, quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "service_zone.offer_not_allowed",
      params: { zoneId, menuItemId: UUID_NOT_IN_CAT },
    });

    // Both refusals happen before any line is deleted, so the parked order still holds its two
    // original espresso lines unchanged.
    const after = await readOrder(id);
    expect(after.lineTotals).toEqual(before.lineTotals);
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(
      lines.map(({ productId, lineNo, quantity }) => ({ productId, lineNo, quantity })),
    ).toEqual([
      { productId: coffeeId, lineNo: 1, quantity: 1000 },
      { productId: coffeeId, lineNo: 2, quantity: 1000 },
    ]);
  });

  it("throws working_order.not_open on a settled order — a closed order can no longer be edited", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(
      updateProducts(cfg, id, { lines: [{ productId: coffeeId, quantity: "2" }] }),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });
  });

  it("throws working_order.not_open for an absent id", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const missing = randomUUID();

    await expect(
      updateProducts(cfg, missing, { lines: [{ productId: coffeeId, quantity: "1" }] }),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: missing },
    });
  });

  it("refuses a save made from a copy another save has since changed, changing nothing", async () => {
    // Spec §10.7 example 2: two tills open the same held order, and each changes it and saves.
    const { cfg, coffeeId } = await setupVenue();
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1" }] });
    const copy = await getHeldOrder({ db }, id);
    const line = copy.lines[0]!.workingOrderLineId!;

    await updateProducts(cfg, id, {
      revision: copy.revision,
      lines: [{ workingOrderLineId: line, productId: coffeeId, quantity: "1", note: "first" }],
    });
    const landed = await readOrder(id);
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));

    await expect(
      updateProducts(cfg, id, {
        revision: copy.revision,
        label: "Table 9",
        lines: [{ workingOrderLineId: line, productId: coffeeId, quantity: "2", note: "second" }],
      }),
    ).rejects.toMatchObject({
      code: "working_order.out_of_date",
      params: { workingOrderId: id, revision: copy.revision + 1 },
    });
    expect(await readOrder(id)).toEqual(landed);
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual(lines);
    const [order] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(order!.label).toBeNull();
    // A fresh copy carries the revision the first save left.
    expect((await getHeldOrder({ db }, id)).revision).toBe(copy.revision + 1);
  });

  it("edits an open order from ANOTHER node of the same taxpayer — reads are venue-wide", async () => {
    const { cfg, coffeeId, zoneId } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);
    // An edit prices from the order's own zone, which a raw order row does not carry.
    await withTransaction(db, (tx) => VENUE_SERVICE.recordOrderContext(tx, foreign, zoneId));

    // The foreign-node order is edited like the node's own: the whole-basket replacement lands.
    await expect(
      updateProducts(cfg, foreign, { lines: [{ productId: coffeeId, quantity: "1" }] }),
    ).resolves.toBe(1);
    const after = await getHeldOrder({ db }, foreign);
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]!.productId).toBe(coffeeId);
    expect(Number(after.lines[0]!.quantity)).toBe(1);
  });
});

describe("basket-wide modifier resolution (perf)", () => {
  afterEach(() => vi.restoreAllMocks());

  // CLAUDE.md §3: shared menu data is resolved ONCE before the line loop, never per line. The
  // two THREE-LINE baskets below — the same dish twice, then a second dish — are what can see that:
  // a read moved inside the loop runs three times instead of once. Behaviour alone cannot tell the
  // two apart, so the reads are spied on.

  it("reads each definition once for a basket of offers priced at their products' prices", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      await addExtraList(tx, coffeeId, "Bacon");
      const coffeeOptions = await addOptionList(tx, coffeeId, "Cooking");
      await addExtraList(tx, waterId, "Hielo");
      const waterOptions = await addOptionList(tx, waterId, "Tamano");
      return { coffeeOptions, waterOptions };
    });
    const offers = await counterOffers();
    const listOffers = vi.spyOn(VENUE_SERVICE, "listZoneOffers");

    await parkProducts(cfg, {
      id: randomUUID(),
      lines: [
        {
          productId: coffeeId,
          quantity: "1",
          options: [
            { listId: seeded.coffeeOptions.listId, labelId: seeded.coffeeOptions.labelIds[0]! },
          ],
        },
        {
          productId: coffeeId,
          quantity: "2",
          options: [
            { listId: seeded.coffeeOptions.listId, labelId: seeded.coffeeOptions.labelIds[0]! },
          ],
        },
        {
          productId: waterId,
          quantity: "1",
          options: [
            { listId: seeded.waterOptions.listId, labelId: seeded.waterOptions.labelIds[0]! },
          ],
        },
      ],
    });

    expect(listOffers).toHaveBeenCalledTimes(1);
    expect(listOffers.mock.calls[0]![1]).toBe(offers.zoneId);
  });

  it("resolves the menu once for a note edit of a stored line", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      await addExtraList(tx, coffeeId, "Bacon");
      return addOptionList(tx, coffeeId, "Cooking");
    });
    const answer = { listId: seeded.listId, labelId: seeded.labelIds[0]! };
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "1", options: [answer], note: "No salt" }],
    });
    const held = await getHeldOrder({ db }, id);

    const contentLanguages = vi.spyOn(menu, "readContentLanguages");
    const listOffers = vi.spyOn(VENUE_SERVICE, "listZoneOffers");

    // A changed note is an edit of the stored line, which prices nothing: the zone's offers are read
    // once, for the answers the edit is checked against.
    await updateProducts(cfg, id, {
      lines: [
        {
          workingOrderLineId: held.lines[0]!.workingOrderLineId,
          productId: coffeeId,
          quantity: "1",
          options: [answer],
          note: "con sal",
        },
      ],
    });

    expect(contentLanguages).toHaveBeenCalledTimes(1);
    expect(listOffers).toHaveBeenCalledTimes(1);

    const stored = await db
      .select({ note: workingOrderLines.note })
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, id), isNull(workingOrderLines.parentLineId)));
    expect(stored).toEqual([{ note: "con sal" }]);
  });

  it("reads the zone's offers once for an edit that re-checks a stored answer and prices a new line", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const cookingOptions = await withTransaction(db, (tx) =>
      addOptionList(tx, coffeeId, "Cooking"),
    );
    const answer = { listId: cookingOptions.listId, labelId: cookingOptions.labelIds[0]! };
    const id = randomUUID();
    await parkProducts(cfg, {
      id,
      lines: [{ productId: coffeeId, quantity: "1", options: [answer] }],
    });
    const held = await getHeldOrder({ db }, id);
    const listOffers = vi.spyOn(VENUE_SERVICE, "listZoneOffers");

    await updateProducts(cfg, id, {
      lines: [
        {
          workingOrderLineId: held.lines[0]!.workingOrderLineId,
          productId: coffeeId,
          quantity: "1",
          options: [answer],
        },
        { productId: waterId, quantity: "1" },
      ],
    });

    expect(listOffers).toHaveBeenCalledTimes(1);
    const stored = await db
      .select({ productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(stored).toEqual([{ productId: coffeeId }, { productId: waterId }]);
  });

  it("reads each MENU-side definition once for an offer basket", async () => {
    const { cfg, coffeeId, waterId, menuId, zoneId, coffeeOfferId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const waterOffer = await addProductToMenu(tx, {
        menuId: menuId,
        productId: waterId,
        grossPrice: "2.20",
      });
      await addExtraList(tx, coffeeId, "Bacon");

      const coffeeOptions = await addOptionList(tx, coffeeId, "Cooking");
      const waterOptions = await addOptionList(tx, waterId, "Tamano");
      await republishMenus(tx);
      return { waterOfferId: waterOffer.id, coffeeOptions, waterOptions };
    });
    const listOffers = vi.spyOn(VENUE_SERVICE, "listZoneOffers");

    await parkOrder({ db }, cfg, {
      id: randomUUID(),
      zoneId,
      lines: [
        {
          menuItemId: coffeeOfferId,
          quantity: "1",
          options: [
            { listId: seeded.coffeeOptions.listId, labelId: seeded.coffeeOptions.labelIds[0]! },
          ],
        },
        {
          menuItemId: coffeeOfferId,
          quantity: "2",
          options: [
            { listId: seeded.coffeeOptions.listId, labelId: seeded.coffeeOptions.labelIds[0]! },
          ],
        },
        {
          menuItemId: seeded.waterOfferId,
          quantity: "1",
          options: [
            { listId: seeded.waterOptions.listId, labelId: seeded.waterOptions.labelIds[0]! },
          ],
        },
      ],
    });

    expect(listOffers).toHaveBeenCalledTimes(1);
    expect(listOffers.mock.calls[0]![1]).toBe(zoneId);
  });
});

describe("a variant is sold as the product it is", () => {
  it("writes the variant as the line's product beside the parent's names, priced and taxed from its effective values", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const id = randomUUID();
    const wine = await withTransaction(db, (tx) => seedWine(tx, menuId));
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: wine.offerId, variantId: wine.wine125, quantity: "1" },
        { menuItemId: wine.offerId, variantId: wine.wine175, quantity: "1" },
      ],
    });
    const rows = await db
      .select({
        productId: workingOrderLines.productId,
        name: workingOrderLines.name,
        descriptions: workingOrderLines.descriptions,
        kitchenName: workingOrderLines.kitchenName,
        variantName: workingOrderLines.variantName,
        variantDescriptions: workingOrderLines.variantDescriptions,
        variantKitchenName: workingOrderLines.variantKitchenName,
        unitPriceGross: workingOrderLines.unitPriceGross,
        vatClass: workingOrderLines.vatClass,
        courseId: workingOrderLines.courseId,
        category: workingOrderLines.category,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    const parentNames = {
      name: "Wine by the glass",
      descriptions: { [LOCALE]: "House wine" },
      kitchenName: "WINE",
    };
    expect(rows).toEqual([
      {
        productId: wine.wine125,
        ...parentNames,
        // The variant's OWN raw names: no kitchen name of its own is stored as none, and its
        // customer text falls back to its own staff name, never to the parent's.
        variantName: "125 ml",
        variantDescriptions: { [LOCALE]: "125 ml" },
        variantKitchenName: null,
        unitPriceGross: 450,
        vatClass: "reduced",
        courseId: wine.firstCourseId,
        category: "Wines",
      },
      {
        productId: wine.wine175,
        ...parentNames,
        variantName: "175 ml",
        variantDescriptions: { [LOCALE]: "Large glass" },
        variantKitchenName: "V175",
        unitPriceGross: 550,
        vatClass: "general",
        courseId: wine.secondCourseId,
        category: "Wines",
      },
    ]);
  });

  it("sells a variant in its product's unit, whatever unit the variant still stores", async () => {
    const { cfg, zoneId, menuId, kgUnitId } = await setupVenue();
    const wine = await withTransaction(db, async (tx) => {
      const seeded = await seedWine(tx, menuId);
      // Wine by the glass sells by the each; 175 ml still stores kg, from before a variant always
      // took its product's unit. The menu is published after, so the live menu is built from it.
      await tx.execute(sql`update products set unit_id = ${kgUnitId} where id = ${seeded.wine175}`);
      await publishWorkingMenu(tx, menuId);
      return seeded;
    });
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [{ menuItemId: wine.offerId, variantId: wine.wine175, quantity: "0.5" }],
      }),
    ).rejects.toMatchObject({ code: "quantity.invalid", params: { reason: "precision" } });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: wine.offerId, variantId: wine.wine175, quantity: "2" }],
    });
    const stored = await db
      .select({
        productId: workingOrderLines.productId,
        unitName: workingOrderLines.unitName,
        unitPrecision: workingOrderLines.unitPrecision,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    // A line freezes the unit's abbreviation, in the default content language, as its unit name;
    // each of the two glasses is its own line.
    const glass = {
      productId: wine.wine175,
      unitName: { [CONTENT_LANGUAGE]: EACH_UNIT.abbreviation.es },
      unitPrecision: EACH_UNIT.precision,
    };
    expect(stored).toEqual([glass, glass]);
  });

  it("refuses a parent with Active variants rung up alone, and sells one whose variants are all Inactive as itself", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const wine = await withTransaction(db, (tx) => seedWine(tx, menuId));
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [{ menuItemId: wine.offerId, quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "product.variant_required",
      params: { productId: wine.parentId },
    });

    await withTransaction(db, async (tx) => {
      await tx.update(products).set({ active: false }).where(eq(products.parentId, wine.parentId));
      await publishWorkingMenu(tx, menuId);
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: wine.offerId, quantity: "1" }],
    });
    const rows = await db
      .select({
        productId: workingOrderLines.productId,
        variantName: workingOrderLines.variantName,
        unitPriceGross: workingOrderLines.unitPriceGross,
        vatClass: workingOrderLines.vatClass,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(rows).toEqual([
      { productId: wine.parentId, variantName: null, unitPriceGross: 400, vatClass: "reduced" },
    ]);
  });

  it("refuses an Inactive, Unavailable or other parent's variant", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const refused = await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      const kept = (id: string, name: string, unitPrice: string) => ({
        id,
        name,
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice,
        available: true,
      });
      const fresh = (name: string, available = true) => ({
        name,
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "6.00",
        available,
      });
      const [, , inactive, unavailable] = await setProductVariants(
        tx,
        wine.parentId,
        [
          kept(wine.wine125, "125 ml", "4.50"),
          kept(wine.wine175, "175 ml", "5.50"),
          fresh("250 ml"),
          fresh("Wine 500", false),
        ],
        LOCALE,
      );
      await tx.update(products).set({ active: false }).where(eq(products.id, inactive!.id));
      const cider = await createProduct(tx, {
        categoryId: null,
        name: "Cider",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      const [pint] = await setProductVariants(tx, cider.id, [fresh("Cider pint")], LOCALE);
      return {
        offerId: wine.offerId,
        ids: [inactive!.id, unavailable!.id, pint!.id],
      };
    });
    for (const variantId of refused.ids) {
      await expect(
        parkOrder({ db }, cfg, {
          id: randomUUID(),
          zoneId,
          lines: [{ menuItemId: refused.offerId, variantId, quantity: "1" }],
        }),
      ).rejects.toMatchObject({ code: "product.variant_unavailable", params: { variantId } });
    }
  });

  it("fires variants by their product's category cell, never a stored category of their own", async () => {
    const { cfg, menuId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const barStation = await createStation(tx, { name: "Counter" });
      const glassStation = await createStation(tx, { name: "Glasses" });
      await routeCategoryTo(tx, wine.wineCategoryId, barStation.id);
      await routeCategoryTo(tx, wine.glassesCategoryId, glassStation.id);
      expect(await categoryStations(tx, [wine.wineCategoryId, wine.glassesCategoryId])).toEqual({
        [wine.wineCategoryId]: barStation.id,
        [wine.glassesCategoryId]: glassStation.id,
      });
      // Both lines name variants; each takes its product's category cell, so Glasses's cell takes neither.
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [], null);
      await insertContextlessLines(tx, orderId, [wine.wine125, wine.wine175]);
      const [first, second] = await fireableLines(tx, orderId);
      await fireLines(tx, cfg, orderId, [first!, second!]);
      const stations = await tx
        .select({ lineId: ticketItems.workingOrderLineId, stationId: ticketItems.stationId })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(new Map(stations.map((s) => [s.lineId, s.stationId]))).toEqual(
        new Map([
          [first!.id, barStation.id],
          [second!.id, barStation.id],
        ]),
      );
    });
  });

  it("fires variants by their inherited category cell", async () => {
    const { cfg, menuId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const cellarStation = await createStation(tx, { name: "Bodega" });
      const terraceStation = await createStation(tx, { name: "Terrace" });
      await routeCategoryTo(tx, wine.wineCategoryId, cellarStation.id);
      await routeCategoryTo(tx, wine.glassesCategoryId, terraceStation.id);
      expect(await categoryStations(tx, [wine.wineCategoryId, wine.glassesCategoryId])).toEqual({
        [wine.wineCategoryId]: cellarStation.id,
        [wine.glassesCategoryId]: terraceStation.id,
      });
      const orderId = randomUUID();
      await createOpenOrder(tx, cfg, orderId, [], null);
      await insertContextlessLines(tx, orderId, [wine.wine125, wine.wine175]);
      const [first, second] = await fireableLines(tx, orderId);
      await fireLines(tx, cfg, orderId, [first!, second!]);
      const stations = await tx
        .select({ lineId: ticketItems.workingOrderLineId, stationId: ticketItems.stationId })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(new Map(stations.map((s) => [s.lineId, s.stationId]))).toEqual(
        new Map([
          [first!.id, cellarStation.id],
          [second!.id, cellarStation.id],
        ]),
      );
    });
  });

  it("takes the parent's product cell past a cell on a variant's stored category", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const orderId = randomUUID();
    await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const barStation = await createStation(tx, { name: "Counter" });
      const terraceStation = await createStation(tx, { name: "Terrace" });
      await insertRoute(tx, {
        zoneId,
        categoryId: wine.glassesCategoryId,
        stationId: terraceStation.id,
      });
      await insertRoute(tx, { productId: wine.parentId, stationId: barStation.id });
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [
          { menuItemId: wine.offerId, variantId: wine.wine125, quantity: "1" },
          { menuItemId: wine.offerId, variantId: wine.wine175, quantity: "1" },
        ],
        null,
        { zoneId },
      );
      await fireLines(tx, cfg, orderId, await fireableLines(tx, orderId));
      const items = await ticketItemsFor(tx, orderId);
      expect(byProduct(items, wine.wine125).stationId).toBe(barStation.id);
      expect(byProduct(items, wine.wine175).stationId).toBe(barStation.id);
    });
  });

  it("takes the parent's category cell for both variants, past one on a variant's stored category", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const orderId = randomUUID();
    await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      const cellarStation = await createStation(tx, { name: "Bodega", isDefault: true });
      const terraceStation = await createStation(tx, { name: "Terrace" });
      await insertRoute(tx, {
        zoneId,
        categoryId: wine.wineCategoryId,
        stationId: cellarStation.id,
      });
      await insertRoute(tx, {
        zoneId,
        categoryId: wine.glassesCategoryId,
        stationId: terraceStation.id,
      });
      expect(await categoryStations(tx, [wine.wineCategoryId, wine.glassesCategoryId])).toEqual({
        [wine.wineCategoryId]: cellarStation.id,
        [wine.glassesCategoryId]: terraceStation.id,
      });
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [
          { menuItemId: wine.offerId, variantId: wine.wine125, quantity: "1" },
          { menuItemId: wine.offerId, variantId: wine.wine175, quantity: "1" },
        ],
        null,
        { zoneId },
      );
      await fireLines(tx, cfg, orderId, await fireableLines(tx, orderId));
      const items = await ticketItemsFor(tx, orderId);
      expect(byProduct(items, wine.wine125).stationId).toBe(cellarStation.id);
      expect(byProduct(items, wine.wine175).stationId).toBe(cellarStation.id);
    });
  });

  it("shows the parent's allergens and dietary labels on the kitchen screen, and a variant's own where it sets them", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const orderId = randomUUID();
    const { items, wine } = await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      const barStation = await createStation(tx, { name: "Counter", isDefault: true });
      await insertRoute(tx, { zoneId, productId: wine.parentId, stationId: barStation.id });
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [
          { menuItemId: wine.offerId, variantId: wine.wine125, quantity: "1" },
          { menuItemId: wine.offerId, variantId: wine.wine175, quantity: "1" },
        ],
        null,
        { zoneId },
      );
      await fireLines(tx, cfg, orderId, await fireableLines(tx, orderId));
      const queue = await listStationQueue(tx, barStation.id);
      return { wine, items: queue.flatMap((group) => group.items) };
    });
    const lines = await db
      .select({ id: workingOrderLines.id, productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, orderId));
    const itemFor = (productId: string) =>
      items.find((i) => i.workingOrderLineId === lines.find((l) => l.productId === productId)!.id)!;
    expect(itemFor(wine.wine125).asServed).toEqual({
      allergens: { sulphites: {} },
      pending: false,
    });
    expect(itemFor(wine.wine125).asServedDiet).toMatchObject({ vegan: "yes", vegetarian: "yes" });
    expect(itemFor(wine.wine175).asServed).toEqual({
      allergens: { gluten: { kinds: ["wheat" as const] } },
      pending: false,
    });
    expect(itemFor(wine.wine175).asServedDiet).toMatchObject({
      vegan: "unknown",
      vegetarian: "unknown",
      halal: "yes",
    });
  });

  it("shows an extra that is a variant with its parent's allergens and dietary labels, and one setting its own with those", async () => {
    const { cfg, zoneId, menuId, coffeeId, coffeeOfferId } = await setupVenue();
    const orderId = randomUUID();
    const modifiers = await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      const list = await menu.createExtraList(
        tx,
        {
          name: "Glass",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: null,
          active: true,
          items: [
            { productId: wine.wine125, maxQuantity: 1, preselected: false, price: "1.00" },
            { productId: wine.wine175, maxQuantity: 1, preselected: false, price: "2.00" },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });

      await republishMenus(tx);
      const barStation = await createStation(tx, { name: "Counter", isDefault: true });
      await insertRoute(tx, { zoneId, productId: coffeeId, stationId: barStation.id });
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [
          {
            menuItemId: coffeeOfferId,
            quantity: "1",
            extras: [
              {
                listId: list.id,
                picks: [
                  { productId: wine.wine125, quantity: 1 },
                  { productId: wine.wine175, quantity: 1 },
                ],
              },
            ],
          },
        ],
        null,
        { zoneId },
      );
      await fireLines(tx, cfg, orderId, await fireableLines(tx, orderId));
      return (await listStationQueue(tx, barStation.id))[0]!.items[0]!.modifiers;
    });
    expect(
      modifiers.map(({ addAllergens, suitableFor }) => ({ addAllergens, suitableFor })),
    ).toEqual([
      {
        addAllergens: { sulphites: {} },
        suitableFor: menu.expandDietaryDeclarations(["vegan"]),
      },
      {
        addAllergens: { gluten: { kinds: ["wheat" as const] } },
        suitableFor: menu.expandDietaryDeclarations(["halal"]),
      },
    ]);
  });

  it("names a variant line with no customer or kitchen name by its own name on the tab, the kitchen screens and the receipt, in every invoice locale", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const locales = [LOCALE, "en-GB"];
    await seedVenueSettings(db, { invoiceLocales: locales });
    const twoLocales = { ...cfg, invoiceLocales: locales };
    const orderId = randomUUID();
    const seen = await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      const barStation = await createStation(tx, { name: "Counter", isDefault: true });
      await insertRoute(tx, { zoneId, productId: wine.parentId, stationId: barStation.id });
      await createOpenOrder(
        tx,
        twoLocales,
        orderId,
        [{ menuItemId: wine.offerId, variantId: wine.wine125, quantity: "1" }],
        null,
        { zoneId },
      );
      await fireLines(tx, twoLocales, orderId, await fireableLines(tx, orderId));
      const [stored] = await tx
        .select({ variantDescriptions: workingOrderLines.variantDescriptions })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      return {
        stored: stored!.variantDescriptions,
        tab: (await readTabLines(tx, orderId)).map((l) => l.name),
        tabUnitPrecision: (await readTabLines(tx, orderId)).map((l) => l.unitPrecision),
        station: (await listStationQueue(tx, barStation.id))[0]!.items.map((i) => i.name),
        expo: (await passItems(tx)).map((i) => i.name),
        receipt: await readStoredOrder(tx, orderId).then(({ gross, identities }) =>
          ticketLinesFrom(gross, identities).map((l) => l.descriptions),
        ),
      };
    });
    expect(seen).toEqual({
      stored: { [LOCALE]: "125 ml", "en-GB": "125 ml" },
      tab: ["Wine by the glass (125 ml)"],
      // The line's own frozen precision: the till splits by it, since a variant is never one of the
      // till's products (it lists the offers' parents).
      tabUnitPrecision: [0],
      station: ["WINE (125 ml)"],
      expo: ["WINE (125 ml)"],
      receipt: [{ [LOCALE]: "House wine (125 ml)", "en-GB": "House wine (125 ml)" }],
    });
  });

  it.each<{
    staffName: string;
    customerName: Record<string, string> | null;
    frozen: string;
    printed: string;
  }>([
    { staffName: "125 ml", customerName: null, frozen: "125 ml", printed: "125 ml" },
    { staffName: "\t", customerName: null, frozen: "", printed: "\t" },
    {
      staffName: "125 ml",
      customerName: { [CONTENT_LANGUAGE]: "Copa pequeña", "en-GB": "Small glass" },
      frozen: "Copa pequeña",
      printed: "Copa pequeña",
    },
    {
      staffName: "125 ml",
      customerName: { [CONTENT_LANGUAGE]: "  ", "fr-FR": "FR small verre" },
      frozen: "125 ml",
      printed: "125 ml",
    },
  ])(
    "freezes resolved variant text $frozen and retains the receipt name after a live rename",
    async ({ staffName, customerName, frozen, printed }) => {
      const { cfg, zoneId, menuId } = await setupVenue();
      const locales = [LOCALE, "en-GB"];
      const twoLocales = { ...cfg, invoiceLocales: locales };
      const orderId = randomUUID();
      const seen = await withTransaction(db, async (tx) => {
        await seedVenueSettings(tx, { invoiceLocales: locales });
        const wine = await seedWine(tx, menuId);
        await tx
          .update(products)
          .set({ name: staffName, customerName })
          .where(eq(products.id, wine.wine125));
        await publishWorkingMenu(tx, menuId);
        await createOpenOrder(
          tx,
          twoLocales,
          orderId,
          [{ menuItemId: wine.offerId, variantId: wine.wine125, quantity: "1" }],
          null,
          { zoneId },
        );
        await tx
          .update(products)
          .set({ name: "Renamed", customerName: { [CONTENT_LANGUAGE]: "New customer name" } })
          .where(eq(products.id, wine.wine125));
        const [stored] = await tx
          .select({ variantDescriptions: workingOrderLines.variantDescriptions })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId));
        const { gross, identities } = await readStoredOrder(tx, orderId);
        return {
          stored: stored!.variantDescriptions,
          receipt: ticketLinesFrom(gross, identities).map((line) => line.descriptions),
        };
      });
      expect(seen).toEqual({
        stored: { [LOCALE]: frozen, "en-GB": frozen },
        receipt: [
          {
            [LOCALE]: `House wine (${printed})`,
            "en-GB": `House wine (${printed})`,
          },
        ],
      });
    },
  );

  it("stores a variant's own staff name in every invoice locale when only an unrelated language has text", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const locales = [LOCALE, "en-GB"];
    await seedVenueSettings(db, { invoiceLocales: locales });
    const twoLocales = { ...cfg, invoiceLocales: locales };
    const id = randomUUID();
    const wine = await withTransaction(db, async (tx) => {
      const seeded = await seedWine(tx, menuId);
      await tx
        .update(products)
        .set({ customerName: { "fr-FR": "Grand verre" } })
        .where(eq(products.id, seeded.wine175));
      await publishWorkingMenu(tx, menuId);
      return seeded;
    });
    await parkOrder({ db }, twoLocales, {
      id,
      zoneId,
      lines: [{ menuItemId: wine.offerId, variantId: wine.wine175, quantity: "1" }],
    });
    const [stored] = await db
      .select({ variantDescriptions: workingOrderLines.variantDescriptions })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(stored!.variantDescriptions).toEqual({
      [LOCALE]: "175 ml",
      "en-GB": "175 ml",
    });
  });

  it("re-prices a kept line whose variant alone changed", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const wine = await withTransaction(db, (tx) => seedWine(tx, menuId));
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: wine.offerId, variantId: wine.wine125, quantity: "1" }],
    });
    const [before] = await db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: before!.id,
          menuItemId: wine.offerId,
          variantId: wine.wine175,
          quantity: "1",
        },
      ],
    });
    const after = await db
      .select({
        productId: workingOrderLines.productId,
        variantName: workingOrderLines.variantName,
        unitPriceGross: workingOrderLines.unitPriceGross,
        vatClass: workingOrderLines.vatClass,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(after).toEqual([
      {
        productId: wine.wine175,
        variantName: "175 ml",
        unitPriceGross: 550,
        vatClass: "general",
      },
    ]);
  });

  it("keeps a quantity-only edit of a variant line with an options answer on its line id and locked price", async () => {
    const { cfg, zoneId, menuId } = await setupVenue();
    const { wine, options } = await withTransaction(db, async (tx) => {
      const wine = await seedWine(tx, menuId);
      // The list is attached to the PARENT: a variant offers its parent's lists.
      const options = await addOptionList(tx, wine.parentId, "Temperature", ["Chilled", "Ambient"]);
      await republishMenus(tx);
      return { wine, options };
    });
    const answer = [{ listId: options.listId, labelId: options.labelIds[0]! }];
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: wine.offerId, variantId: wine.wine125, quantity: "1", options: answer },
      ],
    });
    const [before] = await db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    await db.update(products).set({ unitPrice: 900 }).where(eq(products.id, wine.wine125));
    await updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
      revision: await revisionOf(id),
      lines: [
        {
          workingOrderLineId: before!.id,
          menuItemId: wine.offerId,
          variantId: wine.wine125,
          quantity: "2",
          options: answer,
        },
      ],
    });
    const after = await db
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        unitPriceGross: workingOrderLines.unitPriceGross,
        lineTotal: workingOrderLines.lineTotal,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // The glass keeps its line, and the raise adds a second glass beside it, both at the locked
    // 4.50 rather than today's 9.00: together the 9.00 one line of two was.
    expect(after).toEqual([
      { id: before!.id, productId: wine.wine125, unitPriceGross: 450, lineTotal: 450 },
      { id: expect.any(String), productId: wine.wine125, unitPriceGross: 450, lineTotal: 450 },
    ]);
    expect(after[1]!.id).not.toBe(before!.id);
  });

  it("returns a retrieved variant line's variant id, and none for a line without one", async () => {
    const { cfg, zoneId, menuId, coffeeId, coffeeOfferId } = await setupVenue();
    const wine = await withTransaction(db, (tx) => seedWine(tx, menuId));
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: wine.offerId, variantId: wine.wine175, quantity: "1" },
        { menuItemId: coffeeOfferId, quantity: "1" },
      ],
    });
    const held = await getHeldOrder({ db }, id);
    expect(held.lines.map((l) => [l.menuItemId, l.variantId, l.product?.variantId])).toEqual([
      [wine.offerId, wine.wine175, wine.wine175],
      [coffeeOfferId, undefined, undefined],
    ]);
    // The dish is the variant's PARENT, as the till built it from the offer at add time.
    expect(held.lines.map((l) => [l.productId, l.product?.id, l.product?.productId])).toEqual([
      [wine.parentId, wine.parentId, wine.parentId],
      [coffeeId, coffeeId, coffeeId],
    ]);
  });
});
