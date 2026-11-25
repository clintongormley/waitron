import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { floorZones, kitchenCourses, persons, products, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin } from "@waitron/identity";
import {
  createCategory,
  createProduct,
  setProductVariants,
  createExtraList,
  menuItems,
  saveSetMenuDishCourse,
  writeProductModifiers,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import * as venueService from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { submitDraft, type Draft } from "./order-drafts.js";
import { setMenuOfferLookup } from "./set-menu-offers.js";
import { readGroupingCopies, saveBillGrouping } from "./set-menu-regroup.js";
import { mountTillApi } from "./till-api.js";
import { copyBillDishes } from "./split-after-print.js";
import { moveOrderLines, splitLinesWithinOrder } from "./working-order-transfer.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import { addGroupedTabRound } from "./testing/order-writer-fixture.js";
import {
  commandFor,
  inTx,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import {
  freezeBillLine,
  saveSetMenuDraft,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

let venue: PartyVenue;
let daily: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
let supplement: typeof daily;
let tapas: typeof daily;
let tortilla: { unpriced: string; priced: string };
// Each `setMenuOnFullMenu` gives its dish a course of its own: Flan's is Special's, Tortilla's is
// Tapas's, and Daily's copy counts Flan as Sharing.
let courses: { dessert: string; main: string; sharing: string };
let extra: { listId: string; picks: { productId: string; quantity: number }[] };
let app: Hono;
let cookie: string;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    await inTx(venue, async (tx) => {
      const flan = venue.productId("Flan");
      const { id: categoryId } = await createCategory(tx, { name: "Desserts" });
      await tx
        .update(products)
        .set({ categoryId, vatClass: "reduced" })
        .where(eq(products.id, flan));
      const extras = await createExtraList(
        tx,
        {
          name: "Side",
          minPicks: 0,
          maxPicks: 1,
          items: [{ productId: venue.productId("Tarta"), maxQuantity: 1, price: "1.50" }],
        },
        venue.cfg.locale,
      );
      await writeProductModifiers(tx, flan, [{ kind: "extras", id: extras.id }]);
      extra = { listId: extras.id, picks: [{ productId: venue.productId("Tarta"), quantity: 1 }] };
      daily = await setMenuOnFullMenu(tx, venue.tables.menuId, flan);
      const [{ id: courseId }] = await tx
        .insert(kitchenCourses)
        .values({ name: "Sharing", displayOrder: 5 })
        .returning({ id: kitchenCourses.id });
      await saveSetMenuDishCourse(tx, daily.menuId, daily.menuItemId, courseId);
      const [dessert, main] = await tx
        .insert(kitchenCourses)
        .values([
          { name: "Dessert", displayOrder: 6 },
          { name: "Main", displayOrder: 7 },
        ])
        .returning({ id: kitchenCourses.id });
      courses = { dessert: dessert!.id, main: main!.id, sharing: courseId };
      supplement = await setMenuOnFullMenu(tx, venue.tables.menuId, flan, "Special", "21.00");
      await tx
        .update(menuItems)
        .set({ grossPrice: 250 })
        .where(eq(menuItems.id, supplement.menuItemId));
      // The holding menu sells Flan at 8.00; its own price is 5.00.
      await tx
        .update(menuItems)
        .set({ grossPrice: 800 })
        .where(and(eq(menuItems.menuId, venue.tables.menuId), eq(menuItems.productId, flan)));
      // Sold only in a set menu: the holding menu does not list it. Its own price is 6.00.
      const { id: dish } = await createProduct(tx, {
        name: "Tortilla",
        categoryId: null,
        pricingUnit: "each",
        unitPrice: "6.00",
        vatClass: "reduced",
      });
      const variant = (name: string, unitPrice: string | null) => ({
        name,
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice,
        available: true,
      });
      const [unpriced, priced] = await setProductVariants(
        tx,
        dish,
        [variant("Small", null), variant("Large", "9.00")],
        "es",
      );
      tortilla = { unpriced: unpriced!.id, priced: priced!.id };
      await tx
        .update(products)
        .set({ courseId: courses.dessert })
        .where(eq(products.id, tortilla.priced));
      tapas = await setMenuOnFullMenu(tx, venue.tables.menuId, dish, "Tapas", "12.00");
      daily.versionId =
        supplement.versionId =
        tapas.versionId =
          await publishWorkingMenu(tx, venue.tables.menuId);
    });
    const token = await inTx(venue, async (tx) => {
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.email, "owner@example.test"));
      return (
        await loginWithPin(tx, {
          deviceId: venue.cfg.origin.deviceId,
          personId: admin!.id,
          pin: "1234",
        })
      ).token;
    });
    cookie = await sessionCookieForTest(db, token);
    app = new Hono();
    mountTillApi(
      app,
      {
        db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        venueLocale: "es-ES",
        secureCookies: false,
        admission: testTradingAdmission(),
      },
      () => {},
    );
  },
});

const rowsOf = (tabId: string) =>
  venue.db
    .select({
      setMenuRole: workingOrderLines.setMenuRole,
      parentLineId: workingOrderLines.parentLineId,
      unitPriceGross: workingOrderLines.unitPriceGross,
      aLaCarteUnitPrice: workingOrderLines.aLaCarteUnitPrice,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);

const coursesOf = (tabId: string) =>
  venue.db
    .select({
      setMenuRole: workingOrderLines.setMenuRole,
      parentLineId: workingOrderLines.parentLineId,
      courseId: workingOrderLines.courseId,
      countsAsCourseId: workingOrderLines.countsAsCourseId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);

const rowsWithIds = (tabId: string) =>
  venue.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);

const tableBill = async () => seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
const inMenu = (copy: typeof daily) => ({
  menuItemId: copy.menuItemId,
  menuVersionId: copy.versionId,
  setMenuId: copy.menuId,
  quantity: "1",
});

async function send(draft: Draft) {
  const command = await commandFor(venue, draft.partyId);
  return inTx(venue, async (tx) =>
    submitDraft(tx, venue.cfg, draft.partyId, draft.id, {
      ...command,
      submissionId: crypto.randomUUID(),
      expectedEdit: await expectedDraftEditForTest(tx, draft),
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lines.map(({ id }) => id), release: "hold" }],
    }),
  );
}

function request(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function counterTakeaway(lines: unknown[] = []) {
  const id = crypto.randomUUID();
  const zoneId = venue.counter.zoneId;
  await inTx(venue, async (tx) => {
    const [zone] = await tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, zoneId));
    await venueService.setDepartmentSalePolicyField(
      tx,
      zone!.departmentId,
      "dining",
      "till_choice",
    );
  });
  return { id, zoneId, dining: "takeaway", lines };
}

/**
 * A counter takeaway holding an empty set menu of `copy` at line 2, with its revision and set-menu
 * state. Opened with a Flan the caller's save drops: an order opens with at least one line.
 */
async function counterWithSetMenu(copy: typeof daily) {
  const body = await counterTakeaway([{ menuItemId: venue.counterItem("Flan"), quantity: "1" }]);
  expect((await request("POST", "/api/working-orders", body)).status).toBe(200);
  await inTx(venue, (tx) => seedBillSetMenu(tx, body.id, copy, 2));
  const held = await (await request("GET", `/api/working-orders/${body.id}`)).json();
  return { body, revision: held.revision, setMenus: held.setMenus };
}

/**
 * Saves a grouping that places every dish on the bill in one set menu of `copy`, charged
 * `chargeCents` each, as a calculation could hand it: under D12 Flan counts as its product's
 * course, which the Daily does not list, and no set menu here is cheaper than Flan a la carte.
 */
async function groupInto(billId: string, copy: typeof daily, chargeCents = 0) {
  await inTx(venue, async (tx) =>
    saveBillGrouping(tx, billId, await readGroupingCopies(tx, billId), (input) => {
      const offer = input.offers.find(({ id }) => id.startsWith(`${copy.menuId}:`))!;
      return {
        exact: true,
        totalCents: offer.priceCents + chargeCents * input.dishes.length,
        unusedDiscountIds: [],
        setMenus: [
          {
            id: "menu",
            offerId: offer.id,
            discountId: null,
            baseCents: offer.priceCents,
            discountCents: 0,
          },
        ],
        dishes: input.dishes.map(({ id, extrasCents }) => ({
          id,
          place: { setMenuId: "menu", lineIndex: 0 },
          chargeCents,
          extrasCents,
        })),
      };
    }),
  );
}

it("probe D4: the set-menu copy and the holding menu's ordinary offer agree on category and VAT", async () => {
  const flan = venue.productId("Flan");
  const { ordinary, copy } = await inTx(venue, async (tx) => {
    const zone = await VENUE_SERVICE.listZoneOffers(tx, venue.tables.zoneId, {
      menuItemIds: [venue.item("Flan")],
      withDefault: false,
    });
    const lookup = await setMenuOfferLookup(
      tx,
      null,
      [{ setMenuId: daily.menuId, menuVersionId: daily.versionId, menuItemId: daily.menuItemId }],
      zone.menus,
    );
    return {
      ordinary: zone.offers.find(({ productId }) => productId === flan)!,
      copy: lookup.offerFor({
        setMenuId: daily.menuId,
        menuVersionId: daily.versionId,
        menuItemId: daily.menuItemId,
      })!.offer,
    };
  });
  const pick = (offer: typeof ordinary) => ({
    menuId: offer.menuId,
    vatClass: offer.vatClass,
    takeawayVatClass: offer.takeawayVatClass,
    category: offer.category,
    unit: offer.unit,
  });
  expect(pick(ordinary)).toEqual({
    menuId: venue.tables.menuId,
    vatClass: "reduced",
    takeawayVatClass: "reduced",
    category: "Desserts",
    unit: expect.objectContaining({ id: expect.any(String) }),
  });
  expect(pick(copy)).toEqual(pick(ordinary));
});

it("writes an a la carte dish's charged price as its a la carte price when a draft is sent", async () => {
  const bill = await tableBill();
  await send(
    await saveSetMenuDraft(venue, bill, {
      menuItemId: venue.item("Flan"),
      quantity: "1",
      extras: [extra],
    }),
  );
  expect(await rowsOf(bill.tabId)).toMatchObject([
    { setMenuRole: null, parentLineId: null, unitPriceGross: 800, aLaCarteUnitPrice: 800 },
    { setMenuRole: null, unitPriceGross: 150, aLaCarteUnitPrice: null },
  ]);
});

it("writes the holding menu's price on an included set-menu dish, its extras and set-menu row left null", async () => {
  const bill = await tableBill();
  await send(await saveSetMenuDraft(venue, bill, { ...inMenu(daily), extras: [extra] }));
  await groupInto(bill.tabId, daily);
  expect(await rowsOf(bill.tabId)).toMatchObject([
    { setMenuRole: "dish", unitPriceGross: 0, aLaCarteUnitPrice: 800 },
    { setMenuRole: null, unitPriceGross: 150, aLaCarteUnitPrice: null },
    { setMenuRole: "set_menu", aLaCarteUnitPrice: null },
  ]);
});

it("writes the holding menu's price on a set-menu dish with a supplement", async () => {
  const bill = await tableBill();
  await send(await saveSetMenuDraft(venue, bill, inMenu(supplement)));
  await groupInto(bill.tabId, supplement, 250);
  expect(await rowsOf(bill.tabId)).toMatchObject([
    { setMenuRole: "dish", unitPriceGross: 250, aLaCarteUnitPrice: 800 },
    { setMenuRole: "set_menu", aLaCarteUnitPrice: null },
  ]);
});

it("writes the a la carte price when a counter order is opened with dishes", async () => {
  const body = await counterTakeaway([{ menuItemId: venue.counterItem("Flan"), quantity: "1" }]);
  const opened = await request("POST", "/api/working-orders", body);
  expect(opened.status).toBe(200);
  expect(await rowsOf(body.id)).toMatchObject([
    { setMenuRole: null, unitPriceGross: 800, aLaCarteUnitPrice: 800 },
  ]);
});

// D10: these two dishes fill no set menu, so a counter save charges both a la carte.
it("writes the a la carte price on dishes a counter order saves, a la carte and from a set-menu folder", async () => {
  const { body, revision, setMenus } = await counterWithSetMenu(daily);
  const saved = await request("PUT", `/api/working-orders/${body.id}`, {
    dining: body.dining,
    expectedEdit: null,
    revision,
    lines: [
      {
        ...inMenu(daily),
        menuVersionId: setMenus.recorded[daily.menuId],
        setMenuReservedLineId: setMenus.setMenus[0].lineId,
        setMenuReservedPlace: 0,
      },
      { menuItemId: venue.counterItem("Flan"), quantity: "1" },
    ],
  });
  expect(saved.status).toBe(200);
  expect(await rowsOf(body.id)).toMatchObject([
    { setMenuRole: null, unitPriceGross: 800, aLaCarteUnitPrice: 800 },
    { setMenuRole: null, unitPriceGross: 800, aLaCarteUnitPrice: 800 },
  ]);
});

it("keeps the a la carte price on the row a split cuts off", async () => {
  const bill = await tableBill();
  await inTx(venue, async (tx) => {
    await addGroupedTabRound(tx, venue.cfg, bill.tabId, [
      { menuItemId: venue.item("Flan"), quantity: "2" },
    ]);
    await splitLinesWithinOrder(tx, venue.cfg, bill.tabId, [{ lineNo: 1, quantity: "1" }]);
  });
  expect(await rowsOf(bill.tabId)).toMatchObject([
    { unitPriceGross: 800, aLaCarteUnitPrice: 800 },
    { unitPriceGross: 800, aLaCarteUnitPrice: 800 },
  ]);
});

it("keeps the a la carte price on the set-menu dish Reopen bill copies onto the new bill", async () => {
  const from = await tableBill();
  const to = await tableBill();
  await send(await saveSetMenuDraft(venue, from, inMenu(supplement)));
  await groupInto(from.tabId, supplement, 250);
  await inTx(venue, async (tx) => {
    await copyBillDishes(tx, from.tabId, to.tabId);
  });
  expect(await rowsOf(to.tabId)).toMatchObject([
    { setMenuRole: "dish", unitPriceGross: 250, aLaCarteUnitPrice: 800 },
    { setMenuRole: "set_menu", aLaCarteUnitPrice: null },
  ]);
});

it("keeps the a la carte price on a set-menu dish moved to another bill", async () => {
  const from = await tableBill();
  const to = await tableBill();
  await send(await saveSetMenuDraft(venue, from, inMenu(supplement)));
  await groupInto(from.tabId, supplement, 250);
  // Special (21.00 + 2.50) never beats Flan a la carte (8.00), so the target keeps it only frozen.
  const [dish] = await rowsWithIds(from.tabId);
  await inTx(venue, (tx) => freezeBillLine(tx, dish!.id));
  await inTx(venue, async (tx) => {
    await moveOrderLines(tx, venue.cfg, from.tabId, to.tabId, [1, 2]);
  });
  expect(await rowsOf(to.tabId)).toMatchObject([
    { setMenuRole: "dish", unitPriceGross: 250, aLaCarteUnitPrice: 800 },
    { setMenuRole: "set_menu", aLaCarteUnitPrice: null },
  ]);
});

it.each([
  ["a variant with no price of its own takes the dish's own price", "unpriced", 600],
  ["a variant with a price of its own takes that price", "priced", 900],
] as const)(
  "writes the a la carte price of a set-menu dish the menu does not list: %s",
  async (_, which, cents) => {
    const { body, revision, setMenus } = await counterWithSetMenu(tapas);
    const saved = await request("PUT", `/api/working-orders/${body.id}`, {
      dining: body.dining,
      expectedEdit: null,
      revision,
      lines: [
        {
          ...inMenu(tapas),
          variantId: tortilla[which],
          menuVersionId: setMenus.recorded[tapas.menuId],
          setMenuReservedLineId: setMenus.setMenus[0].lineId,
          setMenuReservedPlace: 0,
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(await rowsOf(body.id)).toMatchObject([
      { setMenuRole: null, unitPriceGross: cents, aLaCarteUnitPrice: cents },
    ]);
  },
);

it("records an a la carte dish's own course as the course it counts as, and none on its extras", async () => {
  const bill = await tableBill();
  await send(
    await saveSetMenuDraft(venue, bill, {
      menuItemId: venue.item("Flan"),
      quantity: "1",
      extras: [extra],
    }),
  );
  expect(await coursesOf(bill.tabId)).toMatchObject([
    { parentLineId: null, countsAsCourseId: supplement.courseId },
    { parentLineId: expect.any(String), countsAsCourseId: null },
  ]);
});

it("records the dish's own course when the waiter sends it with another course", async () => {
  const bill = await tableBill();
  await send(
    await saveSetMenuDraft(venue, bill, {
      menuItemId: venue.item("Flan"),
      quantity: "1",
      courseId: courses.main,
    }),
  );
  expect(await coursesOf(bill.tabId)).toMatchObject([
    { courseId: courses.main, countsAsCourseId: supplement.courseId },
  ]);
});

it("records the product's course on a dish tapped in a set menu, not the copy's, and none on the set menu's row", async () => {
  const bill = await tableBill();
  await send(await saveSetMenuDraft(venue, bill, { ...inMenu(daily), extras: [extra] }));
  await groupInto(bill.tabId, daily);
  expect(await coursesOf(bill.tabId)).toMatchObject([
    {
      setMenuRole: "dish",
      countsAsCourseId: supplement.courseId,
    },
    { setMenuRole: null, parentLineId: expect.any(String), countsAsCourseId: null },
    { setMenuRole: "set_menu", countsAsCourseId: null },
  ]);
});

it.each([
  ["a variant with no course of its own takes its dish's", "unpriced", "parent"],
  ["a variant with a course of its own takes that course", "priced", "dessert"],
] as const)("records the course a variant counts as: %s", async (_, which, course) => {
  const { body, revision, setMenus } = await counterWithSetMenu(tapas);
  const saved = await request("PUT", `/api/working-orders/${body.id}`, {
    dining: body.dining,
    expectedEdit: null,
    revision,
    lines: [
      {
        ...inMenu(tapas),
        variantId: tortilla[which],
        menuVersionId: setMenus.recorded[tapas.menuId],
        setMenuReservedLineId: setMenus.setMenus[0].lineId,
        setMenuReservedPlace: 0,
      },
    ],
  });
  expect(saved.status).toBe(200);
  expect(await coursesOf(body.id)).toMatchObject([
    {
      setMenuRole: null,
      countsAsCourseId: course === "parent" ? tapas.courseId : courses.dessert,
    },
  ]);
});

it("keeps the course a dish counts as on the rows a split carves", async () => {
  const bill = await tableBill();
  await inTx(venue, async (tx) => {
    await addGroupedTabRound(tx, venue.cfg, bill.tabId, [
      { menuItemId: venue.item("Flan"), quantity: "3" },
    ]);
    await splitLinesWithinOrder(tx, venue.cfg, bill.tabId, [{ lineNo: 1, quantity: "1" }]);
  });
  expect(await coursesOf(bill.tabId)).toMatchObject([
    { countsAsCourseId: supplement.courseId },
    { countsAsCourseId: supplement.courseId },
  ]);
});

it("keeps the course a dish counts as on the dishes Reopen bill copies onto the new bill", async () => {
  const from = await tableBill();
  const to = await tableBill();
  await send(await saveSetMenuDraft(venue, from, inMenu(supplement)));
  await groupInto(from.tabId, supplement, 250);
  await inTx(venue, async (tx) => {
    await copyBillDishes(tx, from.tabId, to.tabId);
  });
  expect(await coursesOf(to.tabId)).toMatchObject([
    { setMenuRole: "dish", countsAsCourseId: supplement.courseId },
    { setMenuRole: "set_menu", countsAsCourseId: null },
  ]);
});
