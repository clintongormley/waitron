import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  lineServiceCancellations,
  deviceMadeHereStations,
  orderGroups,
  orderAmendments,
  parties,
  partyTables,
  printJobs,
  printAgents,
  saleSettlements,
  sales,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { adjustments, adjustmentReasons, deleteAdjustmentReason } from "@waitron/adjustments";
import { createPrinter, runAgentOnce } from "@waitron/printing";
import { NetworkTcpTransport } from "@waitron/print-agent";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { mountTillApi } from "./till-api.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { attendanceOperationFacts } from "@waitron/workforce";
import {
  markServed,
  markOrderPlaced,
  listStationQueue,
  advanceTicketItem,
  handOverOrder,
} from "./working-order.js";
import { requestBill } from "./bill-request.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { fireGroup, fireHeldLine } from "./order-groups.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { cancelItem } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { readBillEditState } from "./bill-editing.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { readScopedPassBoard } from "./pass-board.js";
import { boardOrderIds, EVERY } from "./testing/pass-board-probe.js";
import { computeOverdueOrders } from "@waitron/reporting";
import { attachPrinterToStation } from "./station-printers.js";
import { replaceStationPrinters } from "./station-printers.js";
import { freePorts } from "./testing/free-ports.js";
import {
  closingEditsForTest,
  readBillsOfParties,
  billOwes,
} from "./testing/party-close-fixture.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
let extraStation: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    const app = new Hono();
    mountTillApi(
      app,
      {
        admission: testTradingAdmission(),
        db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: venue.venueLocale,
        attendance: recordAttendanceFact,
      },
      () => {},
    );
    venue.app = app;
    extraStation = await inTx(venue, async (tx) => {
      const station = await createStation(tx, { name: "Extra preparation" });
      await attachPrinterToStation(tx, { stationId: station.id, printerId: venue.printerId });
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: venue.olivesId }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
      return station.id;
    });
  },
});

async function depart(partyId: string, billId?: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  const response = await venue.app.request(`/api/parties/${partyId}/unpaid-departure`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: venue.cookie.manager },
    body: JSON.stringify({
      billId:
        billId ??
        (await readBillsOfParties(venue.db, [partyId])).get(partyId)!.find(billOwes)
          ?.workingOrderId,
      expectedPartyRevision: party!.revision,
      expectedEdits: await inTx(venue, (tx) => closingEditsForTest(tx, partyId)),
      reason: "Guests left without paying",
    }),
  });
  return { status: response.status, body: await response.json() };
}

async function jobs() {
  return venue.db.select().from(printJobs);
}

async function pay(billId: string, amount: string) {
  await payWorkingOrder(
    { admission: testTradingAdmission(), db: venue.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    { id: billId, tender: { method: "cash", amount }, lines: [] },
    venue.staffId,
  );
}

async function joinOwing(partyId: string) {
  const owing = await billWith(venue, [{ name: "Burger" }]);
  await inTx(venue, (tx) =>
    combineParties(tx, venue.cfg, {
      from: owing.partyId,
      into: partyId,
      tables: "join",
      operatorId: venue.staffId,
    }),
  );
  return owing;
}

async function serve(partyId: string, lineId: string, quantity: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  await inTx(venue, (tx) =>
    markServed(tx, venue.cfg, partyId, [{ lineId, quantity }], {
      expectedPartyRevision: party!.revision,
      submissionId: randomUUID(),
      operatorId: venue.staffId,
    }),
  );
}

async function cancellations(lineId: string) {
  return venue.db
    .select()
    .from(lineServiceCancellations)
    .where(eq(lineServiceCancellations.lineId, lineId));
}

async function linesOf(billId: string) {
  return venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}

describe("unpaid departure stops kitchen work", () => {
  it("keeps stopped work stopped when its debt moves to another open table and is collected", async () => {
    const order = await billWith(venue, [{ name: "Burger" }]);
    await joinOwing(order.partyId);
    const destination = await billWith(venue, [{ name: "Burger" }]);
    expect(await depart(order.partyId, order.billId)).toMatchObject({
      status: 200,
      body: { state: "open" },
    });
    const [membership] = await venue.db
      .select()
      .from(partyTables)
      .where(eq(partyTables.partyId, destination.partyId));
    const [from] = await venue.db.select().from(parties).where(eq(parties.id, order.partyId));
    const [into] = await venue.db.select().from(parties).where(eq(parties.id, destination.partyId));
    const beforeJobs = await jobs();
    const beforeCancellations = await cancellations((await linesOf(order.billId))[0]!.id);
    const beforeBill = (
      await venue.db.select().from(workingOrders).where(eq(workingOrders.id, order.billId))
    )[0]!;
    await inTx(venue, (tx) =>
      moveBill(
        tx,
        venue.cfg,
        order.billId,
        { tableId: membership!.tableId },
        {
          expectedPartyRevision: from!.revision,
          otherPartyId: destination.partyId,
          expectedOtherPartyRevision: into!.revision,
          operatorId: venue.managerId,
        },
      ),
    );
    expect(await cancellations((await linesOf(order.billId))[0]!.id)).toEqual(beforeCancellations);
    expect(
      (await venue.db.select().from(workingOrders).where(eq(workingOrders.id, order.billId)))[0],
    ).toMatchObject({ partyId: destination.partyId, collectedAt: beforeBill.collectedAt });
    expect(await jobs()).toEqual(beforeJobs);
    const response = await venue.app.request(`/api/working-orders/${order.billId}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venue.cookie.manager },
      body: JSON.stringify({
        tender: { method: "cash", amount: "12.00" },
        expectedEdit: await readBillEditState(venue.db, order.billId),
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, order.billId)),
    ).toEqual([]);
    expect(await cancellations((await linesOf(order.billId))[0]!.id)).toEqual(beforeCancellations);
  });

  it("does not offer or release a departed bill’s held food while another bill stays open", async () => {
    const order = await billWith(venue, [{ name: "Burger" }], {
      shape: "grouped",
      release: "hold",
    });
    await issueOrderInvoice(
      { ...venue, admission: testTradingAdmission() },
      venue.cfg,
      order.billId,
      venue.staffId,
    );
    await inTx(venue, (tx) =>
      markOrderPlaced(tx, venue.clock, venue.cfg, order.billId, venue.staffId),
    );
    await joinOwing(order.partyId);
    expect(await depart(order.partyId, order.billId)).toMatchObject({
      status: 200,
      body: { state: "open" },
    });
    const floor = await venue.app.request("/api/tables/state", {
      headers: { cookie: venue.cookie.manager },
    });
    const tables = (await floor.json()) as {
      party: { id: string; reminder: unknown } | null;
      pendingToServe: number;
      signals: { kind: string }[];
    }[];
    const shown = tables.find((table) => table.party?.id === order.partyId)!;
    expect(shown.pendingToServe).toBe(1);
    expect(shown.signals).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "held" })]),
    );
    expect(shown.party!.reminder).toBeNull();
    const beforeJobs = await jobs();
    const [group] = await venue.db
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.partyId, order.partyId));
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, order.partyId));
    const lineId = (await linesOf(order.billId))[0]!.id;
    await expect(
      inTx(venue, (tx) =>
        fireHeldLine(tx, venue.cfg, order.partyId, lineId, {
          expectedPartyRevision: party!.revision,
          submissionId: randomUUID(),
          operatorId: venue.staffId,
        }),
      ),
    ).rejects.toMatchObject({ code: "tab.not_open" });
    await expect(
      inTx(venue, (tx) =>
        fireGroup(tx, venue.cfg, order.partyId, group!.id, {
          expectedPartyRevision: party!.revision,
          submissionId: randomUUID(),
          operatorId: venue.staffId,
        }),
      ),
    ).rejects.toMatchObject({ code: "management.request_invalid" });
    expect(await jobs()).toEqual(beforeJobs);
  });

  it("refuses foreign and repeated selections without changing invoices or kitchen work", async () => {
    const own = await billWith(venue, [{ name: "Burger" }]);
    const other = await billWith(venue, [{ name: "Burger" }]);
    await joinOwing(own.partyId);
    const beforeJobs = await jobs();
    expect(await depart(own.partyId, other.billId)).toMatchObject({
      status: 409,
      body: { error: { code: "unpaid_departure.nothing_outstanding" } },
    });
    expect(await venue.db.select().from(sales).where(eq(sales.workingOrderId, own.billId))).toEqual(
      [],
    );
    expect(await cancellations((await linesOf(own.billId))[0]!.id)).toEqual([]);
    expect(await jobs()).toEqual(beforeJobs);
    expect(await depart(own.partyId, own.billId)).toMatchObject({
      status: 200,
      body: { state: "open" },
    });
    const recordedJobs = await jobs();
    const recordedSales = await venue.db
      .select()
      .from(sales)
      .where(eq(sales.workingOrderId, own.billId));
    expect(await depart(own.partyId, own.billId)).toMatchObject({
      status: 409,
      body: { error: { code: "unpaid_departure.nothing_outstanding" } },
    });
    expect(await jobs()).toEqual(recordedJobs);
    expect(await venue.db.select().from(sales).where(eq(sales.workingOrderId, own.billId))).toEqual(
      recordedSales,
    );
  });

  it("marks only the selected debt and keeps paid food and another debt on the table", async () => {
    const paid = await billWith(venue, [{ name: "Burger" }]);
    await pay(paid.billId, "12.00");
    const first = await joinOwing(paid.partyId);
    const second = await joinOwing(paid.partyId);
    const [paidBefore] = await venue.db
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.id, paid.billId));
    const paidTickets = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, paid.billId));
    const beforeJobs = await jobs();

    expect(await depart(paid.partyId, first.billId)).toMatchObject({
      status: 200,
      body: {
        state: "open",
        departures: [expect.objectContaining({ workingOrderId: first.billId, amount: "12.00" })],
      },
    });
    expect(
      await venue.db.select().from(workingOrders).where(eq(workingOrders.id, paid.billId)),
    ).toEqual([paidBefore]);
    expect(
      await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, paid.billId)),
    ).toEqual(paidTickets);
    expect(await cancellations((await linesOf(paid.billId))[0]!.id)).toEqual([]);
    expect(await cancellations((await linesOf(second.billId))[0]!.id)).toEqual([]);
    expect(
      await venue.db.select().from(sales).where(eq(sales.workingOrderId, second.billId)),
    ).toEqual([]);
    const newJobs = (await jobs()).filter(
      (job) => !beforeJobs.some((prior) => prior.id === job.id),
    );
    expect(newJobs).toHaveLength(1);
    expect(
      (await venue.db.select().from(workingOrders).where(eq(workingOrders.id, first.billId)))[0]!
        .collectedAt,
    ).not.toBeNull();
    const bills = await venue.app.request(`/api/parties/${paid.partyId}/bills`, {
      headers: { cookie: venue.cookie.manager },
    });
    expect(bills.status).toBe(200);
    expect(await bills.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workingOrderId: first.billId, leftUnpaid: true }),
        expect.objectContaining({ workingOrderId: second.billId, leftUnpaid: false }),
      ]),
    );
    const floor = await venue.app.request("/api/tables/state", {
      headers: { cookie: venue.cookie.manager },
    });
    const tables = (await floor.json()) as {
      party: { id: string; outstanding: string; openingBillId: string } | null;
    }[];
    expect(tables.find((table) => table.party?.id === paid.partyId)!.party).toMatchObject({
      outstanding: "12.00",
      openingBillId: second.billId,
    });
    const [requested] = await venue.db.select().from(parties).where(eq(parties.id, paid.partyId));
    await inTx(venue, (tx) =>
      requestBill(tx, paid.partyId, true, {
        expectedPartyRevision: requested!.revision,
        submissionId: randomUUID(),
        operatorId: venue.managerId,
      }),
    );
    expect(await depart(paid.partyId, second.billId)).toMatchObject({
      status: 200,
      body: { state: "open" },
    });
    expect(
      (await venue.db.select().from(parties).where(eq(parties.id, paid.partyId)))[0]!
        .billRequestedAt,
    ).toBeNull();
    await serve(paid.partyId, (await linesOf(paid.billId))[0]!.id, "1");
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, paid.partyId));
    const finished = await venue.app.request(`/api/parties/${paid.partyId}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venue.cookie.manager },
      body: JSON.stringify({
        expectedPartyRevision: party!.revision,
        expectedEdits: await closingEditsForTest(venue.db, paid.partyId),
      }),
    });
    expect(finished.status, await finished.clone().text()).toBe(200);
    expect(await finished.json()).toEqual({ state: "closed" });
  });

  it("needs no Not served adjustment reason and records no adjustment", async () => {
    const reasons = await venue.db.select().from(adjustmentReasons);
    for (const reason of reasons.filter((row) => row.name === "Not served"))
      await inTx(venue, (tx) => deleteAdjustmentReason(tx, reason.id));
    expect(
      (await venue.db.select().from(adjustmentReasons)).filter((row) => row.name === "Not served"),
    ).toEqual([]);
    const order = await billWith(venue, [{ name: "Burger" }]);
    expect(await depart(order.partyId)).toMatchObject({ status: 200 });
    expect(await cancellations((await linesOf(order.billId))[0]!.id)).toEqual([
      expect.objectContaining({ quantity: 1000 }),
    ]);
    expect(
      await venue.db.select().from(adjustments).where(eq(adjustments.workingOrderId, order.billId)),
    ).toEqual([]);
  });

  it("delivers the actual departure cancellation slip through a TCP printer", async () => {
    const order = await billWith(venue, [{ name: "Burger" }]);
    const [port] = await freePorts(1);
    let receive!: (bytes: Buffer) => void;
    let receiveFailure!: (error: Error) => void;
    const received = new Promise<Buffer>((resolve, reject) => {
      receive = resolve;
      receiveFailure = reject;
    });
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      const chunks: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.once("end", () => receive(Buffer.concat(chunks)));
      socket.once("error", receiveFailure);
      socket.once("close", () => sockets.delete(socket));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port!, "127.0.0.1", resolve);
      });
      const { printerId, agentId } = await inTx(venue, async (tx) => {
        const printer = await createPrinter(tx, {
          name: "Departure TCP sink",
          transport: "network_tcp",
          host: "127.0.0.1",
          port: port!,
        });
        const [agent] = await tx
          .insert(printAgents)
          .values({
            name: "Departure worker",
            tokenHash: "unused-for-local-runtime",
          })
          .returning({ id: printAgents.id });
        await replaceStationPrinters(tx, venue.stationId, [printer.id]);
        return { printerId: printer.id, agentId: agent!.id };
      });
      expect(await depart(order.partyId)).toMatchObject({ status: 200 });
      const [job] = await venue.db
        .select()
        .from(printJobs)
        .where(eq(printJobs.printerId, printerId));
      expect(job).toBeDefined();
      expect(decodeTicket(job!.payload)).toContain("1 x BURG");
      expect(
        await inTx(venue, (tx) =>
          runAgentOnce({
            tx,
            agentId,
            visibleKeys: [],
            transport: new NetworkTcpTransport({ timeoutMs: 2000 }),
          }),
        ),
      ).toEqual({ claimed: 1, delivered: 1, failed: 0 });
      expect(await received).toEqual(Buffer.from(job!.payload));
      expect(
        (await venue.db.select().from(printJobs).where(eq(printJobs.id, job!.id)))[0],
      ).toMatchObject({ status: "done", claimedBy: agentId });
    } finally {
      await inTx(venue, (tx) => replaceStationPrinters(tx, venue.stationId, [venue.printerId]));
      for (const socket of sockets) socket.destroy();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    }
  });

  it.each(["held", "requested"])(
    "leaves %s families and their printed HOLD paper unchanged",
    async (stage) => {
      await inTx(venue, (tx) =>
        setStationPrinting(tx, { printHeldWork: true }, [venue.stationId, extraStation]),
      );
      const order = await billWith(venue, [{ name: "Pizza", olives: 2 }], {
        release: "hold",
        shape: "grouped",
      });
      await inTx(venue, (tx) =>
        setStationPrinting(tx, { printHeldWork: false }, [venue.stationId, extraStation]),
      );
      await pay(order.billId, "12.00");
      if (stage === "requested") {
        await inTx(venue, (tx) =>
          setStationsWaitForPass(tx, true, [venue.stationId, extraStation]),
        );
        try {
          const [group] = await venue.db
            .select()
            .from(orderGroups)
            .where(eq(orderGroups.partyId, order.partyId));
          const [party] = await venue.db
            .select()
            .from(parties)
            .where(eq(parties.id, order.partyId));
          await inTx(venue, (tx) =>
            fireGroup(tx, venue.cfg, order.partyId, group!.id, {
              expectedPartyRevision: party!.revision,
              submissionId: randomUUID(),
              operatorId: venue.staffId,
            }),
          );
        } finally {
          await inTx(venue, (tx) =>
            setStationsWaitForPass(tx, false, [venue.stationId, extraStation]),
          );
        }
      }
      await joinOwing(order.partyId);
      const lines = await linesOf(order.billId);
      const tickets = await venue.db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, order.billId));
      expect(tickets.every((row) => row.firedAt === null)).toBe(true);
      expect(
        tickets.every((row) =>
          stage === "requested" ? row.requestedAt !== null : row.requestedAt === null,
        ),
      ).toBe(true);
      const heldJobs = (await jobs()).map((job) => decodeTicket(job.payload));
      expect(heldJobs.some((text) => text.includes("PIZZA") && text.includes("ESPERA"))).toBe(true);
      const before = new Set((await jobs()).map((job) => job.id));
      const stationBefore = (
        await inTx(venue, (tx) => listStationQueue(tx, venue.stationId))
      ).filter((group) => group.orderId === order.billId);
      expect(await depart(order.partyId)).toMatchObject({ status: 200 });
      expect(await cancellations(lines[0]!.id)).toEqual([]);
      expect(await linesOf(order.billId)).toEqual(lines);
      expect(
        await venue.db
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderId, order.billId)),
      ).toEqual(tickets);
      const newSlips = (await jobs())
        .filter((job) => !before.has(job.id))
        .map((job) => decodeTicket(job.payload))
        .join("\n");
      expect(newSlips).not.toContain("PIZZA");
      expect(newSlips).not.toContain("OLIV");
      expect(
        (await inTx(venue, (tx) => listStationQueue(tx, venue.stationId))).filter(
          (group) => group.orderId === order.billId,
        ),
      ).toEqual(
        stationBefore.map((group) => ({
          ...group,
          party: { ...group.party!, revision: group.party!.revision + 1 },
        })),
      );
      expect(
        await inTx(venue, async (tx) => boardOrderIds(await readScopedPassBoard(tx, EVERY))),
      ).toContain(order.billId);
      expect(
        (await venue.db.select().from(workingOrders).where(eq(workingOrders.id, order.billId)))[0]!
          .collectedAt,
      ).toBeNull();
    },
  );

  it("keeps served quantities and earlier cancellations when stopping the remaining started work", async () => {
    const order = await billWith(venue, [{ name: "Pizza", quantity: "3", olives: 2 }], {
      shape: "grouped",
    });
    const lines = await linesOf(order.billId);
    const [extra] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, lines[1]!.id));
    await inTx(venue, (tx) => advanceTicketItem(tx, extra!.id, "preparing"));
    await inTx(venue, async (tx) => {
      const [party] = await tx.select().from(parties).where(eq(parties.id, order.partyId));
      const [bill] = await tx
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, order.billId));
      await cancelItem(
        tx,
        venue.cfg,
        order.partyId,
        lines[0]!.id,
        {
          admission: testTradingAdmission(),
          quantity: "1",
          outcome: "keep_charge",
          reasonId: venue.reasonId.houseVoid,
          expectedEdit: await readBillEditState(tx, order.billId),
          expectedPartyRevision: party!.revision,
          expectedBillRevision: bill!.revision,
          expectedContext: await readCancellationContext(tx, order.partyId, lines[0]!.id),
          submissionId: randomUUID(),
        },
        venue.staffId,
      );
    });
    await serve(order.partyId, lines[0]!.id, "1");
    const before = await venue.db
      .select()
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, order.billId));
    expect(before).toHaveLength(1);
    expect(await depart(order.partyId)).toMatchObject({ status: 200 });
    expect(await cancellations(lines[0]!.id)).toEqual([
      expect.objectContaining({ quantity: 2000, wasStarted: true, actorId: venue.managerId }),
    ]);
    expect(
      (await linesOf(order.billId)).map((line) => [line.quantity, line.servedQuantity]),
    ).toEqual([
      [3000, 1000],
      [6000, 2000],
    ]);
    expect(
      await venue.db.select().from(adjustments).where(eq(adjustments.workingOrderId, order.billId)),
    ).toEqual(before);
  });

  it("cancels the fractional unserved remainder without rounding the bill", async () => {
    const order = await billWith(venue, [{ name: "Ham", quantity: "1.250" }], { shape: "grouped" });
    const [line] = await linesOf(order.billId);
    await serve(order.partyId, line!.id, "0.500");
    expect(await depart(order.partyId)).toMatchObject({ status: 200 });
    expect(await cancellations(line!.id)).toEqual([expect.objectContaining({ quantity: 750 })]);
    expect((await linesOf(order.billId))[0]).toMatchObject({
      quantity: 1250,
      servedQuantity: 500,
      lineTotal: 3000,
    });
  });

  it("clears station, pass and overdue lists, preserves another party and stays cleared after payment", async () => {
    const order = await billWith(venue, [{ name: "Burger" }]);
    const other = await billWith(venue, [{ name: "Burger" }]);
    const ids = [order.billId, other.billId];
    await venue.db
      .update(ticketItems)
      .set({ queuedAt: "2000-01-01T12:00:00.000Z" })
      .where(inArray(ticketItems.workingOrderId, ids));
    const visible = () =>
      inTx(venue, async (tx) => ({
        station: (await listStationQueue(tx, venue.stationId))
          .map((row) => row.orderId)
          .filter((id) => ids.includes(id))
          .sort(),
        pass: boardOrderIds(await readScopedPassBoard(tx, EVERY))
          .filter((id) => ids.includes(id))
          .sort(),
        overdue: (await computeOverdueOrders(tx))
          .map((row) => row.orderId)
          .filter((id) => ids.includes(id))
          .sort(),
      }));
    expect(await visible()).toEqual({
      station: [...ids].sort(),
      pass: [...ids].sort(),
      overdue: [...ids].sort(),
    });
    expect(await depart(order.partyId)).toMatchObject({ status: 200 });
    const remaining = { station: [other.billId], pass: [other.billId], overdue: [other.billId] };
    expect(await visible()).toEqual(remaining);
    const salesBefore = await venue.db
      .select()
      .from(sales)
      .where(eq(sales.workingOrderId, order.billId));
    const response = await venue.app.request(`/api/working-orders/${order.billId}/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venue.cookie.manager },
      body: JSON.stringify({
        tender: { method: "cash", amount: "12.00" },
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, order.billId)),
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await visible()).toEqual(remaining);
    expect(
      await venue.db.select().from(sales).where(eq(sales.workingOrderId, order.billId)),
    ).toEqual(salesBefore);
    const beforeRetry = await jobs();
    expect(await depart(order.partyId, order.billId)).toMatchObject({
      status: 409,
      body: { error: { code: "party.not_open" } },
    });
    expect(await jobs()).toEqual(beforeRetry);
  });

  it("closes with paid siblings handed over, preserving prior stamps and their activity", async () => {
    const order = await billWith(venue, [{ name: "Burger" }]);
    await pay(order.billId, "12.00");
    const [line] = await linesOf(order.billId);
    await serve(order.partyId, line!.id, "1");
    await inTx(venue, (tx) => handOverOrder(tx, venue.cfg, order.billId));
    const [before] = await venue.db
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.id, order.billId));
    const paid = await billWith(venue, [{ name: "Burger" }]);
    await pay(paid.billId, "12.00");
    const [paidLine] = await linesOf(paid.billId);
    await serve(paid.partyId, paidLine!.id, "1");
    await inTx(venue, (tx) =>
      combineParties(tx, venue.cfg, {
        from: paid.partyId,
        into: order.partyId,
        tables: "join",
        operatorId: venue.staffId,
      }),
    );
    const owing = await joinOwing(order.partyId);
    expect(await depart(order.partyId)).toMatchObject({ status: 200, body: { state: "closed" } });
    expect(
      (await venue.db.select().from(workingOrders).where(eq(workingOrders.id, paid.billId)))[0]!
        .collectedAt,
    ).not.toBeNull();
    expect(
      (await venue.db.select().from(workingOrders).where(eq(workingOrders.id, order.billId)))[0]!
        .collectedAt,
    ).toBe(before!.collectedAt);
    expect(await cancellations(line!.id)).toEqual([]);
    const facts = await venue.db
      .select()
      .from(attendanceOperationFacts)
      .where(eq(attendanceOperationFacts.personId, venue.managerId));
    expect(
      facts.filter((fact) => fact.key.startsWith(`service:${paid.billId}:unpaid-departure:`)),
    ).toHaveLength(0);
    expect(
      facts.filter((fact) => fact.key.startsWith(`service:${order.billId}:unpaid-departure:`)),
    ).toHaveLength(0);
    const placements = await venue.db
      .select()
      .from(orderAmendments)
      .where(
        and(
          eq(orderAmendments.workingOrderId, owing.billId),
          eq(orderAmendments.kind, "order_placed"),
        ),
      );
    expect(placements).toHaveLength(1);
    expect(
      facts.filter(
        (fact) => fact.key === placements[0]!.id || fact.key.startsWith(`service:${owing.billId}:`),
      ),
    ).toEqual([expect.objectContaining({ source: "order", key: placements[0]!.id })]);
  });

  it("refuses unfired uninvoiced work before changing any kitchen state or print job", async () => {
    const order = await billWith(venue, [{ name: "Burger" }], { release: "hold" });
    const tickets = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, order.billId));
    const before = await jobs();
    expect(await depart(order.partyId, order.billId)).toMatchObject({
      status: 409,
      body: { error: { code: "unpaid_departure.unfired_dishes" } },
    });
    expect(
      await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, order.billId)),
    ).toEqual(tickets);
    expect(await cancellations((await linesOf(order.billId))[0]!.id)).toEqual([]);
    expect(await jobs()).toEqual(before);
  });

  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])(
    "keeps made-here work outside station selection, remote extra %s, waiting %s",
    async (remoteExtra, waitingExtra) => {
      const stops = remoteExtra && !waitingExtra;
      if (waitingExtra) await inTx(venue, (tx) => setStationsWaitForPass(tx, true, [extraStation]));
      await venue.db
        .insert(deviceMadeHereStations)
        .values({ deviceId: venue.deviceId, stationId: venue.stationId });
      let order;
      try {
        order = await billWith(
          { ...venue, cfg: { ...venue.cfg, sendingDeviceId: venue.deviceId } },
          remoteExtra ? [{ name: "Pizza", olives: 2 }] : [{ name: "Burger" }],
          { shape: "grouped" },
        );
      } finally {
        if (waitingExtra)
          await inTx(venue, (tx) => setStationsWaitForPass(tx, false, [extraStation]));
        await venue.db
          .delete(deviceMadeHereStations)
          .where(
            and(
              eq(deviceMadeHereStations.deviceId, venue.deviceId),
              eq(deviceMadeHereStations.stationId, venue.stationId),
            ),
          );
      }
      const lines = await linesOf(order.billId);
      const tickets = await venue.db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, order.billId));
      expect(tickets.find((row) => row.workingOrderLineId === lines[0]!.id)).toMatchObject({
        madeHere: true,
        firedAt: expect.any(String),
        state: "ready",
      });
      if (remoteExtra)
        expect(tickets.find((row) => row.workingOrderLineId === lines[1]!.id)).toMatchObject({
          madeHere: false,
          firedAt: waitingExtra ? null : expect.any(String),
          requestedAt: expect.any(String),
          state: "queued",
        });
      const before = new Set((await jobs()).map((job) => job.id));

      expect(await depart(order.partyId)).toMatchObject({ status: 200 });

      expect(await cancellations(lines[0]!.id)).toEqual(
        stops
          ? [
              {
                lineId: lines[0]!.id,
                quantity: 1000,
                actorId: venue.managerId,
                wasStarted: false,
                cancelledAt: expect.any(String),
              },
            ]
          : [],
      );
      const after = await venue.db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, order.billId));
      expect(after).toEqual(stops ? [] : tickets);
      expect(
        (await venue.db.select().from(workingOrders).where(eq(workingOrders.id, order.billId)))[0]!
          .collectedAt,
      ).toEqual(remoteExtra ? expect.any(String) : null);
      const slips = (await jobs())
        .filter((job) => !before.has(job.id))
        .map((job) => decodeTicket(job.payload));
      expect(slips).toHaveLength(stops ? 1 : 0);
      if (stops) {
        expect(slips[0]).toContain("OLIV");
        expect(slips[0]).not.toContain("1 x PIZZA");
      }
    },
  );

  it("cancels a fired parent and its waiting extra, printing only the fired part", async () => {
    await inTx(venue, (tx) => setStationsWaitForPass(tx, true, [extraStation]));
    let order;
    try {
      order = await billWith(venue, [{ name: "Pizza", olives: 2 }], { shape: "grouped" });
    } finally {
      await inTx(venue, (tx) => setStationsWaitForPass(tx, false, [extraStation]));
    }
    const lines = await linesOf(order.billId);
    const tickets = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, order.billId));
    expect(tickets.find((row) => row.workingOrderLineId === lines[0]!.id)).toMatchObject({
      firedAt: expect.any(String),
    });
    expect(tickets.find((row) => row.workingOrderLineId === lines[1]!.id)).toMatchObject({
      firedAt: null,
      requestedAt: expect.any(String),
    });
    const before = new Set((await jobs()).map((job) => job.id));
    expect(await depart(order.partyId)).toMatchObject({ status: 200 });
    expect(await cancellations(lines[0]!.id)).toEqual([
      expect.objectContaining({ quantity: 1000 }),
    ]);
    expect(
      await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, order.billId)),
    ).toEqual([]);
    const slips = (await jobs())
      .filter((job) => !before.has(job.id))
      .map((job) => decodeTicket(job.payload));
    expect(slips).toHaveLength(1);
    expect(slips[0]).toContain("1 x PIZZA");
    expect(slips[0]!.split("\n").filter((line) => /^[0-9.,]+ x /.test(line))).toEqual([
      "1 x PIZZA",
    ]);
    expect(slips[0]).not.toContain("HOLD");
  });

  it.each(["placed", "settled"] as const)(
    "preserves partially served dishes and extras on a %s bill",
    async (status) => {
      const order = await billWith(venue, [{ name: "Pizza", quantity: "3", olives: 2 }], {
        shape: "grouped",
      });
      if (status === "settled") {
        await pay(order.billId, "36.00");
        await joinOwing(order.partyId);
      } else {
        await issueOrderInvoice(
          { ...venue, admission: testTradingAdmission() },
          venue.cfg,
          order.billId,
          venue.staffId,
        );
        await inTx(venue, (tx) =>
          markOrderPlaced(tx, venue.clock, venue.cfg, order.billId, venue.staffId),
        );
      }
      const lines = await linesOf(order.billId);
      await serve(order.partyId, lines[0]!.id, "1");
      const salesBefore = await venue.db
        .select()
        .from(sales)
        .where(eq(sales.workingOrderId, order.billId));
      expect(await depart(order.partyId)).toMatchObject({ status: 200 });
      expect(await cancellations(lines[0]!.id)).toEqual([
        ...(status === "placed" ? [expect.objectContaining({ quantity: 2000 })] : []),
      ]);
      expect(
        (await linesOf(order.billId)).map((line) => [
          line.quantity,
          line.servedQuantity,
          line.lineTotal,
        ]),
      ).toEqual([
        [3000, 1000, 2700],
        [6000, 2000, 900],
      ]);
      expect(
        (
          await venue.db
            .select()
            .from(ticketItems)
            .where(eq(ticketItems.workingOrderId, order.billId))
        ).map((row) => row.quantity),
      ).toEqual(status === "placed" ? [1000, 2000] : [3000, 6000]);
      expect(
        await venue.db.select().from(sales).where(eq(sales.workingOrderId, order.billId)),
      ).toEqual(salesBefore);
    },
  );

  it.each([false, true])(
    "cancels fired food while preserving the invoice and full debt, started %s",
    async (started) => {
      const order = await billWith(venue, [{ name: "Burger" }]);
      const [line] = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, order.billId));
      if (started) {
        const [ticket] = await venue.db
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, line!.id));
        await inTx(venue, (tx) => advanceTicketItem(tx, ticket!.id, "preparing"));
      }
      const before = new Set((await jobs()).map((job) => job.id));

      expect(await depart(order.partyId)).toMatchObject({ status: 200, body: { state: "closed" } });

      expect(
        await venue.db
          .select()
          .from(lineServiceCancellations)
          .where(eq(lineServiceCancellations.lineId, line!.id)),
      ).toEqual([
        {
          lineId: line!.id,
          quantity: 1000,
          actorId: venue.managerId,
          wasStarted: started,
          cancelledAt: expect.any(String),
        },
      ]);
      expect(
        await venue.db
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderId, order.billId)),
      ).toEqual([]);
      expect(
        await venue.db
          .select()
          .from(adjustments)
          .where(eq(adjustments.workingOrderId, order.billId)),
      ).toEqual([]);
      const [sale] = await venue.db
        .select({ total: sales.total, settledAt: saleSettlements.settledAt })
        .from(sales)
        .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
        .where(eq(sales.workingOrderId, order.billId));
      expect(sale).toMatchObject({ total: 1200, settledAt: null });
      expect(
        await venue.db.select().from(workingOrderLines).where(eq(workingOrderLines.id, line!.id)),
      ).toEqual([line]);
      const [bill] = await venue.db
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, order.billId));
      expect(bill).toMatchObject({ status: "placed", collectedAt: expect.any(String) });
      const slips = (await jobs())
        .filter((job) => !before.has(job.id))
        .map((job) => decodeTicket(job.payload));
      expect(slips).toHaveLength(1);
      expect(slips[0]).toContain("1 x BURG");
      await expect(serve(order.partyId, line!.id, "1")).rejects.toMatchObject({
        code: "party.not_open",
      });
    },
  );

  it("preserves a paid sibling’s waiting parent and fired extra", async () => {
    await inTx(venue, (tx) => setStationsWaitForPass(tx, true, [venue.stationId]));
    let mixed;
    try {
      mixed = await billWith(venue, [{ name: "Pizza", quantity: "3", olives: 2 }], {
        shape: "grouped",
      });
    } finally {
      await inTx(venue, (tx) => setStationsWaitForPass(tx, false, [venue.stationId]));
    }
    const lines = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, mixed.billId))
      .orderBy(workingOrderLines.lineNo);
    const tickets = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, mixed.billId));
    expect(tickets.find((item) => item.workingOrderLineId === lines[0]!.id)).toMatchObject({
      firedAt: null,
      requestedAt: expect.any(String),
    });
    expect(tickets.find((item) => item.workingOrderLineId === lines[1]!.id)).toMatchObject({
      stationId: extraStation,
      firedAt: expect.any(String),
    });
    await payWorkingOrder(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      { id: mixed.billId, tender: { method: "cash", amount: "36.00" }, lines: [] },
      venue.staffId,
    );
    const owing = await billWith(venue, [{ name: "Burger" }]);
    await inTx(venue, (tx) =>
      combineParties(tx, venue.cfg, {
        from: owing.partyId,
        into: mixed.partyId,
        tables: "join",
        operatorId: venue.staffId,
      }),
    );
    const before = new Set((await jobs()).map((job) => job.id));

    expect(await depart(mixed.partyId)).toMatchObject({ status: 200 });

    expect(
      await venue.db
        .select()
        .from(lineServiceCancellations)
        .where(eq(lineServiceCancellations.lineId, lines[0]!.id)),
    ).toEqual([]);
    expect(
      await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, mixed.billId)),
    ).toEqual(tickets);
    const slips = (await jobs())
      .filter((job) => !before.has(job.id))
      .map((job) => decodeTicket(job.payload))
      .join("\n");
    expect(slips).not.toContain("OLIV");
    expect(slips).not.toContain("3 x PIZZA");
    expect(slips).not.toContain("HOLD");
    expect(
      await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, mixed.billId))
        .orderBy(workingOrderLines.lineNo),
    ).toEqual(lines);
  });
});
