import {
  workingOrderLines,
  workingOrders,
  orderGroups,
  devices,
  orderEvents,
  ticketItems,
  products,
  units,
  lineServiceCancellations,
} from "@waitron/db";
import { seedPerson, seedKitchenStation } from "@waitron/db/testing/seed.js";
import { createProduct } from "@waitron/menu";
import { setRoutingCell } from "@waitron/venue-service";
import { eq, sql, and, isNotNull, asc, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { reprintOrderTickets } from "./kitchen-print.js";
import { readCurrentOrders } from "./order-group-reads.js";
import { fireGroup, fireHeldLine } from "./order-group-release.js";
import type { GroupLine } from "./order-group-submission.js";
import { attachPrinterToStation } from "./station-printers.js";
import { seedPendingCardPayment } from "./testing/bill-payment-fixture.js";
import { cancelLine } from "./testing/cancel-line.js";
import { setChangesAfterSending } from "./testing/changes-after-sending.js";
import {
  setupVenue,
  specExample,
  groupsOf,
  COURSES,
  linesOf,
  firedTicketLineIds,
  printed,
  DISHES,
  seated,
  submit,
  line,
  MIA,
  db,
  revisionOf,
  linesIn,
  eventsOf,
  ALEX,
  expectRefusedWithNothingWritten,
  fire,
  inTx,
  onSecondBill,
  move,
  args,
  reorder,
  snapshot,
  ticketLines,
  submitGrouped,
  ticketsOf,
  stillPaying,
} from "./testing/order-groups.test-support.js";
import { sendLines, setLineCourse } from "./testing/order-writer-fixture.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { offerProducts } from "./testing/zone-offers.js";

describe("the spec's example (§3, §12 item 3)", () => {
  it("fires the drinks and cold starters as groups 1 and 2 and holds the rest as 3, 4 and 5", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.id, group.position, group.state])).toEqual([
      [s.drinks, 1, "fired"],
      [s.cold, 2, "fired"],
      [s.warm, 3, "held"],
      [s.mains, 4, "held"],
      [s.desserts, 5, "held"],
    ]);
    expect(groups.map((group) => group.summary)).toEqual([
      "2 × Beer tap, 1 × Water btl",
      "4 × Croquettes",
      "4 × Octopus",
      "2 × Steak, 1 × Fish",
      "2 × Flan",
    ]);
    // The two starter groups are two groups, and nothing about them names a course.
    expect(s.cold).not.toBe(s.warm);
    for (const group of groups) {
      for (const course of Object.values(COURSES)) expect(group.summary).not.toContain(course);
    }
  });

  it("gives fired tickets, prints and sent stamps to groups 1 and 2 only", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const lines = await linesOf(s.partyId);
    const inGroup = (groupId: string) => lines.filter((row) => row.groupId === groupId);

    const routedFired = [...inGroup(s.drinks), ...inGroup(s.cold)]
      .filter((row) => row.productId !== v.productId.water)
      .map((row) => row.id)
      .sort();
    expect(await firedTicketLineIds(s.partyId)).toEqual(routedFired);
    for (const row of [...inGroup(s.drinks), ...inGroup(s.cold)]) {
      expect(row.sentAt).not.toBeNull();
    }
    for (const row of [...inGroup(s.warm), ...inGroup(s.mains), ...inGroup(s.desserts)]) {
      expect(row.sentAt).toBeNull();
    }
    const tickets = (await printed(v)).join("\n");
    expect(tickets).toContain(DISHES.beer.kitchen);
    expect(tickets).toContain(DISHES.cold.kitchen);
    for (const dish of ["warm", "steak", "fish", "flan"] as const) {
      expect(tickets).not.toContain(DISHES[dish].kitchen);
    }
  });

  it("credits every submitted line to the operator who submitted it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak", "2")] }], {
      operatorId: MIA,
    });
    const rows = await db
      .select({ creditedTo: workingOrderLines.creditedTo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId));
    expect(rows).toEqual([{ creditedTo: MIA }, { creditedTo: MIA }]);
  });

  it("puts the lines on the party's next tab when its tab has been paid, and names that tab", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "beer")] }]);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, s.tabId));

    const result = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "flan")] }]);

    expect(result.tabId).not.toBe(s.tabId);
    expect(result.revision).toBe(await revisionOf(s.partyId));
    const [flan] = await linesIn(s.partyId, result.groups[0]!.id);
    expect(flan).toMatchObject({ workingOrderId: result.tabId, name: DISHES.flan.staff });
  });
});
describe("fire all now", () => {
  it("makes ONE fired group of a draft spanning four courses, never one per course", async () => {
    const v = await setupVenue();
    const s = await seated(v);

    const result = await submit(v, s.partyId, [
      {
        release: "fire",
        lines: [line(v, "beer"), line(v, "cold"), line(v, "steak"), line(v, "flan")],
      },
    ]);

    const { groups } = await groupsOf(s.partyId);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: result.groups[0]!.id, position: 1, state: "fired" });
    const lines = await linesOf(s.partyId);
    // The lines keep their four product-default courses, which the earliest-course rule would
    // have held; the group's release decides instead.
    expect(new Set(lines.map((row) => row.courseId)).size).toBe(4);
    expect(await firedTicketLineIds(s.partyId)).toEqual(lines.map((row) => row.id).sort());
  });
});
describe("later additions (§12 item 4)", () => {
  it("submits a later Steak released to fire as a new fired group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    const result = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak")] }]);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => group.id)).toEqual([
      s.drinks,
      s.cold,
      s.warm,
      s.mains,
      s.desserts,
      result.groups[0]!.id,
    ]);
    expect(groups[5]).toMatchObject({ position: 6, state: "fired", summary: "1 × Steak" });
  });

  it("joins a later Steak to the held mains, keeping its position and reminder", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const remindAt = "2026-09-27T21:15:00.000Z";
    await db.update(orderGroups).set({ remindAt }).where(eq(orderGroups.id, s.mains));

    const result = await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }], {
      joinGroupId: s.mains,
    });

    expect(result.groups.map((group) => group.id)).toEqual([s.mains]);
    const mains = (await groupsOf(s.partyId)).groups.find((group) => group.id === s.mains)!;
    expect(mains).toMatchObject({ position: 4, state: "held", remindAt });
    expect(mains.lineIds).toHaveLength(4);
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: s.mains,
      kind: "group.joined",
      actorId: ALEX,
    });
  });

  it("refuses to join a fired group (group.not_held), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [{ release: "hold", lines: [line(v, "beer")] }], {
          joinGroupId: s.drinks,
        }),
      { code: "group.not_held", params: { groupId: s.drinks } },
    );
  });

  it("refuses to join a group the party does not have (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const other = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [{ release: "hold", lines: [line(v, "beer")] }], {
          joinGroupId: other.mains,
        }),
      { code: "group.not_found", params: { groupId: other.mains } },
    );
  });

  it("never matches a group by course: a fired Steak does not join the held mains", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const mainsBefore = await linesIn(s.partyId, s.mains);

    const result = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak")] }]);

    expect(result.groups[0]!.id).not.toBe(s.mains);
    expect(await linesIn(s.partyId, s.mains)).toEqual(mainsBefore);
    const [steak] = await linesIn(s.partyId, result.groups[0]!.id);
    expect(steak!.courseId).toBe(mainsBefore[0]!.courseId);
  });
});
describe("firing", () => {
  it("fires the warm starters: sent, fired, printed at fire, and a fired event", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [warm] = await linesIn(s.partyId, s.warm);
    const jobsBefore = (await printed(v)).length;

    const result = await fire(v, s.partyId, s.warm, { operatorId: MIA });

    expect(result).toEqual({ revision: await revisionOf(s.partyId) });
    const [after] = await linesIn(s.partyId, s.warm);
    expect(after!.sentAt).not.toBeNull();
    expect(await firedTicketLineIds(s.partyId)).toContain(warm!.id);
    const jobs = await printed(v);
    expect(jobs).toHaveLength(jobsBefore + 1);
    expect(jobs.at(-1)).toContain(DISHES.warm.kitchen);
    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.warm));
    expect(group).toMatchObject({ state: "fired", firedBy: MIA, firedAt: expect.any(String) });
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: s.warm,
      kind: "group.fired",
      actorId: MIA,
    });
  });

  it("refuses to fire a fired group again under a new submission (group.not_held)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await fire(v, s.partyId, s.warm);
    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, s.warm), {
      code: "group.not_held",
      params: { groupId: s.warm },
    });
  });

  it("refuses a group the party does not have (group.not_found)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const missing = randomUUID();
    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, missing), {
      code: "group.not_found",
      params: { groupId: missing },
    });
  });

  it("stamps a held no-route line sent only when its group fires", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "water"), line(v, "flan")] },
    ]);
    const groupId = groups[0]!.id;
    expect((await linesIn(s.partyId, groupId)).map((row) => row.sentAt)).toEqual([null, null]);

    await fire(v, s.partyId, groupId);

    const lines = await linesIn(s.partyId, groupId);
    expect(lines.map((row) => row.sentAt)).toEqual([expect.any(String), expect.any(String)]);
  });

  it("refuses a group holding an archived Steak, firing none of it, then fires once it is removed", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await db.run(sql`update products set active = 0 where id = ${v.productId.steak}`);

    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, s.mains), {
      code: "product.unavailable",
      params: { productId: v.productId.steak },
    });

    const mains = await linesIn(s.partyId, s.mains);
    const fish = mains.find((row) => row.productId === v.productId.fish);
    for (const steak of mains.filter((row) => row.productId === v.productId.steak))
      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, steak.lineNo));
    await fire(v, s.partyId, s.mains);
    expect(await firedTicketLineIds(s.partyId)).toContain(fish!.id);
  });

  it("fires nothing and prints nothing when the archived line is on the second of two bills", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "steak"), line(v, "water")] },
    ]);
    const groupId = groups[0]!.id;
    const [, water] = await linesIn(s.partyId, groupId);
    const revision = await revisionOf(s.partyId);
    // The second bill is opened after the tab, so its line is released second.
    await onSecondBill(v, s, [{ lineNo: water!.lineNo }], revision, ALEX);
    await db.run(sql`update products set active = 0 where id = ${v.productId.water}`);

    await expectRefusedWithNothingWritten(v, s.partyId, () => fire(v, s.partyId, groupId), {
      code: "product.unavailable",
      params: { productId: v.productId.water },
    });
    expect(await firedTicketLineIds(s.partyId)).toEqual([]);
    expect(await printed(v)).toEqual([]);
  });
});
describe("two orders of events", () => {
  it("fire the mains, then move a Steak into them: group.not_held, and the Steak stays", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const steakGroup = (
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }])
    ).groups[0]!.id;
    const [steak] = await linesIn(s.partyId, steakGroup);
    await fire(v, s.partyId, s.mains);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.mains }),
      { code: "group.not_held", params: { groupId: s.mains } },
    );
    expect((await linesIn(s.partyId, steakGroup)).map((row) => row.id)).toEqual([steak!.id]);
  });

  it("move a Steak into the mains, then fire them: the Steak fires with them", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const steakGroup = (
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }])
    ).groups[0]!.id;
    const [steak] = await linesIn(s.partyId, steakGroup);

    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.mains });
    await fire(v, s.partyId, s.mains);

    expect((await linesIn(s.partyId, s.mains)).map((row) => row.id)).toContain(steak!.id);
    expect(await firedTicketLineIds(s.partyId)).toContain(steak!.id);
  });

  it("refuses to move a line OUT of a fired group (group.not_held)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.partyId, s.drinks);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: beer!.id, quantity: "1" }], { groupId: s.mains }),
      { code: "group.not_held", params: { groupId: s.drinks } },
    );
  });
});
describe("the fired groups' lines", () => {
  it("record who fired them and when, and no held group has a fired time", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const rows = await db
      .select({
        id: orderGroups.id,
        firedBy: orderGroups.firedBy,
        submittedBy: orderGroups.submittedBy,
      })
      .from(orderGroups)
      .where(and(eq(orderGroups.partyId, s.partyId), isNotNull(orderGroups.firedAt)))
      .orderBy(orderGroups.position);
    expect(rows).toEqual([
      { id: s.drinks, firedBy: ALEX, submittedBy: ALEX },
      { id: s.cold, firedBy: ALEX, submittedBy: ALEX },
    ]);
  });
});
describe("sending lines on their own", () => {
  it("refuses to send a line of a held group (group.line_held), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const [croquettes] = await linesIn(s.partyId, s.cold);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => inTx((tx) => sendLines(tx, v.cfg, s.tabId, [croquettes!.lineNo, steak!.lineNo])),
      { code: "group.line_held", params: { tabId: s.tabId, lineNo: steak!.lineNo } },
    );
  });
});
describe("a device as the firer", () => {
  async function firingDevice(): Promise<{ id: string; label: string }> {
    const id = await seedSessionDevice(db);
    const [row] = await db.select({ label: devices.label }).from(devices).where(eq(devices.id, id));
    return { id, label: row!.label };
  }

  it("records the device, not a person, on a historical group release, and shows it as the sender", async () => {
    await seedPerson(db, { id: ALEX, displayName: "Round operator" });
    const v = await setupVenue();
    const s = await specExample(v);
    const device = await firingDevice();
    const command = await args(s.partyId, { operatorId: device.id });
    await inTx((tx) => fireGroup(tx, v.cfg, s.partyId, s.mains, command, { deviceId: device.id }));

    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.mains));
    expect(group).toMatchObject({ state: "fired", firedBy: null, firedByDeviceId: device.id });
    const [event] = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.groupId, s.mains), eq(orderEvents.kind, "group.fired")));
    expect(event).toMatchObject({ actorId: null, actorDeviceId: device.id });
    const read = await inTx((tx) => readCurrentOrders(tx, s.partyId));
    expect(read.groups.find((g) => g.id === s.mains)?.sentBy).toBe(device.label);
    expect(read.groups.find((g) => g.id === s.drinks)?.sentBy).toBe("Round operator");
  });

  it("records the device when a group fires, keeping the device's id as the command's operator", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const device = await firingDevice();
    const command = await args(s.partyId, { operatorId: device.id });

    await inTx((tx) => fireGroup(tx, v.cfg, s.partyId, s.warm, command, { deviceId: device.id }));

    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.warm));
    expect(group).toMatchObject({ state: "fired", firedBy: null, firedByDeviceId: device.id });
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: s.warm,
      kind: "group.fired",
      actorId: null,
    });
    const replay = await inTx((tx) =>
      fireGroup(tx, v.cfg, s.partyId, s.warm, command, { deviceId: device.id }),
    );
    expect(replay).toEqual({ revision: await revisionOf(s.partyId) });
  });

  it("records the person a group's command names when no firer is given", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await fire(v, s.partyId, s.warm, { operatorId: MIA });
    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.warm));
    expect(group).toMatchObject({ firedBy: MIA, firedByDeviceId: null });
  });
});
describe("waiter group and recalled-line release", () => {
  it("fires the selected held group and records the waiter", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak, fish] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);
    const jobsBefore = (await printed(v)).length;

    await fire(v, s.partyId, s.mains, { operatorId: MIA });

    expect(await revisionOf(s.partyId)).toBe(revision + 1);
    const states = Object.fromEntries(
      (await groupsOf(s.partyId)).groups.map((group) => [group.id, group.state]),
    );
    expect(states).toEqual({
      [s.drinks]: "fired",
      [s.cold]: "fired",
      [s.warm]: "held",
      [s.mains]: "fired",
      [s.desserts]: "held",
    });
    expect(await firedTicketLineIds(s.partyId)).toEqual(
      expect.arrayContaining([steak!.id, fish!.id]),
    );
    expect((await linesIn(s.partyId, s.mains)).every((row) => row.sentAt !== null)).toBe(true);
    expect((await printed(v)).slice(jobsBefore).join("\n")).toContain(DISHES.steak.kitchen);
    const [group] = await db.select().from(orderGroups).where(eq(orderGroups.id, s.mains));
    expect(group).toMatchObject({ firedBy: MIA, firedAt: expect.any(String) });
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: s.mains,
      kind: "group.fired",
      actorId: MIA,
    });
  });

  it("fires selected groups whole in waiter order, leaving the other same-course group held", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const made = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "steak")] },
      { release: "hold", lines: [line(v, "fish"), line(v, "flan")] },
      { release: "hold", lines: [line(v, "warm")] },
    ]);
    const [steakGroup, fishGroup, warmGroup] = made.groups.map((group) => group.id);
    await reorder(s.partyId, [fishGroup!, warmGroup!, steakGroup!]);

    await fire(v, s.partyId, fishGroup!, { operatorId: ALEX });

    expect((await groupsOf(s.partyId)).groups.find((g) => g.id === steakGroup)!.state).toBe("held");
    expect((await linesIn(s.partyId, steakGroup!))[0]!.sentAt).toBeNull();
    await fire(v, s.partyId, steakGroup!, { operatorId: ALEX });

    const fired = (await eventsOf(s.partyId)).filter((event) => event.kind === "group.fired");
    expect(fired.map((event) => event.groupId)).toEqual([fishGroup, steakGroup]);
    const flan = (await linesIn(s.partyId, fishGroup!)).find(
      (row) => row.productId === v.productId.flan,
    );
    expect(flan!.sentAt).not.toBeNull();
    expect((await groupsOf(s.partyId)).groups.find((g) => g.id === warmGroup)!.state).toBe("held");
  });

  it("keeps a Steak added held after the mains fired held until the waiter fires its group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await fire(v, s.partyId, s.mains, { operatorId: ALEX });

    const later = await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]);
    const laterGroup = later.groups[0]!.id;
    const [steak] = await linesIn(s.partyId, laterGroup);
    expect(steak!.sentAt).toBeNull();
    expect(await firedTicketLineIds(s.partyId)).not.toContain(steak!.id);

    await fire(v, s.partyId, laterGroup, { operatorId: ALEX });

    expect((await linesIn(s.partyId, laterGroup))[0]!.sentAt).not.toBeNull();
    expect(await firedTicketLineIds(s.partyId)).toContain(steak!.id);
    expect((await groupsOf(s.partyId)).groups.find((g) => g.id === laterGroup)!.state).toBe(
      "fired",
    );
  });

  it("refuses a held group holding an archived Steak (product.unavailable), firing none of it", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await db.run(sql`update products set active = 0 where id = ${v.productId.steak}`);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.mains, { operatorId: ALEX }),
      { code: "product.unavailable", params: { productId: v.productId.steak } },
    );
  });

  it("re-sending a sent line changes nothing, and course editing refuses a course the venue lacks", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [drink] = await linesIn(s.partyId, s.drinks);
    const [steak] = await linesIn(s.partyId, s.mains);
    const before = await snapshot(v, s.partyId);

    await inTx((tx) => sendLines(tx, v.cfg, s.tabId, [drink!.lineNo]));
    expect(await snapshot(v, s.partyId)).toEqual(before);

    const missing = randomUUID();
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => inTx((tx) => setLineCourse(tx, s.tabId, steak!.lineNo, missing)),
      { code: "course.not_found", params: { courseId: missing } },
    );
  });
});
describe("kitchen tickets for a party's groups (Task 5)", () => {
  // Fails if a group's fire ticket stops naming its group, or names it anywhere but under the header.
  it("names the group under the header of each group's fire ticket", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [drinks, cold] = (await printed(v)).map(ticketLines);
    expect(drinks![4]).toBe("GROUP 1 · DRINKS");
    expect(drinks!.slice(5).join("\n")).toContain(DISHES.beer.kitchen);
    expect(cold![4]).toBe("GROUP 2 · STARTERS");

    await fire(v, s.partyId, s.warm);

    const warm = ticketLines((await printed(v)).at(-1)!);
    expect(warm[4]).toBe("GROUP 3 · STARTERS");
    expect(warm.filter((text) => text.startsWith("GROUP"))).toEqual(["GROUP 3 · STARTERS"]);
  });

  // The REPRINT line is what fails first; the rows compared before and after were already left
  // alone by the reprint before this task (it only enqueues print jobs).
  it("marks a reprint REPRINT, heads each group, and records no event, ticket item or sent stamp", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await fire(v, s.partyId, s.warm);
    const rows = async () => ({
      events: await eventsOf(s.partyId),
      tickets: await ticketItemsWithBill(db)
        .where(eq(workingOrderLines.workingOrderId, s.tabId))
        .orderBy(ticketItems.id),
      sent: (await linesOf(s.partyId)).map((row) => [row.id, row.sentAt]),
    });
    const before = await rows();
    const jobsBefore = (await printed(v)).length;

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, s.tabId));

    const jobs = await printed(v);
    expect(jobs).toHaveLength(jobsBefore + 1);
    const reprint = ticketLines(jobs.at(-1)!);
    expect(reprint[0]).toMatch(/^\*\*\* REPRINT \d\d:\d\d \*\*\*$/);
    const at = (text: string) => reprint.findIndex((row) => row.includes(text));
    expect(reprint.filter((text) => text.startsWith("GROUP"))).toEqual([
      "GROUP 1 · DRINKS",
      "GROUP 2 · STARTERS",
      "GROUP 3 · STARTERS",
    ]);
    expect(at("GROUP 1")).toBeLessThan(at(DISHES.beer.kitchen));
    expect(at(DISHES.beer.kitchen)).toBeLessThan(at("GROUP 2"));
    expect(at("GROUP 2")).toBeLessThan(at(DISHES.cold.kitchen));
    expect(at(DISHES.cold.kitchen)).toBeLessThan(at("GROUP 3"));
    expect(at("GROUP 3")).toBeLessThan(at(DISHES.warm.kitchen));
    expect(await rows()).toEqual(before);
  });

  // Fails if a reprint prints in line order rather than group order: the mains were added after
  // the warm starters but moved ahead of them.
  it("prints a reprint's groups in position order, not in the order their lines were added", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await reorder(s.partyId, [s.mains, s.warm, s.desserts]);
    await fire(v, s.partyId, s.mains);
    await fire(v, s.partyId, s.warm);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, s.tabId));

    const reprint = ticketLines((await printed(v)).at(-1)!);
    const at = (text: string) => reprint.findIndex((row) => row.includes(text));
    expect(reprint.filter((text) => text.startsWith("GROUP"))).toEqual([
      "GROUP 1 · DRINKS",
      "GROUP 2 · STARTERS",
      "GROUP 4 · MAINS",
      "GROUP 3 · STARTERS",
    ]);
    expect(at("GROUP 4")).toBeLessThan(at(DISHES.steak.kitchen));
    expect(at(DISHES.steak.kitchen)).toBeLessThan(at("GROUP 3"));
    expect(at("GROUP 3")).toBeLessThan(at(DISHES.warm.kitchen));
  });

  // Fails if the fire ticket or the reprint ignores the venue's grouping setting.
  it("prints Steak x3 as one 3 x entry under combined and three 1 x entries under separate, leaving the bill alone", async () => {
    const v = await setupVenue();
    const steaksOn = (ticket: string) =>
      ticketLines(ticket).filter((text) => text.includes(DISHES.steak.kitchen));
    const bill = (tabId: string) =>
      db
        .select({
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
          unitPriceGross: workingOrderLines.unitPriceGross,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(asc(workingOrderLines.lineNo));
    const three = (qty: string) => expect.stringMatching(new RegExp(`^${qty} .*x K-STEAK$`));

    const first = await seated(v);
    await submit(v, first.partyId, [{ release: "fire", lines: [line(v, "steak", "3")] }]);
    expect(steaksOn((await printed(v)).at(-1)!)).toEqual([three("3")]);

    await inTx((tx) => setStationPrinting(tx, { ticketGrouping: "separate" }));
    const second = await seated(v);
    await submit(v, second.partyId, [{ release: "fire", lines: [line(v, "steak", "3")] }]);
    expect(steaksOn((await printed(v)).at(-1)!)).toEqual([three("1"), three("1"), three("1")]);

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, first.tabId));
    expect(steaksOn((await printed(v)).at(-1)!)).toEqual([three("1"), three("1"), three("1")]);

    const firstBill = await bill(first.tabId);
    expect(firstBill.map((row) => row.quantity)).toEqual([1000, 1000, 1000]);
    expect(await bill(second.tabId)).toEqual(firstBill);
  });

  // Fails if two portions sold by the gram are added together under combined, or one portion is
  // split into single grams under separate; dishes sold in Each must still merge and split.
  it("prints each portion sold by weight as sold, under combined and separate alike", async () => {
    const v = await setupVenue();
    const sold = await inTx(async (tx) => {
      const [steak] = await tx
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, v.productId.steak));
      // As the venue seed makes it (`packages/menu/src/provisioning.ts`): whole grams only.
      const grams = { en: "g", es: "g", ca: "g", gl: "g", eu: "g" };
      const [gram] = await tx
        .insert(units)
        .values({
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: grams,
          abbreviation: grams,
          precision: 0,
          hardwareUnit: "g",
        })
        .returning({ id: units.id });
      const dish = (name: string, kitchenName: string, unit: { unitId: string } | object) =>
        createProduct(tx, {
          ...steak!,
          name,
          customerName: { en: `${name} of the day` },
          kitchenName,
          ...unit,
          unitPrice: "0.05",
          vatClass: "general",
        });
      const hake = await dish("Hake", "K-HAKE", { unitId: gram!.id });
      const ham = await dish("Ham", "K-HAM", { pricingUnit: "weight" });
      const offers = await offerProducts(tx, {
        zone: "tables",
        productIds: [hake.id, ham.id],
      });
      return { hake: offers.offerFor(hake.id), ham: offers.offerFor(ham.id) };
    });
    const hake = (quantity: string): GroupLine => ({ menuItemId: sold.hake, quantity });
    const ofDish = (ticket: string, kitchenName: string) =>
      ticketLines(ticket).filter((text) => text.endsWith(`x ${kitchenName}`));

    const first = await seated(v);
    await submit(v, first.partyId, [
      {
        release: "fire",
        lines: [
          hake("350"),
          line(v, "steak"),
          hake("350"),
          line(v, "steak"),
          { menuItemId: sold.ham, quantity: "0.375" },
        ],
      },
    ]);
    const combined = (await printed(v)).at(-1)!;
    expect(ofDish(combined, "K-HAKE")).toEqual(["350 g x K-HAKE", "350 g x K-HAKE"]);
    expect(ofDish(combined, "K-STEAK")).toEqual([expect.stringMatching(/^2 .*x K-STEAK$/)]);
    expect(ofDish(combined, "K-HAM")).toEqual(["0.375 kg x K-HAM"]);

    await inTx((tx) => setStationPrinting(tx, { ticketGrouping: "separate" }));
    const second = await seated(v);
    await submit(v, second.partyId, [
      { release: "fire", lines: [hake("350"), line(v, "steak", "2")] },
    ]);
    const separate = (await printed(v)).at(-1)!;
    expect(ofDish(separate, "K-HAKE")).toEqual(["350 g x K-HAKE"]);
    expect(ofDish(separate, "K-STEAK")).toEqual([
      expect.stringMatching(/^1 .*x K-STEAK$/),
      expect.stringMatching(/^1 .*x K-STEAK$/),
    ]);
  });

  // Fails if identical lines of one group print as separate entries under the default.
  it.each(["fire", "hold"] as const)(
    "prints three separate Steak lines as one 3 x entry by default (%s)",
    async (release) => {
      const v = await setupVenue();
      const s = await seated(v);
      const { groups } = await submit(v, s.partyId, [
        { release, lines: [line(v, "steak"), line(v, "steak"), line(v, "steak")] },
      ]);
      if (release === "hold") await fire(v, s.partyId, groups[0]!.id);

      const steaks = await linesIn(s.partyId, groups[0]!.id);
      expect(steaks.map((row) => row.quantity)).toEqual([1000, 1000, 1000]);
      const ticket = ticketLines((await printed(v)).at(-1)!);
      expect(ticket.filter((text) => text.includes(DISHES.steak.kitchen))).toEqual([
        expect.stringMatching(/^3 .*x K-STEAK$/),
      ]);
    },
  );
});
describe("Fire now on one held dish", () => {
  async function fixture(printHeld: boolean, shape?: "grouped") {
    const v = await setupVenue();
    const extraStation = await seedKitchenStation(db, {
      name: "Sauce kitchen",
      isDefault: false,
    });
    await inTx(async (tx) => {
      await setStationPrinting(tx, { printHeldWork: printHeld });
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: v.productId.sauce }, zoneId: null },
        { kind: "station", stationId: extraStation },
      );
      await attachPrinterToStation(tx, {
        stationId: extraStation,
        printerId: v.printerId,
      });
    });
    const s = await seated(v);
    const place = (groups: Parameters<typeof submitGrouped>[2]) =>
      shape === "grouped" ? submitGrouped(v, s, groups) : submit(v, s.partyId, groups);
    const result = await place([
      {
        release: "hold",
        lines: [
          {
            ...line(v, "steak", "2"),
            extras: [
              { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
            ],
          },
          line(v, "fish"),
        ],
      },
    ]);
    const rows = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId))
      .orderBy(workingOrderLines.lineNo);
    return {
      v,
      s,
      held: result.groups[0]!,
      rows,
      steak: rows.find((r) => r.productId === v.productId.steak)!,
      fish: rows.find((r) => r.productId === v.productId.fish)!,
      extra: rows.find((r) => r.parentLineId !== null)!,
    };
  }

  it.each([false, true])(
    "fires only the whole dish and its extras, printed HOLD=%s, once on replay",
    async (printHeld) => {
      const { v, s, held, rows, steak, fish, extra } = await fixture(printHeld);
      const command = await args(s.partyId);
      const beforePrint = (await printed(v)).length;
      const answer = await inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, command));
      expect(answer).toEqual({ revision: command.expectedPartyRevision + 1 });
      // Steak ×2 is two portions, each with its own sauce: Fire now takes the first portion.
      const firedRow = (row: { id: string; parentLineId: string | null }) =>
        row.id === steak.id || row.parentLineId === steak.id;
      const left = rows.filter((row) => row.parentLineId === null && !firedRow(row));
      const groups = await groupsOf(s.partyId);
      expect(groups.groups.map((g) => [g.displayNumber, g.state, g.lineIds])).toEqual([
        [1, "held", left.map((row) => row.id)],
        [2, "fired", [steak.id]],
      ]);
      const fired = groups.groups[1]!;
      const after = await db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, s.tabId))
        .orderBy(workingOrderLines.lineNo);
      expect(after).toEqual(
        rows.map((row) => ({
          ...row,
          groupId: firedRow(row) ? fired.id : held.id,
          sentAt: firedRow(row) ? expect.any(String) : row.sentAt,
          sentNutrition: firedRow(row)
            ? { allergens: null, dietaryDeclarations: [] }
            : row.sentNutrition,
        })),
      );
      expect(after.find((r) => r.id === fish.id)).toEqual(fish);
      expect(await firedTicketLineIds(s.partyId)).toEqual([steak.id, extra.id].sort());
      const paper = (await printed(v)).slice(beforePrint).join("\n");
      expect(paper).toContain("K-STEAK");
      expect(paper).not.toContain("K-FISH");
      if (printHeld) {
        expect(paper).toContain("HOLD CHANGED");
        expect(paper).toContain("FIRE");
      } else expect(paper).not.toContain("HOLD CHANGED");
      const afterFirst = await snapshot(v, s.partyId);
      expect(await inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, command))).toEqual(
        answer,
      );
      expect(await snapshot(v, s.partyId)).toEqual(afterFirst);
    },
  );

  it("fires a held dish at a Not allowed station", async () => {
    const { v, s, steak } = await fixture(false);
    await inTx((tx) => setChangesAfterSending(tx, "never"));
    const command = await args(s.partyId);
    await inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, command));
    expect(await firedTicketLineIds(s.partyId)).toContain(steak.id);
  });

  it("refuses a wholly cancelled held dish", async () => {
    const { v, s, steak } = await fixture(false);
    await db.insert(lineServiceCancellations).values({
      lineId: steak.id,
      quantity: steak.quantity,
      cancelledAt: "2026-10-17T10:00:00.000Z",
      wasStarted: false,
      actorId: ALEX,
    });
    const command = await args(s.partyId);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, command)),
      { code: "group.line_cancelled", params: { lineId: steak.id } },
    );
  });

  it("releases a dish needing no kitchen preparation without creating a kitchen record", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const held = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "water")] }]))
      .groups[0]!;
    const command = await args(s.partyId);
    await inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, held.lineIds[0]!, command));
    expect(await ticketsOf(s.partyId)).toEqual([]);
    const [released] = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, held.lineIds[0]!));
    expect(released!.sentAt).toEqual(expect.any(String));
    expect(released!.quantity).toBe(1000);
    expect((await groupsOf(s.partyId)).groups.map((g) => [g.state, g.lineIds])).toEqual([
      ["fired", [held.lineIds[0]]],
    ]);
  });

  it("fires a dish while its bill is being paid, leaving the payment in place", async () => {
    const { v, s, steak } = await fixture(true);
    await seedPendingCardPayment(db, s.tabId);
    const command = await args(s.partyId);
    await inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, command));
    expect(await firedTicketLineIds(s.partyId)).toContain(steak.id);
    await stillPaying(s.tabId);
  });

  it("refuses a different dish reusing an accepted submission id", async () => {
    const { v, s, steak, fish } = await fixture(false);
    const command = await args(s.partyId);
    await inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, command));
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, fish.id, command)),
      { code: "submission.id_reused" },
    );
  });

  it("refuses an abandoned bill while still permitting presented service", async () => {
    const { v, s, steak, fish } = await fixture(false);
    await db.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, s.tabId));
    await inTx(async (tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, await args(s.partyId)));
    expect(await firedTicketLineIds(s.partyId)).toContain(steak.id);
    await db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, s.tabId));
    const command = await args(s.partyId);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, fish.id, command)),
      { code: "tab.not_open" },
    );
  });

  it("fires only the active remainder of a partly cancelled dish", async () => {
    const { v, s, steak, extra } = await fixture(true, "grouped");
    await db.insert(lineServiceCancellations).values({
      lineId: steak.id,
      quantity: 1000,
      cancelledAt: "2026-10-17T10:00:00.000Z",
      wasStarted: false,
      actorId: ALEX,
    });
    await db
      .update(ticketItems)
      .set({ quantity: 1000 })
      .where(inArray(ticketItems.workingOrderLineId, [steak.id, extra.id]));
    const command = await args(s.partyId);
    await inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, command));
    const tickets = (await ticketsOf(s.partyId)).filter((item) => item.firedAt !== null);
    expect(tickets.map((item) => [item.lineId, item.quantity]).sort()).toEqual(
      [
        [steak.id, 1000],
        [extra.id, 1000],
      ].sort(),
    );
    const [charge] = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, steak.id));
    expect(charge).toMatchObject({ quantity: 2000, unitPriceGross: 2200, lineTotal: 4400 });
  });

  it("removes the emptied held group but keeps its paper number reserved", async () => {
    const { v, s, held, rows } = await fixture(false);
    // Two steak portions and the fish: three dishes.
    for (const row of rows.filter((r) => r.parentLineId === null))
      await inTx(async (tx) => fireHeldLine(tx, v.cfg, s.partyId, row.id, await args(s.partyId)));
    const [source] = await db.select().from(orderGroups).where(eq(orderGroups.id, held.id));
    expect(source).toMatchObject({ state: "removed", displayNumber: 1 });
    expect((await groupsOf(s.partyId)).groups.map((g) => [g.displayNumber, g.state])).toEqual([
      [2, "fired"],
      [3, "fired"],
      [4, "fired"],
    ]);
  });

  it("fires a held dish on a paid bill brought across by a merge", async () => {
    const { v, s, rows, steak, extra } = await fixture(false);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, s.tabId));
    const into = await seated(v);
    await inTx((tx) =>
      combineParties(tx, v.cfg, {
        from: s.partyId,
        into: into.partyId,
        tables: "join",
        operatorId: ALEX,
      }),
    );
    const command = await args(into.partyId);
    await inTx((tx) => fireHeldLine(tx, v.cfg, into.partyId, steak.id, command));
    expect(await firedTicketLineIds(into.partyId)).toEqual([steak.id, extra.id].sort());
    expect(
      (await groupsOf(into.partyId)).groups.map((g) => [g.displayNumber, g.state, g.lineIds]),
    ).toEqual([
      [
        1,
        "held",
        rows.filter((row) => row.parentLineId === null && row.id !== steak.id).map((row) => row.id),
      ],
      [2, "fired", [steak.id]],
    ]);
  });

  it.each(["unknown", "extra", "foreign", "fired", "stale"] as const)(
    "refuses %s without changing lines, tickets, paper or command audit",
    async (kind) => {
      const { v, s, steak, extra } = await fixture(false);
      let lineId = steak.id;
      let code = "group.not_found";
      let command = await args(s.partyId);
      if (kind === "unknown") lineId = randomUUID();
      if (kind === "extra") lineId = extra.id;
      if (kind === "foreign") {
        const other = await seated(v);
        const group = await submit(v, other.partyId, [
          { release: "hold", lines: [line(v, "fish")] },
        ]);
        lineId = group.groups[0]!.lineIds[0]!;
      }
      if (kind === "fired") {
        await inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, lineId, command));
        command = await args(s.partyId);
        code = "group.not_held";
      }
      if (kind === "stale") {
        command = { ...command, expectedPartyRevision: command.expectedPartyRevision - 1 };
        code = "party.out_of_date";
      }
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => inTx((tx) => fireHeldLine(tx, v.cfg, s.partyId, lineId, command)),
        { code },
      );
    },
  );
});
