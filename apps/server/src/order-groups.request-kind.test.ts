import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  orderGroups,
  parties,
  partyTables,
  ticketItems,
  withTransaction,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { moveDishes } from "./bill-actions.js";
import { createCourse } from "./kitchen.js";
import {
  fireGroup,
  fireHeldLine,
  groupArrivingDishes,
  moveLinesToGroup,
  removeEmptiedHeldGroups,
  reorderHeldGroups,
  startGroup,
  type GroupRelease,
} from "./order-groups.js";
import { submitGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { createTable } from "./testing/live-table.js";
import { observedRelocationSender } from "./testing/table-action-fixture.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import {
  provisionBillVenue,
  seatedWith,
  send as rawSend,
  type BillVenue,
} from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

async function kinds(groupIds: readonly string[]) {
  const rows = await suite.db
    .select({ id: orderGroups.id, requestKind: orderGroups.requestKind })
    .from(orderGroups)
    .where(inArray(orderGroups.id, [...groupIds]));
  return Object.fromEntries(rows.map((row) => [row.id, row.requestKind]));
}

async function revisionOf(partyId: string): Promise<number> {
  const [row] = await suite.db
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

async function command(partyId: string) {
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(partyId),
    operatorId: OPERATOR,
  };
}

describe("A773 request kind", () => {
  let split: Awaited<ReturnType<typeof setupSplitExtrasVenue>>;
  beforeEach(async () => {
    useSplitExtrasDb(suite.db);
    split = await setupSplitExtrasVenue();
  });

  const burger = () => ({
    menuItemId: split.tables.offerFor(split.products.burger),
    quantity: "1",
  });
  const water = () => ({
    menuItemId: split.tables.offerFor(split.products.water),
    quantity: "1",
  });

  async function submit(groups: { release: GroupRelease; lines: ReturnType<typeof burger>[] }[]) {
    const partyId = split.party.partyId;
    const args = await command(partyId);
    return inTx((tx) =>
      submitGroups(tx, split.cfg, partyId, { ...args, billId: split.party.tabId, groups }),
    );
  }

  it("gives a first submission's Fire now group new_order and its held group next_course, held listed first", async () => {
    const submitted = await submit([
      { release: "hold", lines: [burger()] },
      { release: "fire", lines: [water()] },
    ]);
    const [held, fired] = submitted.groups.map((group) => group.id);
    expect(await kinds([held!, fired!])).toEqual({ [held!]: "next_course", [fired!]: "new_order" });
  });

  it("gives a later submission's Fire now group added", async () => {
    await submit([{ release: "fire", lines: [water()] }]);
    const second = await submit([{ release: "fire", lines: [burger()] }]);
    expect(await kinds([second.groups[0]!.id])).toEqual({ [second.groups[0]!.id]: "added" });
  });

  it("keeps a held group's next_course when it is fired", async () => {
    const submitted = await submit([
      { release: "hold", lines: [burger()] },
      { release: "fire", lines: [water()] },
    ]);
    const held = submitted.groups[0]!.id;
    const partyId = split.party.partyId;
    const args = await command(partyId);
    await inTx((tx) => fireGroup(tx, split.cfg, partyId, held, args));
    const [row] = await suite.db
      .select({ state: orderGroups.state, requestKind: orderGroups.requestKind })
      .from(orderGroups)
      .where(eq(orderGroups.id, held));
    expect(row).toEqual({ state: "fired", requestKind: "next_course" });
  });

  it("gives Fire now on a held dish a next_course group", async () => {
    const submitted = await submit([{ release: "hold", lines: [burger(), burger()] }]);
    const partyId = split.party.partyId;
    const lineId = submitted.groups[0]!.lineIds[0]!;
    const args = await command(partyId);
    await inTx((tx) => fireHeldLine(tx, split.cfg, partyId, lineId, args));
    const [line] = await suite.db
      .select({ groupId: workingOrderLines.groupId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, lineId));
    expect(line!.groupId).not.toBe(submitted.groups[0]!.id);
    expect(await kinds([line!.groupId!])).toEqual({ [line!.groupId!]: "next_course" });
  });

  it("gives a held group made by moving dishes to a new group next_course", async () => {
    const submitted = await submit([{ release: "hold", lines: [burger(), burger()] }]);
    const partyId = split.party.partyId;
    const lineId = submitted.groups[0]!.lineIds[0]!;
    const args = await command(partyId);
    await inTx(async (tx) =>
      moveLinesToGroup(tx, split.cfg, partyId, [{ lineId, quantity: "1" }], "new", {
        ...args,
        expectedEdits: [await readBillEditState(tx, split.party.tabId)],
      }),
    );
    const [line] = await suite.db
      .select({ groupId: workingOrderLines.groupId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, lineId));
    expect(line!.groupId).not.toBe(submitted.groups[0]!.id);
    expect(await kinds([line!.groupId!])).toEqual({ [line!.groupId!]: "next_course" });
  });

  it("gives Fire now new_order when the party's only group was removed", async () => {
    const partyId = split.party.partyId;
    await inTx(async (tx) => {
      const emptied = await startGroup(tx, partyId, "hold", OPERATOR, "next_course");
      await removeEmptiedHeldGroups(tx, partyId, [emptied], OPERATOR);
    });
    const [removed] = await suite.db
      .select({ state: orderGroups.state })
      .from(orderGroups)
      .where(eq(orderGroups.partyId, partyId));
    expect(removed).toEqual({ state: "removed" });
    const submitted = await submit([{ release: "fire", lines: [water()] }]);
    expect(await kinds([submitted.groups[0]!.id])).toEqual({
      [submitted.groups[0]!.id]: "new_order",
    });
  });

  it("writes no group for a counter order", async () => {
    const before = (await suite.db.select({ id: orderGroups.id }).from(orderGroups)).length;
    await inTx((tx) =>
      fireNewOrder(tx, split.cfg, [{ productId: split.products.burger, quantity: "1" }]),
    );
    expect((await suite.db.select({ id: orderGroups.id }).from(orderGroups)).length).toBe(before);
  });

  it("keeps every group's kind across a held-group reorder and a dish moved to another bill", async () => {
    const submitted = await submit([
      { release: "fire", lines: [water(), burger()] },
      { release: "hold", lines: [burger()] },
      { release: "hold", lines: [burger()] },
    ]);
    const ids = submitted.groups.map((group) => group.id);
    const before = await kinds(ids);
    const partyId = split.party.partyId;
    const reorderArgs = await command(partyId);
    await inTx((tx) => reorderHeldGroups(tx, partyId, [ids[2]!, ids[1]!], reorderArgs));
    const moveArgs = await command(partyId);
    await inTx(async (tx) =>
      moveDishes(tx, split.cfg, split.party.tabId, null, [submitted.groups[0]!.lineIds[0]!], {
        ...moveArgs,
        partyId,
        expectedEdits: [await readBillEditState(tx, split.party.tabId)],
      }),
    );
    expect(await kinds(ids)).toEqual(before);
  });
});

describe("A773 request kind of arriving dishes", () => {
  let v: BillVenue;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
    v = await provisionBillVenue(suite.db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const send = observedRelocationSender(() => suite.db, rawSend);

  it("gives arrival at a party with a group added, and a held course's arrival next_course", async () => {
    const p = await seatedWith(v, "Ensalada", "Tarta");
    const lines = await suite.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId))
      .orderBy(workingOrderLines.lineNo);
    await suite.db
      .update(workingOrderLines)
      .set({ groupId: null })
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    await suite.db
      .update(workingOrderLines)
      .set({ sentAt: null })
      .where(eq(workingOrderLines.id, lines[1]!.id));
    await suite.db
      .update(ticketItems)
      .set({ firedAt: null, requestedAt: null, madeHere: false })
      .where(eq(ticketItems.workingOrderLineId, lines[1]!.id));
    await withTransaction(suite.db, async (tx) => {
      const course = await createCourse(tx, v.cfg, { name: "Held arrival", displayOrder: 1 });
      await tx
        .update(workingOrderLines)
        .set({ courseId: course.id })
        .where(eq(workingOrderLines.id, lines[1]!.id));
    });
    const made = await withTransaction(suite.db, (tx) =>
      groupArrivingDishes(tx, v.cfg, p.partyId, p.tabId, v.operatorId, new Map()),
    );
    expect(made.held).toHaveLength(1);
    expect(await kinds([made.fired!, made.held[0]!])).toEqual({
      [made.fired!]: "added",
      [made.held[0]!]: "next_course",
    });
  });

  async function splitOff() {
    const source = await seatedWith(v, "Ensalada", "Tarta");
    const path = `/api/bills/${source.tabId}/split`;
    const splitBill = await send(
      v.app,
      v.cookie,
      "POST",
      path,
      await observedBillActionBody(v.db, path, {
        transfers: [{ lineNo: 2 }],
        expectedPartyRevision: await revisionOf(source.partyId),
      }),
    );
    expect(splitBill.status).toBe(200);
    return { source, billId: splitBill.json.billId as string };
  }

  async function arrivalKinds(billId: string) {
    const rows = await suite.db
      .select({ requestKind: orderGroups.requestKind })
      .from(workingOrderLines)
      .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
      .where(eq(workingOrderLines.workingOrderId, billId));
    return rows.map((row) => row.requestKind);
  }

  it("gives arrival at a newly seated party new_order", async () => {
    const { source, billId } = await splitOff();
    const { id: free } = await withTransaction(suite.db, (tx) =>
      createTable(tx, v.cfg, { label: "Destination", zoneId: v.zoneId }),
    );
    const moved = await send(v.app, v.cookie, "POST", `/api/bills/${billId}/move`, {
      operatorId: v.adminId,
      to: { tableId: free },
      expectedPartyRevision: await revisionOf(source.partyId),
    });
    expect(moved.status).toBe(200);
    const [seat] = await suite.db
      .select({ partyId: partyTables.partyId })
      .from(partyTables)
      .where(eq(partyTables.tableId, free));
    expect(seat!.partyId).not.toBe(source.partyId);
    expect(await arrivalKinds(billId)).toEqual(["new_order"]);
  });

  it("gives arrival at a party that already ordered added", async () => {
    const { source, billId } = await splitOff();
    const destination = await seatedWith(v, "Tarta");
    const moved = await send(v.app, v.cookie, "POST", `/api/bills/${billId}/move`, {
      operatorId: v.adminId,
      to: { tableId: destination.tableId },
      expectedPartyRevision: await revisionOf(source.partyId),
      otherPartyId: destination.partyId,
      expectedOtherPartyRevision: await revisionOf(destination.partyId),
    });
    expect(moved.status).toBe(200);
    expect(await arrivalKinds(billId)).toEqual(["added"]);
  });
});
