import { workingOrderLines, serviceCommands, ticketItems } from "@waitron/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  setupVenue,
  seated,
  submit,
  line,
  linesIn,
  db,
  groupsOf,
  specExampleOnTwoBills,
  groupTickets,
  ready,
  revisionOf,
  specExample,
  snapshot,
  fire,
  inTx,
  linesOf,
  groupCardsOf,
  passBoard,
  groupIdOf,
  DISHES,
  reorder,
  billOfNoParty,
  COURSES,
} from "./testing/order-groups.test-support.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { cardOf } from "./testing/pass-board-probe.js";
import { listStationQueue } from "./working-order-station-queue.js";

describe("a group's summary", () => {
  it("names a variant after its dish, adds equal dishes together and writes part quantities plainly", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [line(v, "steak"), line(v, "fish", "2"), line(v, "fish", "10")] },
    ]);
    const [steak, fish] = await linesIn(s.partyId, groups[0]!.id);
    await db
      .update(workingOrderLines)
      .set({ variantName: "Rare" })
      .where(eq(workingOrderLines.id, steak!.id));
    await db
      .update(workingOrderLines)
      .set({ quantity: 1500 })
      .where(eq(workingOrderLines.id, fish!.id));

    expect((await groupsOf(s.partyId)).groups[0]!.summary).toBe("1 × Steak (Rare), 12.5 × Fish");
  });
});

async function commandsOf(partyId: string) {
  return db
    .select({ kind: serviceCommands.kind, submissionId: serviceCommands.submissionId })
    .from(serviceCommands)
    .where(eq(serviceCommands.scopeId, partyId))
    .orderBy(sql`rowid`);
}
describe("the pass by group (D1)", () => {
  it("bumps the fired cold starters ready on both bills, leaving every other group as it was", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    const cold = await groupTickets(s.cold);
    expect(new Set(cold.map((item) => item.workingOrderId))).toEqual(new Set([s.tabId, s.checkId]));
    expect(cold.every((item) => item.state === "queued" && item.firedAt !== null)).toBe(true);
    const drinksBefore = await groupTickets(s.drinks);
    const warmBefore = await groupTickets(s.warm);

    const readied = await ready(s.partyId, s.cold);

    expect(readied).toEqual({ revision: await revisionOf(s.partyId) });
    const coldReady = await groupTickets(s.cold);
    expect(coldReady.map((item) => item.state)).toEqual(cold.map(() => "ready"));
    expect(coldReady.every((item) => item.readyAt !== null)).toBe(true);
    expect(await groupTickets(s.drinks)).toEqual(drinksBefore);
    expect(await groupTickets(s.warm)).toEqual(warmBefore);
  });

  it("changes no kitchen item for a held group, yet records the command and moves the party on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const before = await groupTickets(s.warm);
    expect(before.every((item) => item.firedAt === null)).toBe(true);
    const revision = await revisionOf(s.partyId);
    const readyId = randomUUID();

    await ready(s.partyId, s.warm, { submissionId: readyId });

    expect(await groupTickets(s.warm)).toEqual(before);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
    expect((await commandsOf(s.partyId)).slice(-1)).toEqual([
      { kind: "group.ready", submissionId: readyId },
    ]);
  });

  it("reads a group ready only once every asked-for kitchen item of it that is not yet served is ready", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    const readyOf = async (groupId: string) =>
      (await groupsOf(s.partyId)).groups.find((group) => group.id === groupId)!.ready === true;
    expect(await readyOf(s.cold)).toBe(false);

    // One of the two bills' items plated by the station is not the whole group.
    const [first] = await groupTickets(s.cold);
    await db.update(ticketItems).set({ state: "ready" }).where(eq(ticketItems.id, first!.id));
    expect(await readyOf(s.cold)).toBe(false);

    await ready(s.partyId, s.cold);
    expect(await readyOf(s.cold)).toBe(true);
    expect(await readyOf(s.drinks)).toBe(false);
    expect(await readyOf(s.warm)).toBe(false);
  });

  it("keeps a group ready across both bills without a dispatch state", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    await ready(s.partyId, s.cold);
    const [first, ...rest] = await groupTickets(s.cold);
    expect(rest.some((item) => item.workingOrderId !== first!.workingOrderId)).toBe(true);
    const before = await snapshot(v, s.partyId);

    const groups = (await groupsOf(s.partyId)).groups;

    expect(groups.find((group) => group.id === s.cold)).toMatchObject({ ready: true });
    expect(groups.every((group) => !("away" in group))).toBe(true);
    expect(groups.find((group) => group.id === s.drinks)!.ready).toBeUndefined();
    expect(groups.find((group) => group.id === s.warm)!.ready).toBeUndefined();
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("reads a fired group with nothing for the kitchen ready before and after its Ready press", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "water")] }]);
    expect(await groupTickets(groups[0]!.id)).toEqual([]);
    expect(groups[0]!.ready).toBe(true);
    expect((await groupsOf(s.partyId)).groups[0]!.ready).toBe(true);

    await ready(s.partyId, groups[0]!.id);

    expect((await groupsOf(s.partyId)).groups[0]!.ready).toBe(true);
  });
});
describe("a paper-only station (Review Focus 6, server half)", () => {
  it("leaves every fired item queued and the group not ready, when no kitchen screen is enrolled", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    expect(db.all(sql`select id from device_profiles where kitchen_views <> '{}'`)).toEqual([]);

    await fire(v, s.partyId, s.warm);

    const warm = await groupTickets(s.warm);
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.map((item) => [item.state, item.readyAt])).toEqual(
      warm.map(() => ["queued", null]),
    );
    const group = (await groupsOf(s.partyId)).groups.find((row) => row.id === s.warm)!;
    expect(group).toMatchObject({ state: "fired", firedAt: expect.any(String) });
    expect(group.ready).toBeUndefined();
  });
});
describe("the kitchen and the pass read a party's groups", () => {
  it("names the party on each station card and the group of each item", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    const revision = await revisionOf(s.partyId);
    const positions = new Map([
      [s.drinks, [1, "fired"]],
      [s.cold, [2, "fired"]],
      [s.warm, [3, "held"]],
      [s.mains, [4, "held"]],
      [s.desserts, [5, "held"]],
    ] as const);

    const cards = (await inTx((tx) => listStationQueue(tx, v.stationId))).filter((card) =>
      [s.tabId, s.checkId].includes(card.orderId),
    );

    expect(cards.map((card) => card.orderId).sort()).toEqual([s.tabId, s.checkId].sort());
    for (const card of cards) {
      expect(card.party).toEqual({ id: s.partyId, revision });
    }
    const lines = await linesOf(s.partyId);
    const groupOfLine = new Map(lines.map((row) => [row.id, row.groupId]));
    const items = cards.flatMap((card) => card.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const groupId = groupOfLine.get(item.workingOrderLineId)!;
      const [position, state] = positions.get(groupId)!;
      expect(item.group).toEqual({
        id: groupId,
        position,
        displayNumber: position,
        numberPartyId: s.partyId,
        state,
      });
    }
  });

  it("puts a party's groups on the pass as cards at their group positions, held groups unfired", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const revision = await revisionOf(s.partyId);

    const cards = groupCardsOf(await passBoard(), s.partyId);

    for (const card of cards) expect(card.party).toEqual({ id: s.partyId, revision });
    expect(
      cards.map((card) => [
        groupIdOf(card),
        card.group!.position,
        card.items[0]!.group!.state,
        card.kind !== "held",
      ]),
    ).toEqual([
      // The drinks' water needs no preparation, so only the beer is on the pass.
      [s.drinks, 1, "fired", true],
      [s.cold, 2, "fired", true],
      [s.warm, 3, "held", false],
      [s.mains, 4, "held", false],
      [s.desserts, 5, "held", false],
    ]);
    // One pass item per portion.
    expect(cards.map((card) => card.items.map((item) => item.name))).toEqual([
      Array(2).fill(DISHES.beer.kitchen),
      Array(4).fill(DISHES.cold.kitchen),
      Array(4).fill(DISHES.warm.kitchen),
      [DISHES.steak.kitchen, DISHES.steak.kitchen, DISHES.fish.kitchen],
      Array(2).fill(DISHES.flan.kitchen),
    ]);
    expect(cards[1]!.items[0]!.group).toEqual({
      id: s.cold,
      position: 2,
      displayNumber: 2,
      numberPartyId: s.partyId,
      state: "fired",
    });
    expect(cards.every((card) => !("away" in card))).toBe(true);
  });

  // Fails if the pass orders held groups by course (the rows' own order) rather than by position.
  it("orders a party's held groups on the pass by position, not by course", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await reorder(s.partyId, [s.desserts, s.mains, s.warm]);

    const board = await passBoard();

    expect(
      board.held
        .filter((card) => card.party?.id === s.partyId)
        .map((card) => [groupIdOf(card), card.group!.position]),
    ).toEqual([
      [s.desserts, 3],
      [s.mains, 4],
      [s.warm, 5],
    ]);
    expect(groupCardsOf(board, s.partyId).map(groupIdOf)).toEqual([
      s.drinks,
      s.cold,
      s.desserts,
      s.mains,
      s.warm,
    ]);
  });

  it("keeps a split group visible on both bills", async () => {
    const v = await setupVenue();
    const s = await specExampleOnTwoBills(v);
    await ready(s.partyId, s.cold);

    const board = await passBoard();
    const cold = cardOf(board, (card) => groupIdOf(card) === s.cold);
    expect(cold.group).toMatchObject({ position: 2 });
    expect(cold.kind).not.toBe("held");
    expect(board.ready).toContain(cold);
    expect(cold.orders.map((order) => order.orderId).sort()).toEqual([s.tabId, s.checkId].sort());
    expect(cold).not.toHaveProperty("away");
  });

  it("puts a fired line in no group on its bill's own card, with no group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    // A round, not a group submission, leaves the fired line in no group.
    await inTx((tx) => addTabRound(tx, v.cfg, s.tabId, [line(v, "steak")]));

    const board = await passBoard();
    const loose = cardOf(
      board,
      (card) => card.target.kind === "bill" && card.target.workingOrderId === s.tabId,
    );

    expect(loose).not.toHaveProperty("group");
    expect(loose.items.map((item) => [item.name, "group" in item])).toEqual([
      [DISHES.steak.kitchen, false],
    ]);
    expect(groupCardsOf(board, s.partyId).map((card) => card.group!.position)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("keeps a bill of no party on one card, its dishes in course order, with no party and no groups", async () => {
    const v = await setupVenue();
    const tabId = await billOfNoParty(v, (tx, id) =>
      addTabRound(tx, v.cfg, id, [
        { menuItemId: v.offer("steak"), quantity: "1" },
        { menuItemId: v.offer("beer"), quantity: "1" },
      ]),
    );

    const pass = cardOf(
      await passBoard(),
      (card) => card.target.kind === "bill" && card.target.workingOrderId === tabId,
    );
    const [card] = (await inTx((tx) => listStationQueue(tx, v.stationId))).filter(
      (row) => row.orderId === tabId,
    );

    expect("party" in pass).toBe(false);
    expect(pass).not.toHaveProperty("group");
    expect(pass.items.map((item) => item.course?.name ?? null)).toEqual([
      COURSES.drinks,
      COURSES.mains,
    ]);
    expect("party" in card!).toBe(false);
    expect(card!.items.map((item) => "group" in item)).toEqual([false, false]);
  });
});
