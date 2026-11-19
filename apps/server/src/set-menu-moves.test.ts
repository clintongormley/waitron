import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { kitchenCourses, ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin, persons } from "@waitron/identity";
import { adjustments } from "@waitron/adjustments";
import { decimal } from "@waitron/shared";
import { menuItems, saveSetMenuDishCourse } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { DishMove } from "@waitron/shared";
import { readBillSetMenus } from "./set-menu-bill.js";
import { advanceTicketItem } from "./working-order.js";
import { cancelItemForTest } from "./testing/cancel-line.js";
import { mountTillApi } from "./till-api.js";
import { send } from "./testing/bill-venue.js";
import { inTx, revisionOf } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import {
  saveSetMenuDraft,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

const app = new Hono();
let cookie: string;
let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
let special: typeof fixture.copy;
let other: typeof fixture.copy;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
    const { venue, copy } = fixture;
    const [owner] = await db.select().from(persons).where(eq(persons.email, "owner@example.test"));
    const { token } = await inTx(venue, (tx) =>
      loginWithPin(tx, { deviceId: venue.cfg.origin.deviceId, personId: owner!.id, pin: "1234" }),
    );
    cookie = await sessionCookieForTest(db, token);
    mountTillApi(
      app,
      {
        db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: { ...venue.cfg, simplifiedInvoiceLimit: decimal("40.00") },
        venueLocale: venue.cfg.locale,
        secureCookies: false,
        admission: testTradingAdmission(),
      },
      () => {},
    );
    await inTx(venue, async (tx) => {
      const [sharing] = await tx
        .insert(kitchenCourses)
        .values({ name: "Sharing", displayOrder: 5 })
        .returning();
      await saveSetMenuDishCourse(tx, copy.menuId, copy.menuItemId, sharing!.id);
      copy.courseId = sharing!.id;
      special = await setMenuOnFullMenu(tx, copy.fullMenuId, copy.productId, "Special menu");
      await tx
        .update(menuItems)
        .set({ grossPrice: 500 })
        .where(eq(menuItems.id, special.menuItemId));
      other = await setMenuOnFullMenu(tx, copy.fullMenuId, venue.productId("Tarta"), "Cake menu");
      copy.versionId =
        special.versionId =
        other.versionId =
          await publishWorkingMenu(tx, copy.fullMenuId);
    });
  },
});

async function bill(destination = special, send = false, menuPrice = 1400) {
  const tab = await setMenuBill(fixture, { send });
  const destinationId = await inTx(fixture.venue, (tx) =>
    seedBillSetMenu(tx, tab.billId, destination, 3, menuPrice),
  );
  return { ...tab, destinationId };
}

async function move(tab: Awaited<ReturnType<typeof bill>>, moves: DishMove[], revision?: number) {
  return send(app, cookie, "POST", `/api/bills/${tab.billId}/set-menu-moves`, {
    moves,
    expectedPartyRevision: revision ?? (await revisionOf(fixture.venue, tab.partyId)),
  });
}

async function row(id: string) {
  const [line] = await fixture.venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, id));
  return line!;
}

const to = (lineId: string, setMenuLineId: string): DishMove => ({
  lineId,
  to: { setMenuLineId, place: 0 },
});

it("moves a placed dish and saves the destination's surcharge while keeping the kitchen course", async () => {
  const tab = await bill();
  const original = await row(tab.dishId);
  const revision = await revisionOf(fixture.venue, tab.partyId);
  const answer = await move(tab, [to(tab.dishId, tab.destinationId)], revision);
  expect(answer.status).toBe(200);
  expect(answer.json).toMatchObject({
    partyRevision: revision + 1,
    setMenus: {
      dishes: [{ lineId: tab.dishId, setMenuLineId: tab.destinationId, priceCents: 500 }],
    },
  });
  expect(await row(tab.dishId)).toEqual({
    ...original,
    setMenuLineId: tab.destinationId,
    setMenuPlace: 0,
    setMenuCountsAsCourseId: special.courseId,
    unitPriceGross: 500,
    lineTotal: 500,
  });
});

it("swaps two dishes in a single request", async () => {
  const tab = await bill();
  const otherDish = await inTx(fixture.venue, async (tx) => {
    const { id: _id, ...dish } = await row(tab.dishId);
    const [inserted] = await tx
      .insert(workingOrderLines)
      .values({
        ...dish,
        lineNo: 4,
        cohortId: null,
        cohortOrdinal: null,
        wholePortion: null,
        setMenuLineId: tab.destinationId,
        setMenuCountsAsCourseId: special.courseId,
        unitPriceGross: 500,
        lineTotal: 500,
      })
      .returning({ id: workingOrderLines.id });
    return inserted!.id;
  });
  const answer = await move(tab, [
    to(tab.dishId, tab.destinationId),
    to(otherDish, tab.menuLineId),
  ]);
  expect(answer.status).toBe(200);
  expect(await row(tab.dishId)).toMatchObject({ setMenuLineId: tab.destinationId, lineTotal: 500 });
  expect(await row(otherDish)).toMatchObject({ setMenuLineId: tab.menuLineId, lineTotal: 0 });
});

it.each(["reserved", "unlisted", "taken", "stale", "payment", "invoice limit"] as const)(
  "refuses a %s move without changing the dish or the party revision",
  async (kind) => {
    const tab = await bill(
      kind === "unlisted" ? other : special,
      false,
      kind === "invoice limit" ? 2600 : 1400,
    );
    if (kind === "reserved") {
      await saveSetMenuDraft(
        fixture.venue,
        { ...tab, tabId: tab.billId },
        {
          menuItemId: special.menuItemId,
          menuVersionId: special.versionId,
          setMenuId: special.menuId,
          quantity: "1",
          setMenuReservedLineId: tab.destinationId,
          setMenuReservedPlace: 0,
        },
      );
    }
    if (kind === "taken") {
      const { id: _id, ...dish } = await row(tab.dishId);
      await inTx(fixture.venue, async (tx) => {
        await tx.insert(workingOrderLines).values({
          ...dish,
          lineNo: 4,
          cohortId: null,
          cohortOrdinal: null,
          wholePortion: null,
          setMenuLineId: tab.destinationId,
          setMenuCountsAsCourseId: special.courseId,
        });
      });
    }
    if (kind === "payment") {
      await inTx(fixture.venue, async (tx) => {
        await tx
          .update(workingOrders)
          .set({ paymentAttemptAt: new Date().toISOString() })
          .where(eq(workingOrders.id, tab.billId));
      });
    }
    const before = await row(tab.dishId);
    const revision = await revisionOf(fixture.venue, tab.partyId);
    const answer = await move(
      tab,
      [to(tab.dishId, tab.destinationId)],
      kind === "stale" ? revision + 1 : revision,
    );
    expect(answer.status).toBe(409);
    const code =
      kind === "stale"
        ? "party.out_of_date"
        : kind === "payment"
          ? "order.payment_in_flight"
          : kind === "invoice limit"
            ? "sale.total_exceeds_simplified_limit"
            : "set_menu.place_taken";
    expect(answer.json).toMatchObject({ code });
    expect(await row(tab.dishId)).toEqual(before);
    expect(await revisionOf(fixture.venue, tab.partyId)).toBe(revision);
  },
);

it("frees a started dish's place on cancellation and refuses a later move of that dish", async () => {
  const tab = await bill(special, true);
  await inTx(fixture.venue, async (tx) => {
    const [ticket] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, tab.dishId));
    await advanceTicketItem(tx, ticket!.id, "preparing");
    await cancelItemForTest(tx, fixture.venue.cfg, tab.billId, 2);
  });
  const adjustmentsOnBill = await fixture.venue.db
    .select()
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, tab.billId));
  expect(adjustmentsOnBill).toMatchObject([
    { lineId: tab.dishId, action: "cancel", chargeKept: false, preparationStarted: true },
  ]);
  const answer = await move(tab, [to(tab.dishId, tab.destinationId)]);
  expect(answer).toMatchObject({
    status: 400,
    json: { code: "management.request_invalid", params: { field: "moves" } },
  });
  expect(await inTx(fixture.venue, (tx) => readBillSetMenus(tx, tab.billId))).toMatchObject({
    dishes: [],
  });
});
