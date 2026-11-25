import { ensureOperator } from "./testing/cancel-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kitchenStations,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedActivityActor } from "@waitron/db/testing/seed.js";
import {
  addProductToMenu,
  createMenu,
  createExtraList,
  createProduct,
  readProductModifiers,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
} from "@waitron/menu";
import type { ExtraSelection } from "@waitron/shared";
import {
  createServiceZone,
  readBusinessDayScheduleRevision,
  replaceMenuWeek,
  saveMenuPeriod,
  setRoutingCell,
  setStationToday,
  updateDepartment,
  updateMenuPeriod,
} from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { createStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  createBareDepartment,
  provisionSignedInTill,
  sendAsTill,
} from "./testing/signed-in-till.js";
import type { LateSendConfirmation } from "./late-send.js";
import { updateHeldOrder, updateOrderLine } from "./working-order-held-write.js";
import { createOpenOrder } from "./working-order-open.js";
import { lateUnsentDishes } from "./working-order-late-send.js";
import { fireableLineColumns } from "./working-order-kitchen-fire.js";
import { readBillEditState } from "./bill-editing.js";
import { createTable } from "./testing/live-table.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { openPartyTab } from "./testing/serve-line.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

afterEach(() => {
  vi.useRealTimers();
});

const at = (time: string, day = "2026-10-05") => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${day}T${time}:00+02:00`));
};

let nifCounter = 0;

/** The person `openPartyTab` seats a party as. */
const OPERATOR = "cccccccc-0000-4000-8000-0000000000f1";

/**
 * Lunch sells Set lunch 12:00–14:00 and Dinner sells Brunch 19:00–23:00 on the given weekdays
 * (Monday by default), each with Drinks and Coffee as staff menus. The Toast is on both: 4.00 on
 * Set lunch, 2.50 on Brunch. The Salad is on Set lunch alone, with an Avocado extras list offering
 * Avocado and Egg. The Beer is on Drinks. The Juice is on Set lunch and Brunch, and only Set lunch's
 * live version lists its Small variant.
 */
async function mealVenue(weekdays: readonly number[] = [1], lunchEndsAt = "14:00") {
  return provisionSignedInTill(suite.db, {
    taxId: nifWithControlLetter(72_000_000 + ++nifCounter),
    dayCutover: "05:00",
    seed: async (tx, cfg) => {
      const effective = new Date("2026-10-05T10:00:00+02:00");
      const restaurant = await createBareDepartment(tx, "Restaurant", effective);
      const diningZone = (
        await createServiceZone(tx, { name: "Dining room", departmentId: restaurant })
      ).id;
      const menu = async (name: string) => (await createMenu(tx, { name })).id;
      const menus = {
        brunch: await menu("Brunch"),
        setLunch: await menu("Set lunch"),
        drinks: await menu("Drinks"),
        coffee: await menu("Coffee"),
      };
      const product = async (name: string, unitPrice: string) =>
        (
          await createProduct(tx, {
            categoryId: null,
            name,
            pricingUnit: "each",
            unitPrice,
            vatClass: "general",
          })
        ).id;
      const toastId = await product("Toast", "3.00");
      const saladId = await product("Salad", "8.00");
      const offer = async (menuId: string, productId: string, grossPrice: string) =>
        (await addProductToMenu(tx, { menuId, productId, grossPrice })).id;
      const toast = {
        brunch: await offer(menus.brunch, toastId, "2.50"),
        setLunch: await offer(menus.setLunch, toastId, "4.00"),
      };
      const salad = await offer(menus.setLunch, saladId, "8.00");
      const avocadoId = await product("Avocado", "1.50");
      const eggId = await product("Egg", "1.00");
      const avocadoList = (
        await createExtraList(
          tx,
          {
            name: "Avocado",
            minPicks: 0,
            maxPicks: null,
            items: [
              { productId: avocadoId, maxQuantity: 1, price: "1.00" },
              { productId: eggId, maxQuantity: 1, price: "1.00" },
            ],
          },
          cfg.locale,
        )
      ).id;
      const carried = (await readProductModifiers(tx, [saladId])).get(saladId) ?? [];
      await writeProductModifiers(tx, saladId, [
        ...carried.map((each) => ({ kind: each.kind, id: each.id })),
        { kind: "extras", id: avocadoList },
      ]);
      const beer = await offer(menus.drinks, await product("Beer", "2.00"), "2.00");
      const juiceId = await product("Juice", "3.00");
      const variant = (name: string, unitPrice: string) => ({
        name,
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice,
        available: true,
      });
      const [large] = await setProductVariants(tx, juiceId, [variant("Large", "3.50")], cfg.locale);
      const juice = {
        setLunch: await offer(menus.setLunch, juiceId, "3.00"),
        brunch: await offer(menus.brunch, juiceId, "3.00"),
      };
      for (const menuId of Object.values(menus)) await publishWorkingMenu(tx, menuId);
      // Small is added after Brunch was published, so only Set lunch's live version lists it.
      const [, small] = await setProductVariants(
        tx,
        juiceId,
        [{ ...variant("Large", "3.50"), id: large!.id }, variant("Small", "2.50")],
        cfg.locale,
      );
      await publishWorkingMenu(tx, menus.setLunch);
      const period = async (name: string, menuId: string) =>
        (
          await saveMenuPeriod(tx, restaurant, {
            name,
            menuId,
            staffMenuIds: [menus.drinks, menus.coffee],
          })
        ).id;
      const lunch = await period("Lunch", menus.setLunch);
      const dinner = await period("Dinner", menus.brunch);
      await replaceMenuWeek(
        tx,
        restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekdays.includes(weekday)
            ? [
                { periodId: lunch, startsAt: "12:00", endsAt: lunchEndsAt },
                { periodId: dinner, startsAt: "19:00", endsAt: "23:00" },
              ]
            : [],
        })),
        effective,
        1,
      );
      return {
        departmentId: restaurant,
        startingZoneId: diningZone,
        restaurant,
        diningZone,
        lunch,
        dinner,
        menus,
        toastId,
        toast,
        salad,
        saladId,
        avocado: { listId: avocadoList, productId: avocadoId },
        eggId,
        beer,
        juice,
        variants: { large: large!.id, small: small!.id },
      };
    },
  });
}

type MealVenue = Awaited<ReturnType<typeof mealVenue>>;

type Line = {
  menuItemId: string;
  makeAt?: string;
  quantity: string;
  variantId?: string;
  extras?: ExtraSelection[];
};

const open = (v: MealVenue, lines: Line[], id = randomUUID(), lateSend?: LateSendConfirmation) =>
  withTransaction(suite.db, (tx) =>
    createOpenOrder(
      tx,
      { ...v.cfg, origin: { source: "readiness_test", deviceId: null } },
      id,
      lines,
      null,
      { zoneId: v.diningZone, ...(lateSend === undefined ? {} : { lateSend }) },
    ),
  );

/** A confirmation covering `menuIds`, confirmed by `personId`. */
const confirming = (menuIds: string[], personId = randomUUID()) => ({
  personId,
  lateSend: {
    menuIds: new Set(menuIds),
    confirm: vi.fn<LateSendConfirmation["confirm"]>((tx) => ensureOperator(tx, personId)),
  },
});

const marksOf = (id: string) =>
  suite.db
    .select({
      latePeriodName: workingOrderLines.latePeriodName,
      lateConfirmedBy: workingOrderLines.lateConfirmedBy,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));

const linesOf = (id: string) =>
  suite.db
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));

const revisionOf = async (id: string) =>
  (
    (await suite.db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id))) as [{ revision: number }]
  )[0].revision;

const orderRows = (id: string) =>
  suite.db.select({ id: workingOrders.id }).from(workingOrders).where(eq(workingOrders.id, id));

const sendAtTable = (v: MealVenue, lines: Line[], lateSend?: LateSendConfirmation) =>
  withTransaction(suite.db, async (tx) => {
    await updateDepartment(tx, v.restaurant, { orderStart: "table" });
    const table = await createTable(tx, { label: randomUUID(), zoneId: v.diningZone });
    const cfg = { ...v.cfg, origin: { source: "readiness_test", deviceId: null } } as const;
    const { tabId, partyId } = await openPartyTab(tx, cfg, { tableId: table.id });
    await placeGroups(tx, cfg, partyId, {
      operatorId: OPERATOR,
      billId: tabId,
      groups: [{ lines, release: "fire" }],
      ...(lateSend === undefined ? {} : { lateSend }),
    });
    return tabId;
  });

async function venueWithLastOrders() {
  const v = await mealVenue([1], "15:00");
  const stations = await withTransaction(suite.db, async (tx) => {
    const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
    const bar = await createStation(tx, { name: "Bar" });
    await setRoutingCell(
      tx,
      { row: { kind: "product", productId: v.toastId }, zoneId: v.diningZone },
      { kind: "station", stationId: bar.id },
      [{ periodId: v.lunch, target: { kind: "station", stationId: kitchen.id } }],
    );
    await updateMenuPeriod(tx, v.lunch, {
      lastOrders: [
        { kind: "station", stationId: kitchen.id, minutes: -15 },
        { kind: "station", stationId: bar.id, minutes: 60 },
      ],
    });
    return { kitchen: kitchen.id, bar: bar.id };
  });
  return { ...v, stations };
}

it("asks before sending a main at Kitchen's cutoff while Lunch still runs", async () => {
  at("14:45");
  const v = await venueWithLastOrders();
  const id = randomUUID();
  await expect(open(v, [{ menuItemId: v.salad, quantity: "1" }], id)).rejects.toMatchObject({
    code: "menu_period.ended",
    params: {
      menus: [{ menuId: v.menus.setLunch, periodName: "Lunch" }],
      menuItemIds: [v.salad],
    },
  });
  expect(await orderRows(id)).toEqual([]);
});

it.each([
  ["14:44", "kitchen"],
  ["14:45", "bar"],
  ["15:20", "bar"],
] as const)("sends and keeps the Lunch price at %s, at %s", async (time, destination) => {
  at(time);
  const v = await venueWithLastOrders();
  const id = await sendAtTable(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }]);
  const sent = await suite.db
    .select({ stationId: ticketItems.stationId, price: workingOrderLines.unitPriceGross })
    .from(workingOrderLines)
    .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, id));
  expect(sent).toEqual([{ stationId: v.stations[destination], price: 400 }]);
});

it("asks at Bar's cutoff for a Lunch dish it took over", async () => {
  at("16:00");
  const v = await venueWithLastOrders();
  await expect(open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }])).rejects.toMatchObject({
    code: "menu_period.ended",
    params: { menuItemIds: [v.toast.setLunch] },
  });
});

it.each([
  [false, false],
  [true, false],
  [false, true],
])(
  "sends an agreed dessert to Bar or its stand-in (closed: %s, agreed at Place: %s)",
  async (closed, onPlace) => {
    at(onPlace ? "14:44" : "16:00");
    const v = await venueWithLastOrders();
    const { lateSend } = confirming([v.menus.setLunch]);
    const id = randomUUID();
    await open(
      v,
      [{ menuItemId: v.toast.setLunch, quantity: "1" }],
      id,
      onPlace ? undefined : lateSend,
    );
    const destination = closed
      ? await withTransaction(suite.db, async (tx) => {
          const standIn = await createStation(tx, { name: "Terrace bar" });
          await setStationToday(
            tx,
            v.stations.bar,
            "closed",
            new Date(),
            await seedActivityActor(tx),
            standIn.id,
          );
          return standIn.id;
        })
      : v.stations.bar;
    at("16:15");
    const reply = await sendAsTill(
      v,
      "POST",
      `/api/working-orders/${id}/place`,
      onPlace ? { lateSend: { menuIds: [v.menus.setLunch] } } : undefined,
    );
    expect(reply).toMatchObject({ status: 200 });
    const [line] = await linesOf(id);
    expect(
      await suite.db
        .select({
          stationId: ticketItems.stationId,
          agreedStationId: workingOrderLines.lateStationId,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(ticketItems.workingOrderLineId, line!.id)),
    ).toEqual([{ stationId: destination, agreedStationId: v.stations.bar }]);
  },
);

it("keeps an extra with its dish when Bar agreed and their Lunch routes match", async () => {
  at("16:00");
  const v = await venueWithLastOrders();
  await withTransaction(suite.db, (tx) =>
    setRoutingCell(
      tx,
      { row: { kind: "all" }, zoneId: v.diningZone },
      { kind: "station", stationId: v.stations.bar },
      [{ periodId: v.lunch, target: { kind: "station", stationId: v.stations.kitchen } }],
    ),
  );
  const { lateSend } = confirming([v.menus.setLunch]);
  const id = await sendAtTable(
    v,
    [
      {
        menuItemId: v.salad,
        quantity: "1",
        extras: [
          { listId: v.avocado.listId, picks: [{ productId: v.avocado.productId, quantity: 1 }] },
        ],
      },
    ],
    lateSend,
  );
  expect(await linesOf(id)).toHaveLength(2);
  expect(
    await suite.db
      .select({ stationId: ticketItems.stationId })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, id)),
  ).toEqual([{ stationId: v.stations.bar }]);
});

it("names the period that stopped last when only Lunch has offsets", async () => {
  at("23:10");
  const v = await venueWithLastOrders();
  await expect(open(v, [{ menuItemId: v.beer, quantity: "1" }])).rejects.toMatchObject({
    code: "menu_period.ended",
    params: { menus: [{ menuId: v.menus.drinks, periodName: "Dinner" }] },
  });
});

it("keeps an unroutable Dinner dish out of the Lunch refusal", async () => {
  at("19:30");
  const v = await venueWithLastOrders();
  const { kitchen, bar } = v.stations;
  await withTransaction(suite.db, async (tx) => {
    await tx
      .update(kitchenStations)
      .set({ isDefault: false })
      .where(eq(kitchenStations.id, kitchen));
    await setStationToday(tx, bar, "closed", new Date(), await seedActivityActor(tx));
  });
  const send = sendAtTable(v, [{ menuItemId: v.toast.brunch, quantity: "1" }]);
  await expect(send).rejects.toMatchObject({ code: "station.no_replacement" });
});

it.each(["19:30", "22:50"])(
  "checks Dinner's route for a dish it also sells at %s",
  async (time) => {
    at(time);
    const v = await venueWithLastOrders();
    if (time === "22:50")
      await withTransaction(suite.db, async (tx) => {
        await updateMenuPeriod(tx, v.lunch, { lastOrders: [] });
        await updateMenuPeriod(tx, v.dinner, {
          lastOrders: [{ kind: "station", stationId: v.stations.bar, minutes: -15 }],
        });
      });
    const send = open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }]);
    if (time === "19:30") {
      await expect(send).resolves.toMatchObject({ gross: { total: "4.00" } });
    } else {
      await expect(send).rejects.toMatchObject({ code: "menu_period.ended" });
    }
  },
);

it("asks before placing a parked main once Kitchen stops", async () => {
  at("14:44");
  const v = await venueWithLastOrders();
  const id = randomUUID();
  await open(v, [{ menuItemId: v.salad, quantity: "1" }], id);
  at("14:45");
  const reply = await sendAsTill(v, "POST", `/api/working-orders/${id}/place`);
  expect(reply).toMatchObject({ status: 409, body: { error: { code: "menu_period.ended" } } });
});

it("uses Lunch's cutoff after a parked dish moves to another department", async () => {
  at("14:44");
  const v = await venueWithLastOrders();
  const id = randomUUID();
  await open(v, [{ menuItemId: v.salad, quantity: "1" }], id);
  await withTransaction(suite.db, async (tx) => {
    const dept = await createBareDepartment(tx, "Terrace", new Date());
    const { id: zone } = await createServiceZone(tx, { name: "Terrace", departmentId: dept });
    const { id: terrace } = await saveMenuPeriod(tx, dept, {
      name: "All day",
      menuId: v.menus.setLunch,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      dept,
      Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        slots: [{ periodId: terrace, startsAt: "05:00", endsAt: "05:00" }],
      })),
      new Date(),
      await readBusinessDayScheduleRevision(tx),
    );
    await setRoutingCell(
      tx,
      { row: { kind: "product", productId: v.saladId }, zoneId: zone },
      { kind: "station", stationId: v.stations.bar },
      [{ periodId: terrace, target: { kind: "station", stationId: v.stations.kitchen } }],
    );
    await VENUE_SERVICE.retargetOrderContext(tx, id, zone);
  });
  at("14:45");
  await expect(
    withTransaction(suite.db, async (tx) => {
      const lines = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      await lateUnsentDishes(tx, id, lines, { ask: undefined });
    }),
  ).rejects.toMatchObject({
    code: "menu_period.ended",
    params: { menus: [{ menuId: v.menus.setLunch, periodName: "Lunch" }] },
  });
});

it.each([
  ["14:45", "salad", false],
  ["15:20", "toast", true],
  ["19:30", "toast", false],
] as const)(
  "checks whether the original dish can be increased at %s",
  async (time, dish, allowed) => {
    at("14:44");
    const v = await venueWithLastOrders();
    const menuItemId = dish === "salad" ? v.salad : v.toast.setLunch;
    const id = randomUUID();
    await open(v, [{ menuItemId, quantity: "1" }], id);
    const before = await linesOf(id);
    at(time);
    const edit = updateHeldOrder({ admission: testTradingAdmission(), db: suite.db }, v.cfg, id, {
      revision: await revisionOf(id),
      expectedEdit: null,
      lines: [{ workingOrderLineId: before[0]!.id, menuItemId, quantity: "2" }],
    });
    if (allowed) {
      await edit;
      expect((await linesOf(id)).map(({ quantity }) => quantity).reduce((a, b) => a + b, 0)).toBe(
        2000,
      );
    } else {
      await expect(edit).rejects.toMatchObject({ code: "menu_period.last_orders" });
      expect(await linesOf(id)).toEqual(before);
    }
  },
);

describe("a dish whose period ended earlier today", () => {
  it("is refused menu_period.ended at 14:05, naming its department, menu, period and offer", async () => {
    at("14:05");
    const v = await mealVenue();
    const id = randomUUID();
    await expect(
      open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], id),
    ).rejects.toMatchObject({
      code: "menu_period.ended",
      params: {
        departmentId: v.restaurant,
        menus: [{ menuId: v.menus.setLunch, periodName: "Lunch" }],
        menuItemIds: [v.toast.setLunch],
        needsManager: false,
      },
    });
    expect(await orderRows(id)).toEqual([]);
  });

  it.each(["19:00", "19:30"])(
    "is accepted at %s at its taken price when the running period also sells it",
    async (time) => {
      at(time);
      const v = await mealVenue();
      const id = randomUUID();
      await open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], id);
      expect(await linesOf(id)).toMatchObject([{ unitPriceGross: 400 }]);
      expect(
        await suite.db
          .select({
            latePeriodName: workingOrderLines.latePeriodName,
            lateConfirmedBy: workingOrderLines.lateConfirmedBy,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id)),
      ).toEqual([{ latePeriodName: null, lateConfirmedBy: null }]);
    },
  );

  it("answers product.unavailable, not menu_period.ended, when it is sold out", async () => {
    at("14:05");
    const v = await mealVenue();
    await withTransaction(suite.db, (tx) => updateProduct(tx, v.toastId, { available: false }));
    await expect(open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }])).rejects.toMatchObject({
      code: "product.unavailable",
      params: { productId: v.toastId },
    });
  });

  it("makes one productsOfferedIn read for a basket of ended dishes, and none without one", async () => {
    const offeredIn = vi.spyOn(VENUE_SERVICE, "productsOfferedIn");
    try {
      at("13:00");
      const v = await mealVenue();
      await open(
        v,
        [1, 2, 3].map(() => ({ menuItemId: v.salad, quantity: "1" })),
      );
      expect(offeredIn).not.toHaveBeenCalled();
      at("19:30");
      await expect(
        open(v, [
          ...[1, 2, 3].map(() => ({ menuItemId: v.salad, quantity: "1" })),
          ...[1, 2].map(() => ({ menuItemId: v.toast.setLunch, quantity: "1" })),
        ]),
      ).rejects.toMatchObject({
        code: "menu_period.ended",
        params: {
          menus: [{ menuId: v.menus.setLunch, periodName: "Lunch" }],
          menuItemIds: [v.salad],
        },
      });
      expect(offeredIn).toHaveBeenCalledTimes(1);
    } finally {
      offeredIn.mockRestore();
    }
  });

  it("names each ended menu once, in the order its dishes appear", async () => {
    at("17:00");
    const v = await mealVenue();
    await expect(
      open(v, [
        { menuItemId: v.toast.setLunch, quantity: "1" },
        { menuItemId: v.beer, quantity: "1" },
        { menuItemId: v.salad, quantity: "1" },
        { menuItemId: v.beer, quantity: "1" },
      ]),
    ).rejects.toMatchObject({
      code: "menu_period.ended",
      params: {
        menus: [
          { menuId: v.menus.setLunch, periodName: "Lunch" },
          { menuId: v.menus.drinks, periodName: "Lunch" },
        ],
        menuItemIds: [v.toast.setLunch, v.beer, v.salad],
      },
    });
  });

  it("is also sold at 19:30 only in a variant the running menu lists", async () => {
    at("19:30");
    const v = await mealVenue();
    const id = randomUUID();
    await open(
      v,
      [{ menuItemId: v.juice.setLunch, variantId: v.variants.large, quantity: "1" }],
      id,
    );
    expect(await linesOf(id)).toMatchObject([{ unitPriceGross: 350 }]);
    await expect(
      open(v, [{ menuItemId: v.juice.setLunch, variantId: v.variants.small, quantity: "1" }]),
    ).rejects.toMatchObject({
      code: "menu_period.ended",
      params: { menuItemIds: [v.juice.setLunch] },
    });
  });

  it("is refused menu_period.ended at 19:30 when the running menu offers it only as not sold separately, and writes nothing", async () => {
    at("19:30");
    const v = await mealVenue();
    await withTransaction(suite.db, async (tx) => {
      await updateProduct(tx, v.toastId, { ordering: "not_sold_separately" });
      // Only Brunch is published again, so Set lunch's live version still sells it on its own.
      await publishWorkingMenu(tx, v.menus.brunch);
      await updateDepartment(tx, v.restaurant, { lateSendNeedsManager: true });
    });
    await expect(open(v, [{ menuItemId: v.toast.brunch, quantity: "1" }])).rejects.toMatchObject({
      code: "product.not_sold_separately",
    });
    const id = randomUUID();
    await expect(
      open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], id),
    ).rejects.toMatchObject({
      code: "menu_period.ended",
      params: {
        menus: [{ menuId: v.menus.setLunch, periodName: "Lunch" }],
        menuItemIds: [v.toast.setLunch],
        needsManager: true,
      },
    });
    expect(await orderRows(id)).toEqual([]);
  });

  it("is accepted at its taken price and marked when a confirmation covers its menu", async () => {
    at("14:05");
    const v = await mealVenue();
    const { personId, lateSend } = confirming([v.menus.setLunch]);
    const id = randomUUID();
    await open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], id, lateSend);
    expect(await linesOf(id)).toMatchObject([{ unitPriceGross: 400 }]);
    expect(await marksOf(id)).toEqual([{ latePeriodName: "Lunch", lateConfirmedBy: personId }]);
    expect(lateSend.confirm).toHaveBeenCalledTimes(1);
    expect(lateSend.confirm).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("marks every row of a confirmed dish, its extras' rows included", async () => {
    at("14:05");
    const v = await mealVenue();
    const { personId, lateSend } = confirming([v.menus.setLunch]);
    const id = randomUUID();
    await open(
      v,
      [
        {
          menuItemId: v.salad,
          quantity: "1",
          extras: [
            { listId: v.avocado.listId, picks: [{ productId: v.avocado.productId, quantity: 1 }] },
          ],
        },
      ],
      id,
      lateSend,
    );
    expect(await linesOf(id)).toHaveLength(2);
    expect(await marksOf(id)).toEqual([
      { latePeriodName: "Lunch", lateConfirmedBy: personId },
      { latePeriodName: "Lunch", lateConfirmedBy: personId },
    ]);
  });

  it("is refused menu_period.ended when the confirmation covers another menu, and writes nothing", async () => {
    at("14:05");
    const v = await mealVenue();
    const { lateSend } = confirming([v.menus.drinks]);
    const id = randomUUID();
    await expect(
      open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], id, lateSend),
    ).rejects.toMatchObject({
      code: "menu_period.ended",
      params: { menus: [{ menuId: v.menus.setLunch, periodName: "Lunch" }] },
    });
    expect(lateSend.confirm).not.toHaveBeenCalled();
    expect(await orderRows(id)).toEqual([]);
  });

  it("is refused menu_period.ended when the confirmation covers only some late menus, and writes nothing", async () => {
    at("14:05");
    const v = await mealVenue();
    const { lateSend } = confirming([v.menus.setLunch]);
    const id = randomUUID();
    await expect(
      open(
        v,
        [
          { menuItemId: v.toast.setLunch, quantity: "1" },
          { menuItemId: v.beer, quantity: "1" },
        ],
        id,
        lateSend,
      ),
    ).rejects.toMatchObject({ code: "menu_period.ended" });
    expect(lateSend.confirm).not.toHaveBeenCalled();
    expect(await orderRows(id)).toEqual([]);
  });

  it("marks only the late dish, not an also-sold dish beside it", async () => {
    at("19:30");
    const v = await mealVenue();
    const { personId, lateSend } = confirming([v.menus.setLunch]);
    const id = randomUUID();
    await open(
      v,
      [
        { menuItemId: v.salad, quantity: "1" },
        { menuItemId: v.toast.setLunch, quantity: "1" },
      ],
      id,
      lateSend,
    );
    const marks = await suite.db
      .select({
        unitPriceGross: workingOrderLines.unitPriceGross,
        latePeriodName: workingOrderLines.latePeriodName,
        lateConfirmedBy: workingOrderLines.lateConfirmedBy,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(marks).toHaveLength(2);
    expect(marks).toEqual(
      expect.arrayContaining([
        { unitPriceGross: 800, latePeriodName: "Lunch", lateConfirmedBy: personId },
        { unitPriceGross: 400, latePeriodName: null, lateConfirmedBy: null },
      ]),
    );
  });

  it("asks the confirmation with the department's own manager setting", async () => {
    at("14:05");
    const v = await mealVenue();
    await withTransaction(suite.db, (tx) =>
      updateDepartment(tx, v.restaurant, { lateSendNeedsManager: true }),
    );
    const { lateSend } = confirming([v.menus.setLunch]);
    await open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], randomUUID(), lateSend);
    expect(lateSend.confirm).toHaveBeenCalledTimes(1);
    expect(lateSend.confirm).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("answers product.unavailable when it is sold out, even with a confirmation", async () => {
    at("14:05");
    const v = await mealVenue();
    await withTransaction(suite.db, (tx) => updateProduct(tx, v.toastId, { available: false }));
    const { lateSend } = confirming([v.menus.setLunch]);
    await expect(
      open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], randomUUID(), lateSend),
    ).rejects.toMatchObject({ code: "product.unavailable", params: { productId: v.toastId } });
    expect(lateSend.confirm).not.toHaveBeenCalled();
  });

  it("asks no confirmation when nothing is late", async () => {
    at("19:30");
    const v = await mealVenue();
    const { lateSend } = confirming([v.menus.setLunch]);
    const id = randomUUID();
    await open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], id, lateSend);
    expect(lateSend.confirm).not.toHaveBeenCalled();
    expect(await marksOf(id)).toEqual([{ latePeriodName: null, lateConfirmedBy: null }]);
  });
});

describe("a dish whose period has not ended today", () => {
  it.each([false, true])(
    "is refused menu_period.not_running before its period starts (confirmation sent: %s)",
    async (confirmed) => {
      at("13:00");
      const v = await mealVenue();
      const { lateSend } = confirming([v.menus.brunch]);
      await expect(
        open(
          v,
          [{ menuItemId: v.toast.brunch, quantity: "1" }],
          randomUUID(),
          confirmed ? lateSend : undefined,
        ),
      ).rejects.toMatchObject({
        code: "menu_period.not_running",
        params: { departmentId: v.restaurant, menuId: v.menus.brunch },
      });
      expect(lateSend.confirm).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "is refused menu_period.not_running the morning after its period ran (confirmation sent: %s)",
    async (confirmed) => {
      at("10:00", "2026-10-06");
      const v = await mealVenue([1, 2]);
      const { lateSend } = confirming([v.menus.setLunch]);
      await expect(
        open(
          v,
          [{ menuItemId: v.toast.setLunch, quantity: "1" }],
          randomUUID(),
          confirmed ? lateSend : undefined,
        ),
      ).rejects.toMatchObject({
        code: "menu_period.not_running",
        params: { departmentId: v.restaurant, menuId: v.menus.setLunch },
      });
      expect(lateSend.confirm).not.toHaveBeenCalled();
    },
  );
});

describe("a raised quantity of a stored line", () => {
  it("keeps menu_period.not_running after its period ends, beside a fresh dish of that period, and changes nothing", async () => {
    at("13:50");
    const v = await mealVenue();
    const id = randomUUID();
    await open(v, [{ menuItemId: v.toast.setLunch, quantity: "1" }], id);
    const before = await linesOf(id);
    const revision = await revisionOf(id);
    at("14:05");
    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db: suite.db }, v.cfg, id, {
        revision,
        expectedEdit: null,
        lines: [
          { workingOrderLineId: before[0]!.id, menuItemId: v.toast.setLunch, quantity: "2" },
          { menuItemId: v.salad, quantity: "1" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "menu_period.not_running",
      params: { departmentId: v.restaurant, menuId: v.menus.setLunch },
    });
    expect(await linesOf(id)).toEqual(before);
  });
});

describe("extras added later to a stored dish", () => {
  const avocadoOn = (v: MealVenue, saladLineId: string) => ({
    workingOrderLineId: saladLineId,
    menuItemId: v.salad,
    quantity: "1",
    extras: [
      { listId: v.avocado.listId, picks: [{ productId: v.avocado.productId, quantity: 1 }] },
    ],
  });
  const editState = (id: string) => withTransaction(suite.db, (tx) => readBillEditState(tx, id));
  const addAvocado = async (v: MealVenue, id: string, lateSend?: LateSendConfirmation) => {
    const [salad] = await linesOf(id);
    return updateHeldOrder({ admission: testTradingAdmission(), db: suite.db }, v.cfg, id, {
      revision: await revisionOf(id),
      operatorId: OPERATOR,
      expectedEdit: await editState(id),
      lines: [avocadoOn(v, salad!.id)],
      ...(lateSend === undefined ? {} : { lateSend }),
    });
  };
  /** The Salad's mark, then its Avocado's. */
  const saladThenAvocado = async (id: string) =>
    (
      await suite.db
        .select({
          parentLineId: workingOrderLines.parentLineId,
          latePeriodName: workingOrderLines.latePeriodName,
          lateConfirmedBy: workingOrderLines.lateConfirmedBy,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
    )
      .sort((a, b) => Number(a.parentLineId !== null) - Number(b.parentLineId !== null))
      .map(({ latePeriodName, lateConfirmedBy }) => ({ latePeriodName, lateConfirmedBy }));

  it.each([
    ["bar", "14:45", true],
    ["kitchen", "14:45", false],
    ["kitchen", "19:30", true],
  ] as const)(
    "judges an extra by the %s that took its dish at %s",
    async (station, time, allowed) => {
      at("14:44");
      const v = await venueWithLastOrders();
      if (time === "19:30")
        await withTransaction(suite.db, async (tx) => {
          await addProductToMenu(tx, { menuId: v.menus.brunch, productId: v.saladId });
          await publishWorkingMenu(tx, v.menus.brunch);
        });
      const id = await sendAtTable(v, [
        { menuItemId: v.salad, quantity: "1", makeAt: v.stations[station] },
      ]);
      at(time);
      if (allowed) await addAvocado(v, id);
      else await expect(addAvocado(v, id)).rejects.toMatchObject({ code: "menu_period.ended" });
      const unmarked = { latePeriodName: null, lateConfirmedBy: null };
      expect(await marksOf(id)).toEqual(allowed ? [unmarked, unmarked] : [unmarked]);
    },
  );

  it("are refused menu_period.ended after the period of an on-time dish, and write nothing", async () => {
    at("13:50");
    const v = await mealVenue();
    const id = await sendAtTable(v, [{ menuItemId: v.salad, quantity: "1" }]);
    const before = await linesOf(id);
    const revision = await revisionOf(id);
    at("14:05");
    await expect(addAvocado(v, id)).rejects.toMatchObject({
      code: "menu_period.ended",
      params: {
        departmentId: v.restaurant,
        menus: [{ menuId: v.menus.setLunch, periodName: "Lunch" }],
        menuItemIds: [v.salad],
        needsManager: false,
      },
    });
    expect(await linesOf(id)).toEqual(before);
    expect(await revisionOf(id)).toBe(revision);
  });

  it("are marked with the new confirmation, leaving the stored dish's context as it was", async () => {
    at("13:50");
    const v = await mealVenue();
    const id = await sendAtTable(v, [{ menuItemId: v.salad, quantity: "1" }]);
    at("14:05");
    const { personId, lateSend } = confirming([v.menus.setLunch]);
    await addAvocado(v, id, lateSend);
    expect(await linesOf(id)).toHaveLength(2);
    expect(await saladThenAvocado(id)).toEqual([
      { latePeriodName: null, lateConfirmedBy: null },
      { latePeriodName: "Lunch", lateConfirmedBy: personId },
    ]);
    expect(lateSend.confirm).toHaveBeenCalledTimes(1);
  });

  it("on a dish sent late record who confirmed the extra, not who confirmed the dish", async () => {
    at("14:05");
    const v = await mealVenue();
    const dish = confirming([v.menus.setLunch]);
    const id = await sendAtTable(v, [{ menuItemId: v.salad, quantity: "1" }], dish.lateSend);
    at("14:10");
    const extra = confirming([v.menus.setLunch]);
    await addAvocado(v, id, extra.lateSend);
    expect(await saladThenAvocado(id)).toEqual([
      { latePeriodName: "Lunch", lateConfirmedBy: dish.personId },
      { latePeriodName: "Lunch", lateConfirmedBy: extra.personId },
    ]);
    expect(extra.lateSend.confirm).toHaveBeenCalledTimes(1);
  });

  it("on a parked dish not yet sent ask nothing after the period and are not marked", async () => {
    at("13:50");
    const v = await mealVenue();
    const id = randomUUID();
    await open(v, [{ menuItemId: v.salad, quantity: "1" }], id);
    at("14:05");
    await addAvocado(v, id);
    expect(await linesOf(id)).toHaveLength(2);
    expect(await saladThenAvocado(id)).toEqual([
      { latePeriodName: null, lateConfirmedBy: null },
      { latePeriodName: null, lateConfirmedBy: null },
    ]);
  });

  it("ask nothing and are not marked while the period runs", async () => {
    at("13:00");
    const v = await mealVenue();
    const id = await sendAtTable(v, [{ menuItemId: v.salad, quantity: "1" }]);
    at("13:50");
    await addAvocado(v, id);
    expect(await linesOf(id)).toHaveLength(2);
    expect(await saladThenAvocado(id)).toEqual([
      { latePeriodName: null, lateConfirmedBy: null },
      { latePeriodName: null, lateConfirmedBy: null },
    ]);
  });

  describe("through the one-line edit", () => {
    const addOnLine = async (v: MealVenue, id: string, lateSend?: LateSendConfirmation) => {
      const [salad] = await suite.db
        .select({ lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      const revision = await revisionOf(id);
      const expectedEdit = await editState(id);
      return withTransaction(suite.db, (tx) =>
        updateOrderLine(
          tx,
          v.cfg,
          id,
          salad!.lineNo,
          {
            portionLineNos: [],
            extras: avocadoOn(v, "").extras,
          },
          revision,
          { operatorId: OPERATOR, expectedEdit, admission: testTradingAdmission() },
          undefined,
          lateSend,
        ),
      );
    };

    it("are refused menu_period.ended without a confirmation, and marked with one", async () => {
      at("13:50");
      const v = await mealVenue();
      const id = await sendAtTable(v, [{ menuItemId: v.salad, quantity: "1" }]);
      const before = await linesOf(id);
      at("14:05");
      await expect(addOnLine(v, id)).rejects.toMatchObject({
        code: "menu_period.ended",
        params: { menuItemIds: [v.salad] },
      });
      expect(await linesOf(id)).toEqual(before);
      const { personId, lateSend } = confirming([v.menus.setLunch]);
      await addOnLine(v, id, lateSend);
      expect(await saladThenAvocado(id)).toEqual([
        { latePeriodName: null, lateConfirmedBy: null },
        { latePeriodName: "Lunch", lateConfirmedBy: personId },
      ]);
    });
  });
});
