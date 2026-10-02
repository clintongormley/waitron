import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billPayments,
  deviceMadeHereStations,
  floorZones,
  kitchenStations,
  orderGroups,
  parties,
  printJobs,
  serviceCommands,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { insertCapturedPayment } from "@waitron/payments";
import { decimal, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { createAdjustmentReason } from "@waitron/adjustments";
import { createExtraList, writeProductModifiers } from "@waitron/catalogue";
import { writePrintHeldWork } from "@waitron/venue-service";
import { attachPrinterToStation } from "./station-printers.js";
import { createCourse, createStation } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { createTable } from "./tables.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { fireLines } from "./working-order.js";

let venue: BillVenue;
let barPrinterId: string;
let grillPrinterId: string;
let grillStationId: string;
let counterOffer: string;
let counterPaellaOffer: string;
let discountReasonId: string;
let cancelReasonId: string;
let garnishListId: string;
let garnishProductId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const [bar] = await tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true));
      const stationId = bar!.id;
      const deviceId = venue.cookie.match(/waitron_device=([0-9a-f-]+)\./)![1]!;
      await tx.insert(deviceMadeHereStations).values({ deviceId, stationId });
      const printer = await createPrinter(
        tx,
        { locationId: venue.cfg.locationId },
        { name: "Bar", transport: "cloud_poll", pollId: randomUUID() },
      );
      barPrinterId = printer.id;
      await attachPrinterToStation(tx, { stationId, printerId: printer.id });
      const grill = await createStation(tx, venue.cfg, { name: "Grill" });
      grillStationId = grill.id;
      const [paella] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, "Paella"));
      await routeProductTo(tx, venue.cfg, paella!.id, grill.id);
      const grillPrinter = await createPrinter(
        tx,
        { locationId: venue.cfg.locationId },
        {
          name: "Grill",
          transport: "cloud_poll",
          pollId: randomUUID(),
        },
      );
      grillPrinterId = grillPrinter.id;
      await attachPrinterToStation(tx, { stationId: grill.id, printerId: grillPrinter.id });
      const [lager] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, "Caña"));
      const [croquetas] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, "Croquetas"));
      garnishProductId = croquetas!.id;
      const garnish = await createExtraList(
        tx,
        {
          name: "Garnish",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [
            { productId: garnishProductId, maxQuantity: 1, preselected: false, price: "1.00" },
          ],
        },
        venue.cfg.locale,
      );
      garnishListId = garnish.id;
      await writeProductModifiers(tx, lager!.id, [{ kind: "extras", id: garnishListId }]);
      const offers = await offerProducts(tx, venue.cfg, {
        zone: "counter",
        productIds: [lager!.id, paella!.id],
      });
      counterOffer = offers.offerFor(lager!.id);
      counterPaellaOffer = offers.offerFor(paella!.id);
      discountReasonId = (
        await createAdjustmentReason(tx, {
          name: "Made-here test",
          names: { "es-ES": "Descuento" },
          actions: ["discount_percent"],
          maxPercentBp: 1000,
          maxAmount: null,
          applyRole: "staff",
          approverRole: "staff",
          noteRequired: false,
        })
      ).id;
      cancelReasonId = (
        await createAdjustmentReason(tx, {
          name: "Cancel made-here",
          names: { "es-ES": "Cancelar" },
          actions: ["cancel"],
          maxPercentBp: null,
          maxAmount: null,
          applyRole: "staff",
          approverRole: "staff",
          noteRequired: false,
        })
      ).id;
    });
  },
});

async function assertMadeHere(orderId: string) {
  const [before] = await inTx(venue, (tx) =>
    tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, orderId)),
  );
  expect(before).toBeUndefined();
  const jobsBefore = await inTx(venue, (tx) =>
    tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
  );
  return async () => {
    const items = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, orderId)),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ madeHere: true, state: "ready" });
    const [line] = await inTx(venue, (tx) =>
      tx
        .select({ sentAt: workingOrderLines.sentAt })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, items[0]!.workingOrderLineId)),
    );
    expect(line!.sentAt).toEqual(expect.any(String));
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobsBefore.length);
  };
}

async function parkedLager(): Promise<{ orderId: string; lineId: string }> {
  const orderId = randomUUID();
  const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
    id: orderId,
    lines: [{ menuItemId: counterOffer, quantity: "1" }],
  });
  expect(parked.status).toBe(200);
  const [line] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, orderId)),
  );
  return { orderId, lineId: line!.id };
}

async function lineCheck(lineId: string) {
  const before = await inTx(venue, (tx) =>
    tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, lineId)),
  );
  expect(before).toEqual([]);
  const jobs = await inTx(venue, (tx) =>
    tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
  );
  return async () => {
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, lineId)),
    );
    expect(item).toMatchObject({ madeHere: true, state: "ready" });
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobs.length);
  };
}

async function bareParty() {
  const { orderId, lineId } = await parkedLager();
  const table = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `Bare ${randomUUID()}` }),
  );
  const sessionOnly = venue.cookie.split(";")[0]!;
  const moved = await send(venue.app, sessionOnly, "POST", `/api/bills/${orderId}/move`, {
    to: { tableId: table.id },
  });
  expect(moved.status).toBe(200);
  return { orderId, lineId, tableId: table.id, partyId: moved.json.partyId as string };
}

async function revisionOf(partyId: string) {
  const [party] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  return party!.revision;
}

async function ordinaryBarDish() {
  const party = await seatedWith(venue);
  const sent = await send(
    venue.app,
    venue.cookie2,
    "POST",
    `/api/parties/${party.partyId}/groups`,
    {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      groups: [{ lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" }],
    },
  );
  expect(sent.status).toBe(200);
  const [line] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, party.tabId)),
  );
  const [item] = await inTx(venue, (tx) =>
    tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, line!.id)),
  );
  expect(item).toMatchObject({ madeHere: false });
  return { ...party, lineId: line!.id };
}

describe("made-here route wiring", () => {
  it("Send all leaves a made-here drink from a held round unchanged", async () => {
    const party = await seatedWith(venue);
    const held = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(held.status).toBe(200);
    const [before] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(before).toMatchObject({ madeHere: true, state: "ready", firedAt: expect.any(String) });
    const jobsBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const sent = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/lines/send`,
      { lineNos: [] },
    );
    expect(sent.status).toBe(200);
    const [after] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(after).toEqual(before);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobsBefore.length);
  });
  it("serves a made-here drink in a held group while its Grill dish waits for fire", async () => {
    const party = await seatedWith(venue);
    await inTx(venue, (tx) => writePrintHeldWork(tx, true));
    const barBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const grillBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    const submitted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          {
            lines: [
              { menuItemId: venue.offerFor("Caña"), quantity: "1" },
              { menuItemId: venue.offerFor("Paella"), quantity: "1" },
            ],
            release: "hold",
          },
        ],
      },
    );
    expect(submitted.status).toBe(200);
    const [group] = await inTx(venue, (tx) =>
      tx.select().from(orderGroups).where(eq(orderGroups.partyId, party.partyId)),
    );
    const items = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    const drink = items.find((item) => item.madeHere)!;
    const burger = items.find((item) => !item.madeHere)!;
    const [drinkLineBefore] = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, drink.workingOrderLineId)),
    );
    expect(drink).toMatchObject({ state: "ready", firedAt: expect.any(String) });
    expect(burger.firedAt).toBeNull();
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(barBefore.length);
    const grillAfter = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    expect(grillAfter).toHaveLength(grillBefore.length + 1);
    expect(decodeTicket(grillAfter.at(-1)!.payload)).toContain("HOLD");
    expect(group!.holdPrintedAt).not.toBeNull();
    const current = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${party.partyId}/current-orders`,
    );
    expect(current.status).toBe(200);
    expect(
      (current.json.groups as { rows: { lineId: string; released: boolean }[] }[])[0]!.rows.find(
        (row: { lineId: string }) => row.lineId === drink.workingOrderLineId,
      ),
    ).toMatchObject({ released: true });
    const refused = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/served`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(party.partyId),
        items: [{ lineId: burger.workingOrderLineId, quantity: "1" }],
      },
    );
    expect(refused.json.code).toBe("group.line_held");
    const served = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/served`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(party.partyId),
        items: [{ lineId: drink.workingOrderLineId, quantity: "1" }],
      },
    );
    expect(served.status).toBe(200);
    const fired = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups/${group!.id}/fire`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(party.partyId),
      },
    );
    expect(fired.status).toBe(200);
    const [after] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.id, drink.id)),
    );
    expect(after!.firedAt).toBe(drink.firedAt);
    const [drinkLineAfter] = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, drink.workingOrderLineId)),
    );
    expect(drinkLineAfter!.sentAt).toBe(drinkLineBefore!.sentAt);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(barBefore.length);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
      ),
    ).toHaveLength(grillBefore.length + 2);
    const firedGrill = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    expect(decodeTicket(firedGrill.at(-1)!.payload)).toContain("FIRE");
  });
  it("keeps a drink-only held group off HOLD paper and shows it ready", async () => {
    const party = await seatedWith(venue);
    await inTx(venue, (tx) => writePrintHeldWork(tx, true));
    const jobsBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const submitted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(submitted.status).toBe(200);
    const [group] = await inTx(venue, (tx) =>
      tx.select().from(orderGroups).where(eq(orderGroups.partyId, party.partyId)),
    );
    expect(group!.holdPrintedAt).toBeNull();
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobsBefore.length);
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(item).toMatchObject({ madeHere: true, firedAt: expect.any(String), state: "ready" });
    const groups = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${party.partyId}/groups`,
    );
    expect(groups.status).toBe(200);
    expect((groups.json.groups as { id: string; ready: boolean }[])[0]).toMatchObject({
      id: group!.id,
      ready: true,
    });
  });

  it("reprints the Grill dish but no made-here drink", async () => {
    const party = await seatedWith(venue);
    const submitted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          {
            lines: [
              { menuItemId: venue.offerFor("Caña"), quantity: "1" },
              { menuItemId: venue.offerFor("Paella"), quantity: "1" },
            ],
            release: "fire",
          },
        ],
      },
    );
    expect(submitted.status).toBe(200);
    const barBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const grillBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    const reprinted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/orders/${party.tabId}/reprint`,
      {},
    );
    expect(reprinted.status).toBe(200);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(barBefore.length);
    const reprintedGrill = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    expect(reprintedGrill).toHaveLength(grillBefore.length + 1);
    expect(decodeTicket(reprintedGrill.at(-1)!.payload)).toContain("REPRINT");
  });
  it("an edit after a made-here send fires its new Grill dish", async () => {
    const party = await seatedWith(venue);
    const sent = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" },
        ],
      },
    );
    expect(sent.status).toBe(200);
    const [drink] = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, party.tabId)),
    );
    const grillBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    const edited = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}`,
      {
        revision: order!.revision,
        lines: [
          { workingOrderLineId: drink!.id, menuItemId: venue.offerFor("Caña"), quantity: "1" },
          { menuItemId: venue.offerFor("Paella"), quantity: "1" },
        ],
      },
    );
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    const items = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(items.find((item) => !item.madeHere)).toMatchObject({
      stationId: grillStationId,
      firedAt: expect.any(String),
    });
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
      ),
    ).toHaveLength(grillBefore.length + 1);
  });
  it("an edit after a made-here send in a held group keeps its new Grill dish held", async () => {
    const party = await seatedWith(venue);
    const held = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(held.status).toBe(200);
    const [drink] = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, party.tabId)),
    );
    const edited = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}`,
      {
        revision: order!.revision,
        lines: [
          { workingOrderLineId: drink!.id, menuItemId: venue.offerFor("Caña"), quantity: "1" },
          { menuItemId: venue.offerFor("Paella"), quantity: "1" },
        ],
      },
    );
    expect(edited.status).toBe(200);
    const items = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(items.find((item) => item.madeHere)).toMatchObject({
      firedAt: expect.any(String),
      state: "ready",
    });
    expect(items.find((item) => !item.madeHere)).toMatchObject({
      stationId: grillStationId,
      firedAt: null,
    });
  });
  it("an ungrouped made-here course does not mark that course fired for an edit", async () => {
    const [first, later] = await inTx(venue, async (tx) => [
      await createCourse(tx, venue.cfg, { name: `First ${randomUUID()}`, displayOrder: 1 }),
      await createCourse(tx, venue.cfg, { name: `Later ${randomUUID()}`, displayOrder: 2 }),
    ]);
    const orderId = randomUUID();
    const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      id: orderId,
      lines: [
        { menuItemId: counterPaellaOffer, quantity: "1", courseId: first.id },
        { menuItemId: counterOffer, quantity: "1", courseId: later.id },
      ],
    });
    expect(parked.status).toBe(200);
    const [burger, drink] = await inTx(venue, (tx) =>
      tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId))
        .orderBy(workingOrderLines.lineNo),
    );
    const deviceId = venue.cookie.match(/waitron_device=([0-9a-f-]+)\./)![1]!;
    await inTx(venue, (tx) =>
      fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [
        {
          id: burger!.id,
          productId: burger!.productId!,
          parentLineId: null,
          courseId: first.id,
          note: null,
          quantity: burger!.quantity,
          hold: true,
        },
        {
          id: drink!.id,
          productId: drink!.productId!,
          parentLineId: null,
          courseId: later.id,
          note: null,
          quantity: drink!.quantity,
        },
      ]),
    );
    const beforeItems = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, orderId)),
    );
    expect(beforeItems.find((item) => item.courseId === first.id)).toMatchObject({
      firedAt: null,
      madeHere: false,
    });
    expect(beforeItems.find((item) => item.courseId === later.id)).toMatchObject({
      firedAt: expect.any(String),
      madeHere: true,
    });
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, orderId)),
    );
    const edited = await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${orderId}`, {
      revision: order!.revision,
      lines: [
        {
          workingOrderLineId: burger!.id,
          menuItemId: counterPaellaOffer,
          quantity: "1",
          courseId: first.id,
        },
        {
          workingOrderLineId: drink!.id,
          menuItemId: counterOffer,
          quantity: "1",
          courseId: later.id,
        },
        { menuItemId: counterPaellaOffer, quantity: "1", courseId: later.id },
      ],
    });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    const items = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, orderId)),
    );
    expect(items.find((item) => item.madeHere)).toMatchObject({
      state: "ready",
      firedAt: expect.any(String),
    });
    expect(items.find((item) => !item.madeHere && item.courseId === later.id)).toMatchObject({
      firedAt: null,
    });
  });
  it("refuses changing or recalling an already-made drink", async () => {
    const party = await seatedWith(venue);
    const sent = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" },
        ],
      },
    );
    expect(sent.status).toBe(200);
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, party.tabId)),
    );
    const [line] = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const changed = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}`,
      {
        revision: order!.revision,
        lines: [
          { workingOrderLineId: line!.id, menuItemId: venue.offerFor("Caña"), quantity: "2" },
        ],
      },
    );
    expect(changed.json.code).toBe("ticket.already_started");
    const recalled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/lines/recall`,
      { lineNos: [line!.lineNo] },
    );
    expect(recalled.json.code).toBe("ticket.already_started");
  });
  it.each([1, 2])(
    "cancels a made-here drink from quantity %i without Bar paper or notice",
    async (quantity) => {
      const party = await seatedWith(venue);
      const sent = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${party.partyId}/groups`,
        {
          submissionId: randomUUID(),
          expectedPartyRevision: party.revision,
          groups: [
            {
              lines: [{ menuItemId: venue.offerFor("Caña"), quantity: String(quantity) }],
              release: "fire",
            },
          ],
        },
      );
      expect(sent.status).toBe(200);
      const [item] = await inTx(venue, (tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
      );
      expect(item).toMatchObject({ madeHere: true, firedAt: expect.any(String), state: "ready" });
      const jobsBefore = await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      );
      const noticesBefore = venue.db.all(sql`select id from kitchen_notices`);
      const [order] = await inTx(venue, (tx) =>
        tx.select().from(workingOrders).where(eq(workingOrders.id, party.tabId)),
      );
      const cancelled = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${party.tabId}/adjustments`,
        {
          submissionId: randomUUID(),
          expectedRevision: order!.revision,
          lineId: item!.workingOrderLineId,
          action: "cancel",
          quantity: "1",
          reasonId: cancelReasonId,
          note: null,
        },
      );
      expect(cancelled.status).toBe(200);
      expect(
        await inTx(venue, (tx) =>
          tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
        ),
      ).toHaveLength(jobsBefore.length);
      expect(venue.db.all(sql`select id from kitchen_notices`)).toHaveLength(noticesBefore.length);
      const remaining = await inTx(venue, (tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
      );
      for (const record of remaining.filter((record) => record.madeHere)) {
        expect(record.firedAt).toEqual(expect.any(String));
        expect(record.state).toBe("ready");
      }
    },
  );
  it("moves a fired mixed bill with a Grill MOVED slip and no Bar notice", async () => {
    const party = await seatedWith(venue);
    const sent = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          {
            lines: [
              { menuItemId: venue.offerFor("Caña"), quantity: "1" },
              { menuItemId: venue.offerFor("Paella"), quantity: "1" },
            ],
            release: "fire",
          },
        ],
      },
    );
    expect(sent.status).toBe(200);
    const target = await inTx(venue, (tx) =>
      createTable(tx, venue.cfg, { label: `Target ${randomUUID()}`, zoneId: venue.zoneId }),
    );
    const barBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const grillBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    const noticesBefore = venue.db.all(sql`select id from kitchen_notices`);
    const moved = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/move`,
      {
        toTableId: target.id,
        expectedPartyRevision: await revisionOf(party.partyId),
      },
    );
    expect(moved.status).toBe(200);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(barBefore.length);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
      ),
    ).toHaveLength(grillBefore.length + 1);
    const movedGrill = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    expect(decodeTicket(movedGrill.at(-1)!.payload)).toContain("MOVED");
    const noticesAfter = venue.db.all<{ station_id: string; kind: string }>(
      sql`select station_id, kind from kitchen_notices order by rowid`,
    );
    expect(noticesAfter.slice(noticesBefore.length)).toEqual([
      { station_id: grillStationId, kind: "moved" },
    ]);
  });
  it("keeps the made-here mark when splitting a drink onto another bill", async () => {
    const party = await seatedWith(venue);
    const sent = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "2" }], release: "fire" },
        ],
      },
    );
    expect(sent.status).toBe(200);
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(item).toMatchObject({ madeHere: true, firedAt: expect.any(String), state: "ready" });
    const [line] = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, item!.workingOrderLineId)),
    );
    const split = await send(venue.app, venue.cookie, "POST", `/api/bills/${party.tabId}/split`, {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
      transfers: [{ lineNo: line!.lineNo, quantity: "1" }],
    });
    expect(split.status).toBe(200);
    const [splitItem] = await inTx(venue, (tx) =>
      tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, split.json.billId as string)),
    );
    expect(splitItem).toMatchObject({
      madeHere: true,
      firedAt: expect.any(String),
      state: "ready",
    });
  });
  it("groups an already-made counter drink as released when its bill joins a table", async () => {
    const orderId = randomUUID();
    const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      id: orderId,
      lines: [{ menuItemId: counterOffer, quantity: "1" }],
    });
    expect(parked.status).toBe(200);
    const placed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${orderId}/place`,
      {},
    );
    expect(placed.status).toBe(200);
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, orderId)),
    );
    expect(item).toMatchObject({ madeHere: true, firedAt: expect.any(String), state: "ready" });
    const table = await inTx(venue, (tx) =>
      createTable(tx, venue.cfg, { label: `Arrival ${randomUUID()}`, zoneId: venue.zoneId }),
    );
    const moved = await send(
      venue.app,
      venue.cookie.split(";")[0]!,
      "POST",
      `/api/bills/${orderId}/move`,
      { to: { tableId: table.id } },
    );
    expect(moved.status).toBe(200);
    const groups = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${moved.json.partyId}/current-orders`,
    );
    expect(groups.status).toBe(200);
    const shown = groups.json.groups as {
      state: string;
      rows: { lineId: string; released: boolean }[];
    }[];
    expect(shown).toEqual([
      expect.objectContaining({
        state: "fired",
        rows: [expect.objectContaining({ lineId: item!.workingOrderLineId, released: true })],
      }),
    ]);
  });
  it("cancels an extra from a made-here drink without Bar paper or notice", async () => {
    const party = await seatedWith(venue);
    const sent = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          {
            lines: [
              {
                menuItemId: venue.offerFor("Caña"),
                quantity: "1",
                extras: [
                  { listId: garnishListId, picks: [{ productId: garnishProductId, quantity: 1 }] },
                ],
              },
            ],
            release: "fire",
          },
        ],
      },
    );
    expect(sent.status).toBe(200);
    const lines = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const extra = lines.find((line) => line.parentLineId !== null)!;
    expect(extra).toBeDefined();
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(item).toMatchObject({ madeHere: true, firedAt: expect.any(String), state: "ready" });
    const jobsBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const noticesBefore = venue.db.all(sql`select id from kitchen_notices`);
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, party.tabId)),
    );
    const cancelled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/adjustments`,
      {
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: extra.id,
        action: "cancel",
        reasonId: cancelReasonId,
        note: null,
      },
    );
    expect(cancelled.status).toBe(200);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobsBefore.length);
    expect(venue.db.all(sql`select id from kitchen_notices`)).toHaveLength(noticesBefore.length);
  });
  it("joining a printed held group makes a drink here without a HOLD CHANGED slip or notice", async () => {
    const party = await seatedWith(venue);
    await inTx(venue, (tx) => writePrintHeldWork(tx, true));
    const held = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(held.status).toBe(200);
    const [group] = await inTx(venue, (tx) =>
      tx.select().from(orderGroups).where(eq(orderGroups.partyId, party.partyId)),
    );
    expect(group!.holdPrintedAt).not.toBeNull();
    const beforeJobs = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const beforeNotices = venue.db.all(sql`select id from kitchen_notices`);
    const joined = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(party.partyId),
        joinGroupId: group!.id,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(joined.status).toBe(200);
    const items = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(items.find((item) => item.madeHere)).toMatchObject({
      state: "ready",
      firedAt: expect.any(String),
    });
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(beforeJobs.length);
    expect(venue.db.all(sql`select id from kitchen_notices`)).toHaveLength(beforeNotices.length);
    const grillBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    const joinedGrill = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(party.partyId),
        joinGroupId: group!.id,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(joinedGrill.status).toBe(200);
    const grillAfter = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinterId)),
    );
    expect(grillAfter).toHaveLength(grillBefore.length + 1);
    expect(decodeTicket(grillAfter.at(-1)!.payload)).toContain("HOLD CHANGED");
    expect(decodeTicket(grillAfter.at(-1)!.payload)).toContain("+1.000 x PAELLA");
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(beforeJobs.length);
    const notices = venue.db.all<{ station_id: string; kind: string }>(
      sql`select station_id, kind from kitchen_notices order by rowid`,
    );
    expect(notices.slice(beforeNotices.length)).toEqual([
      { station_id: grillStationId, kind: "changed" },
    ]);
  });
  it("/api/sales carries the device to a pay-first send", async () => {
    const id = randomUUID();
    const check = await assertMadeHere(id);
    const answer = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [{ menuItemId: counterOffer, quantity: "1" }],
      tender: { method: "cash", amount: "3.00" },
    });
    expect(answer.status).toBe(200);
    expect(answer.json.madeHere).toEqual([
      expect.objectContaining({ name: "Caña", quantity: "1.000", lineId: expect.any(String) }),
    ]);
    expect((answer.json.madeHere as { name: string }[])[0]!.name).not.toBe("Caña de cerveza");
    expect((answer.json.madeHere as { name: string }[])[0]!.name).not.toBe("CANA");
    const replay = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [{ menuItemId: counterOffer, quantity: "1" }],
      tender: { method: "cash", amount: "3.00" },
    });
    expect(replay.json.madeHere).toEqual(answer.json.madeHere);
    await check();
  });

  it("does not add a made-here key or replay row when the sending device makes nothing here", async () => {
    const id = randomUUID();
    const answer = await send(venue.app, venue.cookie2, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [{ menuItemId: counterOffer, quantity: "1" }],
      tender: { method: "cash", amount: "3.00" },
    });
    expect(answer.status).toBe(200);
    expect(answer.json).not.toHaveProperty("madeHere");
    const rows = await inTx(venue, (tx) =>
      tx.select().from(serviceCommands).where(eq(serviceCommands.scopeId, id)),
    );
    expect(rows.filter((row) => row.kind === "made_here")).toEqual([]);
  });

  it("refuses a client's reserved submission id before storing made-here replay facts", async () => {
    const id = randomUUID();
    await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      id,
      lines: [{ menuItemId: counterOffer, quantity: "1" }],
    });
    await inTx(venue, (tx) =>
      tx.insert(serviceCommands).values({
        scopeKind: "bill",
        scopeId: id,
        submissionId: "made-here:prepay",
        kind: "order.collect",
        fingerprint: "client",
        result: { value: null },
      }),
    );
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "3.00",
        method: "cash",
        tendered: "3.00",
        applied: "3.00",
        tip: "0.00",
      },
    );
    expect(answer.json.code).toBe("submission.id_reused");
  });

  it.each(["ticket_then_pay", "invoice_first"] as const)(
    "/api/sales makes a no-party %s counter order here when payment sends it",
    async (serviceMode) => {
      const { zoneId, menuItemId } = await inTx(venue, async (tx) => {
        const [zone] = await tx
          .insert(floorZones)
          .values({ locationId: venue.cfg.locationId, name: `${serviceMode} ${randomUUID()}` })
          .returning();
        const [lager] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.name, "Caña"));
        const offers = await offerProducts(tx, venue.cfg, {
          zone: { zoneId: zone!.id },
          serviceMode,
          productIds: [lager!.id],
        });
        return { zoneId: offers.zoneId, menuItemId: offers.offerFor(lager!.id) };
      });
      const id = randomUUID();
      const check = await assertMadeHere(id);
      const body = {
        workingOrderId: id,
        zoneId,
        lines: [{ menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "3.00" },
      };
      const answer = await send(venue.app, venue.cookie, "POST", "/api/sales", body);
      expect(answer.status).toBe(200);
      expect(answer.json.madeHere).toEqual([
        expect.objectContaining({ name: "Caña", quantity: "1.000", lineId: expect.any(String) }),
      ]);
      const replay = await send(venue.app, venue.cookie, "POST", "/api/sales", body);
      expect(replay.status).toBe(200);
      expect(replay.json.madeHere).toEqual(answer.json.madeHere);
      await check();
    },
  );

  it("/api/pay carries the device to a reader-captured pay-first send", async () => {
    const id = randomUUID();
    const check = await assertMadeHere(id);
    const answer = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id,
      lines: [{ menuItemId: counterOffer, quantity: "1" }],
    });
    expect(answer.status).toBe(200);
    expect(answer.json.madeHere).toEqual([
      expect.objectContaining({ name: "Caña", quantity: "1.000" }),
    ]);
    await check();
  });

  it("/api/parties/:id/groups sends the new drink from the device", async () => {
    const party = await seatedWith(venue);
    const check = await assertMadeHere(party.tabId);
    const submissionId = randomUUID();
    const body = {
      submissionId,
      expectedPartyRevision: party.revision,
      groups: [{ lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" }],
    };
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      body,
    );
    expect(answer.status).toBe(200);
    expect(answer.json.madeHere).toEqual([
      expect.objectContaining({ name: "Caña", quantity: "1.000", lineId: expect.any(String) }),
    ]);
    const replay = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      body,
    );
    expect(replay.json.madeHere).toEqual(answer.json.madeHere);
    await check();
  });

  it("a table Send from a device that makes no station here has no madeHere key", async () => {
    const party = await seatedWith(venue);
    const answer = await send(
      venue.app,
      venue.cookie2,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" },
        ],
      },
    );
    expect(answer.status).toBe(200);
    expect(answer.json).not.toHaveProperty("madeHere");
  });

  it("/api/parties/:id/drafts/:did/submit sends the draft from the device", async () => {
    const party = await seatedWith(venue);
    const saved = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/parties/${party.partyId}/drafts`,
      {
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
      },
    );
    expect(saved.status).toBe(200);
    const draft = saved.json as { id: string; revision: number; lines: { id: string }[] };
    const check = await assertMadeHere(party.tabId);
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/drafts/${draft.id}/submit`,
      {
        submissionId: randomUUID(),
        draftRevision: draft.revision,
        expectedPartyRevision: party.revision,
        groups: [{ lineIds: [draft.lines[0]!.id], release: "fire" }],
      },
    );
    expect(answer.status).toBe(200);
    expect(answer.json.madeHere).toEqual([
      expect.objectContaining({ name: "Caña", quantity: "1.000" }),
    ]);
    await check();
  });

  it("PUT /api/working-orders/:id sends an added line from the device", async () => {
    const party = await seatedWith(venue, "Paella");
    const jobsBefore = await inTx(venue, (tx) =>
      tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const before = await inTx(venue, (tx) =>
      tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    const lines = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, party.tabId)),
    );
    const answer = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}`,
      {
        revision: order!.revision,
        lines: [
          { workingOrderLineId: lines[0]!.id, menuItemId: venue.offerFor("Paella"), quantity: "1" },
          { menuItemId: venue.offerFor("Caña"), quantity: "1" },
        ],
      },
    );
    expect(answer.status).toBe(200);
    const after = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((item) => !before.some((old) => old.id === item.id))).toMatchObject({
      madeHere: true,
      state: "ready",
    });
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobsBefore.length);
  });

  it("/place sends a parked counter order from the device", async () => {
    const id = randomUUID();
    const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      id,
      lines: [{ menuItemId: counterOffer, quantity: "1" }],
    });
    expect(parked.status).toBe(200);
    const check = await assertMadeHere(id);
    const placed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/place`,
      {},
    );
    expect(placed.status).toBe(200);
    await check();
  });

  it("deviceSaleCfgOf sends a pay-first bill when its cash payment completes it", async () => {
    const id = randomUUID();
    const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      id,
      lines: [{ menuItemId: counterOffer, quantity: "1" }],
    });
    expect(parked.status).toBe(200);
    const check = await assertMadeHere(id);
    const payment = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "3.00",
      method: "cash",
      tendered: "3.00",
      applied: "3.00",
      tip: "0.00",
    };
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments`,
      payment,
    );
    expect(paid.status).toBe(200);
    expect(paid.json.madeHere).toEqual([
      expect.objectContaining({ name: "Caña", lineId: expect.any(String) }),
    ]);
    const replay = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments`,
      payment,
    );
    expect(replay.json.madeHere).toEqual(paid.json.madeHere);
    await check();
  });

  it("replays a made-here line added before a fully paid edit retries with the device till", async () => {
    const party = await seatedWith(venue);
    const submitted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }], release: "fire" },
        ],
      },
    );
    expect(submitted.status).toBe(200);
    const payment = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "3.00",
      method: "cash",
      tendered: "3.00",
      applied: "3.00",
      tip: "0.00",
    };
    expect(
      (
        await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/working-orders/${party.tabId}/payments`,
          payment,
        )
      ).status,
    ).toBe(200);
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, party.tabId)),
    );

    const edited = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}`,
      {
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
        revision: order!.revision,
      },
    );

    expect(edited.status).toBe(200);
    expect(edited.json.madeHere).toEqual([
      expect.objectContaining({ name: "Caña", quantity: "1.000" }),
    ]);
    const replay = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      payment,
    );
    expect(replay.status).toBe(200);
    expect(replay.json.madeHere).toEqual(edited.json.madeHere);
  });

  it("replays a pay-first send when an adjustment completes a partly paid bill", async () => {
    const { orderId, lineId } = await parkedLager();
    const reasonId = await inTx(
      venue,
      async (tx) =>
        (
          await createAdjustmentReason(tx, {
            name: `Finish ${randomUUID()}`,
            names: { "es-ES": "Descuento" },
            actions: ["discount_amount"],
            maxPercentBp: null,
            maxAmount: decimal("3.00"),
            applyRole: "staff",
            approverRole: "staff",
            noteRequired: false,
          })
        ).id,
    );
    const part = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${orderId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "2.00",
        method: "cash",
        tendered: "2.00",
        applied: "2.00",
        tip: "0.00",
      },
    );
    expect(part.status).toBe(200);
    expect(part.json).not.toHaveProperty("madeHere");
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, orderId)),
    );
    const body = {
      submissionId: randomUUID(),
      expectedRevision: order!.revision,
      lineId,
      reasonId,
      action: "discount_amount",
      amount: "1.00",
      note: null,
    };
    const first = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${orderId}/adjustments`,
      body,
    );
    expect(first.status).toBe(200);
    expect(first.json.madeHere).toEqual([expect.objectContaining({ name: "Caña", lineId })]);
    const replay = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${orderId}/adjustments`,
      body,
    );
    expect(replay.json.madeHere).toEqual(first.json.madeHere);
  });

  it("the background payment loop has no device and prints the drink", async () => {
    const { orderId, lineId } = await parkedLager();
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, lineId)),
      ),
    ).toEqual([]);
    const jobsBefore = await inTx(venue, (tx) =>
      tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const [payment] = await inTx(venue, (tx) =>
      tx
        .insert(billPayments)
        .values({
          workingOrderId: orderId,
          submissionId: randomUUID(),
          fingerprint: "background",
          kind: "contribution",
          method: "card",
          applied: 300,
          tip: 0,
          state: "pending",
          requestedBy: venue.operatorId,
          tillId: venue.deviceTillId,
        })
        .returning({ id: billPayments.id }),
    );
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        workingOrderId: brandWorkingOrderId(orderId),
        provider: "fake",
        paymentRef: `background-${randomUUID()}`,
        amount: decimal("3.00"),
        settledAt: new Date(),
        billPaymentId: payment!.id,
      }),
    );
    const pass = await settlePendingBillPayments({
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
    });
    expect(pass).toMatchObject({ received: 1 });
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, lineId)),
    );
    expect(item).toMatchObject({ madeHere: false, state: "queued" });
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobsBefore.length + 1);
  });

  it("/api/bills/:id/move sends an unsent counter drink into table service", async () => {
    const { orderId, lineId } = await parkedLager();
    const party = await seatedWith(venue);
    const check = await lineCheck(lineId);
    const moved = await send(venue.app, venue.cookie, "POST", `/api/bills/${orderId}/move`, {
      to: { tableId: party.tableId },
      otherPartyId: party.partyId,
      expectedOtherPartyRevision: party.revision,
    });
    expect(moved.status).toBe(200);
    await check();
  });

  it("/api/parties/:id/move sends a zone-less party's unsent drink", async () => {
    const bare = await bareParty();
    const target = await inTx(venue, (tx) =>
      createTable(tx, venue.cfg, { label: `Target ${randomUUID()}`, zoneId: venue.zoneId }),
    );
    const check = await lineCheck(bare.lineId);
    const moved = await send(venue.app, venue.cookie, "POST", `/api/parties/${bare.partyId}/move`, {
      toTableId: target.id,
      expectedPartyRevision: await revisionOf(bare.partyId),
    });
    expect(moved.status).toBe(200);
    await check();
  });

  it("/api/parties/:id/join sends a zone-less party's unsent drink", async () => {
    const bare = await bareParty();
    const seated = await seatedWith(venue);
    const check = await lineCheck(bare.lineId);
    const joined = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${seated.partyId}/join`,
      {
        tableId: bare.tableId,
        expectedPartyRevision: await revisionOf(seated.partyId),
        otherPartyId: bare.partyId,
        expectedOtherPartyRevision: await revisionOf(bare.partyId),
      },
    );
    expect(joined.status).toBe(200);
    await check();
  });

  it("PUT /api/working-orders/:id/lines/:lineNo makes added adjusted units here even from a held group", async () => {
    const bare = await bareParty();
    const jobsBefore = await inTx(venue, (tx) =>
      tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, bare.orderId)),
    );
    const discounted = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${bare.orderId}/adjustments`,
      {
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: bare.lineId,
        reasonId: discountReasonId,
        action: "discount_percent",
        percentBp: 1000,
        note: null,
      },
    );
    expect(discounted.status).toBe(200);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, bare.lineId)),
      ),
    ).toEqual([]);
    const edited = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${bare.orderId}/lines/1`,
      { revision: discounted.json.revision, quantity: "2" },
    );
    expect(edited.status).toBe(200);
    const lines = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, bare.orderId)),
    );
    expect(lines).toHaveLength(2);
    const newId = lines.find((line) => line.id !== bare.lineId)!.id;
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, newId)),
    );
    expect(item).toMatchObject({ madeHere: true, state: "ready" });
    const [original] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, bare.lineId)),
    );
    expect(original).toBeUndefined();
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobsBefore.length);
  });

  it("/api/parties/:id/split-table sends the selected bill when it enters table service", async () => {
    const bare = await bareParty();
    const second = await parkedLager();
    const sessionOnly = venue.cookie.split(";")[0]!;
    const moved = await send(venue.app, sessionOnly, "POST", `/api/bills/${second.orderId}/move`, {
      to: { tableId: bare.tableId },
      bills: "separate",
      otherPartyId: bare.partyId,
      expectedOtherPartyRevision: await revisionOf(bare.partyId),
    });
    expect(moved.status).toBe(200);
    const groups = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${bare.partyId}/groups`,
    );
    const [secondLine] = await inTx(venue, (tx) =>
      tx
        .select({ groupId: workingOrderLines.groupId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, second.lineId)),
    );
    const held = (groups.json.groups as { id: string; state: string }[]).find(
      (group) => group.id === secondLine!.groupId,
    );
    expect(held).toBeDefined();
    const fired = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${bare.partyId}/groups/${held!.id}/fire`,
      { submissionId: randomUUID(), expectedPartyRevision: groups.json.revision },
    );
    expect(fired.status).toBe(200);
    const service = await inTx(venue, (tx) =>
      createTable(tx, venue.cfg, { label: `Service ${randomUUID()}`, zoneId: venue.zoneId }),
    );
    const joined = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${bare.partyId}/join`,
      { tableId: service.id, expectedPartyRevision: await revisionOf(bare.partyId) },
    );
    expect(joined.status).toBe(200);
    const check = await lineCheck(second.lineId);
    const split = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${bare.partyId}/split-table`,
      {
        tableId: service.id,
        billId: second.orderId,
        expectedPartyRevision: await revisionOf(bare.partyId),
      },
    );
    expect(split.status).toBe(200);
    await check();
  });

  it("a changed ordinary dish keeps its first made-here decision", async () => {
    const dish = await ordinaryBarDish();
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, dish.tabId)),
    );
    const jobsBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const changed = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${dish.tabId}`,
      {
        revision: order!.revision,
        lines: [
          {
            workingOrderLineId: dish.lineId,
            menuItemId: venue.offerFor("Caña"),
            quantity: "1",
            note: "cold",
          },
        ],
      },
    );
    expect(changed.status).toBe(200);
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, dish.lineId)),
    );
    expect(item).toMatchObject({ madeHere: false });
    const jobsAfter = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    expect(jobsAfter).toHaveLength(jobsBefore.length + 2);
    const fresh = jobsAfter
      .filter((job) => !jobsBefore.some((old) => old.id === job.id))
      .map((job) => decodeTicket(job.payload));
    expect(fresh.some((ticket) => ticket.includes("RECALLED"))).toBe(true);
    expect(fresh.some((ticket) => ticket.includes("CANA") && !ticket.includes("RECALLED"))).toBe(
      true,
    );
  });

  it("units raised on an ordinary dish follow its first made-here decision", async () => {
    const dish = await ordinaryBarDish();
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, dish.tabId)),
    );
    const jobsBefore = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
    );
    const raised = await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${dish.tabId}`, {
      revision: order!.revision,
      lines: [
        { workingOrderLineId: dish.lineId, menuItemId: venue.offerFor("Caña"), quantity: "2" },
      ],
    });
    expect(raised.status).toBe(200);
    const lines = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, dish.tabId)),
    );
    const added = lines.find((line) => line.id !== dish.lineId)!;
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, added.id)),
    );
    expect(item).toMatchObject({ madeHere: false });
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinterId)),
      ),
    ).toHaveLength(jobsBefore.length + 1);
  });
});
