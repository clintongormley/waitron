import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  kitchenStations,
  locations,
  orderGroups,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { KitchenNoteScope, KitchenNoteSnapshot } from "@waitron/module";
import { createPrinter } from "@waitron/printing";
import {
  kitchenNotices,
  listStationNotices,
  writeKitchenNote,
  writePrintHeldWork,
} from "@waitron/venue-service";
import { locationId } from "@waitron/shared";
import {
  enqueueCorrectionSlips,
  enqueueOrderKitchenNoteChange,
  reprintOrderTickets,
} from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveBill } from "./testing/move-bill-fixture.js";

import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  readOrderKitchenNotes,
  readPartyKitchenNote,
  setOrderKitchenNote,
} from "./order-kitchen-note.js";
import { attachPrinterToStation } from "./station-printers.js";
import { joinTables } from "./testing/table-action-fixture.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  commandFor,
  counterOrder,
  inTx,
  OPERATOR,
  order,
  pay,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let stationId: string;

beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  const [station] = await v.db.select({ id: kitchenStations.id }).from(kitchenStations);
  stationId = station!.id;
});
afterEach(() => vi.restoreAllMocks());

async function printer(paperWidth: "58mm" | "80mm" = "80mm") {
  return inTx(v, async (tx) => {
    const p = await createPrinter(
      tx,
      { locationId: v.cfg.locationId },
      { name: "Kitchen", transport: "cloud_poll", pollId: randomUUID(), paperWidth },
    );
    await attachPrinterToStation(tx, { locationId: v.cfg.locationId, stationId, printerId: p.id });
    return p.id;
  });
}

function read(scope: KitchenNoteScope) {
  return inTx(v, async (tx) =>
    "partyId" in scope
      ? readPartyKitchenNote(tx, v.cfg, scope.partyId)
      : (await readOrderKitchenNotes(tx, [scope.workingOrderId])).get(scope.workingOrderId)!,
  );
}

async function set(
  scope: KitchenNoteScope,
  note: string | null,
  submissionId = randomUUID(),
  before?: KitchenNoteSnapshot,
) {
  const current = before ?? (await read(scope));
  return inTx(v, (tx) =>
    setOrderKitchenNote(tx, v.db, v.cfg, scope, {
      submissionId,
      expectedNoteRevision: current.revision,
      expectedOwnerRevision: current.ownerRevision,
      note,
      operatorId: OPERATOR,
      deviceId: v.cfg.origin.deviceId!,
    }),
  );
}

async function sent() {
  const tableId = await v.table("Table 1");
  const p = await seat(v, tableId);
  await inTx(v, (tx) => writeKitchenNote(tx, { partyId: p.partyId }, 0, "Old time"));
  await order(v, p.tabId, "Burger");
  return { ...p, tableId };
}

describe("saved kitchen note corrections", () => {
  it.each(["58mm", "80mm"] as const)(
    "queues an edit and a removal on %s, retaining old bytes, old notices and the line note",
    async (width) => {
      await printer(width);
      const p = await sent();
      await inTx(v, (tx) =>
        tx
          .update(workingOrderLines)
          .set({ note: "No onions" })
          .where(eq(workingOrderLines.workingOrderId, p.tabId)),
      );
      const original = await v.db.select().from(printJobs);
      const scope = { partyId: p.partyId };
      const before = await read(scope);
      const submissionId = randomUUID();
      const saved = await set(scope, "New time", submissionId, before);
      const firstNotices = await inTx(v, (tx) => listStationNotices(tx, v.cfg, stationId));
      expect(firstNotices).toHaveLength(1);
      expect(firstNotices[0]).toMatchObject({
        kind: "changed",
        lineName: "BURG",
        note: "No onions",
        orderNoteChange: { before: "Old time", after: "New time" },
      });
      const firstJobs = await v.db.select().from(printJobs);
      expect(firstJobs).toHaveLength(original.length + 1);
      expect(printedLines(firstJobs.at(-1)!.payload)).toContain("Para cocina: New time");
      expect(await set(scope, "New time", submissionId, before)).toEqual(saved);
      expect(await v.db.select().from(printJobs)).toEqual(firstJobs);
      await set(scope, null);
      const allNotices = await inTx(v, (tx) => listStationNotices(tx, v.cfg, stationId));
      expect(allNotices).toHaveLength(2);
      expect(allNotices[0]).toEqual(firstNotices[0]);
      expect(allNotices[1]).toMatchObject({
        note: "No onions",
        orderNoteChange: { before: "New time", after: null },
      });
      const allJobs = await v.db.select().from(printJobs);
      expect(allJobs).toHaveLength(original.length + 2);
      expect(allJobs.slice(0, firstJobs.length)).toEqual(firstJobs);
      expect(printedLines(allJobs.at(-1)!.payload)).toContain("Nota para cocina eliminada");
    },
  );

  it("records a notice without a printer and sends nothing for an equal saved value", async () => {
    const p = await sent();
    const scope = { partyId: p.partyId };
    const before = await read(scope);
    expect(await set(scope, "Old time")).toEqual(before);
    expect(await v.db.select().from(kitchenNotices)).toEqual([]);
    await set(scope, "New time");
    expect(await v.db.select().from(kitchenNotices)).toHaveLength(1);
    expect(await v.db.select().from(printJobs)).toEqual([]);
  });

  it.each(["served", "away", "made-here", "collected"] as const)(
    "does not correct %s work",
    async (kind) => {
      const p = await sent();
      await inTx(v, async (tx) => {
        if (kind === "served")
          await tx
            .update(workingOrderLines)
            .set({ servedAt: new Date().toISOString(), servedQuantity: 1000 })
            .where(eq(workingOrderLines.workingOrderId, p.tabId));
        if (kind === "away")
          await tx
            .update(ticketItems)
            .set({ awayAt: new Date().toISOString() })
            .where(eq(ticketItems.workingOrderId, p.tabId));
        if (kind === "made-here")
          await tx
            .update(ticketItems)
            .set({ madeHere: true })
            .where(eq(ticketItems.workingOrderId, p.tabId));
      });
      if (kind === "collected") {
        await pay(v, p.tabId, "12.00");
        await inTx(v, (tx) =>
          tx
            .update(workingOrders)
            .set({ collectedAt: new Date().toISOString() })
            .where(eq(workingOrders.id, p.tabId)),
        );
      }
      await set({ partyId: p.partyId }, "New time");
      expect(await v.db.select().from(kitchenNotices)).toEqual([]);
    },
  );

  it.each(["unprinted", "removed"] as const)("does not correct a %s held group", async (kind) => {
    const p = await seat(v, await v.table("Held"));
    if (kind === "removed") {
      await printer();
      await inTx(v, (tx) => writePrintHeldWork(tx, true));
    }
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        operatorId: OPERATOR,
        groups: [{ release: "hold", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
      }),
    );
    if (kind === "removed") await inTx(v, (tx) => tx.update(orderGroups).set({ state: "removed" }));
    const jobs = await v.db.select().from(printJobs);
    await set({ partyId: p.partyId }, "New time");
    expect(await v.db.select().from(kitchenNotices)).toEqual([]);
    expect(await v.db.select().from(printJobs)).toEqual(jobs);
  });

  it("corrects still-held groups only after their HOLD ticket has been queued", async () => {
    await printer();
    await inTx(v, (tx) => writePrintHeldWork(tx, true));
    const p = await seat(v, await v.table("Held"));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        operatorId: OPERATOR,
        groups: [{ release: "hold", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
      }),
    );
    const groups = await v.db.select().from(orderGroups);
    expect(groups[0]!.holdPrintedAt).not.toBeNull();
    await set({ partyId: p.partyId }, "Bring together");
    const notices = await v.db.select().from(kitchenNotices);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: "changed",
      orderNoteChange: { before: null, after: "Bring together" },
    });
    const jobs = await v.db.select().from(printJobs);
    expect(printedLines(jobs.at(-1)!.payload)).toContain("GROUP 1");
  });

  it("rolls back note and owner revision when recording a kitchen correction fails", async () => {
    const p = await sent();
    const scope = { partyId: p.partyId };
    const before = await read(scope);
    vi.spyOn(VENUE_SERVICE, "recordKitchenNotices").mockRejectedValueOnce(
      new Error("correction failed"),
    );
    await expect(set(scope, "New time")).rejects.toThrow("correction failed");
    expect(await read(scope)).toEqual(before);
    expect(await v.db.select().from(kitchenNotices)).toEqual([]);
    expect(await v.db.select().from(printJobs)).toEqual([]);
  });
});

describe("effective kitchen headings", () => {
  it("includes the current heading on ordinary corrections and a MOVED slip", async () => {
    await printer();
    const p = await sent();
    const [item] = await v.db.select().from(ticketItems);
    await inTx(v, (tx) =>
      enqueueCorrectionSlips(
        tx,
        v.cfg,
        p.tabId,
        [
          {
            workingOrderLineId: item!.workingOrderLineId,
            stationId: item!.stationId,
            quantity: 1000,
            wasStarted: false,
          },
        ],
        "RECALLED",
      ),
    );
    const correction = (await v.db.select().from(printJobs)).at(-1)!;
    expect(printedLines(correction.payload)).toContain("Para cocina: Old time");
    const expectedPartyRevision = await revisionOf(v, p.partyId);
    const to = await v.table("Moved destination");
    await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        p.tabId,
        { tableId: to },
        {
          expectedPartyRevision,
          operatorId: OPERATOR,
          partyId: p.partyId,
          otherPartyId: null,
          bills: "separate",
        },
      ),
    );
    const moved = (await v.db.select().from(printJobs)).at(-1)!;
    const lines = printedLines(moved.payload);
    expect(lines).toContain("*** MOVIDO ***");
    expect(lines).toContain("Para cocina: Old time");
  });

  it("corrects the source and destination work when their parties combine", async () => {
    const source = await sent();
    const target = await seat(v, await v.table("Destination"));
    await inTx(v, (tx) =>
      writeKitchenNote(tx, { partyId: target.partyId }, 0, "Target instruction"),
    );
    await order(v, target.tabId, "Flan");
    const command = await commandFor(v, target.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, source.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, target.partyId, source.tableId, {
        ...command,
        otherPartyId: source.partyId,
        expectedOtherPartyRevision,
        bills: "separate",
      }),
    );
    const changed = (await v.db.select().from(kitchenNotices)).filter(
      (notice) => notice.orderNoteChange !== null,
    );
    expect(changed).toHaveLength(2);
    expect(changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workingOrderId: source.tabId,
          orderNoteChange: { before: "Old time", after: "Target instruction; Old time" },
        }),
        expect.objectContaining({
          workingOrderId: target.tabId,
          orderNoteChange: { before: "Target instruction", after: "Target instruction; Old time" },
        }),
      ]),
    );
  });

  it("prints a saved heading on the first ticket and its latest value on reprint", async () => {
    await printer();
    const p = await sent();
    const first = (await v.db.select().from(printJobs))[0]!;
    expect(printedLines(first.payload)).toContain("Para cocina: Old time");
    await set({ partyId: p.partyId }, "New time");
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, p.tabId));
    const jobs = await v.db.select().from(printJobs);
    expect(printedLines(jobs.at(-1)!.payload)).toContain("Para cocina: New time");
    expect((await v.db.select().from(printJobs))[0]).toEqual(first);
  });

  it("adopts a counter note before moving to a table fires its unsent food", async () => {
    await printer();
    const id = await counterOrder(v, "Burger");
    await inTx(v, (tx) => writeKitchenNote(tx, { workingOrderId: id }, 0, "Send together"));
    const tableId = await v.table("Arriving");
    await inTx(v, (tx) =>
      moveBill(
        tx,
        v.cfg,
        id,
        { tableId },
        {
          operatorId: OPERATOR,
          bills: "separate",
          partyId: null,
          otherPartyId: null,
          submissionId: randomUUID(),
          allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        },
      ),
    );
    const jobs = await v.db.select().from(printJobs);
    expect(jobs.length).toBeGreaterThan(0);
    expect(printedLines(jobs[0]!.payload)).toContain("Para cocina: Send together");
  });

  it("corrects a retained paid bill when its combined party's shared note changes", async () => {
    const p = await sent();
    await order(v, p.tabId, "Flan");
    const paidBill = await split(v, p.partyId, p.tabId, [2]);
    await pay(v, paidBill, "5.00");
    const targetTable = await v.table("Survivor");
    const target = await seat(v, targetTable);
    const command = await commandFor(v, target.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, p.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, target.partyId, p.tableId, {
        ...command,
        otherPartyId: p.partyId,
        expectedOtherPartyRevision,
        bills: "separate",
      }),
    );
    await set({ partyId: target.partyId }, "New time");
    const notices = await v.db.select().from(kitchenNotices);
    expect(
      notices.some(
        (notice) =>
          notice.workingOrderId === paidBill && notice.orderNoteChange?.after === "New time",
      ),
    ).toBe(true);
  });
});

it("uses the existing per-dish acknowledgement and correction paper for a shared instruction", async () => {
  await printer();
  const p = await sent();
  await order(v, p.tabId, "Burger");
  await order(v, p.tabId, "Burger");
  const before = await v.db.select().from(printJobs);
  await set({ partyId: p.partyId }, "New shared time");
  const notices = await inTx(v, (tx) => listStationNotices(tx, v.cfg, stationId));
  expect(notices).toHaveLength(3);
  expect(notices.map((notice) => notice.orderNoteChange)).toEqual([
    { before: "Old time", after: "New shared time" },
    { before: "Old time", after: "New shared time" },
    { before: "Old time", after: "New shared time" },
  ]);
  expect(await v.db.select().from(printJobs)).toHaveLength(before.length + 3);
});

it("does not correct retained work on an abandoned bill", async () => {
  await printer();
  const p = await sent();
  await inTx(v, (tx) =>
    tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, p.tabId)),
  );
  const before = await v.db.select().from(printJobs);
  await inTx(v, (tx) =>
    enqueueOrderKitchenNoteChange(tx, v.cfg, [p.tabId], { before: "Old time", after: "New time" }),
  );
  expect(await v.db.select().from(kitchenNotices)).toEqual([]);
  expect(await v.db.select().from(printJobs)).toEqual(before);
});

it("does not correct a different location's work when the supplied order ids cross the boundary", async () => {
  await printer();
  const p = await sent();
  const [other] = await inTx(v, (tx) =>
    tx
      .insert(locations)
      .values({
        name: "Other restaurant",
        invoiceLocales: ["en-GB"],
        operationDescription: "Restaurant",
      })
      .returning(),
  );
  const before = await v.db.select().from(printJobs);
  await inTx(v, (tx) =>
    enqueueOrderKitchenNoteChange(tx, { ...v.cfg, locationId: locationId(other!.id) }, [p.tabId], {
      before: "Old time",
      after: "New time",
    }),
  );
  expect(await v.db.select().from(kitchenNotices)).toEqual([]);
  expect(await v.db.select().from(printJobs)).toEqual(before);
});
