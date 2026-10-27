import { observedGroupSender } from "./testing/group-composition-fixture.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { kitchenPrintJobs, kitchenStations, printJobs, parties } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createPrinter, MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { attachPrinterToStation } from "./station-printers.js";
import { createTable } from "./testing/live-table.js";
import {
  inTx,
  provisionBillVenue,
  send as rawGroupSend,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// The printing problems the groups read answers with, and the retired print-problems route's 404;
// what counts as a problem is pinned in `print-problems.test.ts`.
let venue: BillVenue;
let stationId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    stationId = await inTx(venue, async (tx) => {
      const [station] = await tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true));
      const { id: printerId } = await createPrinter(
        tx,
        { locationId: venue.cfg.locationId },
        { name: "Cocina", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
      );
      await attachPrinterToStation(tx, {
        locationId: venue.cfg.locationId,
        stationId: station!.id,
        printerId,
      });
      return station!.id;
    });
  },
});

/** A seated table with one fired group of Pulpo, its kitchen ticket just queued. */
async function tableWithTicket() {
  const { id: tableId } = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `P-${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  const seat = await send(venue.app, venue.cookie, "POST", `/api/tables/${tableId}/seat`, {});
  expect(seat.status).toBe(200);
  const { partyId, tabId } = seat.json as unknown as { partyId: string; tabId: string };
  const [party] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  const submitted = await send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/groups`, {
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
    allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    groups: [{ lines: [{ menuItemId: venue.offerFor("Pulpo"), quantity: "1" }], release: "fire" }],
  });
  expect(submitted.status).toBe(200);
  const [link] = await inTx(venue, (tx) =>
    tx
      .select({ jobId: kitchenPrintJobs.printJobId })
      .from(kitchenPrintJobs)
      .where(eq(kitchenPrintJobs.workingOrderId, tabId)),
  );
  return { partyId, tabId, jobId: link!.jobId };
}

/** A seated table with one fired group of Pulpo, whose kitchen ticket failed every attempt. */
async function tableWithFailedTicket() {
  const { partyId, tabId, jobId } = await tableWithTicket();
  const [job] = await inTx(venue, (tx) =>
    tx
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
      .where(eq(printJobs.id, jobId))
      .returning({ createdAt: printJobs.createdAt }),
  );
  return { partyId, tabId, since: job!.createdAt };
}

describe("GET /api/parties/:id/print-problems", () => {
  it("answers like an unknown route now that the groups read carries the problems", async () => {
    const table = await tableWithFailedTicket();

    const missing = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${table.partyId}/no-such-read`,
    );
    const retired = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${table.partyId}/print-problems`,
    );

    expect(retired.status).toBe(404);
    expect({ status: retired.status, json: retired.json }).toEqual({
      status: missing.status,
      json: missing.json,
    });
  });
});

describe("GET /api/parties/:id/groups printProblems", () => {
  it("the groups read carries the party's printing problems", async () => {
    const table = await tableWithFailedTicket();

    const answer = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${table.partyId}/groups`,
    );

    expect(answer.status).toBe(200);
    expect((answer.json as { printProblems?: unknown }).printProblems).toEqual([
      {
        workingOrderId: table.tabId,
        stationId,
        stationName: expect.any(String),
        since: table.since,
      },
    ]);
  });

  it("answers no printing problem while a fresh ticket is still waiting", async () => {
    const table = await tableWithTicket();

    const answer = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${table.partyId}/groups`,
    );

    expect(answer.status).toBe(200);
    expect((answer.json as { printProblems?: unknown }).printProblems).toEqual([]);
  });
});

const send = observedGroupSender(() => venue.db, rawGroupSend);
