import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workingOrderLines, workingOrders, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addProductToMenu,
  createCatalogue,
  createProduct,
  updateProduct,
} from "@waitron/catalogue";
import {
  createServiceZone,
  replaceMenuWeek,
  saveMenuPeriod,
  workingLineContexts,
} from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { VENUE_SERVICE } from "./modules.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { createBareDepartment, provisionSignedInTill } from "./testing/signed-in-till.js";
import { createOpenOrder, updateHeldOrder } from "./working-order.js";

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

/**
 * Lunch sells Almuerzo 12:00–14:00 and Dinner sells Desayunos 19:00–23:00 on the given weekdays
 * (Monday by default), each with Bebidas and Café as staff menus. The Tostada is on both: 4.00 on
 * Almuerzo, 2.50 on Desayunos. The Ensalada is on Almuerzo alone.
 */
async function mealVenue(weekdays: readonly number[] = [1]) {
  return provisionSignedInTill(suite.db, {
    taxId: nifWithControlLetter(72_000_000 + ++nifCounter),
    dayCutover: "05:00",
    seed: async (tx, cfg) => {
      const effective = new Date("2026-10-05T10:00:00+02:00");
      const restaurant = await createBareDepartment(tx, cfg, "Restaurant", effective);
      const diningZone = (
        await createServiceZone(tx, cfg, { name: "Sala", departmentId: restaurant })
      ).id;
      const menu = async (name: string) => (await createCatalogue(tx, { name })).id;
      const menus = {
        desayunos: await menu("Desayunos"),
        almuerzo: await menu("Almuerzo"),
        bebidas: await menu("Bebidas"),
        cafe: await menu("Café"),
      };
      const product = async (catalogueId: string, name: string, unitPrice: string) =>
        (
          await createProduct(tx, {
            catalogueId,
            categoryId: null,
            name,
            pricingUnit: "each",
            unitPrice,
            vatClass: "general",
          })
        ).id;
      const toastId = await product(menus.desayunos, "Tostada", "3.00");
      const saladId = await product(menus.almuerzo, "Ensalada", "8.00");
      const offer = async (menuId: string, productId: string, grossPrice: string) =>
        (await addProductToMenu(tx, { menuId, productId, grossPrice })).id;
      const toast = {
        desayunos: await offer(menus.desayunos, toastId, "2.50"),
        almuerzo: await offer(menus.almuerzo, toastId, "4.00"),
      };
      const salad = await offer(menus.almuerzo, saladId, "8.00");
      for (const menuId of Object.values(menus)) await publishWorkingMenu(tx, menuId);
      const period = async (name: string, menuId: string) =>
        (
          await saveMenuPeriod(tx, cfg, restaurant, {
            name,
            menuId,
            staffMenuIds: [menus.bebidas, menus.cafe],
          })
        ).id;
      const lunch = await period("Lunch", menus.almuerzo);
      const dinner = await period("Dinner", menus.desayunos);
      await replaceMenuWeek(
        tx,
        cfg,
        restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekdays.includes(weekday)
            ? [
                { periodId: lunch, startsAt: "12:00", endsAt: "14:00" },
                { periodId: dinner, startsAt: "19:00", endsAt: "23:00" },
              ]
            : [],
        })),
        effective,
        0,
      );
      return {
        departmentId: restaurant,
        startingZoneId: diningZone,
        restaurant,
        diningZone,
        menus,
        toastId,
        toast,
        salad,
      };
    },
  });
}

type MealVenue = Awaited<ReturnType<typeof mealVenue>>;

const open = (v: MealVenue, lines: { menuItemId: string; quantity: string }[], id = randomUUID()) =>
  withTransaction(suite.db, (tx) =>
    createOpenOrder(
      tx,
      { ...v.cfg, origin: { source: "readiness_test", deviceId: null } },
      id,
      lines,
      null,
      { zoneId: v.diningZone },
    ),
  );

const linesOf = (id: string) =>
  suite.db
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));

const orderRows = (id: string) =>
  suite.db.select({ id: workingOrders.id }).from(workingOrders).where(eq(workingOrders.id, id));

describe("a dish whose period ended earlier today", () => {
  it("is refused menu_period.ended at 14:05, naming its department, menu, period and offer", async () => {
    at("14:05");
    const v = await mealVenue();
    const id = randomUUID();
    await expect(
      open(v, [{ menuItemId: v.toast.almuerzo, quantity: "1" }], id),
    ).rejects.toMatchObject({
      code: "menu_period.ended",
      params: {
        departmentId: v.restaurant,
        menus: [{ menuId: v.menus.almuerzo, periodName: "Lunch" }],
        menuItemIds: [v.toast.almuerzo],
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
      await open(v, [{ menuItemId: v.toast.almuerzo, quantity: "1" }], id);
      expect(await linesOf(id)).toMatchObject([{ unitPriceGross: 400 }]);
      expect(
        await suite.db
          .select({
            latePeriodName: workingLineContexts.latePeriodName,
            lateConfirmedBy: workingLineContexts.lateConfirmedBy,
          })
          .from(workingLineContexts)
          .innerJoin(
            workingOrderLines,
            eq(workingOrderLines.id, workingLineContexts.workingOrderLineId),
          )
          .where(eq(workingOrderLines.workingOrderId, id)),
      ).toEqual([{ latePeriodName: null, lateConfirmedBy: null }]);
    },
  );

  it("answers product.unavailable, not menu_period.ended, when it is sold out", async () => {
    at("14:05");
    const v = await mealVenue();
    await withTransaction(suite.db, (tx) => updateProduct(tx, v.toastId, { available: false }));
    await expect(open(v, [{ menuItemId: v.toast.almuerzo, quantity: "1" }])).rejects.toMatchObject({
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
          ...[1, 2].map(() => ({ menuItemId: v.toast.almuerzo, quantity: "1" })),
        ]),
      ).rejects.toMatchObject({
        code: "menu_period.ended",
        params: { menuItemIds: [v.salad] },
      });
      expect(offeredIn).toHaveBeenCalledTimes(1);
    } finally {
      offeredIn.mockRestore();
    }
  });
});

describe("a dish whose period has not ended today", () => {
  it("is refused menu_period.not_running before its period starts", async () => {
    at("13:00");
    const v = await mealVenue();
    await expect(open(v, [{ menuItemId: v.toast.desayunos, quantity: "1" }])).rejects.toMatchObject(
      {
        code: "menu_period.not_running",
        params: { departmentId: v.restaurant, menuId: v.menus.desayunos },
      },
    );
  });

  it("is refused menu_period.not_running the morning after its period ran", async () => {
    at("10:00", "2026-10-06");
    const v = await mealVenue([1, 2]);
    await expect(open(v, [{ menuItemId: v.toast.almuerzo, quantity: "1" }])).rejects.toMatchObject({
      code: "menu_period.not_running",
      params: { departmentId: v.restaurant, menuId: v.menus.almuerzo },
    });
  });
});

describe("a raised quantity of a stored line", () => {
  it("keeps menu_period.not_running after its period ends, beside a fresh dish of that period, and changes nothing", async () => {
    at("13:50");
    const v = await mealVenue();
    const id = randomUUID();
    await open(v, [{ menuItemId: v.toast.almuerzo, quantity: "1" }], id);
    const before = await linesOf(id);
    const [{ revision }] = (await suite.db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id))) as [{ revision: number }];
    at("14:05");
    await expect(
      updateHeldOrder({ db: suite.db }, v.cfg, id, {
        revision,
        expectedEdit: null,
        lines: [
          { workingOrderLineId: before[0]!.id, menuItemId: v.toast.almuerzo, quantity: "2" },
          { menuItemId: v.salad, quantity: "1" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "menu_period.not_running",
      params: { departmentId: v.restaurant, menuId: v.menus.almuerzo },
    });
    expect(await linesOf(id)).toEqual(before);
  });
});
