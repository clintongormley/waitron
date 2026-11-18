import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { departmentCourses, kitchenCourses, products, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { addStarterServiceSteps } from "@waitron/venue-service";
import { createCourse, readCourseFireNowZones, setProductCourse } from "./kitchen.js";
import { readReleaseReminders } from "./order-groups.js";
import { readTableSteps } from "./service-step-signals.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  inTx,
  OPERATOR,
  partyRow,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { setReleaseReminderInDepartment } from "./testing/release-reminder.js";
import { serveLine } from "./testing/serve-line.js";
import { departmentOf } from "./testing/service-steps.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const MINUTE = 60_000;
const SENT = Date.parse("2026-11-18T20:00:00.000Z");
const SERVED = SENT + 7 * MINUTE;
const SERVED_AT = new Date(SERVED).toISOString();
const REMINDER_MINUTES = 12;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: SENT });
});
afterEach(() => {
  vi.useRealTimers();
});

async function fireNowVenue() {
  const v = await setupPartyVenue(suite.db);
  const department = await departmentOf(v, v.tables.zoneId);
  return inTx(v, async (tx) => {
    const existing = await tx
      .select({
        id: kitchenCourses.id,
        starterKey: kitchenCourses.starterKey,
        displayOrder: kitchenCourses.displayOrder,
      })
      .from(kitchenCourses);
    const last = Math.max(...existing.map(({ displayOrder }) => displayOrder));
    const drinks = await createCourse(tx, { name: "Drinks", displayOrder: last + 1 });
    const bread = await createCourse(tx, { name: "Bread", displayOrder: last + 2 });
    const mains = existing.find(({ starterKey }) => starterKey === "mains");
    await setReleaseReminderInDepartment(tx, department, REMINDER_MINUTES);
    await tx
      .update(departmentCourses)
      .set({ heldUntilFired: false, reminderMinutes: 25 })
      .where(
        and(
          eq(departmentCourses.departmentId, department),
          inArray(departmentCourses.courseId, [drinks.id, bread.id]),
        ),
      );
    const fireNow = await readCourseFireNowZones(tx);
    expect(fireNow.get(drinks.id)).toContain(v.tables.zoneId);
    expect(fireNow.get(bread.id)).toContain(v.tables.zoneId);
    expect(fireNow.has(mains!.id)).toBe(false);
    await setProductCourse(tx, v.productId("Burger"), mains!.id);
    return { v, department, mains: mains!.id, drinks: drinks.id, bread: bread.id };
  });
}

async function giveCourses(v: PartyVenue, courses: Record<string, string | null>): Promise<void> {
  await inTx(v, async (tx) => {
    for (const [name, courseId] of Object.entries(courses))
      await setProductCourse(tx, v.productId(name), courseId);
  });
}

async function sendGroups(
  v: PartyVenue,
  label: string,
  groups: { name: string; release: "fire" | "hold" }[],
) {
  const tableId = await v.table(label);
  const { partyId } = await seat(v, tableId);
  const placed = await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: groups.map(({ name, release }) => ({
        lines: [{ menuItemId: v.item(name), quantity: "1" }],
        release,
      })),
      operatorId: OPERATOR,
    }),
  );
  return { tableId, partyId, tabId: placed.tabId, groupIds: placed.groups.map(({ id }) => id) };
}

async function sendAsTheTillPlaces(v: PartyVenue, label: string, names: string[]) {
  const { courses, productCourses } = await inTx(v, async (tx) => {
    const fireNowZones = await readCourseFireNowZones(tx);
    return {
      courses: (await tx.select().from(kitchenCourses)).map((course) => ({
        ...course,
        fireNowZoneIds: fireNowZones.get(course.id) ?? [],
      })),
      productCourses: await tx
        .select({ id: products.id, courseId: products.courseId })
        .from(products),
    };
  });
  const context = {
    courses,
    zoneId: v.tables.zoneId,
    held: [],
    firstOrder: true,
    placed: [] as { courseId: string | null; place: { kind: "fire" | "new" | "join" } }[],
  };
  const path = fileURLToPath(new URL("../../till/src/state/draft-place.ts", import.meta.url));
  const { placeFor } = (await import(/* @vite-ignore */ path)) as {
    placeFor: (
      courseId: string | null,
      ctx: typeof context,
    ) => { place: (typeof context.placed)[number]["place"] };
  };
  for (const name of names) {
    const courseId = productCourses.find((product) => product.id === v.productId(name))!.courseId;
    context.placed.push({ courseId, place: placeFor(courseId, context).place });
  }
  const places = context.placed.map(({ place }) => place);
  const sent = await sendGroups(
    v,
    label,
    names.map((name, index) => ({
      name,
      release: places[index]!.kind === "fire" ? "fire" : "hold",
    })),
  );
  return { ...sent, places };
}

function sendFiredRegardlessOfCourse(v: PartyVenue, label: string, names: string[]) {
  return sendGroups(
    v,
    label,
    names.map((name) => ({ name, release: "fire" })),
  );
}

async function linesOf(v: PartyVenue, billId: string) {
  return inTx(v, (tx) =>
    tx
      .select({
        name: workingOrderLines.name,
        lineNo: workingOrderLines.lineNo,
        courseId: workingOrderLines.courseId,
        quantity: workingOrderLines.quantity,
        servedQuantity: workingOrderLines.servedQuantity,
        servedAt: workingOrderLines.servedAt,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

async function lineOf(v: PartyVenue, billId: string, name: string) {
  return (await linesOf(v, billId)).find((line) => line.name === name)!;
}

async function servingsOf(v: PartyVenue, billId: string) {
  return (await linesOf(v, billId)).map(({ name, quantity, servedQuantity, servedAt }) => ({
    name,
    quantity,
    servedQuantity,
    servedAt,
  }));
}

async function serveAll(v: PartyVenue, billId: string, names: string[]): Promise<void> {
  vi.setSystemTime(SERVED);
  for (const name of names) {
    const { lineNo } = await lineOf(v, billId, name);
    await inTx(v, (tx) => serveLine(tx, v.cfg, billId, lineNo));
  }
  vi.setSystemTime(SENT);
}

describe("a dish whose course is Fire now", () => {
  it("leaves the held course's reminder running from the drink's serving, as without a course", async () => {
    const { v, mains, drinks } = await fireNowVenue();
    const firedThenHeld = [{ kind: "fire" }, { kind: "new", slot: 1 }];
    const reminderOf = async (partyId: string) =>
      (await inTx(v, (tx) => readReleaseReminders(tx, [partyId]))).get(partyId);

    await giveCourses(v, { "Red wine bottle": drinks });
    const withCourse = await sendAsTheTillPlaces(v, "Table 1", ["Red wine bottle", "Burger"]);
    expect(withCourse.places).toEqual(firedThenHeld);
    expect((await lineOf(v, withCourse.tabId, "Red wine bottle")).courseId).toBe(drinks);
    expect((await lineOf(v, withCourse.tabId, "Burger")).courseId).toBe(mains);
    expect(await reminderOf(withCourse.partyId)).toEqual({
      groupId: withCourse.groupIds[1],
      dueAt: null,
    });
    await serveAll(v, withCourse.tabId, ["Red wine bottle"]);

    await giveCourses(v, { "Red wine bottle": null });
    const without = await sendAsTheTillPlaces(v, "Table 2", ["Red wine bottle", "Burger"]);
    expect(without.places).toEqual(firedThenHeld);
    expect((await lineOf(v, without.tabId, "Red wine bottle")).courseId).toBeNull();
    expect((await lineOf(v, without.tabId, "Burger")).courseId).toBe(mains);
    await serveAll(v, without.tabId, ["Red wine bottle"]);

    const dueAt = new Date(SERVED + REMINDER_MINUTES * MINUTE).toISOString();
    expect(await reminderOf(withCourse.partyId)).toEqual({
      groupId: withCourse.groupIds[1],
      dueAt,
    });
    expect(await reminderOf(without.partyId)).toEqual({ groupId: without.groupIds[1], dueAt });
  });

  it("adds no starter service step", async () => {
    const { v, department, drinks, bread } = await fireNowVenue();
    await inTx(v, (tx) => addStarterServiceSteps(tx, department, "en"));
    const stepsOf = async ({ partyId, tableId }: { partyId: string; tableId: string }) => {
      const { openedAt } = await partyRow(v, partyId);
      const steps = await inTx(v, (tx) =>
        readTableSteps(tx, [{ partyId, openedAt, tableIds: [tableId] }], SERVED + 60 * MINUTE),
      );
      return steps.get(tableId)!.live.map(({ name, dueAt }) => ({ name, dueAt }));
    };

    const bothFired = [{ kind: "fire" }, { kind: "fire" }];
    const bothServed = ["Red wine bottle", "Water"].map((name) => ({
      name,
      quantity: 1000,
      servedQuantity: 1000,
      servedAt: SERVED_AT,
    }));

    await giveCourses(v, { "Red wine bottle": drinks, Water: bread });
    const withCourses = await sendAsTheTillPlaces(v, "Table 1", ["Red wine bottle", "Water"]);
    expect(withCourses.places).toEqual(bothFired);
    expect((await lineOf(v, withCourses.tabId, "Red wine bottle")).courseId).toBe(drinks);
    expect((await lineOf(v, withCourses.tabId, "Water")).courseId).toBe(bread);
    await serveAll(v, withCourses.tabId, ["Red wine bottle", "Water"]);
    expect(await servingsOf(v, withCourses.tabId)).toEqual(bothServed);

    await giveCourses(v, { "Red wine bottle": null, Water: null });
    const without = await sendAsTheTillPlaces(v, "Table 2", ["Red wine bottle", "Water"]);
    expect(without.places).toEqual(bothFired);
    expect((await lineOf(v, without.tabId, "Red wine bottle")).courseId).toBeNull();
    expect((await lineOf(v, without.tabId, "Water")).courseId).toBeNull();
    await serveAll(v, without.tabId, ["Red wine bottle", "Water"]);
    expect(await servingsOf(v, without.tabId)).toEqual(bothServed);

    const mains = await sendFiredRegardlessOfCourse(v, "Table 3", ["Burger"]);
    await serveAll(v, mains.tabId, ["Burger"]);

    expect(await stepsOf(withCourses)).toEqual([]);
    expect(await stepsOf(without)).toEqual([]);
    expect(await stepsOf(mains)).toEqual([{ name: "Dessert?", dueAt: SERVED + 5 * MINUTE }]);
  });
});
