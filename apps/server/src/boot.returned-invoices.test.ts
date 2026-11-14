import { seedModuleSettings } from "../test/module-settings.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readReturnedOriginals } from "@waitron/fiscal-verifactu/src/handover-return.js";
import { VERIFACTU_HANDOVER } from "@waitron/fiscal-verifactu/src/handover-summary.js";
import {
  appendOriginalForReturn,
  copyReturnFiscalMetadata,
  seedReturnNodeForVenue,
} from "@waitron/fiscal-verifactu/src/testing/returned-invoice.js";
import type { CanonicalValue } from "@waitron/membership";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import type { StartedServer } from "./boot.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const source = useVenueDb({ migrations });
const receiver = useVenueDb({ migrations });

it("serves a real returned invoice through the booted fiscal backend and report route", async () => {
  beforeServerStarts();
  const venue = await setupVenue(receiver.db);
  const node = await seedReturnNodeForVenue(source.db, receiver.db);
  await copyReturnFiscalMetadata(source.db, receiver.db);
  await appendOriginalForReturn(source.db, node, 1);
  const batch = await withTransaction(source.db, (tx) => readReturnedOriginals(tx, node.nodeId));
  const receivedAt = new Date("2026-07-21T18:00:00Z");
  expect(
    await withTransaction(receiver.db, (tx) =>
      VERIFACTU_HANDOVER.returnRecords!.receive(
        tx,
        node.nodeId,
        batch as unknown as CanonicalValue,
        receivedAt,
        [],
      ),
    ),
  ).toBe(true);
  const scratch = await mkdtemp(join(tmpdir(), "waitron-returned-invoice-boot-"));
  let server: StartedServer | undefined;
  try {
    await copyMigrationsRoot(join(scratch, "migrations"));
    await seedModuleSettings(receiver.db, { "fiscal-none": false });
    const database = receiver.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    server = await startServer({
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_NODE_ID: venue.cfg.nodeId,
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_ENV: "preproduction",
    });
    const warning = await fetch(
      `http://127.0.0.1:${httpPort()}/management-api/reports/handover-warning`,
      { headers: { cookie: venue.managerCookie } },
    );
    expect(warning.status).toBe(200);
    expect(await warning.json()).toEqual({
      hasEmergencyHandover: false,
      hasReturnedInvoices: true,
    });
    const response = await fetch(
      `http://127.0.0.1:${httpPort()}/management-api/reports/returned-invoices`,
      { headers: { cookie: venue.managerCookie } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      records: [
        {
          recordId: batch.records[0]!.id,
          invoiceNumber: "A/1",
          taxable: "102.02",
          receivedAt: receivedAt.toISOString(),
        },
      ],
      nextOffset: null,
    });
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60000);
