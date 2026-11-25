import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { billSetMenuCopies, products, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin, persons } from "@waitron/identity";
import {
  addMember,
  createMenu,
  removeMember,
  requireMenuRoot,
  saveSetMenuDishCourse,
  updateMenuDetails,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  replaceMenuWeek,
  resolveZoneContext,
  saveMenuPeriod,
  updateMenuPeriod,
} from "@waitron/venue-service";
import { fireGroup } from "./order-group-release.js";
import { VENUE_SERVICE } from "./modules.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { mountTillApi } from "./till-api.js";
import { send as tillRequest } from "./testing/bill-venue.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { submitDraft, type Draft } from "./order-drafts.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import {
  commandFor,
  inTx,
  order,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  priceSetMenuDish,
  saveSetMenuDraft,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";

let venue: PartyVenue;
const app = new Hono();
let cookie: string;
let confirmer: string;
let daily: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
let evening: typeof daily;
let lunchPeriodId: string;
const serviceDate = new Date("2026-11-19T10:00:00+01:00");
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    const [admin] = await db.select().from(persons).where(eq(persons.email, "owner@example.test"));
    confirmer = admin!.id;
    const { token } = await inTx(venue, (tx) =>
      loginWithPin(tx, { deviceId: venue.cfg.origin.deviceId, personId: confirmer, pin: "1234" }),
    );
    cookie = await sessionCookieForTest(db, token);
    mountTillApi(
      app,
      {
        db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        venueLocale: venue.cfg.locale,
        secureCookies: false,
        admission: testTradingAdmission(),
      },
      () => {},
    );
    daily = await inTx(venue, async (tx) => {
      // Cheaper than Flan a la carte (5.00), so a send groups Flan into it.
      const menu = await setMenuOnFullMenu(
        tx,
        venue.tables.menuId,
        venue.productId("Flan"),
        "Daily menu",
        "4.00",
      );
      const { departmentId } = await resolveZoneContext(tx, venue.tables.zoneId);
      const dinner = await createMenu(tx, { name: "Dinner menu" });
      evening = await setMenuOnFullMenu(tx, dinner.id, menu.productId, "Evening set menu");
      await tx
        .update(products)
        .set({ courseId: menu.courseId })
        .where(eq(products.id, menu.productId));
      const lunchPeriod = await saveMenuPeriod(tx, departmentId, {
        name: "Lunch",
        menuId: menu.fullMenuId,
        staffMenuIds: [],
      });
      lunchPeriodId = lunchPeriod.id;
      const dinnerPeriod = await saveMenuPeriod(tx, departmentId, {
        name: "Dinner",
        menuId: dinner.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        departmentId,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: [
            { periodId: lunchPeriod.id, startsAt: "12:00", endsAt: "15:00" },
            { periodId: dinnerPeriod.id, startsAt: "15:00", endsAt: "21:00" },
          ],
        })),
        serviceDate,
        1,
      );
      return menu;
    });
  },
});

afterEach(() => vi.useRealTimers());

function at(time: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`2026-11-19T${time}:00+01:00`));
}

async function draftMenuDish(recorded: boolean, time = "14:00", count = 1) {
  at("14:00");
  const { tabId, partyId } = await seatWithNoAllergies(
    venue,
    await venue.table(crypto.randomUUID()),
  );
  if (recorded)
    await inTx(venue, async (tx) => {
      for (let lineNo = 1; lineNo <= count; lineNo++)
        await seedBillSetMenu(tx, tabId, daily, lineNo);
    });
  at(time);
  return saveSetMenuDraft(
    venue,
    { tabId, partyId },
    ...Array.from({ length: count }, () => ({
      menuItemId: daily.menuItemId,
      menuVersionId: daily.versionId,
      setMenuId: daily.menuId,
      quantity: "1",
    })),
  );
}

async function send(
  draft: Draft,
  release: "fire" | "hold",
  lateSend?: Parameters<typeof submitDraft>[4]["lateSend"],
) {
  const command = await commandFor(venue, draft.partyId);
  return inTx(venue, async (tx) =>
    submitDraft(tx, venue.cfg, draft.partyId, draft.id, {
      ...command,
      submissionId: crypto.randomUUID(),
      expectedEdit: await expectedDraftEditForTest(tx, draft),
      draftRevision: draft.revision,
      lateSend,
      groups: [{ lineIds: draft.lines.map((line) => line.id), release }],
    }),
  );
}

const dishRow = (id: string) =>
  venue.db.select().from(workingOrderLines).where(eq(workingOrderLines.id, id)).get();

it("fires a held dessert ordered from the recorded copy after lunch without a question", async () => {
  const draft = await draftMenuDish(true, "15:30");
  const { groups } = await send(draft, "hold");
  at("15:45");
  const command = await commandFor(venue, draft.partyId);
  await expect(
    inTx(venue, (tx) =>
      fireGroup(tx, venue.cfg, draft.partyId, groups[0]!.id, {
        ...command,
        submissionId: crypto.randomUUID(),
      }),
    ),
  ).resolves.toMatchObject({ revision: command.expectedPartyRevision + 1 });
});

it("asks before sending from an ended unrecorded copy and records the confirmed dish", async () => {
  const draft = await draftMenuDish(false);
  at("15:30");
  await expect(send(draft, "fire")).rejects.toMatchObject({
    code: "menu_period.ended",
    params: { menus: [{ menuId: daily.fullMenuId, periodName: "Lunch" }] },
  });
  const sent = await send(draft, "fire", {
    menuIds: new Set([daily.fullMenuId]),
    confirm: async () => venue.operator.personId,
  });
  const dish = await dishRow(sent.groups[0]!.lineIds[0]!);
  // The bill records no copy of a set menu on sale now, so the dish is charged a la carte.
  expect(dish).toMatchObject({
    setMenuRole: null,
    setMenuId: daily.menuId,
    unitPriceGross: 500,
    latePeriodName: "Lunch",
    lateConfirmedBy: venue.operator.personId,
  });
});

it.each(["course", "line", "row"])(
  "asks before firing a held set-menu %s after lunch",
  async (kind) => {
    const draft = await draftMenuDish(true, "14:00", kind === "row" ? 2 : 1);
    const {
      groups: [group],
    } = await send(draft, "hold");
    at("15:30");
    const command = await commandFor(venue, draft.partyId);
    const lineIds = group!.lineIds;
    const lineId = lineIds[0]!;
    expect(lineIds).toHaveLength(kind === "row" ? 2 : 1);
    const route = kind === "course" ? `${group!.id}/fire` : "fire-line";
    const release = (lateSend?: { menuIds: string[] }) =>
      tillRequest(app, cookie, "POST", `/api/parties/${draft.partyId}/groups/${route}`, {
        ...command,
        submissionId: crypto.randomUUID(),
        lineId,
        ...(kind === "row" ? { lineIds } : {}),
        lateSend,
      });
    expect(await release()).toMatchObject({
      status: 409,
      json: {
        code: "menu_period.ended",
        params: { menuItemIds: [daily.menuItemId], workingOrderLineIds: lineIds },
      },
    });
    expect((await release({ menuIds: [daily.fullMenuId] })).status).toBe(200);
    for (const id of lineIds)
      expect(await dishRow(id)).toMatchObject({
        latePeriodName: "Lunch",
        lateConfirmedBy: confirmer,
      });
  },
);

it.each([
  ["after lunch", false],
  ["after lunch and a republication", true],
])("sends from the bill's recorded version %s", async (_when, republished) => {
  const draft = await draftMenuDish(true, "15:30");
  if (republished) {
    const latest = await inTx(venue, async (tx) => {
      await updateMenuDetails(tx, daily.menuId, { setPrice: "17.00" });
      return publishWorkingMenu(tx, daily.fullMenuId);
    });
    expect(latest).not.toBe(daily.versionId);
  }
  const sent = await send(draft, "fire");
  expect(sent.groups[0]).toMatchObject({ state: "fired" });
  expect(await dishRow(sent.groups[0]!.lineIds[0]!)).toMatchObject({
    setMenuRole: "dish",
    menuId: daily.fullMenuId,
    menuVersionId: daily.versionId,
    unitPriceGross: 0,
    latePeriodName: null,
    lateConfirmedBy: null,
  });
});

/** Orders a Flan on the bill, which records the set menus listing it, and reads the bill's set menus. */
async function orderFlan(billId: string) {
  await order(venue, billId, "Flan");
  return inTx(venue, (tx) => readBillSetMenus(tx, billId));
}

it("takes the current sale price on a new bill and keeps the recorded price on an existing one", async () => {
  at("13:00");
  const initialVersion = await inTx(venue, async (tx) => {
    // Flan a la carte dearer than the Daily, so each Flan ordered makes a Daily.
    await priceSetMenuDish(tx, daily, { aLaCarte: 2000 });
    await updateMenuDetails(tx, daily.menuId, { setPrice: "14.00" });
    return publishWorkingMenu(tx, daily.fullMenuId);
  });
  try {
    const old = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
    const newBill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
    expect((await orderFlan(old.tabId)).recorded).toEqual({ [daily.menuId]: initialVersion });
    const nextVersion = await inTx(venue, async (tx) => {
      await updateMenuDetails(tx, daily.menuId, { setPrice: "15.00" });
      return publishWorkingMenu(tx, daily.fullMenuId);
    });

    // Each Flan is on the bill before the Daily it makes.
    expect(await orderFlan(old.tabId)).toMatchObject({
      copies: [{ versionId: initialVersion, priceCents: 1400 }],
      setMenus: [{ lineNo: 2 }, { lineNo: 4 }],
    });
    expect(await orderFlan(newBill.tabId)).toMatchObject({
      recorded: { [daily.menuId]: nextVersion },
      copies: [{ versionId: nextVersion, priceCents: 1500 }],
    });
  } finally {
    await inTx(venue, (tx) => priceSetMenuDish(tx, daily, { aLaCarte: 500 }));
  }
});

it("takes the newest copy on sale and records a full menu that sells it now", async () => {
  at("13:00");
  const { root, memberId } = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, daily.menuId, { setPrice: "14.00" });
    await publishWorkingMenu(tx, daily.fullMenuId);
    await saveSetMenuDishCourse(tx, evening.menuId, evening.menuItemId, evening.courseId);
    const root = await requireMenuRoot(tx, evening.fullMenuId);
    const member = await addMember(tx, root, { kind: "set_menu", menuId: daily.menuId });
    await updateMenuPeriod(tx, lunchPeriodId, { staffMenuIds: [evening.fullMenuId] });
    return { root, memberId: member.id };
  });
  try {
    at("13:05");
    const dinnerVersion = await inTx(venue, async (tx) => {
      await updateMenuDetails(tx, daily.menuId, { setPrice: "15.00" });
      return publishWorkingMenu(tx, evening.fullMenuId);
    });
    const first = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
    const firstDaily = await orderFlan(first.tabId);
    expect(firstDaily.recorded[daily.menuId]).toBe(dinnerVersion);
    expect(firstDaily.copies.find(({ setMenuId }) => setMenuId === daily.menuId)).toMatchObject({
      priceCents: 1500,
    });

    const lunchVersion = await inTx(venue, async (tx) => {
      await updateMenuPeriod(tx, lunchPeriodId, { staffMenuIds: [] });
      return publishWorkingMenu(tx, daily.fullMenuId);
    });
    const lunch = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
    expect((await orderFlan(lunch.tabId)).recorded[daily.menuId]).toBe(lunchVersion);
    at("16:00");
    const dinner = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
    // After lunch only the dinner menu sells, and it lists Flan only in the Daily's folder.
    await send(
      await saveSetMenuDraft(venue, dinner, {
        menuItemId: daily.menuItemId,
        menuVersionId: dinnerVersion,
        setMenuId: daily.menuId,
        quantity: "1",
      }),
      "fire",
    );
    const dinnerMenus = await inTx(venue, (tx) => readBillSetMenus(tx, dinner.tabId));
    expect(dinnerMenus.recorded[daily.menuId]).toBe(dinnerVersion);
  } finally {
    await inTx(venue, async (tx) => {
      await removeMember(tx, root, memberId);
      await publishWorkingMenu(tx, evening.fullMenuId);
      await updateMenuPeriod(tx, lunchPeriodId, { staffMenuIds: [] });
    });
  }
});

it("keeps a set menu linked by a dish ordered at lunch usable for a dessert sent after lunch", async () => {
  at("14:30");
  const { tabId, partyId } = await seatWithNoAllergies(
    venue,
    await venue.table(crypto.randomUUID()),
  );
  // Earlier cases leave the Daily dearer than Flan a la carte; at 4.00 a send groups Flan into it.
  const versionId = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, daily.menuId, { setPrice: "4.00" });
    return publishWorkingMenu(tx, daily.fullMenuId);
  });
  await order(venue, tabId, "Flan");
  at("16:15");
  const draft = await saveSetMenuDraft(
    venue,
    { tabId, partyId },
    {
      menuItemId: daily.menuItemId,
      menuVersionId: versionId,
      setMenuId: daily.menuId,
      quantity: "1",
    },
  );
  const sent = await send(draft, "fire");
  expect(sent.groups[0]).toMatchObject({ state: "fired" });
  expect(await dishRow(sent.groups[0]!.lineIds[0]!)).toMatchObject({
    setMenuRole: "dish",
    latePeriodName: null,
  });
});

it("links the set menus on sale when the dish was priced, though the clock passes lunch's end before the link", async () => {
  at("14:00");
  const { tabId } = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  vi.setSystemTime(new Date("2026-11-19T14:59:59.999+01:00"));
  const resolve = VENUE_SERVICE.resolveDepartmentService;
  const service = vi
    .spyOn(VENUE_SERVICE, "resolveDepartmentService")
    .mockImplementation(async (...args) => {
      const resolved = await resolve(...args);
      vi.setSystemTime(new Date("2026-11-19T15:00:00.001+01:00"));
      return resolved;
    });
  try {
    await order(venue, tabId, "Flan");
    expect(service).toHaveBeenCalled();
  } finally {
    service.mockRestore();
  }
  const linked = await venue.db
    .select({ menuId: billSetMenuCopies.setMenuId })
    .from(billSetMenuCopies)
    .where(eq(billSetMenuCopies.workingOrderId, tabId));
  expect(linked).toEqual([{ menuId: daily.menuId }]);
});

async function heldFlanFiredAfterLunch(dailyPrice: string, fromFolder: boolean) {
  at("14:00");
  const versionId = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, daily.menuId, { setPrice: dailyPrice });
    return publishWorkingMenu(tx, daily.fullMenuId);
  });
  const { tabId, partyId } = await seatWithNoAllergies(
    venue,
    await venue.table(crypto.randomUUID()),
  );
  const draft = await saveSetMenuDraft(
    venue,
    { tabId, partyId },
    fromFolder
      ? {
          menuItemId: daily.menuItemId,
          menuVersionId: versionId,
          setMenuId: daily.menuId,
          quantity: "1",
        }
      : { menuItemId: venue.item("Flan"), quantity: "1" },
  );
  const {
    groups: [group],
  } = await send(draft, "hold");
  const lineId = group!.lineIds[0]!;
  const held = await dishRow(lineId);
  at("15:30");
  const command = await commandFor(venue, partyId);
  const fire = (lateSend?: { menuIds: string[] }) =>
    tillRequest(app, cookie, "POST", `/api/parties/${partyId}/groups/${group!.id}/fire`, {
      ...command,
      submissionId: crypto.randomUUID(),
      lateSend,
    });
  return { lineId, held, fire };
}

it("asks before firing a held dish tapped in an ended set-menu folder that no set menu took", async () => {
  // Dearer than Flan a la carte (5.00), so the grouping leaves the folder's Flan a la carte.
  const { lineId, held, fire } = await heldFlanFiredAfterLunch("9.00", true);
  expect(held).toMatchObject({ setMenuRole: null, setMenuId: daily.menuId });
  expect(await fire()).toMatchObject({
    status: 409,
    json: {
      code: "menu_period.ended",
      params: { menuItemIds: [daily.menuItemId], workingOrderLineIds: [lineId] },
    },
  });
  expect((await fire({ menuIds: [daily.fullMenuId] })).status).toBe(200);
});

it("fires a held a la carte dish the grouping put in a set menu without a question", async () => {
  const { held, fire } = await heldFlanFiredAfterLunch("4.00", false);
  expect(held).toMatchObject({ setMenuRole: "dish", setMenuId: null });
  expect((await fire()).status).toBe(200);
});

it("charges a Flan sent after lunch a la carte on a bill with no set menu, where at lunch it makes a Daily", async () => {
  at("13:00");
  await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, daily.menuId, { setPrice: "4.00" });
    await publishWorkingMenu(tx, daily.fullMenuId);
  });
  const lunch = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  expect((await orderFlan(lunch.tabId)).setMenus).toHaveLength(1);
  const late = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  const draft = await saveSetMenuDraft(venue, late, {
    menuItemId: venue.item("Flan"),
    quantity: "1",
  });
  at("16:00");
  const sent = await send(draft, "fire", {
    menuIds: new Set([daily.fullMenuId]),
    confirm: async () => venue.operator.personId,
  });
  expect(await dishRow(sent.groups[0]!.lineIds[0]!)).toMatchObject({
    setMenuRole: null,
    unitPriceGross: 500,
  });
  expect((await inTx(venue, (tx) => readBillSetMenus(tx, late.tabId))).setMenus).toEqual([]);
});
