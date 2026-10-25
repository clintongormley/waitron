import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workingOrderLines, workingOrders, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addProductToMenu,
  createCatalogue,
  createExtraList,
  createProduct,
  readProductModifiers,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import type { ExtraSelection } from "@waitron/shared";
import {
  createServiceZone,
  replaceMenuWeek,
  saveMenuPeriod,
  updateDepartment,
  workingLineContexts,
} from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { VENUE_SERVICE } from "./modules.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { createBareDepartment, provisionSignedInTill } from "./testing/signed-in-till.js";
import type { LateSendConfirmation } from "./late-send.js";
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
 * Lunch sells Set lunch 12:00–14:00 and Dinner sells Brunch 19:00–23:00 on the given weekdays
 * (Monday by default), each with Drinks and Coffee as staff menus. The Toast is on both: 4.00 on
 * Set lunch, 2.50 on Brunch. The Salad is on Set lunch alone, with an Avocado extras list. The
 * Beer is on Drinks. The Juice is on Set lunch and Brunch, and only Set lunch's live version lists
 * its Small variant.
 */
async function mealVenue(weekdays: readonly number[] = [1]) {
  return provisionSignedInTill(suite.db, {
    taxId: nifWithControlLetter(72_000_000 + ++nifCounter),
    dayCutover: "05:00",
    seed: async (tx, cfg) => {
      const effective = new Date("2026-10-05T10:00:00+02:00");
      const restaurant = await createBareDepartment(tx, cfg, "Restaurant", effective);
      const diningZone = (
        await createServiceZone(tx, cfg, { name: "Dining room", departmentId: restaurant })
      ).id;
      const menu = async (name: string) => (await createCatalogue(tx, { name })).id;
      const menus = {
        brunch: await menu("Brunch"),
        setLunch: await menu("Set lunch"),
        drinks: await menu("Drinks"),
        coffee: await menu("Coffee"),
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
      const toastId = await product(menus.brunch, "Toast", "3.00");
      const saladId = await product(menus.setLunch, "Salad", "8.00");
      const offer = async (menuId: string, productId: string, grossPrice: string) =>
        (await addProductToMenu(tx, { menuId, productId, grossPrice })).id;
      const toast = {
        brunch: await offer(menus.brunch, toastId, "2.50"),
        setLunch: await offer(menus.setLunch, toastId, "4.00"),
      };
      const salad = await offer(menus.setLunch, saladId, "8.00");
      const avocadoId = await product(menus.setLunch, "Avocado", "1.50");
      const avocadoList = (
        await createExtraList(
          tx,
          {
            name: "Avocado",
            minPicks: 0,
            maxPicks: null,
            items: [{ productId: avocadoId, maxQuantity: 1, price: "1.00" }],
          },
          cfg.locale,
        )
      ).id;
      const carried = (await readProductModifiers(tx, [saladId])).get(saladId) ?? [];
      await writeProductModifiers(tx, saladId, [
        ...carried.map((each) => ({ kind: each.kind, id: each.id })),
        { kind: "extras", id: avocadoList },
      ]);
      const beer = await offer(menus.drinks, await product(menus.drinks, "Beer", "2.00"), "2.00");
      const juiceId = await product(menus.setLunch, "Juice", "3.00");
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
          await saveMenuPeriod(tx, cfg, restaurant, {
            name,
            menuId,
            staffMenuIds: [menus.drinks, menus.coffee],
          })
        ).id;
      const lunch = await period("Lunch", menus.setLunch);
      const dinner = await period("Dinner", menus.brunch);
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
        avocado: { listId: avocadoList, productId: avocadoId },
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
    confirm: vi.fn(async () => personId),
  },
});

const marksOf = (id: string) =>
  suite.db
    .select({
      latePeriodName: workingLineContexts.latePeriodName,
      lateConfirmedBy: workingLineContexts.lateConfirmedBy,
    })
    .from(workingLineContexts)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, workingLineContexts.workingOrderLineId))
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

const orderRows = (id: string) =>
  suite.db.select({ id: workingOrders.id }).from(workingOrders).where(eq(workingOrders.id, id));

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
      await updateDepartment(tx, v.cfg, v.restaurant, { lateSendNeedsManager: true });
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
        latePeriodName: workingLineContexts.latePeriodName,
        lateConfirmedBy: workingLineContexts.lateConfirmedBy,
      })
      .from(workingLineContexts)
      .innerJoin(
        workingOrderLines,
        eq(workingOrderLines.id, workingLineContexts.workingOrderLineId),
      )
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
      updateDepartment(tx, v.cfg, v.restaurant, { lateSendNeedsManager: true }),
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
