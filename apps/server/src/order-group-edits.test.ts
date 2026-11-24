import {
  billPayments,
  refunds,
  orderGroups,
  workingOrders,
  workingOrderLines,
  ticketItems,
} from "@waitron/db";
import { updateProduct, deleteExtraList } from "@waitron/menu";
import { listStationNotices } from "@waitron/venue-service";
import { eq, inArray, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readBillEditState } from "./bill-editing.js";
import * as lineServiceState from "./line-service-state.js";
import type { GroupLine } from "./order-group-submission.js";
import { billRefundFields, seedPendingCardPayment } from "./testing/bill-payment-fixture.js";
import { cancelLine, cancelItemForTest } from "./testing/cancel-line.js";
import { splitHeldLineIntoUnits } from "./testing/group-composition-fixture.js";
import {
  type Venue,
  db,
  ALEX,
  setupVenue,
  specExample,
  reorder,
  groupsOf,
  expectRefusedWithNothingWritten,
  linesIn,
  move,
  linesOf,
  ticketsOf,
  submit,
  line,
  revisionOf,
  seated,
  submitGrouped,
  onSecondBill,
  linesOfBill,
  eventsOf,
  MIA,
  fire,
  inTx,
  printed,
  snapshot,
  firedTicketLineIds,
  stillPaying,
  groupRow,
  changeLine,
  saveWhole,
  keptLines,
  billOfNoParty,
  billRevisionOf,
  args,
} from "./testing/order-groups.test-support.js";
import { updateOrderLine, addTabRound } from "./testing/order-writer-fixture.js";
import { republishMenus } from "./testing/publish-menu.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { updateOrderLine as updateOrderLineCommand } from "./working-order-held-write.js";
import { parkOrder } from "./working-order-open.js";
import { splitUnitsWithinOrder, splitLinesWithinOrder } from "./working-order-transfer.js";

/** A received card payment of the bill, and a refund of it the provider has not answered. */
async function pendingRefund(v: Venue, billId: string): Promise<void> {
  const [payment] = await db
    .insert(billPayments)
    .values({
      workingOrderId: billId,
      submissionId: randomUUID(),
      fingerprint: "f",
      kind: "contribution",
      method: "card",
      applied: 100,
      state: "received",
      receivedAt: new Date().toISOString(),
      requestedBy: ALEX,
      source: v.cfg.origin.source,
      deviceId: v.cfg.origin.deviceId,
    })
    .returning({ id: billPayments.id });
  await db.insert(refunds).values({
    billPaymentId: payment!.id,
    ...billRefundFields(db, v.cfg.nodeId, payment!.id),
    submissionId: randomUUID(),
    fingerprint: "f",
    appliedAmount: 100,
    reason: "r",
    authorizedBy: ALEX,
    requestedBy: ALEX,
    source: v.cfg.origin.source,
    deviceId: v.cfg.origin.deviceId,
    state: "pending",
  });
}

async function refundStates(billId: string): Promise<string[]> {
  const rows = await db
    .select({ state: refunds.state })
    .from(refunds)
    .innerJoin(billPayments, eq(billPayments.id, refunds.billPaymentId))
    .where(eq(billPayments.workingOrderId, billId));
  return rows.map((row) => row.state);
}
describe("editing held groups", () => {
  it("puts the desserts before the mains, leaving the fired groups at 1 and 2", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    await reorder(s.partyId, [s.warm, s.desserts, s.mains]);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.id, group.position])).toEqual([
      [s.drinks, 1],
      [s.cold, 2],
      [s.warm, 3],
      [s.desserts, 4],
      [s.mains, 5],
    ]);
  });

  it("reverses three held groups at once", async () => {
    const v = await setupVenue();
    const s = await specExample(v);

    await reorder(s.partyId, [s.desserts, s.mains, s.warm]);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => group.id)).toEqual([
      s.drinks,
      s.cold,
      s.desserts,
      s.mains,
      s.warm,
    ]);
  });

  it("refuses a reorder naming a fired group (group.not_held), changing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.desserts, s.mains, s.warm, s.drinks]),
      { code: "group.not_held", params: { groupId: s.drinks } },
    );
  });

  it("refuses a reorder missing a held group (management.request_invalid), changing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.desserts, s.mains]),
      { code: "management.request_invalid", params: { field: "heldGroupIds" } },
    );
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.desserts, s.mains, s.warm, s.warm]),
      { code: "management.request_invalid", params: { field: "heldGroupIds" } },
    );
  });

  it("moves one Steak portion of two from the mains to the desserts with its own ticket", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);

    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts });

    const { groups } = await groupsOf(s.partyId);
    const byId = new Map(groups.map((group) => [group.id, group]));
    expect(byId.get(s.mains)!.summary).toBe("1 × Steak, 1 × Fish");
    expect(byId.get(s.desserts)!.summary).toBe("1 × Steak, 2 × Flan");
    const steaks = (await linesOf(s.partyId)).filter((row) => row.productId === v.productId.steak);
    expect(steaks.map((row) => [row.groupId, row.quantity, row.creditedTo])).toEqual([
      [s.desserts, 1000, ALEX],
      [s.mains, 1000, ALEX],
    ]);
    const tickets = await ticketsOf(s.partyId);
    for (const row of steaks) {
      expect(tickets.find((ticket) => ticket.lineId === row.id)).toMatchObject({
        firedAt: null,
        quantity: 1000,
      });
    }
  });

  it("answers the party's revision as stored after a move that splits a row and empties a group", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    const [steak] = await linesIn(s.partyId, s.mains);
    const before = await revisionOf(s.partyId);

    const result = await move(
      v,
      s.partyId,
      [
        { lineId: steak!.id, quantity: "1" },
        { lineId: fish!.id, quantity: "1" },
      ],
      { groupId: s.desserts },
    );

    expect(result).toEqual({ revision: before + 1 });
    expect(await revisionOf(s.partyId)).toBe(before + 1);
    const [row] = await db.select().from(orderGroups).where(eq(orderGroups.id, fishOnly));
    expect(row!.state).toBe("removed");
  });

  it("moves part of two lines of one bill in one request, splitting each into a numbered row of the target", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);
    const [flan] = await linesIn(s.partyId, s.desserts);

    await move(
      v,
      s.partyId,
      [
        { lineId: steak!.id, quantity: "1" },
        { lineId: flan!.id, quantity: "1" },
      ],
      "new",
    );

    const target = (await groupsOf(s.partyId)).groups[5]!.id;
    const rows = (await linesOf(s.partyId)).map((row) => [
      row.lineNo,
      row.productId,
      row.quantity,
      row.groupId,
    ]);
    expect(rows.slice(4)).toEqual([
      [5, v.productId.steak, 1000, s.mains],
      [6, v.productId.fish, 1000, s.mains],
      [7, v.productId.flan, 1000, s.desserts],
      [8, v.productId.steak, 1000, target],
      [9, v.productId.flan, 1000, target],
    ]);
  });

  it("moves part of a line on each of two bills in one request, splitting each on its own bill", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submitGrouped(v, s, [
      { release: "hold", lines: [line(v, "water", "3"), line(v, "steak", "2")] },
    ]);
    const groupId = groups[0]!.id;
    const [water, steak] = await linesIn(s.partyId, groupId);
    const revision = await revisionOf(s.partyId);
    const checkId = await onSecondBill(
      v,
      s,
      [{ lineNo: water!.lineNo, quantity: "2" }],
      revision,
      ALEX,
    );
    const [checkWater] = await linesOfBill(checkId);

    await move(
      v,
      s.partyId,
      [
        { lineId: checkWater!.id, quantity: "1" },
        { lineId: steak!.id, quantity: "1" },
      ],
      "new",
    );

    const target = (await groupsOf(s.partyId)).groups[1]!.id;
    const lines = await linesOf(s.partyId);
    const rowsOf = (billId: string) =>
      lines
        .filter((row) => row.workingOrderId === billId)
        .map((row) => [row.lineNo, row.productId, row.quantity, row.groupId]);
    expect(rowsOf(s.tabId)).toEqual([
      [1, v.productId.water, 1000, groupId],
      [2, v.productId.steak, 1000, groupId],
      [3, v.productId.steak, 1000, target],
    ]);
    expect(rowsOf(checkId)).toEqual([
      [1, v.productId.water, 1000, groupId],
      [2, v.productId.water, 1000, target],
    ]);
  });

  it("splits Steak ×2 into two rows by moving one into a new held group at the end", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);

    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], "new");

    const { groups } = await groupsOf(s.partyId);
    expect(groups).toHaveLength(6);
    expect(groups[5]).toMatchObject({ position: 6, state: "held", summary: "1 × Steak" });
    expect(groups[3]).toMatchObject({ id: s.mains, summary: "1 × Steak, 1 × Fish" });
  });

  it("split part of a held line into its own group: two rows in that group, quantities summing to the original", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);
    const events = (await eventsOf(s.partyId)).length;

    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.mains });

    expect((await linesIn(s.partyId, s.mains)).map((row) => [row.productId, row.quantity])).toEqual(
      [
        [v.productId.steak, 1000],
        [v.productId.fish, 1000],
        [v.productId.steak, 1000],
      ],
    );
    const { groups } = await groupsOf(s.partyId);
    expect(groups).toHaveLength(5);
    expect(groups[3]).toMatchObject({
      id: s.mains,
      position: 4,
      state: "held",
      summary: "2 × Steak, 1 × Fish",
    });
    const after = await eventsOf(s.partyId);
    expect(after.slice(events).map((event) => [event.groupId, event.kind])).toEqual([
      [s.mains, "group.lines_moved"],
    ]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("removes a group a move empties: gone from the list, its events still readable", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);

    await move(v, s.partyId, [{ lineId: fish!.id, quantity: "1" }], { groupId: s.desserts });

    const [row] = await db.select().from(orderGroups).where(eq(orderGroups.id, fishOnly));
    expect(row!.state).toBe("removed");
    expect((await groupsOf(s.partyId)).groups.map((group) => group.id)).not.toContain(fishOnly);
    const events = (await eventsOf(s.partyId)).filter((event) => event.groupId === fishOnly);
    expect(events.map((event) => event.kind)).toEqual(["group.submitted", "group.removed"]);
    expect((await linesIn(s.partyId, s.desserts)).map((line) => line.id)).toContain(fish!.id);
  });

  it("writes one event naming the operator, and moves the party's revision on, for each change", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);
    let fishGroup = "";
    const changes: [string, () => Promise<unknown>][] = [
      [
        "group.submitted",
        async () => {
          const result = await submit(
            v,
            s.partyId,
            [{ release: "hold", lines: [line(v, "fish")] }],
            { operatorId: MIA },
          );
          fishGroup = result.groups[0]!.id;
        },
      ],
      [
        "group.joined",
        () =>
          submit(v, s.partyId, [{ release: "hold", lines: [line(v, "flan")] }], {
            joinGroupId: s.desserts,
            operatorId: MIA,
          }),
      ],
      [
        "group.reordered",
        () => reorder(s.partyId, [fishGroup, s.warm, s.mains, s.desserts], { operatorId: MIA }),
      ],
      [
        "group.lines_moved",
        () =>
          move(
            v,
            s.partyId,
            [{ lineId: steak!.id, quantity: "1" }],
            { groupId: s.desserts },
            { operatorId: MIA },
          ),
      ],
      ["group.fired", () => fire(v, s.partyId, s.warm, { operatorId: MIA })],
    ];
    for (const [kind, change] of changes) {
      const revision = await revisionOf(s.partyId);
      const events = (await eventsOf(s.partyId)).length;
      await change();
      expect(await revisionOf(s.partyId)).toBe(revision + 1);
      const after = await eventsOf(s.partyId);
      expect(after).toHaveLength(events + 1);
      expect(after.at(-1)).toMatchObject({ kind, actorId: MIA });
    }
  });

  it("leaves a held group's line freely editable in place, in its group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const [bill] = await db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, s.tabId));

    await inTx((tx) =>
      updateOrderLine(
        tx,
        v.cfg,
        s.tabId,
        steak!.lineNo,
        { portionLineNos: [], quantity: "3" },
        bill!.revision,
      ),
    );

    const [edited] = await linesIn(s.partyId, s.mains);
    expect(edited).toMatchObject({ id: steak!.id, quantity: 1000, groupId: s.mains });
    expect(
      (await linesIn(s.partyId, s.mains))
        .filter((row) => row.productId === v.productId.steak)
        .map((row) => row.quantity),
    ).toEqual([1000, 1000, 1000, 1000]);
    expect(await printed(v)).toHaveLength(2);
  });
});
describe("retries (D8): each writes nothing the second time", () => {
  it("answers a repeated submission with the same groups, even carrying the now-stale revision", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const submissionId = randomUUID();
    const revision = await revisionOf(s.partyId);
    const groups = [{ release: "fire" as const, lines: [line(v, "steak")] }];

    const first = await submit(v, s.partyId, groups, { submissionId, revision });
    const before = await snapshot(v, s.partyId);
    const second = await submit(v, s.partyId, groups, { submissionId, revision });

    expect(second).toEqual(first);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("adds a joined Steak once when the join is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    const revision = await revisionOf(s.partyId);
    const join = () =>
      submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }], {
        joinGroupId: s.mains,
        submissionId,
        revision,
      });

    await join();
    const before = await snapshot(v, s.partyId);
    await join();

    expect(await snapshot(v, s.partyId)).toEqual(before);
    expect(await linesIn(s.partyId, s.mains)).toHaveLength(4);
  });

  it("prints a fired group once when the fire is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };

    const first = await fire(v, s.partyId, s.warm, opts);
    const before = await snapshot(v, s.partyId);
    const second = await fire(v, s.partyId, s.warm, opts);

    expect(second).toEqual(first);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("moves once when a move is repeated", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };
    const moves = [{ lineId: steak!.id, quantity: "1" }];

    await move(v, s.partyId, moves, { groupId: s.desserts }, opts);
    const before = await snapshot(v, s.partyId);
    await move(v, s.partyId, moves, { groupId: s.desserts }, opts);

    expect(await snapshot(v, s.partyId)).toEqual(before);
  });
});
describe("an id reused for a different request (D8) is submission.id_reused", () => {
  it("refuses the same id with the Steak's quantity changed", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const submissionId = randomUUID();
    await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak", "1")] }], {
      submissionId,
    });
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak", "2")] }], {
          submissionId,
        }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses the same id on a move naming another target group", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);
    const submissionId = randomUUID();
    const moves = [{ lineId: steak!.id, quantity: "1" }];
    await move(v, s.partyId, moves, { groupId: s.desserts }, { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, moves, { groupId: s.warm }, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses an id first used by a submission, then sent with a fire", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }], { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.warm, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses an id that fired the mains, sent again to fire the desserts", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    await fire(v, s.partyId, s.mains, { submissionId });
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.desserts, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });
});
describe("stale screens (D19)", () => {
  it("fires a group whose lines sit on two bills of the party: every line, on both bills", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submitGrouped(v, s, [
      { release: "hold", lines: [line(v, "water", "2"), line(v, "steak")] },
    ]);
    const groupId = groups[0]!.id;
    const [water] = await linesIn(s.partyId, groupId);
    const revision = await revisionOf(s.partyId);
    const checkId = await onSecondBill(
      v,
      s,
      [{ lineNo: water!.lineNo, quantity: "1" }],
      revision,
      ALEX,
    );
    const billRevisions = async () =>
      db
        .select({ id: workingOrders.id, revision: workingOrders.revision })
        .from(workingOrders)
        .where(inArray(workingOrders.id, [s.tabId, checkId]))
        .orderBy(workingOrders.id);
    const before = await billRevisions();

    await fire(v, s.partyId, groupId);

    const lines = await linesIn(s.partyId, groupId);
    expect(lines.map((row) => row.workingOrderId).sort()).toEqual(
      [s.tabId, s.tabId, checkId].sort(),
    );
    expect(lines.every((row) => row.sentAt !== null)).toBe(true);
    expect(await billRevisions()).toEqual(
      before.map((bill) => ({ ...bill, revision: bill.revision + 1 })),
    );
  });

  it("refuses device A's fire after device B moved a line between held groups, then fires the moved line", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const seenByA = await revisionOf(s.partyId);
    const steaks = (await linesIn(s.partyId, s.mains)).filter(
      (row) => row.productId === v.productId.steak,
    );
    const steak = steaks[0];
    await move(
      v,
      s.partyId,
      steaks.map((row) => ({ lineId: row.id, quantity: "1" })),
      { groupId: s.warm },
    );

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => fire(v, s.partyId, s.warm, { revision: seenByA }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision: seenByA + 1 } },
    );

    await fire(v, s.partyId, s.warm);
    expect(await firedTicketLineIds(s.partyId)).toContain(steak!.id);
  });

  it("refuses a reorder and a move sent with a revision another device has moved on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const stale = await revisionOf(s.partyId);
    await reorder(s.partyId, [s.warm, s.desserts, s.mains]);
    const [steak] = await linesIn(s.partyId, s.mains);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.mains, s.desserts, s.warm], { revision: stale }),
      { code: "party.out_of_date" },
    );
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        move(
          v,
          s.partyId,
          [{ lineId: steak!.id, quantity: "1" }],
          { groupId: s.warm },
          {
            revision: stale,
          },
        ),
      { code: "party.out_of_date" },
    );
  });
});
describe("during a card payment", () => {
  async function paying(tabId: string): Promise<void> {
    await seedPendingCardPayment(db, tabId);
  }

  it("refuses a submission (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await paying(s.tabId);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]),
      { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } },
    );
  });

  it("fires a held group while the card is at the reader", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const warm = (await linesIn(s.partyId, s.warm)).map((row) => row.id);
    await paying(s.tabId);
    await fire(v, s.partyId, s.warm);
    expect((await groupsOf(s.partyId)).groups.find((group) => group.id === s.warm)).toMatchObject({
      state: "fired",
    });
    expect(await firedTicketLineIds(s.partyId)).toEqual(expect.arrayContaining(warm));
    await stillPaying(s.tabId);
  });

  it("moves a whole line into a held group while the card is at the reader", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    expect(steak!.quantity).toBe(1000);
    await paying(s.tabId);
    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts });
    expect((await linesIn(s.partyId, s.desserts)).map((row) => row.id)).toContain(steak!.id);
    expect((await linesIn(s.partyId, s.mains)).map((row) => row.id)).not.toContain(steak!.id);
    await stillPaying(s.tabId);
  });

  it("refuses a partial move into a held group (order.payment_in_flight), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);
    expect(steak!.quantity).toBe(2000);
    await paying(s.tabId);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts }),
      { code: "order.payment_in_flight", params: { workingOrderId: s.tabId } },
    );
  });

  it("reorders the held groups while the card is at the reader", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await paying(s.tabId);
    const revision = await revisionOf(s.partyId);
    const positions = (await groupsOf(s.partyId)).groups
      .filter((group) => group.state === "held")
      .map(({ position }) => position)
      .sort((a, b) => a - b);
    await reorder(s.partyId, [s.desserts, s.mains, s.warm]);
    expect(await revisionOf(s.partyId)).toBeGreaterThan(revision);
    const after = new Map(
      (await groupsOf(s.partyId)).groups.map(({ id, position }) => [id, position]),
    );
    expect([s.desserts, s.mains, s.warm].map((id) => after.get(id))).toEqual(positions);
    await stillPaying(s.tabId);
  });

  it("refuses a whole line on one bill moved with part of a line on a bill being paid, writing nothing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submitGrouped(v, s, [
      { release: "hold", lines: [line(v, "water", "3"), line(v, "steak", "2")] },
    ]);
    const [water, steak] = await linesIn(s.partyId, groups[0]!.id);
    const checkId = await onSecondBill(
      v,
      s,
      [{ lineNo: water!.lineNo, quantity: "2" }],
      await revisionOf(s.partyId),
      ALEX,
    );
    const [checkWater] = await linesOfBill(checkId);
    await paying(checkId);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        move(
          v,
          s.partyId,
          [
            { lineId: steak!.id, quantity: "2" },
            { lineId: checkWater!.id, quantity: "1" },
          ],
          "new",
        ),
      { code: "order.payment_in_flight", params: { workingOrderId: checkId } },
    );
  });
});
describe("while a card refund waits on the bill", () => {
  it("reorders the held groups", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await pendingRefund(v, s.tabId);
    const positions = (await groupsOf(s.partyId)).groups
      .filter((group) => group.state === "held")
      .map(({ position }) => position)
      .sort((a, b) => a - b);
    await reorder(s.partyId, [s.desserts, s.mains, s.warm]);
    const after = new Map(
      (await groupsOf(s.partyId)).groups.map(({ id, position }) => [id, position]),
    );
    expect([s.desserts, s.mains, s.warm].map((id) => after.get(id))).toEqual(positions);
    expect(await refundStates(s.tabId)).toEqual(["pending"]);
  });

  it("moves a whole line into a held group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    expect(steak!.quantity).toBe(1000);
    await pendingRefund(v, s.tabId);
    await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts });
    expect((await linesIn(s.partyId, s.desserts)).map((row) => row.id)).toContain(steak!.id);
    expect((await linesIn(s.partyId, s.mains)).map((row) => row.id)).not.toContain(steak!.id);
    expect(await refundStates(s.tabId)).toEqual(["pending"]);
  });
});
describe("extras lines follow their dish", () => {
  function steakWithSauce(v: Venue): GroupLine {
    return {
      ...line(v, "steak"),
      extras: [{ listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] }],
    };
  }

  async function allLinesOf(tabId: string) {
    return db
      .select({
        id: workingOrderLines.id,
        parentLineId: workingOrderLines.parentLineId,
        groupId: workingOrderLines.groupId,
        creditedTo: workingOrderLines.creditedTo,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
  }

  it("puts a submitted dish's extras in its group, credited to the same operator", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(
      v,
      s.partyId,
      [{ release: "hold", lines: [steakWithSauce(v)] }],
      { operatorId: MIA },
    );

    const [dish, sauce] = await allLinesOf(s.tabId);
    expect(sauce).toMatchObject({
      parentLineId: dish!.id,
      groupId: groups[0]!.id,
      creditedTo: MIA,
    });
    expect(groups[0]).toMatchObject({ lineIds: [dish!.id], summary: "1 × Steak" });
  });

  it("puts each dish's extras in its own group when one submission carries two groups", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const { groups } = await submit(
      v,
      s.partyId,
      [
        { release: "fire", lines: [steakWithSauce(v), line(v, "beer")] },
        { release: "hold", lines: [line(v, "flan"), steakWithSauce(v)] },
      ],
      { operatorId: MIA },
    );
    const [first, second] = groups.map((group) => group.id);

    const rows = await db
      .select({
        id: workingOrderLines.id,
        lineNo: workingOrderLines.lineNo,
        productId: workingOrderLines.productId,
        parentLineId: workingOrderLines.parentLineId,
        groupId: workingOrderLines.groupId,
        creditedTo: workingOrderLines.creditedTo,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId))
      .orderBy(workingOrderLines.lineNo);
    const lineNoOf = new Map(rows.map((row) => [row.id, row.lineNo]));
    expect(
      rows.map((row) => [
        row.lineNo,
        row.productId,
        row.parentLineId === null ? null : lineNoOf.get(row.parentLineId),
        row.groupId,
        row.creditedTo,
      ]),
    ).toEqual([
      [1, v.productId.steak, null, first, MIA],
      [2, v.productId.sauce, 1, first, MIA],
      [3, v.productId.beer, null, first, MIA],
      [4, v.productId.flan, null, second, MIA],
      [5, v.productId.steak, null, second, MIA],
      [6, v.productId.sauce, 5, second, MIA],
    ]);
  });

  it("moves a whole dish with its extras into another held group", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const { groups } = await submit(v, s.partyId, [
      { release: "hold", lines: [steakWithSauce(v)] },
    ]);
    const lines = await allLinesOf(s.tabId);
    const dish = lines.find((row) => row.groupId === groups[0]!.id && row.parentLineId === null)!;

    await move(v, s.partyId, [{ lineId: dish.id, quantity: "1" }], { groupId: s.mains });

    const moved = (await allLinesOf(s.tabId)).filter(
      (row) => row.id === dish.id || row.parentLineId === dish.id,
    );
    expect(moved.map((row) => row.groupId)).toEqual([s.mains, s.mains]);
  });

  it("refuses to move part of a dish that has extras (tab.transfer_modifier_line), writing nothing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submitGrouped(v, s, [
      { release: "hold", lines: [{ ...steakWithSauce(v), quantity: "2" }] },
    ]);
    const target = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "flan")] }]))
      .groups[0]!.id;
    const dish = (await allLinesOf(s.tabId)).find(
      (row) => row.parentLineId === null && row.groupId !== target,
    )!;

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: dish.id, quantity: "1" }], { groupId: target }),
      { code: "tab.transfer_modifier_line" },
    );
  });

  it("A803 portions: moves one portion of a sent dish with extras whole, with its own extras", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [
      { release: "hold", lines: [{ ...steakWithSauce(v), quantity: "2" }] },
    ]);
    const target = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "flan")] }]))
      .groups[0]!.id;
    const before = await allLinesOf(s.tabId);
    const [dish, other] = before.filter(
      (row) => row.parentLineId === null && row.groupId !== target,
    );
    const own = (id: string) => (row: { id: string; parentLineId: string | null }) =>
      row.id === id || row.parentLineId === id;

    await move(v, s.partyId, [{ lineId: dish!.id, quantity: "1" }], { groupId: target });

    const after = await allLinesOf(s.tabId);
    expect(after).toHaveLength(before.length);
    expect(after.filter(own(dish!.id)).map((row) => row.groupId)).toEqual([target, target]);
    expect(after.filter(own(other!.id)).map((row) => row.groupId)).toEqual([
      other!.groupId,
      other!.groupId,
    ]);
  });

  it("refuses to move an extras line on its own (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "hold", lines: [steakWithSauce(v)] }]);
    const target = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "flan")] }]))
      .groups[0]!.id;
    const sauce = (await allLinesOf(s.tabId)).find((row) => row.parentLineId !== null)!;

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: sauce.id, quantity: "1" }], { groupId: target }),
      { code: "group.not_found", params: { lineId: sauce.id } },
    );
  });
});
describe("malformed commands are refused, writing nothing", () => {
  it("refuses a submission with no groups", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await expectRefusedWithNothingWritten(v, s.partyId, () => submit(v, s.partyId, []), {
      code: "management.request_invalid",
      params: { field: "groups" },
    });
  });

  it("refuses a submission holding a group with no lines, first or later (sale.empty_basket)", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const empty = { release: "hold" as const, lines: [] };
    const fish = { release: "fire" as const, lines: [line(v, "fish")] };
    for (const groups of [
      [empty, fish],
      [fish, empty],
    ]) {
      await expectRefusedWithNothingWritten(v, s.partyId, () => submit(v, s.partyId, groups), {
        code: "sale.empty_basket",
      });
    }
  });

  it("refuses a join carrying two groups, or one released to fire", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const hold = { release: "hold" as const, lines: [line(v, "fish")] };
    for (const groups of [[hold, hold], [{ ...hold, release: "fire" as const }]]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => submit(v, s.partyId, groups, { joinGroupId: s.mains }),
        { code: "management.request_invalid", params: { field: "joinGroupId" } },
      );
    }
  });

  it("refuses a join to a removed group as not found", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    await move(v, s.partyId, [{ lineId: fish!.id, quantity: "1" }], { groupId: s.mains });

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }], {
          joinGroupId: fishOnly,
        }),
      { code: "group.not_found", params: { groupId: fishOnly } },
    );
  });

  it("refuses a reorder naming a group the party does not have", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const missing = randomUUID();
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => reorder(s.partyId, [s.warm, s.mains, s.desserts, missing]),
      { code: "group.not_found", params: { groupId: missing } },
    );
  });

  it("refuses a move with no lines, or naming one line twice", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const twice = [
      { lineId: steak!.id, quantity: "1" },
      { lineId: steak!.id, quantity: "1" },
    ];
    for (const moves of [[], twice]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => move(v, s.partyId, moves, { groupId: s.desserts }),
        { code: "management.request_invalid", params: { field: "moves" } },
      );
    }
  });

  it("refuses a move of a line no group of the party holds", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const other = await specExample(v);
    const [steak] = await linesIn(other.partyId, other.mains);
    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts }),
      { code: "group.not_found", params: { lineId: steak!.id } },
    );
  });

  it("refuses a move of a malformed or too large quantity", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    for (const quantity of ["abc", "3"]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => move(v, s.partyId, [{ lineId: steak!.id, quantity }], { groupId: s.desserts }),
        { code: "tab.transfer_quantity_invalid" },
      );
    }
  });

  it("lists no groups of a party that does not exist", async () => {
    const missing = randomUUID();
    await expect(groupsOf(missing)).rejects.toMatchObject({
      code: "party.not_open",
      params: { partyId: missing },
    });
  });
});
describe("a held line on a paid bill", () => {
  it("is not moved, whole or in part (working_order.not_open), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, s.tabId));

    for (const quantity of ["2", "1"]) {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => move(v, s.partyId, [{ lineId: steak!.id, quantity }], { groupId: s.desserts }),
        { code: "working_order.not_open", params: { workingOrderId: s.tabId } },
      );
    }
  });
});
describe("edits inside groups (D19)", () => {
  it("removes a held group whose only line is voided: gone from the list, its events kept, the party moved on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    const revision = await revisionOf(s.partyId);

    await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish!.lineNo, undefined, MIA));

    expect((await groupRow(fishOnly)).state).toBe("removed");
    expect((await groupsOf(s.partyId)).groups.map((group) => group.id)).not.toContain(fishOnly);
    const events = (await eventsOf(s.partyId)).filter((event) => event.groupId === fishOnly);
    expect(events.map((event) => [event.kind, event.actorId])).toEqual([
      ["group.submitted", ALEX],
      ["group.removed", MIA],
    ]);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("removes a held group whose only line Cancel item removes, naming the editor", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    const revision = await revisionOf(s.partyId);

    await inTx((tx) => cancelItemForTest(tx, v.cfg, s.tabId, fish!.lineNo, undefined, MIA));

    expect((await groupRow(fishOnly)).state).toBe("removed");
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: fishOnly,
      kind: "group.removed",
      actorId: MIA,
    });
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("keeps a held group one of whose two lines is voided, writes no event, and moves the party on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [, fish] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);
    const events = (await eventsOf(s.partyId)).length;

    await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish!.lineNo, undefined, MIA));

    expect((await groupRow(s.mains)).state).toBe("held");
    expect(await eventsOf(s.partyId)).toHaveLength(events);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("moves the party on for part of a line voided", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);

    await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, steak!.lineNo, "1", MIA));

    expect((await linesIn(s.partyId, s.mains))[0]).toMatchObject({ id: steak!.id, quantity: 1000 });
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("puts a FIRED line's raised quantity in a new fired group credited to the editor, leaving the line as it was", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.partyId, s.drinks);
    const revision = await revisionOf(s.partyId);

    // Beer ×2 is two portions; raising the first by one adds one beer, as 2 → 3 did.
    await changeLine(v, s.tabId, beer!.lineNo, { portionLineNos: [], quantity: "2" }, MIA);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.position, group.state])).toEqual([
      [1, "fired"],
      [2, "fired"],
      [3, "held"],
      [4, "held"],
      [5, "held"],
      [6, "fired"],
    ]);
    const added = groups[5]!;
    const [extra] = await linesIn(s.partyId, added.id);
    expect(added.lineIds).toEqual([extra!.id]);
    expect(extra).toMatchObject({
      productId: v.productId.beer,
      quantity: 1000,
      creditedTo: MIA,
      sentAt: expect.any(String),
    });
    expect(await firedTicketLineIds(s.partyId)).toContain(extra!.id);
    expect((await linesIn(s.partyId, s.drinks))[0]).toMatchObject({
      id: beer!.id,
      quantity: 1000,
      groupId: s.drinks,
      creditedTo: ALEX,
    });
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: added.id,
      kind: "group.submitted",
      actorId: MIA,
    });
    expect(await groupRow(added.id)).toMatchObject({ submittedBy: MIA, firedBy: MIA });
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("refuses raising a FIRED line's quantity once a publish makes its dish not sold separately, writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.partyId, s.drinks);
    await inTx(async (tx) => {
      await updateProduct(tx, v.productId.beer, { ordering: "not_sold_separately" });
      await republishMenus(tx);
    });

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => changeLine(v, s.tabId, beer!.lineNo, { portionLineNos: [], quantity: "3" }, MIA),
      { code: "product.not_sold_separately", params: { productId: v.productId.beer } },
    );
  });

  it("changes a HELD line's quantity in place, in its group, and moves the party on", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);
    const events = (await eventsOf(s.partyId)).length;

    await changeLine(v, s.tabId, steak!.lineNo, { portionLineNos: [], quantity: "3" }, MIA);

    expect((await linesIn(s.partyId, s.mains))[0]).toMatchObject({
      id: steak!.id,
      quantity: 1000,
      creditedTo: ALEX,
      sentAt: null,
    });
    expect(
      (await linesIn(s.partyId, s.mains))
        .filter((row) => row.productId === v.productId.steak)
        .map((row) => [row.quantity, row.creditedTo, row.sentAt]),
    ).toEqual(Array.from({ length: 4 }, () => [1000, ALEX, null]));
    expect((await groupsOf(s.partyId)).groups).toHaveLength(5);
    expect(await eventsOf(s.partyId)).toHaveLength(events);
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("leaves the party's revision alone for an edit that changes nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [steak] = await linesIn(s.partyId, s.mains);
    const revision = await revisionOf(s.partyId);

    // Steak ×2 is two portions of one each.
    await changeLine(v, s.tabId, steak!.lineNo, { portionLineNos: [], quantity: "1" }, MIA);

    expect(await revisionOf(s.partyId)).toBe(revision);
  });

  it("puts an extra Mia adds to Alex's held Steak in the Steak's group, credited to Alex", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const held = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    const [steak] = await linesIn(s.partyId, held);

    await changeLine(
      v,
      s.tabId,
      steak!.lineNo,
      {
        portionLineNos: [],
        extras: [
          { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
        ],
      },
      MIA,
    );

    const rows = await linesOfBill(s.tabId);
    expect(rows.map((row) => [row.parentLineId, row.groupId, row.creditedTo])).toEqual([
      [null, held, ALEX],
      [steak!.id, held, ALEX],
    ]);
    expect((await groupsOf(s.partyId)).groups.map((group) => group.id)).toEqual([held]);
  });

  it("puts an extra Mia adds to Alex's FIRED Steak in the Steak's fired group, credited to Alex", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const fired = (await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    const [steak] = await linesIn(s.partyId, fired);
    const events = (await eventsOf(s.partyId)).length;

    await changeLine(
      v,
      s.tabId,
      steak!.lineNo,
      {
        portionLineNos: [],
        extras: [
          { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
        ],
      },
      MIA,
    );

    const rows = await linesOfBill(s.tabId);
    expect(rows.map((row) => [row.parentLineId, row.groupId, row.creditedTo])).toEqual([
      [null, fired, ALEX],
      [steak!.id, fired, ALEX],
    ]);
    expect((await groupsOf(s.partyId)).groups.map((group) => [group.id, group.state])).toEqual([
      [fired, "fired"],
    ]);
    expect(await eventsOf(s.partyId)).toHaveLength(events);
  });

  it("puts a new dish a save adds, where some line was sent, in a new fired group credited to the editor", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const revision = await revisionOf(s.partyId);

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "flan")], MIA);

    const { groups } = await groupsOf(s.partyId);
    expect(groups).toHaveLength(6);
    expect(groups[5]).toMatchObject({ position: 6, state: "fired", summary: "1 × Flan" });
    const [flan] = await linesIn(s.partyId, groups[5]!.id);
    expect(flan).toMatchObject({ creditedTo: MIA, sentAt: expect.any(String) });
    expect(await firedTicketLineIds(s.partyId)).toContain(flan!.id);
    expect((await eventsOf(s.partyId)).at(-1)).toMatchObject({
      groupId: groups[5]!.id,
      kind: "group.submitted",
      actorId: MIA,
    });
    expect(await revisionOf(s.partyId)).toBe(revision + 1);
  });

  it("puts a new dish a save adds, where every line is held, in a new held group at the end", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak"), line(v, "fish")] }])
    ).groups[0]!.id;

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "flan")], MIA);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.id === first, group.position, group.state])).toEqual([
      [true, 1, "held"],
      [false, 2, "held"],
    ]);
    const [flan] = await linesIn(s.partyId, groups[1]!.id);
    expect(flan).toMatchObject({ productId: v.productId.flan, creditedTo: MIA, sentAt: null });
    expect(await firedTicketLineIds(s.partyId)).toEqual([]);
    expect(await groupRow(groups[1]!.id)).toMatchObject({ submittedBy: MIA, firedBy: null });
  });

  it("puts a new dish a save adds to a party's tab of held no-route lines only in a new held group", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "water")] }]);

    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "steak")], MIA);

    const { groups } = await groupsOf(s.partyId);
    expect(groups.map((group) => [group.position, group.state, group.summary])).toEqual([
      [1, "held", "1 × Water btl"],
      [2, "held", "1 × Steak"],
    ]);
    await fire(v, s.partyId, groups[1]!.id);
    const [steak] = await linesIn(s.partyId, groups[1]!.id);
    expect(await firedTicketLineIds(s.partyId)).toEqual([steak!.id]);
  });

  it("puts no line of a counter order in a group, crediting a line a save adds to the editor", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, v.cfg, {
      id,
      lines: [line(v, "steak")],
      zoneId: v.zoneId,
      operatorId: ALEX,
    });

    await saveWhole(v, id, [...(await keptLines(v, id)), line(v, "flan")], MIA);

    expect((await linesOfBill(id)).map((row) => [row.groupId, row.creditedTo, row.sentAt])).toEqual(
      [
        [null, ALEX, null],
        [null, MIA, null],
      ],
    );
    expect(await db.select().from(orderGroups)).toEqual([]);
  });

  it("credits nobody and starts no group for an edit with no operator on a bill of no party", async () => {
    const v = await setupVenue();
    const tabId = await billOfNoParty(v, (tx, id) =>
      addTabRound(tx, v.cfg, id, [{ ...line(v, "steak"), release: true }], {
        creditedTo: ALEX,
      }),
    );
    expect(await linesOfBill(tabId)).toMatchObject([{ sentAt: expect.any(String) }]);

    await changeLine(v, tabId, 1, { portionLineNos: [], quantity: "2" });
    await saveWhole(v, tabId, [...(await keptLines(v, tabId)), line(v, "flan")], undefined);

    expect(
      (await linesOfBill(tabId)).map((row) => [
        row.lineNo,
        row.quantity,
        row.groupId,
        row.creditedTo,
      ]),
    ).toEqual([
      [1, 1000, null, ALEX],
      [2, 1000, null, null],
      [3, 1000, null, null],
    ]);
    expect(await db.select().from(orderGroups)).toEqual([]);
  });

  it("refuses an edit that must start a group when no operator is named, writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [beer] = await linesIn(s.partyId, s.drinks);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () =>
        inTx(async (tx) =>
          updateOrderLineCommand(
            tx,
            v.cfg,
            s.tabId,
            beer!.lineNo,
            { portionLineNos: [], quantity: "3" },
            await billRevisionOf(s.tabId),
            {
              admission: testTradingAdmission(),
              operatorId: undefined,
              expectedEdit: await readBillEditState(tx, s.tabId),
            },
          ),
        ),
      { code: "management.request_invalid", params: { field: "operatorId" } },
    );
  });
});
describe("splitting a held line into units", () => {
  it.each(["fired", "settled", "paying", "stale", "other-party", "missing"] as const)(
    "refuses %s without changing rows, tickets, revisions, printing or history",
    async (state) => {
      const v = await setupVenue();
      const s = await specExample(v);
      const [steak] = await linesIn(s.partyId, s.mains);
      const command = await args(s.partyId);
      let lineId = steak!.id;
      let code = "group.not_held";
      if (state === "fired") await fire(v, s.partyId, s.mains);
      if (state === "settled") {
        await db
          .update(workingOrders)
          .set({ status: "settled", settledAt: new Date().toISOString() })
          .where(eq(workingOrders.id, s.tabId));
        code = "working_order.not_open";
      }
      if (state === "paying") {
        await seedPendingCardPayment(db, s.tabId);
        code = "order.payment_in_flight";
      }
      if (state === "stale") {
        command.expectedPartyRevision -= 1;
        code = "party.out_of_date";
      }
      if (state === "other-party") {
        const other = await specExample(v);
        lineId = (await linesIn(other.partyId, other.mains))[0]!.id;
        code = "group.not_found";
      }
      if (state === "missing") {
        lineId = randomUUID();
        code = "group.not_found";
      }
      if (state === "fired") command.expectedPartyRevision = await revisionOf(s.partyId);
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => inTx((tx) => splitHeldLineIntoUnits(tx, v.cfg, s.partyId, lineId, command)),
        { code },
      );
    },
  );

  it("refuses a dish with extras and an extra by itself without writing", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const answer = await submitGrouped(v, s, [
      {
        release: "hold",
        lines: [
          {
            ...line(v, "steak", "3"),
            extras: [
              { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
            ],
          },
        ],
      },
    ]);
    const rows = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId));
    for (const row of rows) {
      const command = await args(s.partyId);
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => inTx((tx) => splitHeldLineIntoUnits(tx, v.cfg, s.partyId, row.id, command)),
        { code: row.parentLineId === null ? "tab.transfer_modifier_line" : "group.not_found" },
      );
    }
    expect(answer.groups).toHaveLength(1);
  });
  it.each([200, 1000])(
    "reads the bill's source lines once for %s units and gives the event loop a turn",
    async (quantity) => {
      const v = await setupVenue();
      const s = await seated(v);
      await submitGrouped(v, s, [{ release: "hold", lines: [line(v, "steak", String(quantity))] }]);
      const [source] = await linesOf(s.partyId);
      const command = await args(s.partyId);
      let yielded = false;
      const result = await inTx(async (tx) => {
        const selects = vi.spyOn(tx, "select");
        try {
          setImmediate(() => {
            yielded = true;
          });
          const result = await splitHeldLineIntoUnits(tx, v.cfg, s.partyId, source!.id, command);
          const sourceReads = selects.mock.calls.filter(
            ([fields]) =>
              fields?.unitPriceGross === workingOrderLines.unitPriceGross &&
              fields?.ticketItemId === ticketItems.id,
          );
          expect(sourceReads).toHaveLength(1);
          expect(yielded).toBe(true);
          return result;
        } finally {
          selects.mockRestore();
        }
      });
      expect(result).toEqual({ revision: command.expectedPartyRevision + 1 });
      const rows = await linesOf(s.partyId);
      expect(rows).toHaveLength(quantity);
      expect(rows.every((row) => row.quantity === 1000 && row.groupId === source!.groupId)).toBe(
        true,
      );
    },
  );
  it.each([1000, 1500, 2500])(
    "the batch splitter refuses stored quantity %s before writing",
    async (quantity) => {
      const v = await setupVenue();
      const s = await seated(v);
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak", "3")] }]);
      const [source] = await linesOf(s.partyId);
      await db
        .update(workingOrderLines)
        .set({ quantity })
        .where(eq(workingOrderLines.id, source!.id));
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => inTx((tx) => splitUnitsWithinOrder(tx, v.cfg, s.tabId, source!.lineNo)),
        { code: "tab.transfer_quantity_invalid" },
      );
    },
  );
  it.each([3, null])(
    "refuses a line with precision %s even when its saved quantity is a whole number",
    async (precision) => {
      const v = await setupVenue();
      const s = await seated(v);
      await submitGrouped(v, s, [{ release: "hold", lines: [line(v, "steak", "2")] }]);
      const [source] = await linesOf(s.partyId);
      await db
        .update(workingOrderLines)
        .set({ unitPrecision: precision, unitName: { en: "kg", es: "kg" } })
        .where(eq(workingOrderLines.id, source!.id));
      const command = await args(s.partyId);
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => inTx((tx) => splitHeldLineIntoUnits(tx, v.cfg, s.partyId, source!.id, command)),
        { code: "tab.transfer_quantity_invalid" },
      );
    },
  );
  it("a concurrent reader sees the unsplit committed line until the entire split commits", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submitGrouped(v, s, [{ release: "hold", lines: [line(v, "steak", "64")] }]);
    const [source] = await linesOf(s.partyId);
    const command = await args(s.partyId);
    let copied!: () => void;
    const firstCopy = new Promise<void>((resolve) => {
      copied = resolve;
    });
    let release!: () => void;
    const readerDone = new Promise<void>((resolve) => {
      release = resolve;
    });
    let blocked = false;
    const copy = lineServiceState.splitLineServiceState;
    const gate = vi
      .spyOn(lineServiceState, "splitLineServiceState")
      .mockImplementation(async (...args) => {
        await copy(...args);
        if (!blocked) {
          blocked = true;
          copied();
          await readerDone;
        }
      });
    const splitting = inTx((tx) =>
      splitHeldLineIntoUnits(tx, v.cfg, s.partyId, source!.id, command),
    );
    try {
      await firstCopy;
      expect((await linesOf(s.partyId)).map((row) => [row.id, row.quantity])).toEqual([
        [source!.id, 64000],
      ]);
      release();
      await splitting;
      expect(await linesOf(s.partyId)).toHaveLength(64);
    } finally {
      release();
      await splitting;
      gate.mockRestore();
    }
  });
  it("refuses a payment in progress before copying units", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const [source] = await linesIn(s.partyId, s.mains);
    await seedPendingCardPayment(db, s.tabId);
    const command = await args(s.partyId);
    const copy = vi.spyOn(lineServiceState, "splitLineServiceState");
    try {
      await expectRefusedWithNothingWritten(
        v,
        s.partyId,
        () => inTx((tx) => splitHeldLineIntoUnits(tx, v.cfg, s.partyId, source!.id, command)),
        { code: "order.payment_in_flight" },
      );
      expect(copy).not.toHaveBeenCalled();
    } finally {
      copy.mockRestore();
    }
  });
  it("keeps a dish on HOLD paper when part of its quantity is split", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await inTx((tx) => setStationPrinting(tx, { printHeldWork: true }, [v.stationId]));
    await submitGrouped(v, s, [{ release: "hold", lines: [line(v, "steak", "2")] }]);
    const [source] = await linesOf(s.partyId);

    const split = await inTx((tx) =>
      splitLinesWithinOrder(tx, v.cfg, s.tabId, [{ lineNo: source!.lineNo, quantity: "1" }]),
    );
    const copied = split.get(source!.id)!;
    expect(
      await db
        .select()
        .from(ticketItems)
        .where(inArray(ticketItems.workingOrderLineId, [source!.id, copied.id])),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workingOrderLineId: source!.id, holdPaperQueued: true }),
        expect.objectContaining({ workingOrderLineId: copied.id, holdPaperQueued: true }),
      ]),
    );
  });

  it("the original partial splitter makes one row, retaining the other four units", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submitGrouped(v, s, [{ release: "hold", lines: [line(v, "steak", "5")] }]);
    const [source] = await linesOf(s.partyId);
    const result = await inTx((tx) =>
      splitLinesWithinOrder(tx, v.cfg, s.tabId, [{ lineNo: source!.lineNo, quantity: "1" }]),
    );
    expect(result.size).toBe(1);
    expect((await linesOf(s.partyId)).map((row) => row.quantity)).toEqual([4000, 1000]);
    expect((await ticketsOf(s.partyId)).map((row) => row.quantity).sort()).toEqual([1000, 4000]);
  });

  it("keeps the total served quantity while dividing the stored rows", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    await submitGrouped(v, s, [{ release: "hold", lines: [line(v, "steak", "7")] }]);
    const [source] = await linesOf(s.partyId);
    await db
      .update(workingOrderLines)
      .set({ servedQuantity: 3000 })
      .where(eq(workingOrderLines.id, source!.id));
    const command = await args(s.partyId);
    await inTx((tx) => splitHeldLineIntoUnits(tx, v.cfg, s.partyId, source!.id, command));
    const rows = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, s.tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(rows.map((row) => [row.quantity, row.servedQuantity, row.servedAt !== null])).toEqual([
      [1000, 1000, true],
      [1000, 0, false],
      [1000, 0, false],
      [1000, 0, false],
      [1000, 0, false],
      [1000, 1000, true],
      [1000, 1000, true],
    ]);
  });
});
describe("A773 request kind of an edit's and an inserted group", () => {
  it("gives the fired group a raised quantity starts added", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "cold")] }]))
      .groups[0]!.id;
    const [cold] = await linesIn(s.partyId, first);
    await changeLine(v, s.tabId, cold!.lineNo, { portionLineNos: [], quantity: "2" }, MIA);
    const { groups } = await groupsOf(s.partyId);
    const added = groups.at(-1)!.id;
    expect(added).not.toBe(first);
    expect(await groupRow(added)).toMatchObject({ state: "fired", requestKind: "added" });
  });

  it("gives the held group a save of a held order starts next_course", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "flan")], MIA);
    const { groups } = await groupsOf(s.partyId);
    const added = groups.at(-1)!.id;
    expect(added).not.toBe(first);
    expect(await groupRow(added)).toMatchObject({ state: "held", requestKind: "next_course" });
  });

  it("gives a held group inserted after another next_course", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]))
      .groups[0]!.id;
    const inserted = (
      await submit(v, s.partyId, [
        { release: "hold", lines: [line(v, "flan")], afterGroupId: first },
      ])
    ).groups[0]!.id;
    expect(inserted).not.toBe(first);
    expect(await groupRow(inserted)).toMatchObject({ state: "held", requestKind: "next_course" });
  });
});
describe("A884 deleted lists", () => {
  it("keeps the submitted extra and charge on whole saves and note edits, refusing quantity rises before and after republish", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const extras = [
      { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
    ];
    const placed = await submit(v, s.partyId, [
      { release: "fire", lines: [{ ...line(v, "steak"), extras }] },
    ]);
    const [dish] = await linesIn(s.partyId, placed.groups[0]!.id);
    const rows = () =>
      db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, s.tabId))
        .orderBy(asc(workingOrderLines.lineNo));
    expect((await ticketsOf(s.partyId))[0]!.firedAt).not.toBeNull();
    const before = await rows();
    const notices = await inTx((tx) => listStationNotices(tx, v.stationId));
    await inTx((tx) => deleteExtraList(tx, v.extrasListId));
    for (const republish of [false, true]) {
      if (republish) await inTx((tx) => republishMenus(tx));
      const kept = [
        { workingOrderLineId: dish!.id, menuItemId: v.offer("steak"), quantity: "1", extras },
      ];
      await saveWhole(v, s.tabId, kept, MIA);
      expect(await rows()).toEqual(before);
      expect(before.map((row) => [row.productId, row.lineTotal])).toEqual([
        [v.productId.steak, 2200],
        [v.productId.sauce, 150],
      ]);
      expect(await inTx((tx) => listStationNotices(tx, v.stationId))).toEqual(notices);
      await expect(
        changeLine(v, s.tabId, dish!.lineNo, { portionLineNos: [], quantity: "2" }, MIA),
      ).rejects.toMatchObject({ code: "extras.invalid" });
      expect(await rows()).toEqual(before);
    }
    await changeLine(v, s.tabId, dish!.lineNo, { portionLineNos: [], note: "no pepper" }, MIA);
    const afterNote = await rows();
    expect(afterNote[0]).toMatchObject({ id: dish!.id, note: "no pepper", lineTotal: 2200 });
    expect(afterNote[1]).toEqual(before[1]);
  });
});
