import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { KitchenNoteScope } from "@waitron/module";
import { readKitchenNotes, kitchenNoteKey, writeKitchenNote } from "@waitron/venue-service";
import { mergeBills, splitBill, transferItems } from "./testing/bill-action-fixture.js";
import { moveBill, type MoveTarget } from "./testing/move-bill-fixture.js";
import { readOrderKitchenNotes } from "./order-kitchen-note.js";
import { partyMainBill } from "./parties.js";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  commandFor,
  counterOrder,
  inTx,
  join,
  linesOf,
  order,
  partyAt,
  partyRow,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";

let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

let tableNumber = 0;
function freshTable(label: string) {
  return v.table(`${label} ${++tableNumber}`);
}

function save(scope: KitchenNoteScope, note: string | null, revision = 0) {
  return inTx(v, (tx) => writeKitchenNote(tx, scope, revision, note));
}

function saved(scope: KitchenNoteScope) {
  return inTx(v, async (tx) => (await readKitchenNotes(tx, [scope])).get(kitchenNoteKey(scope))!);
}

function effective(billId: string) {
  return inTx(v, async (tx) => (await readOrderKitchenNotes(tx, [billId])).get(billId)!);
}

async function move(billId: string, to: MoveTarget, bills: "merge" | "separate" = "separate") {
  const source = (await billRow(v, billId)).partyId;
  const target = "tableId" in to ? await partyAt(v, to.tableId) : null;
  const expectedPartyRevision = source === null ? undefined : await revisionOf(v, source);
  const expectedOtherPartyRevision = target === null ? undefined : await revisionOf(v, target);
  return inTx(v, (tx) =>
    moveBill(tx, v.cfg, billId, to, {
      ...(source === null && "tableId" in to
        ? {
            submissionId: randomUUID(),
            allergy: { party: { answer: "none" as const, guests: [] }, ticks: [] },
          }
        : {}),
      bills,
      operatorId: OPERATOR,
      partyId: source,
      expectedPartyRevision,
      otherPartyId: target,
      expectedOtherPartyRevision,
    }),
  );
}

async function combine(from: string, into: string, tableId: string) {
  const command = await commandFor(v, into);
  const expectedOtherPartyRevision = await revisionOf(v, from);
  return inTx(v, (tx) =>
    joinTables(tx, v.cfg, into, tableId, {
      ...command,
      bills: "separate",
      otherPartyId: from,
      expectedOtherPartyRevision,
    }),
  );
}

describe("kitchen notes when bills and parties move", () => {
  it("copies a split counter note without changing quantities, prices or a dish's own note", async () => {
    const id = await counterOrder(v, "Burger", "Flan");
    await save({ workingOrderId: id }, "All together before 14:30");
    await inTx(v, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ note: "No onions" })
        .where(eq(workingOrderLines.workingOrderId, id)),
    );
    const original = await linesOf(v, id);
    const { billId } = await inTx(v, (tx) =>
      splitBill(tx, v.cfg, id, [{ lineNo: 1 }], { operatorId: OPERATOR }),
    );
    expect(await effective(billId)).toMatchObject({
      note: "All together before 14:30",
      scope: { workingOrderId: billId },
    });
    expect(await saved({ workingOrderId: id })).toEqual({
      note: "All together before 14:30",
      revision: 1,
    });
    expect(await linesOf(v, billId)).toEqual([original[0]]);
    const [dish] = await v.db
      .select({ note: workingOrderLines.note })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId));
    expect(dish).toEqual({ note: "No onions" });
  });

  it("keeps one shared note through same-party split, transfer and merge", async () => {
    const source = await seat(v, await freshTable("Shared note"));
    await order(v, source.tabId, "Burger", "Flan", "Vino");
    await save({ partyId: source.partyId }, "One shared heading");
    const other = await split(v, source.partyId, source.tabId, [2]);
    expect(await effective(other)).toMatchObject({
      note: "One shared heading",
      scope: { partyId: source.partyId },
    });
    let command = await commandFor(v, source.partyId);
    await inTx(v, (tx) => transferItems(tx, v.cfg, source.tabId, other, [{ lineNo: 3 }], command));
    command = await commandFor(v, source.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, source.tabId, other, command));
    expect(await effective(source.tabId)).toMatchObject({
      note: "One shared heading",
      revision: 1,
    });
    expect(await saved({ workingOrderId: other })).toEqual({ note: null, revision: 0 });
    expect((await linesOf(v, source.tabId)).map((line) => line.name).sort()).toEqual([
      "Burger",
      "Flan",
      "Vino",
    ]);
  });

  it("copies a departing bill's party note over an obsolete counter note, leaving the source intact", async () => {
    const source = await seat(v, await freshTable("Partial departure"));
    await order(v, source.tabId, "Burger", "Flan");
    await save({ partyId: source.partyId }, "Dessert with coffee");
    const other = await split(v, source.partyId, source.tabId, [2]);
    await save({ workingOrderId: other }, "Obsolete counter text");
    await move(other, { counter: { zoneId: v.counter.zoneId } });
    expect(await effective(other)).toMatchObject({
      note: "Dessert with coffee",
      scope: { workingOrderId: other },
      revision: 2,
    });
    expect(await effective(source.tabId)).toMatchObject({
      note: "Dessert with coffee",
      scope: { partyId: source.partyId },
      revision: 1,
    });
    await save({ workingOrderId: other }, "Counter changes", 2);
    expect(await effective(source.tabId)).toMatchObject({
      note: "Dessert with coffee",
      revision: 1,
    });
  });

  it.each(["counter", "party"] as const)(
    "copies a %s bill's note into a new party",
    async (kind) => {
      const source = kind === "party" ? await seat(v, await freshTable("From party")) : null;
      const id = source?.tabId ?? (await counterOrder(v, "Burger"));
      if (source !== null) await order(v, id, "Burger");
      await save(
        source === null ? { workingOrderId: id } : { partyId: source.partyId },
        "A new table, same instruction",
      );
      const result = await move(id, { tableId: await freshTable("Free destination") });
      expect(await effective(result.billId)).toMatchObject({
        note: "A new table, same instruction",
        scope: { partyId: result.partyId },
      });
    },
  );

  it.each(["merge", "separate"] as const)(
    "combines a counter bill with the destination note when bills stay %s",
    async (bills) => {
      const targetTable = await freshTable("Existing destination");
      const target = await seat(v, targetTable);
      await order(v, target.tabId, "Flan");
      const incoming = await counterOrder(v, "Burger");
      await save({ partyId: target.partyId }, "Destination first");
      await save({ workingOrderId: incoming }, "Incoming second");
      const result = await move(incoming, { tableId: targetTable }, bills);
      expect(result.merged).toBe(bills === "merge");
      expect(await effective(result.billId)).toMatchObject({
        note: "Destination first; Incoming second",
        scope: { partyId: target.partyId },
      });
      expect(await effective(target.tabId)).toMatchObject({
        note: "Destination first; Incoming second",
      });
    },
  );

  it.each([false, true])("copies a split table note with a chosen bill: %s", async (withBill) => {
    const first = await freshTable("Stays");
    const leaving = await freshTable("Leaves");
    const source = await seat(v, first);
    await join(v, source.partyId, leaving);
    await order(v, source.tabId, "Burger", "Flan");
    await save({ partyId: source.partyId }, "They eat together");
    const bill = withBill ? await split(v, source.partyId, source.tabId, [2]) : null;
    const command = await commandFor(v, source.partyId);
    const result = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, source.partyId, leaving, bill, command),
    );
    expect(await saved({ partyId: result.partyId })).toEqual({
      note: "They eat together",
      revision: 1,
    });
    expect(await saved({ partyId: source.partyId })).toEqual({
      note: "They eat together",
      revision: 1,
    });
    expect(await effective(result.mainBillId!)).toMatchObject({
      note: "They eat together",
      scope: { partyId: result.partyId },
    });
  });

  it("combines multiple bills once and resolves retained paid bills through the survivor", async () => {
    const fromTable = await freshTable("Combined source");
    const source = await seat(v, fromTable);
    const target = await seat(v, await freshTable("Combined target"));
    await order(v, source.tabId, "Burger", "Flan", "Vino");
    const second = await split(v, source.partyId, source.tabId, [2]);
    const retained = await split(v, source.partyId, source.tabId, [3]);
    await pay(v, retained, "30.00");
    await save({ partyId: source.partyId }, "Source instruction");
    await save({ partyId: target.partyId }, "Target instruction");
    await combine(source.partyId, target.partyId, fromTable);
    for (const id of [source.tabId, second, retained, target.tabId]) {
      expect(await effective(id)).toMatchObject({
        note: "Target instruction; Source instruction",
        scope: { partyId: target.partyId },
        revision: 2,
      });
    }
    expect((await billRow(v, retained)).partyId).toBe(source.partyId);
  });

  it.each([
    {
      destination: "Same instruction",
      source: "Same instruction",
      want: "Same instruction",
      revision: 1,
    },
    { destination: "Keep target", source: null, want: "Keep target", revision: 1 },
    { destination: null, source: "Keep source", want: "Keep source", revision: 1 },
    { destination: null, source: null, want: null, revision: 0 },
  ])(
    "joins nonempty complete notes without duplication or erasing either side: $want",
    async ({ destination, source, want, revision }) => {
      const fromTable = await freshTable("Dedup source");
      const from = await seat(v, fromTable);
      const into = await seat(v, await freshTable("Dedup target"));
      await save({ partyId: from.partyId }, source);
      await save({ partyId: into.partyId }, destination);
      await combine(from.partyId, into.partyId, fromTable);
      expect(await saved({ partyId: into.partyId })).toEqual({ note: want, revision });
    },
  );

  it("rejects an overlength join atomically, including party revisions and table memberships", async () => {
    const table = await freshTable("Too long source");
    const source = await seat(v, table);
    const target = await seat(v, await freshTable("Too long target"));
    await order(v, source.tabId, "Burger");
    await save({ partyId: source.partyId }, "s".repeat(1000));
    await save({ partyId: target.partyId }, "t".repeat(999));
    const beforeSource = await partyRow(v, source.partyId);
    const beforeTarget = await partyRow(v, target.partyId);
    const beforeBills = await v.db.select().from(workingOrders);
    const beforeLines = await v.db.select().from(workingOrderLines);
    await expect(combine(source.partyId, target.partyId, table)).rejects.toMatchObject({
      code: "kitchen_note.too_long",
    });
    expect(await partyRow(v, source.partyId)).toEqual(beforeSource);
    expect(await partyRow(v, target.partyId)).toEqual(beforeTarget);
    expect(await activeTablesOf(v, source.partyId)).toEqual([table]);
    expect(await v.db.select().from(workingOrders)).toEqual(beforeBills);
    expect(await v.db.select().from(workingOrderLines)).toEqual(beforeLines);
    expect(await saved({ partyId: source.partyId })).toEqual({
      note: "s".repeat(1000),
      revision: 1,
    });
    expect(await saved({ partyId: target.partyId })).toEqual({
      note: "t".repeat(999),
      revision: 1,
    });
  });

  it("refuses an overlength bill move before sending or changing ownership", async () => {
    const destinationTable = await freshTable("Overflow move");
    const target = await seat(v, destinationTable);
    const incoming = await counterOrder(v, "Burger");
    await save({ partyId: target.partyId }, "d".repeat(1000));
    await save({ workingOrderId: incoming }, "s".repeat(999));
    const before = await billRow(v, incoming);
    const beforeTarget = await partyRow(v, target.partyId);
    const beforeLines = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, incoming));
    await expect(move(incoming, { tableId: destinationTable })).rejects.toMatchObject({
      code: "kitchen_note.too_long",
    });
    expect(await billRow(v, incoming)).toEqual(before);
    expect(await partyRow(v, target.partyId)).toEqual(beforeTarget);
    expect(
      await v.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, incoming)),
    ).toEqual(beforeLines);
    expect(await effective(incoming)).toMatchObject({
      note: "s".repeat(999),
      scope: { workingOrderId: incoming },
    });
  });

  it("copies a cleared party note over a bill's old counter value", async () => {
    const source = await seat(v, await freshTable("Cleared party"));
    await order(v, source.tabId, "Burger");
    await save({ workingOrderId: source.tabId }, "Obsolete counter instruction");
    await save({ partyId: source.partyId }, "Party instruction");
    await save({ partyId: source.partyId }, null, 1);
    await move(source.tabId, { counter: { zoneId: v.counter.zoneId } });
    expect(await effective(source.tabId)).toMatchObject({
      note: null,
      revision: 2,
      scope: { workingOrderId: source.tabId },
    });
    expect(await saved({ partyId: source.partyId })).toEqual({ note: null, revision: 2 });
  });

  it("accepts a 2000-character combined note and keeps it when the party needs a replacement main bill", async () => {
    const fromTable = await freshTable("Boundary source");
    const from = await seat(v, fromTable);
    const into = await seat(v, await freshTable("Boundary target"));
    await save({ partyId: from.partyId }, "s".repeat(1000));
    await save({ partyId: into.partyId }, "t".repeat(998));
    await combine(from.partyId, into.partyId, fromTable);
    expect(await effective(into.tabId)).toMatchObject({
      note: "t".repeat(998) + "; " + "s".repeat(1000),
    });
    await order(v, into.tabId, "Burger");
    await pay(v, into.tabId, "12.00");
    const replacement = await inTx(v, (tx) => partyMainBill(tx, v.cfg, into.partyId, "moved"));
    expect(replacement).not.toBe(into.tabId);
    expect(await effective(replacement)).toMatchObject({
      note: "t".repeat(998) + "; " + "s".repeat(1000),
      scope: { partyId: into.partyId },
    });
  });
});
