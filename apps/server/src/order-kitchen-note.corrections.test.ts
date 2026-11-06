import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  kitchenStations,
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
import { kitchenNotices, listStationNotices, writeKitchenNote } from "@waitron/venue-service";
import { thousandthsToDecimal } from "@waitron/shared";
import {
  enqueueCorrectionSlips,
  enqueueOrderKitchenNoteChange,
  reprintOrderTickets,
} from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { createStation } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";

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
  nameParty,
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

it("A1378 prints and acknowledges one party note change across two bills", async () => {
  const output = await printer();
  const p = await sent();
  await order(v, p.tabId, "Burger");
  const second = await split(v, p.partyId, p.tabId, [2]);
  await nameParty(v, p.partyId, "Ana");
  const numbers = (
    await v.db
      .select({ number: workingOrders.orderNumber })
      .from(workingOrders)
      .where(inArray(workingOrders.id, [p.tabId, second]))
  )
    .map((row) => row.number)
    .sort((a, b) => a - b);
  const before = new Set((await v.db.select().from(printJobs)).map((job) => job.id));
  await set({ partyId: p.partyId }, "New time");
  const papers = (
    await v.db.select().from(printJobs).where(eq(printJobs.printerId, output))
  ).filter((job) => !before.has(job.id));
  expect(papers).toHaveLength(1);
  expect(printedLines(papers[0]!.payload)[3]).toBe(`Pedidos ${numbers.join(", ")} · Ana`);
  const notes = (await inTx(v, (tx) => listStationNotices(tx, stationId))).filter(
    (notice) => notice.orderNoteChange !== undefined,
  );
  expect(notes).toHaveLength(1);
  expect(notes[0]!.orderLabel).toBe(numbers.map((number) => `#${number}`).join(", "));
  expect(notes[0]!.orderNoteChange).toEqual({
    before: "Old time",
    after: "New time",
    partyId: p.partyId,
  });
  expect(notes[0]!.dishes).toEqual([
    expect.objectContaining({ lineName: "BURG", quantity: "2.000" }),
  ]);
  const rows = (await v.db.select().from(kitchenNotices)).filter(
    (row) => row.orderNoteChange !== null,
  );
  expect(rows.map((row) => row.workingOrderId).sort()).toEqual([p.tabId, second].sort());
  await inTx(v, (tx) => VENUE_SERVICE.acknowledgeKitchenNotice(tx, notes[0]!.id));
  expect(
    (await inTx(v, (tx) => listStationNotices(tx, stationId))).filter(
      (notice) => notice.orderNoteChange !== undefined,
    ),
  ).toEqual([]);
  expect(
    (await v.db.select().from(kitchenNotices))
      .filter((row) => rows.some((old) => old.id === row.id))
      .every((row) => row.acknowledgedAt !== null),
  ).toBe(true);
});

it("A1378 keeps same-name parties and independent counter note changes apart", async () => {
  await printer();
  const first = await sent();
  const second = await seat(v, await v.table("Table 2"));
  await nameParty(v, first.partyId, "Ana");
  await nameParty(v, second.partyId, "Ana");
  await order(v, second.tabId, "Burger");
  const counters = [await counterOrder(v, "Burger"), await counterOrder(v, "Burger")];
  for (const id of counters)
    await placeOrder(
      { db: v.db, backend: v.backend, clock: v.clock, admission: testTradingAdmission() },
      v.cfg,
      id,
      OPERATOR,
    );
  const ids = [first.tabId, second.tabId, ...counters];
  const before = new Set((await v.db.select().from(printJobs)).map((job) => job.id));
  await inTx(v, (tx) =>
    enqueueOrderKitchenNoteChange(tx, v.cfg, ids, { before: null, after: "Together" }),
  );
  expect((await v.db.select().from(printJobs)).filter((job) => !before.has(job.id))).toHaveLength(
    4,
  );
  const notes = (await inTx(v, (tx) => listStationNotices(tx, stationId))).filter(
    (notice) => notice.orderNoteChange !== undefined,
  );
  expect(notes).toHaveLength(4);
  expect(notes.map((notice) => notice.workingOrderId).sort()).toEqual(ids.sort());
});

it("A1378 lists only each printer's affected bills on a party note change", async () => {
  const shared = await printer();
  const bar = await inTx(v, async (tx) => {
    const station = await createStation(tx, { name: "Bar" });
    await routeProductTo(tx, v.productId("Paella"), station.id);
    const own = await createPrinter(tx, {
      name: "Bar only",
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, { stationId: station.id, printerId: shared });
    await attachPrinterToStation(tx, { stationId: station.id, printerId: own.id });
    return { id: station.id, printerId: own.id };
  });
  const p = await seat(v, await v.table("Table 3"));
  await order(v, p.tabId, "Burger", "Paella");
  const second = await split(v, p.partyId, p.tabId, [2]);
  const rows = await v.db
    .select({ id: workingOrders.id, number: workingOrders.orderNumber })
    .from(workingOrders)
    .where(inArray(workingOrders.id, [p.tabId, second]));
  const numbers = new Map(rows.map((row) => [row.id, String(row.number)]));
  const before = new Set((await v.db.select().from(printJobs)).map((job) => job.id));
  await set({ partyId: p.partyId }, "Together");
  const jobs = (await v.db.select().from(printJobs)).filter((job) => !before.has(job.id));
  expect(jobs).toHaveLength(2);
  expect(printedLines(jobs.find((job) => job.printerId === shared)!.payload)[3]).toBe(
    `Pedidos ${rows
      .map((row) => row.number)
      .sort((a, b) => a - b)
      .join(", ")}`,
  );
  expect(printedLines(jobs.find((job) => job.printerId === bar.printerId)!.payload)[3]).toBe(
    numbers.get(second),
  );
  expect(
    (await inTx(v, (tx) => listStationNotices(tx, stationId)))
      .filter((notice) => notice.orderNoteChange !== undefined)
      .map((notice) => notice.orderLabel),
  ).toEqual([`#${numbers.get(p.tabId)}`]);
  expect(
    (await inTx(v, (tx) => listStationNotices(tx, bar.id)))
      .filter((notice) => notice.orderNoteChange !== undefined)
      .map((notice) => notice.orderLabel),
  ).toEqual([`#${numbers.get(second)}`]);
});

beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  const [station] = await v.db.select({ id: kitchenStations.id }).from(kitchenStations);
  stationId = station!.id;
});
afterEach(() => vi.restoreAllMocks());

async function printer(paperWidth: "58mm" | "80mm" = "80mm") {
  return inTx(v, async (tx) => {
    const p = await createPrinter(tx, {
      name: "Kitchen",
      transport: "cloud_poll",
      pollId: randomUUID(),
      paperWidth,
    });
    await attachPrinterToStation(tx, { stationId, printerId: p.id });
    return p.id;
  });
}

function read(scope: KitchenNoteScope) {
  return inTx(v, async (tx) =>
    "partyId" in scope
      ? readPartyKitchenNote(tx, scope.partyId)
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
      const firstNotices = await inTx(v, (tx) => listStationNotices(tx, stationId));
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
      const allNotices = await inTx(v, (tx) => listStationNotices(tx, stationId));
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

  it.each(["served", "made-here", "collected"] as const)(
    "corrects only remaining service work: %s",
    async (kind) => {
      const p = await sent();
      await inTx(v, async (tx) => {
        if (kind === "served")
          await tx
            .update(workingOrderLines)
            .set({ servedAt: new Date().toISOString(), servedQuantity: 1000 })
            .where(eq(workingOrderLines.workingOrderId, p.tabId));
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

  it.each([
    ["partly served", 1000, 500, 1],
    ["cancelled remainder served", 500, 500, 0],
    ["fully cancelled", 0, 0, 0],
  ] as const)(
    "A773 no dispatch state: note correction follows remaining service quantity: %s",
    async (_kind, active, served, expected) => {
      await printer();
      const p = await sent();
      await inTx(v, async (tx) => {
        await tx
          .update(ticketItems)
          .set({ state: "ready", quantity: active })
          .where(eq(ticketItems.workingOrderId, p.tabId));
        await tx
          .update(workingOrderLines)
          .set({ servedQuantity: served })
          .where(eq(workingOrderLines.workingOrderId, p.tabId));
      });
      const beforeLines = await v.db.select().from(workingOrderLines);
      const beforeJobs = await v.db.select().from(printJobs);
      await expect(set({ partyId: p.partyId }, "Updated instructions")).resolves.toBeDefined();
      expect(await v.db.select().from(kitchenNotices)).toHaveLength(expected);
      const afterJobs = await v.db.select().from(printJobs);
      expect(afterJobs).toHaveLength(beforeJobs.length + expected);
      expect(afterJobs.slice(0, beforeJobs.length)).toEqual(beforeJobs);
      expect(await v.db.select().from(workingOrderLines)).toEqual(beforeLines);
    },
  );

  it.each(["unprinted", "removed"] as const)("does not correct a %s held group", async (kind) => {
    const p = await seat(v, await v.table("Held"));
    if (kind === "removed") {
      await printer();
      await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: true }));
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
    await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: true }));
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
    expect(printedLines(jobs.at(-1)!.payload)).toContain(`${kitchenTicketWords("es").group} 1`);
  });

  it("a changed order note corrects held paper only at a station recorded for the group, and every station's screen is told", async () => {
    const stations = await inTx(v, async (tx) => {
      const station = async (name: string, dish: string, withPrinter: boolean) => {
        const { id } = await createStation(tx, { name });
        await routeProductTo(tx, v.productId(dish), id);
        if (!withPrinter) return { id, printerId: null };
        const p = await createPrinter(tx, { name, transport: "cloud_poll", pollId: randomUUID() });
        await attachPrinterToStation(tx, {
          stationId: id,
          printerId: p.id,
        });
        return { id, printerId: p.id };
      };
      const kitchen = await station("Kitchen", "Burger", true);
      const bar = await station("Bar", "Paella", true);
      const screen = await station("Screen", "Flan", false);
      await setStationPrinting(tx, { printHeldWork: true }, [kitchen.id]);
      return { kitchen, bar, screen };
    });
    const p = await seat(v, await v.table("Held"));
    const dish = (name: string) => ({ menuItemId: v.item(name), quantity: "1" });
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        operatorId: OPERATOR,
        groups: [{ release: "hold", lines: [dish("Burger"), dish("Paella"), dish("Flan")] }],
      }),
    );
    const jobsAt = async (printerId: string) =>
      (await v.db.select().from(printJobs).where(eq(printJobs.printerId, printerId))).map((job) =>
        printedLines(job.payload),
      );
    expect(await jobsAt(stations.kitchen.printerId!)).toHaveLength(1);

    await set({ partyId: p.partyId }, "Bring together");

    const kitchenSlips = (await jobsAt(stations.kitchen.printerId!)).slice(1);
    expect(kitchenSlips).toHaveLength(1);
    expect(kitchenSlips[0]).toContain(`${kitchenTicketWords("es").group} 1`);
    expect(kitchenSlips[0]).toContain("Para cocina: Bring together");
    expect(await jobsAt(stations.bar.printerId!)).toEqual([]);
    const noticeAt = async (id: string) =>
      v.db
        .select({
          kind: kitchenNotices.kind,
          lineName: kitchenNotices.lineName,
          orderNoteChange: kitchenNotices.orderNoteChange,
        })
        .from(kitchenNotices)
        .where(eq(kitchenNotices.stationId, id));
    const change = { before: null, after: "Bring together" };
    expect(await noticeAt(stations.kitchen.id)).toEqual([
      { kind: "changed", lineName: "BURG", orderNoteChange: change },
    ]);
    expect(await noticeAt(stations.bar.id)).toEqual([
      { kind: "changed", lineName: "PAELLA", orderNoteChange: change },
    ]);
    expect(await noticeAt(stations.screen.id)).toEqual([
      { kind: "changed", lineName: "FLAN", orderNoteChange: change },
    ]);
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

it("gives a shared instruction one slip at the printer and one notice at the station for three dishes", async () => {
  await printer();
  const p = await sent();
  await order(v, p.tabId, "Burger");
  await order(v, p.tabId, "Burger");
  const before = await v.db.select().from(printJobs);
  const scope = { partyId: p.partyId };
  const starting = await read(scope);
  const submissionId = randomUUID();
  const saved = await set(scope, "New shared time", submissionId, starting);
  const notices = await inTx(v, (tx) => listStationNotices(tx, stationId));
  expect(notices).toHaveLength(1);
  expect(notices.map((notice) => notice.orderNoteChange)).toEqual([
    { before: "Old time", after: "New shared time" },
  ]);
  expect(await v.db.select().from(printJobs)).toHaveLength(before.length + 1);
  expect(notices[0]!.dishes).toEqual([
    expect.objectContaining({ lineName: "BURG", quantity: thousandthsToDecimal(3000) }),
  ]);
  const jobs = await v.db.select().from(printJobs);
  expect(printedLines(jobs.at(-1)!.payload).filter((line) => line === "3 x BURG")).toHaveLength(1);

  const rows = await v.db.select().from(kitchenNotices);
  expect(await set(scope, "New shared time", submissionId, starting)).toEqual(saved);
  expect(await v.db.select().from(kitchenNotices)).toHaveLength(rows.length);
  expect(await v.db.select().from(printJobs)).toEqual(jobs);

  await inTx(v, (tx) => VENUE_SERVICE.acknowledgeKitchenNotice(tx, notices[0]!.id));
  expect(await inTx(v, (tx) => listStationNotices(tx, stationId))).toEqual([]);
  const acknowledged = await v.db.select().from(kitchenNotices);
  expect(acknowledged).toHaveLength(3);
  expect(acknowledged.every((row) => row.acknowledgedAt !== null)).toBe(true);
});

it("A807 prints one slip per printer for stations that share one", async () => {
  const s = await inTx(v, async (tx) => {
    const newPrinter = async (name: string, paperWidth: "58mm" | "80mm") =>
      (await createPrinter(tx, { name, transport: "cloud_poll", pollId: randomUUID(), paperWidth }))
        .id;
    const shared = await newPrinter("P", "80mm");
    const own = await newPrinter("Q", "58mm");
    const station = async (name: string, dish: string, printerId: string) => {
      const { id } = await createStation(tx, { name });
      await routeProductTo(tx, v.productId(dish), id);
      await attachPrinterToStation(tx, { stationId: id, printerId });
      return id;
    };
    return {
      shared,
      own,
      grill: await station("Grill", "Burger", shared),
      pastry: await station("Pastry", "Flan", shared),
      bar: await station("Bar", "Paella", own),
    };
  });
  const p = await seat(v, await v.table("Table 1"));
  await inTx(v, (tx) => writeKitchenNote(tx, { partyId: p.partyId }, 0, "Old time"));
  // Flan is ordered first, so the slip names Grill first only because stations print in name order.
  await order(v, p.tabId, "Flan", "Burger", "Burger", "Paella");
  const jobsAt = async (printerId: string) =>
    (await v.db.select().from(printJobs).where(eq(printJobs.printerId, printerId))).map((job) =>
      printedLines(job.payload),
    );
  const before = { shared: (await jobsAt(s.shared)).length, own: (await jobsAt(s.own)).length };

  await set({ partyId: p.partyId }, "New time");

  const shared = (await jobsAt(s.shared)).slice(before.shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]!.slice(0, 2)).toEqual(["*** NOTA PARA COCINA CAMBIADA ***", "Grill · Pastry"]);
  expect(shared[0]!.slice(-5)).toEqual(["Grill", "2 x BURG", "Pastry", "1 x FLAN", ""]);
  const own = (await jobsAt(s.own)).slice(before.own);
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("1 x PAELLA");
  const dishes = async (id: string) =>
    (await inTx(v, (tx) => listStationNotices(tx, id))).map((notice) =>
      notice.dishes?.map((dish) => dish.lineName),
    );
  expect(await dishes(s.grill)).toEqual([["BURG"]]);
  const [grill] = await inTx(v, (tx) => listStationNotices(tx, s.grill));
  expect(grill!.dishes![0]!.quantity).toEqual(thousandthsToDecimal(2000));
  expect(await dishes(s.pastry)).toEqual([["FLAN"]]);
  expect(await dishes(s.bar)).toEqual([["PAELLA"]]);
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
