import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { floorZones, kitchenStations, printJobs, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder, seedZone } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining, DiningPolicy } from "@waitron/shared";
import {
  createDepartment,
  departments,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import {
  cashPayment,
  inTx,
  provisionBillVenue,
  send,
  seatedWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { observedMoveBillBody, takeIntoParty } from "./testing/move-bill-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";
import { createPrinter } from "@waitron/printing";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { readKitchenLanguage } from "./kitchen-language.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { cancelLine } from "./testing/cancel-line.js";
import { takeawayRates } from "./testing/adjustment-venue.js";

// A bill keeps its way of selling wherever it moves (the owner, 2026-11-24).
let venue: BillVenue;
let counterZone: string;
let deli: string;
let deliTableZone: string;
let deliCounterZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counterZone = (
      await inTx(venue, (tx) => offerProducts(tx, { zone: "counter", paidWhen: "prepay" }))
    ).zoneId;
    await inTx(venue, async (tx) => {
      deli = (await createDepartment(tx, { name: "Deli", orderStart: "table" })).id;
      const tables = await seedZone(tx, { name: "Deli tables", departmentId: deli });
      const counter = await seedZone(tx, { name: "Deli counter", departmentId: deli });
      deliTableZone = (
        await offerProducts(tx, { zone: { zoneId: tables.id }, orderStart: "table" })
      ).zoneId;
      deliCounterZone = (
        await offerProducts(tx, {
          zone: { zoneId: counter.id },
          orderStart: "counter",
          paidWhen: "prepay",
        })
      ).zoneId;
    });
  },
});

async function departmentsSell(dining: DiningPolicy): Promise<void> {
  await inTx(venue, async (tx) => {
    for (const { id } of await tx.select({ id: departments.id }).from(departments))
      await setDepartmentSalePolicyField(tx, id, "dining", dining);
  });
}

beforeEach(() => departmentsSell("till_choice"));

function diningOf(id: string): Dining {
  return venue.db.all<{ dining: Dining }>(
    sql`select dining from working_orders where id = ${id}`,
  )[0]!.dining;
}

function setDining(id: string, dining: Dining): void {
  venue.db.run(sql`update working_orders set dining = ${dining} where id = ${id}`);
}

function revisionOf(partyId: string): number {
  return venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  )[0]!.revision;
}

function ticketItemCount(billId: string): number {
  return venue.db.all<{ n: number }>(
    sql`select count(*) as n from ticket_items where working_order_line_id in
        (select id from working_order_lines where working_order_id = ${billId})`,
  )[0]!.n;
}

async function post(path: string, body: unknown) {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    path,
    await observedMoveBillBody(venue.db, path, body),
  );
}

function moveTo(billId: string, tableId: string) {
  const own = venue.db.all<{ party_id: string | null }>(
    sql`select party_id from working_orders where id = ${billId}`,
  )[0]!.party_id;
  const holder = venue.db.all<{ party_id: string }>(
    sql`select party_id from party_tables where table_id = ${tableId} and left_at is null`,
  )[0]?.party_id;
  return post(`/api/bills/${billId}/move`, {
    to: { tableId },
    ...(own === null ? {} : { expectedPartyRevision: revisionOf(own) }),
    ...(holder === undefined
      ? {}
      : { otherPartyId: holder, expectedOtherPartyRevision: revisionOf(holder) }),
  });
}

async function departmentOf(zoneId: string): Promise<string> {
  const [zone] = await inTx(venue, (tx) =>
    tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, zoneId)),
  );
  return zone!.departmentId!;
}

describe("a bill moved within its own department keeps its way", () => {
  it("keeps a pay-first takeaway counter order takeaway when it moves to a seated table, which sends it", async () => {
    expect(await departmentOf(counterZone)).toBe(await departmentOf(venue.zoneId));
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Octopus"), quantity: "1" }],
      zoneId: counterZone,
      operatorId: venue.operatorId,
      dining: "takeaway",
    });
    const seated = await seatedWith(venue, "Croquettes");

    const moved = await moveTo(id, seated.tableId);

    expect(moved.status).toBe(200);
    expect(diningOf(id)).toBe("takeaway");
    expect(ticketItemCount(id)).toBeGreaterThan(0);
    const read = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}`);
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ dining: "takeaway", diningChoice: "locked" });
  });

  it("keeps a takeaway bill takeaway when the whole bill moves to another table", async () => {
    const seated = await seatedWith(venue);
    setDining(seated.tabId, "takeaway");
    const table = await inTx(venue, (tx) =>
      createTable(tx, {
        label: `Table ${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      }),
    );

    const moved = await moveTo(seated.tabId, table.id);

    expect(moved.status).toBe(200);
    expect(diningOf(seated.tabId)).toBe("takeaway");
  });

  it("keeps an unsent takeaway bill takeaway at the counter of its department, now selling eaten here", async () => {
    const seated = await seatedWith(venue);
    setDining(seated.tabId, "takeaway");
    await departmentsSell("eat_in");

    const moved = await post(`/api/bills/${seated.tabId}/move`, {
      to: { counter: { zoneId: counterZone } },
      partyId: seated.partyId,
      expectedPartyRevision: revisionOf(seated.partyId),
    });

    expect(moved.status).toBe(200);
    expect(diningOf(seated.tabId)).toBe("takeaway");
  });
});

describe("a bill moved into another department keeps its way", () => {
  const deliSells = (dining: DiningPolicy) =>
    inTx(venue, (tx) => setDepartmentSalePolicyField(tx, deli, "dining", dining));
  const deliTable = () =>
    inTx(venue, (tx) =>
      createTable(tx, { label: `Deli ${randomUUID().slice(0, 8)}`, zoneId: deliTableZone }),
    );

  async function counterOrder(dining: Dining): Promise<string> {
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Octopus"), quantity: "1" }],
      zoneId: counterZone,
      operatorId: venue.operatorId,
      dining,
    });
    return id;
  }

  function toDeliCounter(seated: { tabId: string; partyId: string }) {
    return post(`/api/bills/${seated.tabId}/move`, {
      to: { counter: { zoneId: deliCounterZone } },
      partyId: seated.partyId,
      expectedPartyRevision: revisionOf(seated.partyId),
    });
  }

  it("keeps an unsent eaten-in counter bill eaten in at a table of a takeaway-only department, and files the dine-in rate", async () => {
    await takeawayRates(venue, { Octopus: "21.00" });
    const id = await counterOrder("eat_in");
    await deliSells("takeaway");

    const moved = await post(`/api/bills/${id}/move`, {
      to: { tableId: (await deliTable()).id },
      partyId: null,
      otherPartyId: null,
      submissionId: randomUUID(),
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    });
    expect(moved.status).toBe(200);

    expect(diningOf(id)).toBe("eat_in");
    expect((await cashPayment(venue, venue.cookie, id, "100.00")).status).toBe(200);
    const filed = venue.db.all<{ vat_rate: number }>(
      sql`select sl.vat_rate from sale_lines sl join sales s on s.id = sl.sale_id
          where s.working_order_id = ${id}`,
    );
    expect(filed).toEqual([{ vat_rate: 1000 }]);
    const records = venue.db.all<{ desglose: string }>(
      sql`select r.desglose from verifactu_records r join sales s on s.id = r.sale_id
          where s.working_order_id = ${id}`,
    );
    expect(records).toHaveLength(1);
    const bands = JSON.parse(records[0]!.desglose) as { TipoImpositivo: string }[];
    expect(bands.map(({ TipoImpositivo }) => TipoImpositivo)).toEqual(["10.00"]);
  });

  it("keeps an unsent eaten-in table bill eaten in at the counter of a takeaway-only department", async () => {
    const seated = await seatedWith(venue);
    setDining(seated.tabId, "eat_in");
    await deliSells("takeaway");

    expect((await toDeliCounter(seated)).status).toBe(200);

    expect(diningOf(seated.tabId)).toBe("eat_in");
  });

  it("keeps an unsent takeaway table bill takeaway at the counter of an eaten-in-only department", async () => {
    const seated = await seatedWith(venue);
    setDining(seated.tabId, "takeaway");
    await deliSells("eat_in");

    expect((await toDeliCounter(seated)).status).toBe(200);

    expect(diningOf(seated.tabId)).toBe("takeaway");
  });
});

describe("a bill that takes a department for the first time", () => {
  it("keeps its way when it takes a department for the first time", async () => {
    const seated = await seatedWith(venue);
    await departmentsSell("takeaway");
    const order = await inTx(venue, (tx) =>
      seedWorkingOrder(tx, { orderNumber: 900_000 + Math.floor(Math.random() * 99_999) }),
    );
    expect(order.dining).toBe("eat_in");

    await inTx(venue, (tx) => takeIntoParty(tx, venue.cfg, order.id, seated.partyId, venue.zoneId));

    expect(diningOf(order.id)).toBe("eat_in");
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ partyId: workingOrders.partyId })
        .from(workingOrders)
        .where(eq(workingOrders.id, order.id)),
    );
    expect(row).toEqual({ partyId: seated.partyId });
  });
});

describe("the paper a move sends", () => {
  async function kitchenPrinters(): Promise<string[]> {
    return inTx(venue, async (tx) => {
      const ids: string[] = [];
      for (const { id } of await tx.select({ id: kitchenStations.id }).from(kitchenStations)) {
        await tx
          .update(kitchenStations)
          .set({ printMovedSlips: true })
          .where(eq(kitchenStations.id, id));
        const printer = await createPrinter(tx, {
          name: `Kitchen ${randomUUID().slice(0, 8)}`,
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        });
        await attachPrinterToStation(tx, { stationId: id, printerId: printer.id });
        ids.push(printer.id);
      }
      return ids;
    });
  }

  /** The printed lines of each job queued on `printerIds` since the last call, each job once. */
  async function paperSince(seen: Set<string>, printerIds: readonly string[]): Promise<string[][]> {
    const jobs = await inTx(venue, (tx) =>
      tx
        .select({ id: printJobs.id, printerId: printJobs.printerId, payload: printJobs.payload })
        .from(printJobs),
    );
    const fresh = jobs.filter((job) => !seen.has(job.id));
    for (const job of fresh) seen.add(job.id);
    return fresh
      .filter((job) => printerIds.includes(job.printerId))
      .map((job) => printedLines(job.payload));
  }

  async function allJobIds(): Promise<Set<string>> {
    const jobs = await inTx(venue, (tx) => tx.select({ id: printJobs.id }).from(printJobs));
    return new Set(jobs.map((job) => job.id));
  }

  // Fails if the ticket a takeaway counter order's move to a table sends, or that order's void
  // slip, drops the takeaway line.
  it("says take away for a takeaway counter order moved to a seated table, and on its void slip", async () => {
    const printerIds = await kitchenPrinters();
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Octopus"), quantity: "1" }],
      zoneId: counterZone,
      operatorId: venue.operatorId,
      dining: "takeaway",
    });
    const seated = await seatedWith(venue, "Croquettes");
    const seen = await allJobIds();

    expect((await moveTo(id, seated.tableId)).status).toBe(200);

    const words = kitchenTicketWords(await inTx(venue, (tx) => readKitchenLanguage(tx)));
    const tickets = await paperSince(seen, printerIds);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]![0]).toBe(`*** ${words.takeAway} ***`);

    await inTx(venue, (tx) => cancelLine(tx, venue.cfg, id, 1));
    const slips = await paperSince(seen, printerIds);
    expect(slips).toHaveLength(1);
    expect(slips[0]!.slice(0, 2)).toEqual([`*** ${words.void} ***`, `*** ${words.takeAway} ***`]);
  });

  // Fails if the MOVED slip of a takeaway bill whose dishes the kitchen has drops the takeaway
  // line.
  it("says take away on the MOVED slip of a sent takeaway bill moved to another table", async () => {
    const printerIds = await kitchenPrinters();
    await departmentsSell("takeaway");
    const seated = await seatedWith(venue, "Croquettes");
    expect(diningOf(seated.tabId)).toBe("takeaway");
    const table = await inTx(venue, (tx) =>
      createTable(tx, {
        label: `Table ${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      }),
    );
    const seen = await allJobIds();

    expect((await moveTo(seated.tabId, table.id)).status).toBe(200);

    const words = kitchenTicketWords(await inTx(venue, (tx) => readKitchenLanguage(tx)));
    const slips = await paperSince(seen, printerIds);
    expect(slips).toHaveLength(1);
    expect(slips[0]!.slice(0, 2)).toEqual([`*** ${words.moved} ***`, `*** ${words.takeAway} ***`]);
  });

  // Fails if the note-change slip of a takeaway bill whose dishes the kitchen has drops the
  // takeaway line.
  it("says take away on the note-change slip of a sent takeaway bill", async () => {
    const printerIds = await kitchenPrinters();
    await departmentsSell("takeaway");
    const seated = await seatedWith(venue, "Croquettes");
    const seen = await allJobIds();
    const note = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${seated.partyId}/kitchen-note`,
    );
    expect(note.status).toBe(200);

    const put = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/parties/${seated.partyId}/kitchen-note`,
      {
        submissionId: randomUUID(),
        expectedNoteRevision: note.json.revision,
        expectedPartyRevision: note.json.ownerRevision,
        note: "Train at 14:30",
      },
    );
    expect(put.status).toBe(200);

    const words = kitchenTicketWords(await inTx(venue, (tx) => readKitchenLanguage(tx)));
    const slips = await paperSince(seen, printerIds);
    expect(slips).toHaveLength(1);
    expect(slips[0]!.slice(0, 2)).toEqual([
      `*** ${words.noteChanged} ***`,
      `*** ${words.takeAway} ***`,
    ]);
  });
});
