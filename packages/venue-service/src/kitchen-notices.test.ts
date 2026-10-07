import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  EACH_UNIT,
  EACH_UNIT_ID,
  addProductToMenu,
  createCatalogue,
  createProduct,
  deleteUnit,
  units,
  updateUnit,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId, thousandthsToDecimal } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { kitchenNotices } from "./schema/kitchen-notices.js";
import { workingLineContexts } from "./schema/service.js";
import { serviceSettings } from "./schema/settings.js";
import {
  acknowledgeKitchenNotice,
  listStationNotices,
  readClearingWorkflow,
  readEditSentLines,
  readKitchenTicketGrouping,
  readPrintHeldWork,
  readReleaseReminderMinutes,
  recordKitchenNotices,
  writeClearingWorkflow,
  writeEditSentLines,
  writeKitchenTicketGrouping,
  writePrintHeldWork,
  writeReleaseReminderMinutes,
  type KitchenNoticeItem,
} from "./kitchen-notices.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);

const ONE = thousandthsToDecimal(1000);
const TWO = thousandthsToDecimal(2000);

/** A cutover `minutes` from now on a UTC venue, written `HH:MM:SS`. */
function cutoverFromNow(minutes: number): string {
  return `${new Date(Date.now() + minutes * 60_000).toISOString().slice(11, 16)}:00`;
}

async function seedLocation(name: string): Promise<LocationId> {
  const [row] = await db
    .insert(locations)
    .values({
      name,
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
      timeZone: "UTC",
    })
    .returning({ id: locations.id });
  return brandLocationId(row!.id);
}

async function seedStation(locationId: LocationId, name: string): Promise<string> {
  const [row] = await db
    .insert(kitchenStations)
    .values({ locationId, name })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

/**
 * An order with a burger whose three names differ, so a reader of the wrong one fails: staff name
 * "Burger", kitchen name "BRGR", customer-facing text "Classic beef burger". A second line, a
 * lemonade, has no kitchen name, and falls back to its staff name. A third, a pizza sold as its
 * large variant, has three different variant names too: staff "Large pizza", kitchen "LRG PZ",
 * customer-facing "Large sourdough pizza".
 */
async function seedOrder(
  locationId: LocationId,
  orderNumber: number,
  label: string | null,
): Promise<{ orderId: string; burgerLineId: string; lemonadeLineId: string; pizzaLineId: string }> {
  const [order] = await db
    .insert(workingOrders)
    .values({ source: "dashboard", deviceId: null, locationId, orderNumber, label })
    .returning({ id: workingOrders.id });
  const line = {
    workingOrderId: order!.id,
    quantity: 2000,
    unitPriceGross: 1100,
    vatClass: "reduced",
    lineTotal: 2200,
  };
  const [burger] = await db
    .insert(workingOrderLines)
    .values({
      ...line,
      lineNo: 1,
      name: "Burger",
      kitchenName: "BRGR",
      descriptions: { en: "Classic beef burger" },
      note: "no onions",
    })
    .returning({ id: workingOrderLines.id });
  const [lemonade] = await db
    .insert(workingOrderLines)
    .values({ ...line, lineNo: 2, name: "Lemonade", descriptions: { en: "Fresh lemonade" } })
    .returning({ id: workingOrderLines.id });
  const [pizza] = await db
    .insert(workingOrderLines)
    .values({
      ...line,
      lineNo: 3,
      name: "Pizza",
      kitchenName: "PZ",
      descriptions: { en: "Sourdough pizza" },
      variantName: "Large pizza",
      variantKitchenName: "LRG PZ",
      variantDescriptions: { en: "Large sourdough pizza" },
    })
    .returning({ id: workingOrderLines.id });
  return {
    orderId: order!.id,
    burgerLineId: burger!.id,
    lemonadeLineId: lemonade!.id,
    pizzaLineId: pizza!.id,
  };
}

async function venue() {
  await seedTenant(db);
  const locationId = await seedLocation("Venue");
  const grill = await seedStation(locationId, "Grill");
  const bar = await seedStation(locationId, "Bar");
  return { locationId, cfg: { locationId }, grill, bar };
}

/** A notice written directly, at a chosen moment. */
async function noticeAt(
  stationId: string,
  orderId: string,
  createdAt: string,
  lineName = "Burger",
): Promise<string> {
  const [row] = await db
    .insert(kitchenNotices)
    .values({
      stationId,
      workingOrderId: orderId,
      orderLabel: "#1",
      kind: "void",
      lineName,
      quantity: 1000,
      createdAt,
    })
    .returning({ id: kitchenNotices.id });
  return row!.id;
}

describe("recordKitchenNotices", () => {
  it("records each item as the kitchen saw it: the order label, the kitchen name and the line's note", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 12, "Table 4");
    await inTx((tx) =>
      recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        [
          {
            workingOrderLineId: order.burgerLineId,
            stationId: v.grill,
            quantity: ONE,
            wasStarted: true,
          },
          {
            workingOrderLineId: order.lemonadeLineId,
            stationId: v.bar,
            quantity: TWO,
            wasStarted: false,
          },
        ],
        "void",
      ),
    );

    const grill = await inTx((tx) => listStationNotices(tx, v.cfg, v.grill));
    expect(grill).toEqual([
      {
        id: expect.any(String),
        stationId: v.grill,
        workingOrderId: order.orderId,
        orderLabel: "#12 · Table 4",
        kind: "void",
        lineName: "BRGR",
        unitName: null,
        soldInEach: false,
        quantity: ONE,
        note: "no onions",
        wasStarted: true,
        movedTo: null,
        direction: null,
        cancelledExtra: null,
        reroutedTo: null,
        createdAt: expect.any(String),
      },
    ]);
    const bar = await inTx((tx) => listStationNotices(tx, v.cfg, v.bar));
    expect(bar).toEqual([
      expect.objectContaining({
        lineName: "Lemonade",
        quantity: TWO,
        note: null,
        wasStarted: false,
      }),
    ]);
  });

  it("names a variant line by the parent and variant kitchen pair", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 8, null);
    await inTx((tx) =>
      recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        [
          {
            workingOrderLineId: order.pizzaLineId,
            stationId: v.grill,
            quantity: ONE,
            wasStarted: false,
          },
        ],
        "void",
      ),
    );
    expect(
      (await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).map((n) => n.lineName),
    ).toEqual(["PZ (LRG PZ)"]);
  });

  it("copies a weighed line's unit, in every language it was recorded in", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 5, null);
    const [octopus] = await db
      .insert(workingOrderLines)
      .values({
        workingOrderId: order.orderId,
        lineNo: 4,
        name: "Octopus",
        descriptions: { en: "Galician octopus" },
        unitName: { en: "kg", "es-ES": "kilo" },
        quantity: 500,
        unitPriceGross: 4400,
        vatClass: "reduced",
        lineTotal: 2200,
      })
      .returning({ id: workingOrderLines.id });
    await inTx((tx) =>
      recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        [
          {
            workingOrderLineId: octopus!.id,
            stationId: v.grill,
            quantity: thousandthsToDecimal(500),
            wasStarted: false,
          },
        ],
        "void",
      ),
    );
    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, octopus!.id));
    expect(await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).toEqual([
      expect.objectContaining({
        lineName: "Octopus",
        unitName: { en: "kg", "es-ES": "kilo" },
        quantity: thousandthsToDecimal(500),
      }),
    ]);
  });

  /**
   * Each line is sold in a unit its context names: Each as a product with no stored unit reads it,
   * the stored unit seeded as each after a venue renamed its abbreviation, kg, the seeded g (a
   * second unit counted in whole numbers), and a unit the venue created with Each's own
   * abbreviations. Only the first two are Each; the last proves the answer ignores the text.
   */
  it("marks a notice sold in Each by the identity of the unit its line was sold in, never its text", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 7, null);
    const stored = await db
      .insert(units)
      .values([
        { seedKey: "each", name: { en: "each" }, abbreviation: { en: "ea" }, precision: 0 },
        { seedKey: "kg", name: { en: "kg" }, abbreviation: { en: "kg" }, precision: 3 },
        { seedKey: "g", name: { en: "gram" }, abbreviation: { en: "g" }, precision: 0 },
        { name: { en: "Portion" }, abbreviation: EACH_UNIT.abbreviation, precision: 0 },
      ])
      .returning({ id: units.id, abbreviation: units.abbreviation, precision: units.precision });
    const [seededEach, kg, gram, lookalike] = stored;
    await inTx((tx) => updateUnit(tx, seededEach!.id, { abbreviation: { en: "pc" } }, "en"));
    const offer = await inTx(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Tapas" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Tapa",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "reduced",
      });
      return addProductToMenu(tx, { menuId: menu.id, productId: product.id });
    });
    const soldIn = [
      {
        name: "Croqueta",
        unit: { id: EACH_UNIT_ID, abbreviation: EACH_UNIT.abbreviation, precision: 0 },
        soldInEach: true,
      },
      { name: "Gilda", unit: { ...seededEach!, abbreviation: { en: "pc" } }, soldInEach: true },
      { name: "Pulpo", unit: kg!, soldInEach: false },
      { name: "Almendras", unit: gram!, soldInEach: false },
      { name: "Pan", unit: lookalike!, soldInEach: false },
    ];
    const lineIds: string[] = [];
    for (const [index, sold] of soldIn.entries()) {
      const [line] = await db
        .insert(workingOrderLines)
        .values({
          workingOrderId: order.orderId,
          lineNo: 10 + index,
          name: sold.name,
          descriptions: { en: sold.name },
          unitName: sold.unit.abbreviation,
          unitPrecision: sold.unit.precision,
          quantity: 2000,
          unitPriceGross: 100,
          vatClass: "reduced",
          lineTotal: 200,
        })
        .returning({ id: workingOrderLines.id });
      await db.insert(workingLineContexts).values({
        workingOrderLineId: line!.id,
        menuItemId: offer.id,
        menuId: offer.menuId,
        menuName: "Tapas",
        departmentId: "00000000-0000-4000-8000-0000000000d1",
        departmentName: "Restaurant",
        categoryName: "Uncategorised",
        unitId: sold.unit.id,
        unitName: sold.unit.abbreviation,
        unitPrecision: sold.unit.precision,
        soldInEach: sold.soldInEach,
        vatClass: "reduced",
      });
      lineIds.push(line!.id);
    }

    await inTx((tx) =>
      recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        [...lineIds, order.burgerLineId].map((workingOrderLineId) => ({
          workingOrderLineId,
          stationId: v.grill,
          quantity: TWO,
          wasStarted: false,
        })),
        "void",
      ),
    );
    // The void deletes the lines, and their contexts with them; the seeded each unit then goes too.
    await db.delete(workingOrderLines).where(eq(workingOrderLines.workingOrderId, order.orderId));
    await inTx((tx) => deleteUnit(tx, seededEach!.id));

    expect(
      (await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).map((notice) => [
        notice.lineName,
        notice.soldInEach,
      ]),
    ).toEqual([
      ["Croqueta", true],
      ["Gilda", true],
      ["Pulpo", false],
      ["Almendras", false],
      ["Pan", false],
      ["BRGR", false],
    ]);
  });

  describe("refuses", () => {
    const item = (
      workingOrderLineId: string,
      stationId: string,
      quantity = ONE,
    ): KitchenNoticeItem => ({ workingOrderLineId, stationId, quantity, wasStarted: false });

    it("an unknown order, and an order at another location, as not found", async () => {
      const v = await venue();
      const order = await seedOrder(v.locationId, 1, null);
      const elsewhere = await seedOrder(await seedLocation("Other venue"), 2, null);
      const unknown = "00000000-0000-4000-8000-00000000dead";
      await expect(
        inTx((tx) =>
          recordKitchenNotices(tx, v.cfg, unknown, [item(order.burgerLineId, v.grill)], "void"),
        ),
      ).rejects.toMatchObject({
        code: "working_order.not_found",
        params: { workingOrderId: unknown },
      });
      await expect(
        inTx((tx) =>
          recordKitchenNotices(
            tx,
            v.cfg,
            elsewhere.orderId,
            [item(elsewhere.burgerLineId, v.grill)],
            "void",
          ),
        ),
      ).rejects.toMatchObject({
        code: "working_order.not_found",
        params: { workingOrderId: elsewhere.orderId },
      });
      expect(await db.select().from(kitchenNotices)).toEqual([]);
    });

    it("an unknown station, and a station at another location, as not found", async () => {
      const v = await venue();
      const order = await seedOrder(v.locationId, 1, null);
      const elsewhere = await seedStation(await seedLocation("Other venue"), "Grill");
      const unknown = "00000000-0000-4000-8000-00000000beef";
      for (const stationId of [unknown, elsewhere]) {
        await expect(
          inTx((tx) =>
            recordKitchenNotices(
              tx,
              v.cfg,
              order.orderId,
              [item(order.burgerLineId, v.grill), item(order.lemonadeLineId, stationId)],
              "void",
            ),
          ),
        ).rejects.toMatchObject({ code: "station.not_found", params: { stationId } });
      }
      expect(await db.select().from(kitchenNotices)).toEqual([]);
    });

    it.each([
      ["zero", thousandthsToDecimal(0)],
      ["a negative", thousandthsToDecimal(-1000)],
    ])("%s quantity as not positive", async (_, quantity) => {
      const v = await venue();
      const order = await seedOrder(v.locationId, 1, null);
      await expect(
        inTx((tx) =>
          recordKitchenNotices(
            tx,
            v.cfg,
            order.orderId,
            [item(order.burgerLineId, v.grill, quantity)],
            "void",
          ),
        ),
      ).rejects.toMatchObject({ code: "quantity.invalid", params: { reason: "positive" } });
    });

    it.each(["recalled", "void", "moved"] as const)(
      "a direction on a %s notice, which only a changed notice carries",
      async (kind) => {
        const v = await venue();
        const order = await seedOrder(v.locationId, 1, null);
        await expect(
          inTx((tx) =>
            recordKitchenNotices(
              tx,
              v.cfg,
              order.orderId,
              [item(order.burgerLineId, v.grill)],
              kind,
              null,
              "added",
            ),
          ),
        ).rejects.toMatchObject({ code: "kitchen_notice.invalid", params: { field: "direction" } });
        expect(await db.select().from(kitchenNotices)).toEqual([]);
      },
    );

    it.each(["recalled", "void", "moved"] as const)(
      "an extra taken off on a %s notice, which only a changed notice carries",
      async (kind) => {
        const v = await venue();
        const order = await seedOrder(v.locationId, 1, null);
        await expect(
          inTx((tx) =>
            recordKitchenNotices(
              tx,
              v.cfg,
              order.orderId,
              [item(order.burgerLineId, v.grill)],
              kind,
              null,
              null,
              "Gherkins",
            ),
          ),
        ).rejects.toMatchObject({
          code: "kitchen_notice.invalid",
          params: { field: "cancelledExtra" },
        });
        expect(await db.select().from(kitchenNotices)).toEqual([]);
      },
    );

    it("a rerouted notice without its destination station", async () => {
      const v = await venue();
      const order = await seedOrder(v.locationId, 1, null);
      await expect(
        inTx((tx) =>
          recordKitchenNotices(
            tx,
            v.cfg,
            order.orderId,
            [item(order.burgerLineId, v.grill)],
            "rerouted",
          ),
        ),
      ).rejects.toMatchObject({ code: "kitchen_notice.invalid", params: { field: "reroutedTo" } });
      expect(await db.select().from(kitchenNotices)).toEqual([]);
    });

    it("a destination station on a recalled notice", async () => {
      const v = await venue();
      const order = await seedOrder(v.locationId, 1, null);
      await expect(
        inTx((tx) =>
          recordKitchenNotices(
            tx,
            v.cfg,
            order.orderId,
            [item(order.burgerLineId, v.grill)],
            "recalled",
            null,
            null,
            null,
            "Grill",
          ),
        ),
      ).rejects.toMatchObject({ code: "kitchen_notice.invalid", params: { field: "reroutedTo" } });
      expect(await db.select().from(kitchenNotices)).toEqual([]);
    });

    it("a direction other than added or removed", async () => {
      const v = await venue();
      const order = await seedOrder(v.locationId, 1, null);
      await expect(
        inTx((tx) =>
          recordKitchenNotices(
            tx,
            v.cfg,
            order.orderId,
            [item(order.burgerLineId, v.grill)],
            "changed",
            null,
            "sideways" as "added",
          ),
        ),
      ).rejects.toMatchObject({ code: "kitchen_notice.invalid", params: { field: "direction" } });
      expect(await db.select().from(kitchenNotices)).toEqual([]);
    });

    it("a line that is not on the order as a caller fault, with no domain code", async () => {
      const v = await venue();
      const order = await seedOrder(v.locationId, 1, null);
      const other = await seedOrder(v.locationId, 2, null);
      const refusal = inTx((tx) =>
        recordKitchenNotices(tx, v.cfg, order.orderId, [item(other.burgerLineId, v.grill)], "void"),
      );
      await expect(refusal).rejects.toThrow(
        `recordKitchenNotices: line ${other.burgerLineId} is not on order ${order.orderId}`,
      );
      await expect(refusal).rejects.not.toBeInstanceOf(AppError);
    });
  });

  it("labels an order with no label by its number alone, and records the kind it is given", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 7, null);
    for (const kind of ["recalled", "changed"] as const) {
      await inTx((tx) =>
        recordKitchenNotices(
          tx,
          v.cfg,
          order.orderId,
          [
            {
              workingOrderLineId: order.burgerLineId,
              stationId: v.grill,
              quantity: ONE,
              wasStarted: false,
            },
          ],
          kind,
        ),
      );
    }
    const notices = await inTx((tx) => listStationNotices(tx, v.cfg, v.grill));
    expect(notices.map((notice) => [notice.orderLabel, notice.kind])).toEqual([
      ["#7", "recalled"],
      ["#7", "changed"],
    ]);
  });

  it("records which way a changed notice went, and no direction when none is given or for any other kind", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 6, null);
    const burger = [
      {
        workingOrderLineId: order.burgerLineId,
        stationId: v.grill,
        quantity: ONE,
        wasStarted: false,
      },
    ];
    await inTx(async (tx) => {
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "changed", null, "added");
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "changed", null, "removed");
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "changed");
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "void");
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "moved", "Mesa 2");
    });
    expect(
      (await db.execute(sql`select kind, direction from kitchen_notices order by rowid`)).rows,
    ).toEqual([
      { kind: "changed", direction: "added" },
      { kind: "changed", direction: "removed" },
      { kind: "changed", direction: null },
      { kind: "void", direction: null },
      { kind: "moved", direction: null },
    ]);
  });

  // Fails if the list leaves out which way a changed notice went.
  it("lists a changed notice with its direction", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 6, null);
    const burger = [
      {
        workingOrderLineId: order.burgerLineId,
        stationId: v.grill,
        quantity: ONE,
        wasStarted: false,
      },
    ];
    await inTx(async (tx) => {
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "changed", null, "removed");
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "changed", null, "added");
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "void");
    });
    const notices = await inTx((tx) => listStationNotices(tx, v.cfg, v.grill));
    expect(notices.map((notice) => [notice.kind, notice.direction])).toEqual([
      ["changed", "removed"],
      ["changed", "added"],
      ["void", null],
    ]);
  });

  // Fails if the extra a change took off the dish is not recorded, or not listed.
  it("records and lists a changed notice with the extra taken off the dish, and none on the others", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 6, null);
    const burger = [
      {
        workingOrderLineId: order.burgerLineId,
        stationId: v.grill,
        quantity: ONE,
        wasStarted: true,
      },
    ];
    await inTx(async (tx) => {
      await recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        burger,
        "changed",
        null,
        null,
        "Gherkins",
      );
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "changed", null, "added");
      await recordKitchenNotices(tx, v.cfg, order.orderId, burger, "void");
    });
    const notices = await inTx((tx) => listStationNotices(tx, v.cfg, v.grill));
    expect(notices[0]).toEqual({
      id: expect.any(String),
      stationId: v.grill,
      workingOrderId: order.orderId,
      orderLabel: "#6",
      kind: "changed",
      lineName: "BRGR",
      unitName: null,
      soldInEach: false,
      quantity: ONE,
      note: "no onions",
      wasStarted: true,
      movedTo: null,
      direction: null,
      cancelledExtra: "Gherkins",
      reroutedTo: null,
      createdAt: expect.any(String),
    });
    expect(notices.map((notice) => notice.cancelledExtra)).toEqual(["Gherkins", null, null]);
  });

  it("records a moved notice with the table the work moved to", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 9, null);
    await inTx((tx) =>
      recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        [
          {
            workingOrderLineId: order.burgerLineId,
            stationId: v.grill,
            quantity: ONE,
            wasStarted: false,
          },
        ],
        "moved",
        "Mesa 7",
      ),
    );
    expect(await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).toEqual([
      {
        id: expect.any(String),
        stationId: v.grill,
        workingOrderId: order.orderId,
        orderLabel: "#9",
        kind: "moved",
        lineName: "BRGR",
        unitName: null,
        soldInEach: false,
        quantity: ONE,
        note: "no onions",
        wasStarted: false,
        movedTo: "Mesa 7",
        direction: null,
        cancelledExtra: null,
        reroutedTo: null,
        createdAt: expect.any(String),
      },
    ]);
  });

  it("records and lists a rerouted notice with its destination station", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 10, null);
    await inTx((tx) =>
      recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        [
          {
            workingOrderLineId: order.burgerLineId,
            stationId: v.bar,
            quantity: ONE,
            wasStarted: true,
          },
        ],
        "rerouted",
        null,
        null,
        null,
        "Grill",
      ),
    );
    expect(await inTx((tx) => listStationNotices(tx, v.cfg, v.bar))).toEqual([
      expect.objectContaining({
        kind: "rerouted",
        reroutedTo: "Grill",
        stationId: v.bar,
        lineName: "BRGR",
      }),
    ]);
  });

  it("the engine refuses a non-rerouted notice with a destination station", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 11, null);
    await expect(
      db.insert(kitchenNotices).values({
        stationId: v.bar,
        workingOrderId: order.orderId,
        orderLabel: "#11",
        kind: "void",
        lineName: "BRGR",
        quantity: 1000,
        reroutedTo: "Grill",
      }),
    ).rejects.toThrow(/kitchen_notices_rerouted_to_ck/);
  });

  it("lists the notices one call records in the order it was given them", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 4, null);
    await inTx((tx) =>
      recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        [
          {
            workingOrderLineId: order.lemonadeLineId,
            stationId: v.grill,
            quantity: ONE,
            wasStarted: false,
          },
          {
            workingOrderLineId: order.burgerLineId,
            stationId: v.grill,
            quantity: ONE,
            wasStarted: false,
          },
        ],
        "recalled",
      ),
    );
    expect(
      (await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).map((n) => n.lineName),
    ).toEqual(["Lemonade", "BRGR"]);
  });

  it("records nothing for no items", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 3, null);
    await inTx((tx) => recordKitchenNotices(tx, v.cfg, order.orderId, [], "void"));
    expect(await db.select().from(kitchenNotices)).toEqual([]);
  });

  it("keeps the notice when the line it describes is deleted", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 5, null);
    await inTx(async (tx) => {
      await recordKitchenNotices(
        tx,
        v.cfg,
        order.orderId,
        [
          {
            workingOrderLineId: order.burgerLineId,
            stationId: v.grill,
            quantity: ONE,
            wasStarted: true,
          },
        ],
        "void",
      );
      await tx.delete(workingOrderLines).where(eq(workingOrderLines.id, order.burgerLineId));
    });
    expect(
      (await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).map((n) => n.lineName),
    ).toEqual(["BRGR"]);
  });
});

describe("listStationNotices", () => {
  it("returns the newest fifty unacknowledged notices, oldest first", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 1, null);
    await db.update(locations).set({ dayCutover: cutoverFromNow(90) });
    const base = Date.now() - 60 * 60_000;
    for (let index = 0; index < 55; index += 1) {
      await noticeAt(
        v.grill,
        order.orderId,
        new Date(base + index * 1000).toISOString(),
        `N${index}`,
      );
    }
    const acknowledged = await noticeAt(v.grill, order.orderId, new Date().toISOString(), "Done");
    await inTx((tx) => acknowledgeKitchenNotice(tx, v.cfg, acknowledged));

    const names = (await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).map(
      (notice) => notice.lineName,
    );
    expect(names).toEqual(Array.from({ length: 50 }, (_, index) => `N${index + 5}`));
  });

  it("returns none older than the venue's business day, whatever their age in hours", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 1, null);
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    await noticeAt(v.grill, order.orderId, hoursAgo(23), "23 hours ago");
    await noticeAt(v.grill, order.orderId, hoursAgo(25), "25 hours ago");
    await noticeAt(v.grill, order.orderId, hoursAgo(1), "an hour ago");
    await noticeAt(v.grill, order.orderId, hoursAgo(0.1), "just now");
    const listed = async () =>
      (await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).map((n) => n.lineName);

    // The day began about 23.5 hours ago: yesterday's notice from 23 hours ago is still today's.
    await db.update(locations).set({ dayCutover: cutoverFromNow(30) });
    expect(await listed()).toEqual(["23 hours ago", "an hour ago", "just now"]);
    // The day began about half an hour ago: the notice from an hour ago belongs to yesterday.
    await db.update(locations).set({ dayCutover: cutoverFromNow(-30) });
    expect(await listed()).toEqual(["just now"]);
  });

  it("returns only the named station's notices, and none for a station at another location", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 1, null);
    const elsewhere = await seedStation(await seedLocation("Other venue"), "Grill");
    await noticeAt(v.bar, order.orderId, new Date().toISOString(), "at the bar");
    await noticeAt(elsewhere, order.orderId, new Date().toISOString(), "elsewhere");
    expect(await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).toEqual([]);
    expect(
      (await inTx((tx) => listStationNotices(tx, v.cfg, v.bar))).map((n) => n.lineName),
    ).toEqual(["at the bar"]);
    expect(await inTx((tx) => listStationNotices(tx, v.cfg, elsewhere))).toEqual([]);
  });
});

describe("acknowledgeKitchenNotice", () => {
  it("clears a notice from its station's list, and a second acknowledgement keeps the first time", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 1, null);
    const id = await noticeAt(v.grill, order.orderId, new Date().toISOString());
    const acknowledgedAt = async () =>
      (
        await db
          .select({ at: kitchenNotices.acknowledgedAt })
          .from(kitchenNotices)
          .where(eq(kitchenNotices.id, id))
      )[0]!.at;
    const before = new Date().toISOString();
    await inTx((tx) => acknowledgeKitchenNotice(tx, v.cfg, id));
    expect(await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).toEqual([]);
    expect((await acknowledgedAt())! >= before).toBe(true);

    // Moved back by hand so a second acknowledgement in the same millisecond cannot pass for one
    // that kept the first time.
    const first = "2026-01-01T00:00:00.000Z";
    await db.update(kitchenNotices).set({ acknowledgedAt: first }).where(eq(kitchenNotices.id, id));
    await inTx((tx) => acknowledgeKitchenNotice(tx, v.cfg, id));
    expect(await acknowledgedAt()).toBe(first);
  });

  it("refuses an unknown notice, and one at another location's station, as not found", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 1, null);
    const elsewhere = await seedStation(await seedLocation("Other venue"), "Grill");
    const foreign = await noticeAt(elsewhere, order.orderId, new Date().toISOString());
    const unknown = "00000000-0000-4000-8000-00000000dead";
    await expect(inTx((tx) => acknowledgeKitchenNotice(tx, v.cfg, unknown))).rejects.toMatchObject({
      code: "kitchen_notice.not_found",
      params: { noticeId: unknown },
    });
    await expect(inTx((tx) => acknowledgeKitchenNotice(tx, v.cfg, foreign))).rejects.toMatchObject({
      code: "kitchen_notice.not_found",
      params: { noticeId: foreign },
    });
    const [row] = await db
      .select({ at: kitchenNotices.acknowledgedAt })
      .from(kitchenNotices)
      .where(eq(kitchenNotices.id, foreign));
    expect(row!.at).toBeNull();
  });
});

describe("acknowledgeKitchenNotice for one station", () => {
  it("clears a notice at the named station, and refuses one at another station as not found", async () => {
    const v = await venue();
    const order = await seedOrder(v.locationId, 1, null);
    const atGrill = await noticeAt(v.grill, order.orderId, new Date().toISOString());

    await expect(
      inTx((tx) => acknowledgeKitchenNotice(tx, v.cfg, atGrill, { stationId: v.bar })),
    ).rejects.toMatchObject({ code: "kitchen_notice.not_found", params: { noticeId: atGrill } });
    expect(
      (await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).map((notice) => notice.id),
    ).toEqual([atGrill]);

    await inTx((tx) => acknowledgeKitchenNotice(tx, v.cfg, atGrill, { stationId: v.grill }));
    expect(await inTx((tx) => listStationNotices(tx, v.cfg, v.grill))).toEqual([]);
  });
});

describe("the edit-sent-lines setting", () => {
  it("reads ON when the venue has no settings row", async () => {
    expect(await inTx((tx) => readEditSentLines(tx))).toBe(true);
  });

  it("reads what was written, creating the row when it is missing", async () => {
    await inTx((tx) => writeEditSentLines(tx, false));
    expect(await inTx((tx) => readEditSentLines(tx))).toBe(false);
    await inTx((tx) => writeEditSentLines(tx, true));
    expect(await inTx((tx) => readEditSentLines(tx))).toBe(true);
    expect(await db.select().from(serviceSettings)).toEqual([
      {
        id: 1,
        editSentLines: true,
        clearingWorkflow: false,
        kitchenTicketGrouping: "combined",
        printHeldWork: false,
        releaseReminderMinutes: 10,
      },
    ]);
    // Raw SQL, so the stored value is read without the column's boolean mapping.
    await db.execute(sql`update service_settings set edit_sent_lines = 0`);
    expect(await inTx((tx) => readEditSentLines(tx))).toBe(false);
  });
});

describe("the clearing-workflow setting", () => {
  it("reads OFF when the venue has no settings row", async () => {
    expect(await inTx((tx) => readClearingWorkflow(tx))).toBe(false);
  });

  it("reads what was written, creating the row when it is missing, and leaves the other setting alone", async () => {
    await inTx((tx) => writeEditSentLines(tx, false));
    await inTx((tx) => writeClearingWorkflow(tx, true));
    expect(await inTx((tx) => readClearingWorkflow(tx))).toBe(true);
    expect(await inTx((tx) => readEditSentLines(tx))).toBe(false);
    await inTx((tx) => writeClearingWorkflow(tx, false));
    expect(await inTx((tx) => readClearingWorkflow(tx))).toBe(false);
    await db.execute(sql`update service_settings set clearing_workflow = 1`);
    expect(await inTx((tx) => readClearingWorkflow(tx))).toBe(true);
  });

  it("creates the row with the other setting at its default when only this one is written", async () => {
    await inTx((tx) => writeClearingWorkflow(tx, true));
    expect(await db.select().from(serviceSettings)).toEqual([
      {
        id: 1,
        editSentLines: true,
        clearingWorkflow: true,
        kitchenTicketGrouping: "combined",
        printHeldWork: false,
        releaseReminderMinutes: 10,
      },
    ]);
  });
});

describe("the kitchen ticket grouping setting", () => {
  it("reads combined when the venue has no settings row", async () => {
    expect(await inTx((tx) => readKitchenTicketGrouping(tx))).toBe("combined");
  });

  it("reads what was written, creating the row when it is missing, and leaves the other settings alone", async () => {
    await inTx((tx) => writeEditSentLines(tx, false));
    await inTx((tx) => writeKitchenTicketGrouping(tx, "separate"));
    expect(await inTx((tx) => readKitchenTicketGrouping(tx))).toBe("separate");
    expect(await inTx((tx) => readEditSentLines(tx))).toBe(false);
    expect(await inTx((tx) => readClearingWorkflow(tx))).toBe(false);
    await inTx((tx) => writeKitchenTicketGrouping(tx, "combined"));
    expect(await inTx((tx) => readKitchenTicketGrouping(tx))).toBe("combined");
    await db.execute(sql`update service_settings set kitchen_ticket_grouping = 'separate'`);
    expect(await inTx((tx) => readKitchenTicketGrouping(tx))).toBe("separate");
  });

  it("creates the row with the other settings at their defaults when only this one is written", async () => {
    await inTx((tx) => writeKitchenTicketGrouping(tx, "separate"));
    expect(await db.select().from(serviceSettings)).toEqual([
      {
        id: 1,
        editSentLines: true,
        clearingWorkflow: false,
        kitchenTicketGrouping: "separate",
        printHeldWork: false,
        releaseReminderMinutes: 10,
      },
    ]);
  });

  it("refuses a stored value outside the two choices", async () => {
    await inTx((tx) => writeKitchenTicketGrouping(tx, "separate"));
    await expect(
      (async () =>
        db.execute(sql`update service_settings set kitchen_ticket_grouping = 'bogus'`))(),
    ).rejects.toThrow(/CHECK constraint failed: service_settings_kitchen_ticket_grouping_ck/);
    expect(await inTx((tx) => readKitchenTicketGrouping(tx))).toBe("separate");
  });
});

describe("the print-held-work setting", () => {
  it("reads OFF when the venue has no settings row", async () => {
    expect(await inTx((tx) => readPrintHeldWork(tx))).toBe(false);
  });

  it("reads what was written, creating the row when it is missing, and leaves the other settings alone", async () => {
    await inTx((tx) => writeEditSentLines(tx, false));
    await inTx((tx) => writePrintHeldWork(tx, true));
    expect(await inTx((tx) => readPrintHeldWork(tx))).toBe(true);
    expect(await inTx((tx) => readEditSentLines(tx))).toBe(false);
    expect(await inTx((tx) => readClearingWorkflow(tx))).toBe(false);
    expect(await inTx((tx) => readKitchenTicketGrouping(tx))).toBe("combined");
    await inTx((tx) => writePrintHeldWork(tx, false));
    expect(await inTx((tx) => readPrintHeldWork(tx))).toBe(false);
    // Raw SQL, so the stored value is read without the column's boolean mapping.
    await db.execute(sql`update service_settings set print_held_work = 1`);
    expect(await inTx((tx) => readPrintHeldWork(tx))).toBe(true);
  });

  it("creates the row with the other settings at their defaults when only this one is written", async () => {
    await inTx((tx) => writePrintHeldWork(tx, true));
    expect(await db.select().from(serviceSettings)).toEqual([
      {
        id: 1,
        editSentLines: true,
        clearingWorkflow: false,
        kitchenTicketGrouping: "combined",
        printHeldWork: true,
        releaseReminderMinutes: 10,
      },
    ]);
  });
});

describe("the release-reminder setting", () => {
  it("reads 10 minutes when the venue has no settings row", async () => {
    expect(await inTx((tx) => readReleaseReminderMinutes(tx))).toBe(10);
  });

  it("reads what was written, off included, and leaves the other settings alone", async () => {
    await inTx((tx) => writeEditSentLines(tx, false));
    await inTx((tx) => writeReleaseReminderMinutes(tx, 15));
    expect(await inTx((tx) => readReleaseReminderMinutes(tx))).toBe(15);
    expect(await inTx((tx) => readEditSentLines(tx))).toBe(false);
    expect(await inTx((tx) => readPrintHeldWork(tx))).toBe(false);
    await inTx((tx) => writeReleaseReminderMinutes(tx, null));
    expect(await inTx((tx) => readReleaseReminderMinutes(tx))).toBeNull();
    await db.execute(sql`update service_settings set release_reminder_minutes = 7`);
    expect(await inTx((tx) => readReleaseReminderMinutes(tx))).toBe(7);
  });

  it("stores off as null, not as the default, when it is the first setting written", async () => {
    await inTx((tx) => writeReleaseReminderMinutes(tx, null));
    expect(await db.select().from(serviceSettings)).toEqual([
      {
        id: 1,
        editSentLines: true,
        clearingWorkflow: false,
        kitchenTicketGrouping: "combined",
        printHeldWork: false,
        releaseReminderMinutes: null,
      },
    ]);
  });

  it("gives a row another setting created the 10-minute default", async () => {
    await inTx((tx) => writePrintHeldWork(tx, true));
    expect(await inTx((tx) => readReleaseReminderMinutes(tx))).toBe(10);
  });
});
