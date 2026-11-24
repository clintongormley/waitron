import { orderGroups, kitchenCourses, products, ticketItems, workingOrderLines } from "@waitron/db";
import { inArray, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readCourseFireNowZones } from "./kitchen.js";
import type { GroupRelease } from "./order-group-records.js";
import { submitGroups } from "./testing/group-submit-fixture.js";
import {
  setupVenue,
  seated,
  submit,
  line,
  inTx,
  ALEX,
  MIA,
  args,
  linesIn,
  groupsOf,
  specExample,
  printed,
  DISHES,
  expectRefusedWithNothingWritten,
  eventsOf,
  snapshot,
  db,
  linesOf,
  firedTicketLineIds,
  fire,
} from "./testing/order-groups.test-support.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { offerProducts } from "./testing/zone-offers.js";
import { fireDishesAtPayment } from "./till-sale.js";
import { createOpenOrder } from "./working-order-open.js";

describe("per-group submission destinations", () => {
  it("joins one table group from two bills and two owners without moving earlier charges", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const initial = await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]);
    const groupId = initial.groups[0]!.id;
    const billId = randomUUID();
    await inTx((tx) =>
      createOpenOrder(tx, v.cfg, billId, [], null, {
        partyId: s.partyId,
        existingService: true,
        copyServiceContextFrom: s.tabId,
      }),
    );
    for (const operatorId of [ALEX, MIA]) {
      const command = await args(s.partyId, { operatorId });
      const result = await inTx((tx) =>
        submitGroups(tx, v.cfg, s.partyId, {
          ...command,
          billId,
          groups: [{ release: "hold", joinGroupId: groupId, lines: [line(v, "fish")] }],
        }),
      );
      expect(result.groups.map((g) => g.id)).toEqual([groupId]);
    }
    expect(
      (await linesIn(s.partyId, groupId)).map((l) => [l.workingOrderId, l.productId, l.creditedTo]),
    ).toEqual([
      [s.tabId, v.productId.steak, ALEX],
      [billId, v.productId.fish, ALEX],
      [billId, v.productId.fish, MIA],
    ]);
    expect((await groupsOf(s.partyId)).groups).toHaveLength(1);
  });

  it("keeps each printed HOLD correction confined to its joined destination", async () => {
    const v = await setupVenue();
    await inTx((tx) => setStationPrinting(tx, { printHeldWork: true }));
    const s = await specExample(v);
    const prior = (await printed(v)).length;
    await submit(v, s.partyId, [
      { release: "hold", joinGroupId: s.warm, lines: [line(v, "warm")] },
      { release: "hold", joinGroupId: s.mains, lines: [line(v, "fish")] },
    ]);
    const corrections = (await printed(v)).slice(prior);
    expect(corrections).toHaveLength(2);
    expect(corrections[0]).toContain(DISHES.warm.kitchen);
    expect(corrections[0]).not.toContain(DISHES.fish.kitchen);
    expect(corrections[1]).toContain(DISHES.fish.kitchen);
    expect(corrections[1]).not.toContain(DISHES.warm.kitchen);
  });

  it("clears snoozes only for existing groups whose firing position shifts", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const at = "2026-10-17T20:00:00.000Z";
    await inTx((tx) =>
      tx
        .update(orderGroups)
        .set({ remindAt: at })
        .where(inArray(orderGroups.id, [s.warm, s.mains])),
    );
    await submit(v, s.partyId, [
      { release: "hold", afterGroupId: s.warm, lines: [line(v, "fish")] },
    ]);
    const groups = (await groupsOf(s.partyId)).groups;
    expect(groups.find((g) => g.id === s.warm)).toMatchObject({ position: 3, remindAt: at });
    expect(groups.find((g) => g.id === s.mains)).toMatchObject({ position: 5, remindAt: null });
  });

  it("validates every destination before attempting fresh-line pricing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [
          { release: "fire", lines: [{ menuItemId: randomUUID(), quantity: "1" }] },
          { release: "hold", joinGroupId: randomUUID(), lines: [line(v, "fish")] },
        ]),
      { code: "group.not_found" },
    );
  });

  it("inserts after a held group without changing existing permanent numbers", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const before = (await groupsOf(s.partyId)).groups;
    const result = await submit(v, s.partyId, [
      { release: "hold", afterGroupId: s.warm, lines: [line(v, "fish")] },
    ]);
    const inserted = result.groups[0]!;
    expect(inserted).toMatchObject({ position: 4, displayNumber: 6, numberPartyId: s.partyId });
    expect(
      (await groupsOf(s.partyId)).groups.map((g) => [g.id, g.position, g.displayNumber]),
    ).toEqual([
      [s.drinks, 1, 1],
      [s.cold, 2, 2],
      [s.warm, 3, 3],
      [inserted.id, 4, 6],
      [s.mains, 5, 4],
      [s.desserts, 6, 5],
    ]);
    for (const group of before) {
      expect((await groupsOf(s.partyId)).groups.find((g) => g.id === group.id)).toMatchObject({
        displayNumber: group.displayNumber,
        numberPartyId: group.numberPartyId,
      });
    }
  });

  it("joins two held groups, fires a batch and inserts a held group exactly once", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const command = await args(s.partyId);
    const groups = [
      { release: "fire" as const, lines: [line(v, "beer")] },
      { release: "hold" as const, joinGroupId: s.warm, lines: [line(v, "warm")] },
      { release: "hold" as const, joinGroupId: s.mains, lines: [line(v, "steak")] },
      { release: "hold" as const, afterGroupId: s.warm, lines: [line(v, "flan")] },
    ];
    const oldEvents = (await eventsOf(s.partyId)).length;
    const result = await inTx((tx) => submitGroups(tx, v.cfg, s.partyId, { ...command, groups }));
    const [fired, warm, mains, held] = result.groups;
    expect(warm!.id).toBe(s.warm);
    expect(mains!.id).toBe(s.mains);
    expect(fired).toMatchObject({ state: "fired", displayNumber: 6 });
    expect(held).toMatchObject({ state: "held", position: 4, displayNumber: 7 });
    expect((await linesIn(s.partyId, s.warm)).map((l) => l.quantity)).toEqual(Array(5).fill(1000));
    expect((await linesIn(s.partyId, s.mains)).map((l) => l.quantity)).toEqual(Array(4).fill(1000));
    expect((await eventsOf(s.partyId)).slice(oldEvents).map((e) => [e.groupId, e.kind])).toEqual([
      [fired!.id, "group.submitted"],
      [s.warm, "group.joined"],
      [s.mains, "group.joined"],
      [held!.id, "group.submitted"],
    ]);
    const beforeRetry = await snapshot(v, s.partyId);
    expect(await inTx((tx) => submitGroups(tx, v.cfg, s.partyId, { ...command, groups }))).toEqual(
      result,
    );
    expect(await snapshot(v, s.partyId)).toEqual(beforeRetry);
  });

  it("keeps insertion order for two new groups after the same held anchor", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", afterGroupId: s.warm, lines: [line(v, "fish")] },
      { release: "hold", afterGroupId: s.warm, lines: [line(v, "flan")] },
    ]);
    expect((await groupsOf(s.partyId)).groups.map((g) => g.id)).toEqual([
      s.drinks,
      s.cold,
      s.warm,
      groups[0]!.id,
      groups[1]!.id,
      s.mains,
      s.desserts,
    ]);
    expect(groups.map((g) => [g.position, g.displayNumber])).toEqual([
      [4, 6],
      [5, 7],
    ]);
  });

  it("refuses an invalid second destination without changing any send rows", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [
          { release: "fire", lines: [line(v, "beer")] },
          { release: "hold", joinGroupId: randomUUID(), lines: [line(v, "fish")] },
        ]),
      { code: "group.not_found" },
    );
  });

  it.each(["fired", "removed", "foreign"] as const)(
    "refuses an insertion after a %s target",
    async (kind) => {
      const v = await setupVenue();
      const s = await specExample(v);
      let target = s.drinks;
      if (kind === "removed") {
        target = s.warm;
        await inTx((tx) =>
          tx.update(orderGroups).set({ state: "removed" }).where(eq(orderGroups.id, target)),
        );
      } else if (kind === "foreign") {
        target = (await specExample(v)).warm;
      }
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () =>
          submit(v, s.partyId, [
            { release: "hold", afterGroupId: target, lines: [line(v, "fish")] },
          ]),
        { code: kind === "fired" ? "group.not_held" : "group.not_found" },
      );
    },
  );

  it.each([
    "fire-join",
    "fire-after",
    "join-and-after",
    "duplicate-join",
    "legacy-and-per-group",
  ] as const)("refuses conflicting destination %s before writing", async (kind) => {
    const v = await setupVenue();
    const s = await specExample(v);
    const entry = {
      release: "hold" as GroupRelease,
      lines: [line(v, "fish")],
      ...(kind === "fire-after" ? { afterGroupId: s.warm } : { joinGroupId: s.warm }),
    };
    if (kind === "fire-join" || kind === "fire-after") entry.release = "fire";
    if (kind === "join-and-after") Object.assign(entry, { afterGroupId: s.mains });
    const submitted = kind === "duplicate-join" ? [entry, entry] : [entry];
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(
          v,
          s.partyId,
          submitted,
          kind === "legacy-and-per-group" ? { joinGroupId: s.mains } : {},
        ),
      { code: "management.request_invalid" },
    );
  });
});
describe("country starter courses in service", () => {
  it("fires the immediate starter course and holds later courses at a table", async () => {
    const v = await setupVenue(true);
    const s = await seated(v);
    const fireNowZones = await inTx(readCourseFireNowZones);
    const courses = (await db.select().from(kitchenCourses)).map((course) => ({
      ...course,
      fireNowZoneIds: fireNowZones.get(course.id) ?? [],
    }));
    const productCourses = await db
      .select({ id: products.id, courseId: products.courseId })
      .from(products);
    const context = {
      courses,
      zoneId: v.zoneId,
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
    const groups = (["beer", "cold", "steak", "flan"] as const).map((dish) => {
      const courseId = productCourses.find((product) => product.id === v.productId[dish])!.courseId;
      const { place } = placeFor(courseId, context);
      context.placed.push({ courseId, place });
      return {
        release: place.kind === "fire" ? ("fire" as const) : ("hold" as const),
        lines: [line(v, dish)],
      };
    });
    expect(context.placed.map(({ place }) => place.kind)).toEqual(["fire", "fire", "new", "new"]);
    await submit(v, s.partyId, groups);
    const rows = await linesOf(s.partyId);
    const fired = await firedTicketLineIds(s.partyId);
    expect(rows.map((row) => [row.productId, fired.includes(row.id)]).sort()).toEqual(
      [
        [v.productId.beer, true],
        [v.productId.cold, true],
        [v.productId.steak, false],
        [v.productId.flan, false],
      ].sort(),
    );
    const held = rows.find((row) => row.productId === v.productId.steak)!;
    await fire(v, s.partyId, held.groupId!);
    expect(await firedTicketLineIds(s.partyId)).toContain(held.id);
  });

  it("fires the starter and later courses together at the counter", async () => {
    const v = await setupVenue(true);
    const counter = await inTx((tx) => offerProducts(tx, { zone: "counter" }));
    const id = randomUUID();
    await inTx((tx) =>
      createOpenOrder(
        tx,
        v.cfg,
        id,
        (["cold", "steak", "flan"] as const).map((dish) => ({
          menuItemId: counter.offerFor(v.productId[dish]),
          quantity: "1",
        })),
        null,
        { zoneId: counter.zoneId },
      ),
    );
    await inTx((tx) => fireDishesAtPayment(tx, v.cfg, id));
    const tickets = await db
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(tickets).toHaveLength(3);
    expect(tickets.every((ticket) => ticket.firedAt !== null)).toBe(true);
  });
});
