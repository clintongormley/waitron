import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { kitchenPrintJobs, kitchenStations, printJobs, visits } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createPrinter, MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { attachPrinterToStation } from "./station-printers.js";
import { createTable } from "./tables.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import "./errors.js";

// The HTTP layer of `GET /api/visits/:id/print-problems`; what counts as a problem is pinned in
// `print-problems.test.ts`.
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
      await attachPrinterToStation(tx, { stationId: station!.id, printerId });
      return station!.id;
    });
  },
});

/** A seated table with one fired group of Pulpo, whose kitchen ticket failed every attempt. */
async function tableWithFailedTicket() {
  const { id: tableId } = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `P-${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  const seat = await send(venue.app, venue.cookie, "POST", `/api/tables/${tableId}/seat`, {});
  expect(seat.status).toBe(200);
  const { visitId, tabId } = seat.json as unknown as { visitId: string; tabId: string };
  const [visit] = await inTx(venue, (tx) =>
    tx.select({ revision: visits.revision }).from(visits).where(eq(visits.id, visitId)),
  );
  const submitted = await send(venue.app, venue.cookie, "POST", `/api/visits/${visitId}/groups`, {
    submissionId: randomUUID(),
    expectedVisitRevision: visit!.revision,
    groups: [{ lines: [{ menuItemId: venue.offerFor("Pulpo"), quantity: "1" }], release: "fire" }],
  });
  expect(submitted.status).toBe(200);
  const [link] = await inTx(venue, (tx) =>
    tx
      .select({ jobId: kitchenPrintJobs.printJobId })
      .from(kitchenPrintJobs)
      .where(eq(kitchenPrintJobs.workingOrderId, tabId)),
  );
  const [job] = await inTx(venue, (tx) =>
    tx
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
      .where(eq(printJobs.id, link!.jobId))
      .returning({ createdAt: printJobs.createdAt }),
  );
  return { visitId, tabId, since: job!.createdAt };
}

describe("GET /api/visits/:id/print-problems", () => {
  it("answers 200 with the visit's printing problems", async () => {
    const table = await tableWithFailedTicket();

    const answer = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/visits/${table.visitId}/print-problems`,
    );

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      problems: [
        {
          workingOrderId: table.tabId,
          stationId,
          stationName: expect.any(String),
          since: table.since,
        },
      ],
    });
  });

  it("refuses 401 session.required without a session", async () => {
    const table = await tableWithFailedTicket();

    const answer = await send(venue.app, "", "GET", `/api/visits/${table.visitId}/print-problems`);

    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "session.required" });
  });

  it.each([randomUUID(), "not-a-visit"])(
    "refuses 409 visit.not_open for an unknown visit id: %s",
    async (visitId) => {
      const answer = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/visits/${visitId}/print-problems`,
      );

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "visit.not_open", params: { visitId } });
    },
  );
});
