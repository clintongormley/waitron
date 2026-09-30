import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { kitchenPrintJobs, kitchenStations, parties, printJobs } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import { PRINTER_UNPAIRED, createPrinter } from "@waitron/printing";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { acceptPrintAgentJoinRequest } from "./join-requests.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountPrintApi } from "./print-api.js";
import { attachPrinterToStation } from "./station-printers.js";
import { createTable } from "./tables.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import "./errors.js";

// A kitchen ticket ended by a Bluetooth unpairing, read back through the till's printing-problem
// route; what counts as a problem is pinned in `print-problems.test.ts`.
const MAC = "5A:4A:45:D4:FB:BB";

let venue: BillVenue;
let stationId: string;
let managerCookie: string;
let printApi: Hono;

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
        { name: "Cocina", transport: "bluetooth", localKey: MAC },
      );
      await attachPrinterToStation(tx, { stationId: station!.id, printerId });
      return station!.id;
    });
    const session = await inTx(venue, (tx) =>
      startManagementSession(tx, { personId: venue.adminId }),
    );
    managerCookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    const pairingMode = createPairingMode();
    pairingMode.open();
    printApi = new Hono();
    mountPrintApi(
      printApi,
      {
        db,
        cfg: venue.cfg,
        pairingMode,
        readMembership: async () => null,
        venueLocale: "es-ES",
      },
      () => {},
    );
  },
});

async function printApiCall(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; cookie?: string; bearer?: string },
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie !== undefined) headers["cookie"] = opts.cookie;
  if (opts.bearer !== undefined) headers["authorization"] = `Bearer ${opts.bearer}`;
  return printApi.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

/** An accepted agent reporting the kitchen printer paired, with an Unpair for it queued. */
async function agentUnpairingTheKitchenPrinter(): Promise<{ token: string; commandId: string }> {
  const knock = await printApiCall("POST", "/print-api/agent/join", { body: { name: "Box" } });
  expect(knock.status).toBe(201);
  const { token, verificationNumber } = (await knock.json()) as {
    token: string;
    verificationNumber: string;
  };
  const agentId = token.slice(0, token.indexOf("."));
  await inTx(venue, async (tx) => {
    const accepted = await acceptPrintAgentJoinRequest(tx, venue.cfg, agentId, {
      choice: verificationNumber,
    });
    expect(accepted.ok).toBe(true);
  });
  const paired = await printApiCall("POST", "/print-api/agent/jobs", {
    bearer: token,
    body: { pairedBluetooth: [{ localKey: MAC }] },
  });
  expect(paired.status).toBe(200);
  const queued = await printApiCall(
    "POST",
    `/management-api/print-agents/${agentId}/bluetooth/forget`,
    { cookie: managerCookie, body: { address: MAC } },
  );
  expect(queued.status).toBe(202);
  const { command } = (await queued.json()) as { command: { id: string } };
  return { token, commandId: command.id };
}

/** A seated table with one fired group of Pulpo, whose kitchen ticket waits for the printer. */
async function tableWithWaitingTicket() {
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

describe("a kitchen ticket ended by a Bluetooth unpairing", () => {
  it("shows as the table's printing problem", async () => {
    const { token, commandId } = await agentUnpairingTheKitchenPrinter();
    const table = await tableWithWaitingTicket();
    const before = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${table.partyId}/print-problems`,
    );
    expect(before.json).toEqual({ problems: [] });

    const reported = await printApiCall("POST", "/print-api/agent/jobs", {
      bearer: token,
      body: { bluetoothOutcomes: [{ id: commandId, ok: true }] },
    });
    expect(reported.status).toBe(200);

    const [job] = await inTx(venue, (tx) =>
      tx
        .select({ lastError: printJobs.lastError, createdAt: printJobs.createdAt })
        .from(printJobs)
        .where(eq(printJobs.id, table.jobId)),
    );
    expect(job!.lastError).toBe(PRINTER_UNPAIRED);
    const answer = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${table.partyId}/print-problems`,
    );
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      problems: [
        {
          workingOrderId: table.tabId,
          stationId,
          stationName: expect.any(String),
          since: job!.createdAt,
        },
      ],
    });
  });
});
