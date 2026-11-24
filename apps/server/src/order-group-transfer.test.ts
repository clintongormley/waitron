import {
  diningTables,
  parties,
  orderGroups,
  workingOrderLines,
  ticketItems,
  workingOrders,
} from "@waitron/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { reprintOrderTickets, enqueueOrderKitchenNoteChange } from "./kitchen-print.js";
import { readCurrentOrders } from "./order-group-reads.js";
import { mergeBills, splitBill, transferItems } from "./testing/bill-action-fixture.js";
import { floorLabelSuffix } from "./testing/floor-label.js";
import { createTable } from "./testing/live-table.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import {
  setupVenue,
  inTx,
  seated,
  db,
  submit,
  line,
  ALEX,
  groupsOf,
  passBoard,
  groupIdOf,
  printed,
  move,
  specExample,
  reorder,
  fire,
  DISHES,
  groupCardsOf,
  billCommand,
  linesOfBill,
  linesIn,
  revisionOf,
  submitGrouped,
  onSecondBill,
  MIA,
  expectRefusedWithNothingWritten,
  splitToCheck,
  linesOf,
  ticketLines,
  billHead,
  changeLine,
  eventsOf,
} from "./testing/order-groups.test-support.js";
import { cardOf } from "./testing/pass-board-probe.js";
import { openPartyTab } from "./testing/serve-line.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { joinTables } from "./testing/table-action-fixture.js";
import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import type { TradingContext, DeviceRequestConfig } from "./trading-context.js";
import type { TillSaleDeps } from "./working-order-context.js";
import { updateHeldOrder } from "./working-order-held-write.js";
import { createOpenOrder, parkOrder } from "./working-order-open.js";
import { listStationQueue } from "./working-order-station-queue.js";

describe("permanent group numbers on kitchen work", () => {
  it("qualifies duplicate numbers from a closed origin using its recorded tables", async () => {
    const v = await setupVenue();
    await inTx((tx) => setStationPrinting(tx, { printHeldWork: true }));
    const into = await seated(v);
    const from = await seated(v);
    await db
      .update(diningTables)
      .set({ label: "Terrace 4" })
      .where(eq(diningTables.id, into.tableId));
    await db
      .update(diningTables)
      .set({ label: "Terrace 7" })
      .where(eq(diningTables.id, from.tableId));
    const a = (await submit(v, into.partyId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!;
    const b = (await submit(v, from.partyId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!;
    await inTx(async (tx) => {
      await joinTables(tx, v.cfg, into.partyId, from.tableId, {
        expectedPartyRevision: 1,
        otherPartyId: from.partyId,
        expectedOtherPartyRevision: 1,
        operatorId: ALEX,
      });
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, into.partyId));
      await mergeBills(tx, v.cfg, into.tabId, from.tabId, {
        partyId: into.partyId,
        expectedPartyRevision: party!.revision,
        operatorId: ALEX,
      });
    });
    await db
      .update(diningTables)
      .set({ label: "Terrace 9" })
      .where(eq(diningTables.id, from.tableId));

    const { groups } = await groupsOf(into.partyId);
    expect(groups.map((g) => [g.id, g.displayNumber, g.numberPartyId, g.numberPartyLabel])).toEqual(
      [
        [a.id, 1, into.partyId, "Terrace 4, 9"],
        [b.id, 1, from.partyId, "Terrace 7"],
      ],
    );
    const current = await inTx((tx) => readCurrentOrders(tx, into.partyId));
    expect(current.groups.map((g) => g.numberPartyLabel)).toEqual(["Terrace 4, 9", "Terrace 7"]);
    const station = (await inTx((tx) => listStationQueue(tx, v.stationId))).find(
      (o) => o.orderId === into.tabId,
    )!;
    expect(station.items.map((i) => i.group?.numberPartyLabel)).toEqual([
      "Terrace 4, 9",
      "Terrace 7",
    ]);
    const pass = await passBoard();
    expect(
      [a.id, b.id].map((id) => cardOf(pass, (card) => groupIdOf(card) === id).group),
    ).toMatchObject([{ numberPartyLabel: "Terrace 4, 9" }, { numberPartyLabel: "Terrace 7" }]);
    const before = (await printed(v)).length;
    await inTx((tx) => reprintOrderTickets(tx, v.cfg, into.tabId));
    const paper = (await printed(v)).slice(before).join("\n");
    expect(paper).toContain("GROUP 1 · Terrace 4, 9 · MAINS\n1 x K-STEAK");
    expect(paper).toContain("GROUP 1 · Terrace 7 · MAINS\n1 x K-STEAK");
    expect(paper).not.toContain("2 x K-STEAK");
    const beforeMove = (await printed(v)).length;
    await move(v, into.partyId, [{ lineId: b.lineIds[0]!, quantity: "1" }], { groupId: a.id });
    const corrections = (await printed(v)).slice(beforeMove);
    expect(corrections).toHaveLength(2);
    expect(corrections[0]).toContain("GROUP 1 · Terrace 7 · MAINS\n-1 x K-STEAK");
    expect(corrections[1]).toContain("GROUP 1 · Terrace 4, 9 · MAINS\n+1 x K-STEAK");
    const next = await submit(v, into.partyId, [{ release: "hold", lines: [line(v, "flan")] }]);
    expect(next.groups[0]).toMatchObject({ displayNumber: 2, numberPartyId: into.partyId });
    expect(next.groups[0]).not.toHaveProperty("numberPartyLabel");
  });

  it("does not qualify a non-colliding number from another party", async () => {
    const v = await setupVenue();
    const into = await seated(v);
    const from = await seated(v);
    const source = (await submit(v, from.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!;
    await inTx((tx) =>
      joinTables(tx, v.cfg, into.partyId, from.tableId, {
        expectedPartyRevision: 0,
        otherPartyId: from.partyId,
        expectedOtherPartyRevision: 1,
        operatorId: ALEX,
      }),
    );
    const { groups } = await groupsOf(into.partyId);
    expect(groups[0]).toMatchObject({
      id: source.id,
      displayNumber: 1,
      numberPartyId: from.partyId,
    });
    expect(groups[0]).not.toHaveProperty("numberPartyLabel");
  });

  it("keeps original numbers on FIRE paper after reordering held groups", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await reorder(s.partyId, [s.desserts, s.warm, s.mains]);
    const before = (await printed(v)).length;

    await fire(v, s.partyId, s.desserts);

    const paper = (await printed(v)).slice(before);
    expect(paper).toHaveLength(1);
    expect(paper[0]).toContain("GROUP 5 · DESSERTS\n");
    expect(paper[0]).not.toMatch(/^GROUP 3\b/m);
    expect(paper[0]).toContain(DISHES.flan.kitchen);
  });

  it("keeps original numbers on HOLD corrections after reordering", async () => {
    const v = await setupVenue();
    await inTx((tx) => setStationPrinting(tx, { printHeldWork: true }));
    const s = await specExample(v);
    await reorder(s.partyId, [s.desserts, s.warm, s.mains]);
    const before = (await printed(v)).length;

    await submit(v, s.partyId, [
      { release: "hold", joinGroupId: s.desserts, lines: [line(v, "flan")] },
    ]);

    const paper = (await printed(v)).slice(before);
    expect(paper).toHaveLength(1);
    expect(paper[0]).toContain("HOLD CHANGED");
    expect(paper[0]).toContain("GROUP 5 · DESSERTS\n");
    expect(paper[0]).not.toMatch(/^GROUP 3\b/m);
    expect(paper[0]).toContain("+1 x K-FLAN");
  });

  it("reprints permanent numbers in the changed firing order", async () => {
    const v = await setupVenue();
    await inTx((tx) => setStationPrinting(tx, { printHeldWork: true }));
    const s = await specExample(v);
    await reorder(s.partyId, [s.desserts, s.warm, s.mains]);
    const before = (await printed(v)).length;

    await inTx((tx) => reprintOrderTickets(tx, v.cfg, s.tabId));

    const paper = (await printed(v)).slice(before).join("\n");
    expect(paper).toContain("GROUP 5 · DESSERTS\n2 x K-FLAN");
    expect(paper).toContain("GROUP 3 · STARTERS\n4 x K-OCTO");
    expect(paper).toContain("GROUP 4 · MAINS\n2 x K-STEAK");
    expect(paper.indexOf("GROUP 5 · DESSERTS\n")).toBeLessThan(
      paper.indexOf("GROUP 3 · STARTERS\n"),
    );
  });

  it("keeps the original group number on order-note change slips", async () => {
    const v = await setupVenue();
    await inTx((tx) => setStationPrinting(tx, { printHeldWork: true }));
    const s = await specExample(v);
    await reorder(s.partyId, [s.desserts, s.warm, s.mains]);
    const before = (await printed(v)).length;

    await inTx((tx) =>
      enqueueOrderKitchenNoteChange(tx, v.cfg, [s.tabId], {
        before: null,
        after: "Bring together",
      }),
    );

    const paper = (await printed(v)).slice(before).filter((p) => p.includes("K-FLAN"));
    expect(paper).toHaveLength(1);
    expect(paper[0]).toContain("GROUP 5 · DESSERTS\n");
    expect(paper[0]).toContain("GROUP 5 · DESSERTS\n2 x K-FLAN");
    expect(paper[0]).toContain("GROUP 3 · STARTERS\n4 x K-OCTO");
    expect(paper[0]!.indexOf("GROUP 5 · DESSERTS\n")).toBeLessThan(
      paper[0]!.indexOf("GROUP 3 · STARTERS\n"),
    );
  });

  it("carries permanent numbers and origins through station and pass queues", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await reorder(s.partyId, [s.desserts, s.warm, s.mains]);

    const station = (await inTx((tx) => listStationQueue(tx, v.stationId))).find(
      (o) => o.orderId === s.tabId,
    )!;
    expect(station.items.find((i) => i.group?.id === s.desserts)?.group).toMatchObject({
      position: 3,
      displayNumber: 5,
      numberPartyId: s.partyId,
    });
    const cards = groupCardsOf(await passBoard(), s.partyId);
    expect(
      cards.map((card) => [
        card.group!.position,
        card.group!.displayNumber,
        card.items[0]!.group!.numberPartyId,
      ]),
    ).toEqual([
      [1, 1, s.partyId],
      [2, 2, s.partyId],
      [3, 5, s.partyId],
      [4, 3, s.partyId],
      [5, 4, s.partyId],
    ]);
  });
});
describe("a line leaving its party", () => {
  it("clears the group of a dish's extras lines too when its bill leaves the party", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [
      {
        release: "fire",
        lines: [
          {
            ...line(v, "steak"),
            extras: [
              { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
            ],
          },
        ],
      },
    ]);
    const { billId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: 1 }], await billCommand(s.partyId)),
    );
    expect((await linesOfBill(billId)).map((row) => row.groupId)).not.toContain(null);

    await inTx(async (tx) =>
      moveBill(
        tx,
        v.cfg,
        billId,
        { counter: { zoneId: null } },
        { ...(await billCommand(s.partyId)), partyId: s.partyId },
      ),
    );

    const landed = await linesOfBill(billId);
    expect(landed).toHaveLength(2);
    expect(landed.map((row) => row.groupId)).toEqual([null, null]);
  });

  it("keeps the group of a held line transferred to another bill of the same party", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const secondTab = randomUUID();
    await inTx(async (tx) => {
      await createOpenOrder(tx, v.cfg, secondTab, [], null, {
        partyId: s.partyId,
        existingService: true,
        copyServiceContextFrom: s.tabId,
      });
    });
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);

    await inTx(async (tx) =>
      transferItems(
        tx,
        v.cfg,
        s.tabId,
        secondTab,
        [{ lineNo: steak!.lineNo }],
        await billCommand(s.partyId),
      ),
    );

    expect(await linesOfBill(secondTab)).toMatchObject([{ groupId: s.mains }]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });
});
describe("merging two bills (D2)", () => {
  it("appends the source party's groups after the target's, in their own order", async () => {
    const v = await setupVenue();
    const into = await seated(v);
    const target = await submit(v, into.partyId, [
      { release: "fire", lines: [line(v, "beer")] },
      { release: "hold", lines: [line(v, "flan")] },
    ]);
    const from = await specExample(v);
    // The source's held groups no longer sit in the order they were made.
    await reorder(from.partyId, [from.desserts, from.warm, from.mains]);
    const command = {
      expectedPartyRevision: await revisionOf(into.partyId),
      otherPartyId: from.partyId,
      expectedOtherPartyRevision: await revisionOf(from.partyId),
      operatorId: ALEX,
    };

    await inTx(async (tx) => {
      await joinTables(tx, v.cfg, into.partyId, from.tableId, command);
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, into.partyId));
      await mergeBills(tx, v.cfg, into.tabId, from.tabId, {
        partyId: into.partyId,
        expectedPartyRevision: party!.revision,
        operatorId: ALEX,
      });
    });

    const { groups } = await groupsOf(into.partyId);
    expect(groups.map((group) => [group.id, group.position, group.state])).toEqual([
      [target.groups[0]!.id, 1, "fired"],
      [target.groups[1]!.id, 2, "held"],
      [from.drinks, 3, "fired"],
      [from.cold, 4, "fired"],
      [from.desserts, 5, "held"],
      [from.warm, 6, "held"],
      [from.mains, 7, "held"],
    ]);
    expect((await groupsOf(from.partyId)).groups).toEqual([]);
    const moved = await linesOfBill(into.tabId);
    expect(new Set(moved.map((row) => row.groupId))).toEqual(
      new Set([
        ...target.groups.map((group) => group.id),
        from.drinks,
        from.cold,
        from.warm,
        from.mains,
        from.desserts,
      ]),
    );

    await fire(v, into.partyId, from.mains);
    expect((await groupsOf(into.partyId)).groups.find((g) => g.id === from.mains)!.state).toBe(
      "fired",
    );
  });

  it("leaves the groups as they are when a check goes back onto its tab in the same party", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [croquettes] = await linesIn(s.partyId, s.cold);
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo, quantity: "1" }], {
        expectedPartyRevision: await revisionOf(s.partyId),
        operatorId: ALEX,
      }),
    );
    const groupsBefore = await db
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.partyId, s.partyId))
      .orderBy(orderGroups.id);
    const command = await billCommand(s.partyId);

    await inTx((tx) => mergeBills(tx, v.cfg, s.tabId, checkId, command));

    expect(
      await db
        .select()
        .from(orderGroups)
        .where(eq(orderGroups.partyId, s.partyId))
        .orderBy(orderGroups.id),
    ).toEqual(groupsBefore);
    expect((await linesIn(s.partyId, s.cold)).map((row) => row.workingOrderId)).toEqual(
      Array(4).fill(s.tabId),
    );
  });
});
describe("a group split across bills of its party", () => {
  it("refuses device A's fire after device B moved the group's line onto another bill, then fires every line", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submitGrouped(v, s, [
      { release: "hold", lines: [line(v, "water", "2"), line(v, "steak")] },
    ]);
    const groupId = groups[0]!.id;
    const seenByA = await revisionOf(s.partyId);
    const [water] = await linesIn(s.partyId, groupId);
    const checkId = await onSecondBill(
      v,
      s,
      [{ lineNo: water!.lineNo, quantity: "1" }],
      seenByA,
      MIA,
    );

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, groupId, { revision: seenByA }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision: seenByA + 1 } },
    );

    await fire(v, s.partyId, groupId);
    const lines = await linesIn(s.partyId, groupId);
    expect(lines.map((row) => row.workingOrderId).sort()).toEqual(
      [s.tabId, s.tabId, checkId].sort(),
    );
    expect(lines.every((row) => row.sentAt !== null)).toBe(true);
  });

  it("keeps the group and credit of a fired-group line split onto a check", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [croquettes] = await linesIn(s.partyId, s.cold);
    const revision = await revisionOf(s.partyId);

    const checkId = await splitToCheck(
      v,
      s,
      [{ lineNo: croquettes!.lineNo, quantity: "1" }],
      revision,
      MIA,
    );

    expect(await linesOfBill(checkId)).toMatchObject([
      { groupId: s.cold, creditedTo: ALEX, quantity: 1000 },
    ]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("keeps the group and credit of a routed held-group line split onto a check, still held", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);

    const checkId = await splitToCheck(v, s, [{ lineNo: steak!.lineNo }], revision, MIA);

    expect(await linesOfBill(checkId)).toMatchObject([
      { id: steak!.id, groupId: s.mains, creditedTo: ALEX, quantity: 1000, sentAt: null },
    ]);
    expect(
      (await dishTickets(s.partyId, v.productId.steak)).filter(
        (ticket) => ticket.lineId === steak!.id,
      ),
    ).toEqual([{ workingOrderId: checkId, lineId: steak!.id, firedAt: null, quantity: 1000 }]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("fires a held-group line split onto a check once, on the check, when its group fires", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const steaks = (await linesIn(s.partyId, s.mains)).filter(
      (row) => row.productId === v.productId.steak,
    );
    const checkId = await splitToCheck(
      v,
      s,
      steaks.map((row) => ({ lineNo: row.lineNo })),
    );
    const jobsBefore = (await printed(v)).length;

    await fire(v, s.partyId, s.mains);

    const tickets = await dishTickets(s.partyId, v.productId.steak);
    expect(tickets.map((ticket) => [ticket.workingOrderId, ticket.lineId]).sort()).toEqual(
      steaks.map((row) => [checkId, row.id]).sort(),
    );
    expect(tickets.every((ticket) => ticket.firedAt !== null)).toBe(true);
    expect((await linesOfBill(checkId)).every((row) => row.sentAt !== null)).toBe(true);
    expect(
      (await linesOf(s.partyId)).filter(
        (row) => row.workingOrderId === s.tabId && row.productId === v.productId.steak,
      ),
    ).toEqual([]);
    expect(timesPrinted((await printed(v)).slice(jobsBefore), DISHES.steak.kitchen)).toBe(1);
  });

  it("fires a held group split whole onto a check on the check alone", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const mains = await linesIn(s.partyId, s.mains);
    const checkId = await splitToCheck(
      v,
      s,
      mains.map((row) => ({ lineNo: row.lineNo })),
    );
    expect((await linesIn(s.partyId, s.mains)).map((row) => row.workingOrderId)).toEqual([
      checkId,
      checkId,
      checkId,
    ]);
    const tabTicketsBefore = await ticketsOfBill(s.tabId);
    const jobsBefore = (await printed(v)).length;

    await fire(v, s.partyId, s.mains);

    const fired = await linesIn(s.partyId, s.mains);
    expect(fired.map((row) => row.workingOrderId)).toEqual([checkId, checkId, checkId]);
    expect(fired.every((row) => row.sentAt !== null)).toBe(true);
    expect((await ticketsOfBill(checkId)).every((ticket) => ticket.firedAt !== null)).toBe(true);
    expect(await ticketsOfBill(s.tabId)).toEqual(tabTicketsBefore);
    const newJobs = (await printed(v)).slice(jobsBefore);
    expect(timesPrinted(newJobs, DISHES.steak.kitchen)).toBe(1);
    expect(timesPrinted(newJobs, DISHES.fish.kitchen)).toBe(1);
  });

  it("splits part of a held-group line onto a check as two held rows of the group, and fires both", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);

    const checkId = await splitToCheck(v, s, [{ lineNo: steak!.lineNo, quantity: "1" }]);

    const [split] = await linesOfBill(checkId);
    expect(
      (await linesIn(s.partyId, s.mains)).filter((row) => row.productId === v.productId.steak),
    ).toMatchObject([
      { id: steak!.id, workingOrderId: s.tabId, quantity: 1000, sentAt: null },
      { id: split!.id, workingOrderId: checkId, quantity: 1000, sentAt: null },
    ]);
    expect(sortedByBill(await dishTickets(s.partyId, v.productId.steak), s.tabId)).toEqual([
      { workingOrderId: s.tabId, lineId: steak!.id, firedAt: null, quantity: 1000 },
      { workingOrderId: checkId, lineId: split!.id, firedAt: null, quantity: 1000 },
    ]);
    const jobsBefore = (await printed(v)).length;

    await fire(v, s.partyId, s.mains);

    expect((await printed(v)).slice(jobsBefore).map(ticketLines)).toEqual([
      [
        ...(await billHead(v, s, s.tabId)),
        "GROUP 4 · MAINS",
        `1 x ${DISHES.steak.kitchen}`,
        `1 x ${DISHES.fish.kitchen}`,
      ],
      [...(await billHead(v, s, checkId)), "GROUP 4 · MAINS", `1 x ${DISHES.steak.kitchen}`],
    ]);
    const fired = sortedByBill(await dishTickets(s.partyId, v.productId.steak), s.tabId);
    expect(fired).toMatchObject([
      { workingOrderId: s.tabId, lineId: steak!.id, quantity: 1000 },
      { workingOrderId: checkId, lineId: split!.id, quantity: 1000 },
    ]);
    expect(fired.every((ticket) => ticket.firedAt !== null)).toBe(true);
  });

  it("refuses device A's fire after device B split the held group's line onto a check, then fires every line", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const seenByA = await revisionOf(s.partyId);
    const [steak] = await linesIn(s.partyId, s.mains);
    const checkId = await splitToCheck(
      v,
      s,
      [{ lineNo: steak!.lineNo, quantity: "1" }],
      seenByA,
      MIA,
    );

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.mains, { revision: seenByA }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision: seenByA + 1 } },
    );

    await fire(v, s.partyId, s.mains);
    const lines = await linesIn(s.partyId, s.mains);
    expect(lines.map((row) => row.workingOrderId).sort()).toEqual(
      [s.tabId, s.tabId, checkId].sort(),
    );
    expect(lines.every((row) => row.sentAt !== null)).toBe(true);
  });
});
/** The ticket items of the party's lines of this product, with the bill each is on. */
async function dishTickets(partyId: string, productId: string) {
  return db
    .select({
      workingOrderId: workingOrderLines.workingOrderId,
      lineId: ticketItems.workingOrderLineId,
      firedAt: ticketItems.firedAt,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(and(eq(workingOrders.partyId, partyId), eq(workingOrderLines.productId, productId)))
    .orderBy(ticketItems.workingOrderLineId);
}
/** The original bill's tickets first. */
function sortedByBill<T extends { workingOrderId: string }>(
  tickets: T[],
  firstBillId: string,
): T[] {
  return [...tickets].sort(
    (a, b) => Number(b.workingOrderId === firstBillId) - Number(a.workingOrderId === firstBillId),
  );
}

async function ticketsOfBill(billId: string) {
  return ticketItemsWithBill(db)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(ticketItems.id);
}
/** How many times the kitchen name appears across these printed jobs. */
function timesPrinted(jobs: string[], kitchenName: string): number {
  return jobs.join("\n").split(kitchenName).length - 1;
}
describe("the bill a group's first event names", () => {
  it("names the bill its lines went on by the same key, whether a submission, a join or an edit started it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "cold")] }]))
      .groups[0]!.id;
    const held = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }], {
      joinGroupId: held,
    });
    const [croquettes] = await linesIn(s.partyId, first);
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: croquettes!.lineNo }], {
        expectedPartyRevision: await revisionOf(s.partyId),
        operatorId: ALEX,
      }),
    );
    const [onCheck] = await linesOfBill(checkId);

    await changeLine(v, checkId, onCheck!.lineNo, { portionLineNos: [], quantity: "2" }, MIA);

    const added = (await groupsOf(s.partyId)).groups.at(-1)!.id;
    expect(
      (await eventsOf(s.partyId)).map((event) => [event.groupId, event.kind, event.detail]),
    ).toEqual([
      [first, "group.submitted", { workingOrderId: s.tabId, release: "fire" }],
      [held, "group.submitted", { workingOrderId: s.tabId, release: "hold" }],
      [held, "group.joined", { workingOrderId: s.tabId, release: "hold" }],
      [added, "group.submitted", { workingOrderId: checkId, release: "fire" }],
    ]);
  });
});
describe("credit (D5)", () => {
  // The directive is the assertion: typecheck reports an unused `@ts-expect-error` the moment a
  // save that may issue the bill's invoice types without naming who saves. Vitest does not typecheck.
  it("will not type a save that may issue the invoice without naming who saves", () => {
    const cfg = {} as TradingContext;
    const issue = {
      fiscal: {} as TillSaleDeps,
      saleCfg: {} as DeviceRequestConfig,
    };
    const unnamed = { lines: [], revision: 0, expectedEdit: null };
    expectTypeOf(updateHeldOrder).toBeCallableWith(
      { admission: testTradingAdmission(), db },
      cfg,
      "order",
      unnamed,
    );
    expectTypeOf(updateHeldOrder).toBeCallableWith(
      { admission: testTradingAdmission(), db },
      cfg,
      "order",
      { ...unnamed, operatorId: MIA },
      issue,
    );
    // @ts-expect-error a save given `issue` must carry `operatorId`
    expectTypeOf(updateHeldOrder).toBeCallableWith({ db }, cfg, "order", unnamed, issue);
  });

  it("credits the lines a parked counter order is created with to the operator who parked it", async () => {
    const v = await setupVenue();
    const id = randomUUID();

    await parkOrder({ db }, v.cfg, {
      id,
      lines: [line(v, "steak"), line(v, "flan")],
      zoneId: v.zoneId,
      operatorId: MIA,
    });

    expect((await linesOfBill(id)).map((row) => row.creditedTo)).toEqual([MIA, MIA]);
  });

  it("credits the lines a tab is opened with to the operator who opened it", async () => {
    const v = await setupVenue();
    const { tabId } = await inTx(async (tx) => {
      const { id: tableId } = await createTable(tx, {
        label: `O-${floorLabelSuffix().padStart(6, "0")}`,
        zoneId: v.zoneId,
      });
      return openPartyTab(tx, v.cfg, {
        tableId,
        lines: [{ menuItemId: v.offer("flan"), quantity: "1" }],
        operatorId: MIA,
      });
    });

    expect(await linesOfBill(tabId)).toMatchObject([{ groupId: null, creditedTo: MIA }]);
  });
});
