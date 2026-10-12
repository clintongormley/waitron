import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { invoiceDeliveries, pagePrinters, printAgents, tenants } from "@waitron/db";
import { hashSecret } from "@waitron/identity";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Alert } from "@waitron/module";
import { startServer, type StartedServer } from "./boot.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import { recordSyntheticInvoice } from "./testing/synthetic-invoice.js";

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const instant = new Date("2026-10-12T10:00:00.000Z");

type Venue = Awaited<ReturnType<typeof setupVenue>>;

/** A synthetic full invoice in series `FB`, so its number is `FB/1`. */
async function fullInvoice(venue: Venue): Promise<string> {
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved issuer address" });
  return (await recordSyntheticInvoice(suite.db, venue.cfg.nodeId, { seriesCode: "FB" })).saleId;
}

/** Starts the server on the suite's venue, runs `use` against its base URL, and stops it. */
async function withServer(venue: Venue, use: (base: string) => Promise<void>): Promise<void> {
  const [port] = await freePorts(1);
  let scratch: string | undefined;
  let server: StartedServer | undefined;
  try {
    scratch = await mkdtemp(join(tmpdir(), "waitron-boot-invoice-alert-"));
    const migrationsRoot = join(scratch, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const env = {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
      WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
    };
    server = await startServer(env, env);
    const base = `http://127.0.0.1:${port}`;
    await vi.waitFor(async () => {
      expect((await fetch(`${base}/health`)).status).toBe(200);
    });
    await use(base);
  } finally {
    if (server !== undefined) await server.close();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  }
}

async function invoiceAlerts(base: string, venue: Venue): Promise<Alert[]> {
  const response = await fetch(`${base}/management-api/alerts`, {
    headers: { cookie: venue.managerCookie },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { alerts: Alert[] };
  return body.alerts.filter((alert) => alert.area === "invoice_delivery");
}

describe("the running server's undelivered invoice alert", () => {
  it("reports a full invoice whose original failed through the alerts API", async () => {
    const venue = await setupVenue(suite.db);
    const saleId = await fullInvoice(venue);
    await suite.db.insert(invoiceDeliveries).values({
      saleId,
      requestKey: "email-one",
      medium: "email",
      designation: "original",
      status: "failed",
      generation: 1,
      recipient: "customer@example.test",
      personId: "staff-one",
      failureCode: "transport_failed",
      reportedAt: instant.toISOString(),
    });

    await withServer(venue, async (base) => {
      expect(await invoiceAlerts(base, venue)).toEqual([
        {
          key: `invoice_delivery.undelivered:${saleId}`,
          code: "invoice_delivery.failed",
          params: { invoice: "FB/1" },
          severity: "error",
          since: instant.toISOString(),
          screen: "orders",
          kind: "ongoing",
          area: "invoice_delivery",
        },
      ]);
    });
  });

  it("names the hold of a test page requested through the route ahead of a waiting A4", async () => {
    const venue = await setupVenue(suite.db);
    const secret = "synthetic-agent-secret";
    const [agent] = await suite.db
      .insert(printAgents)
      .values({
        locationId: venue.cfg.locationId,
        name: "Office agent",
        tokenHash: hashSecret(secret),
      })
      .returning({ id: printAgents.id });
    const [office] = await suite.db
      .insert(pagePrinters)
      .values({
        locationId: venue.cfg.locationId,
        name: "Back office",
        host: "192.0.2.20",
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 600,
        agentId: agent!.id,
      })
      .returning({ id: pagePrinters.id });
    const saleId = await fullInvoice(venue);

    await withServer(venue, async (base) => {
      const agentAuth = {
        authorization: `Bearer ${agent!.id}.${secret}`,
        "content-type": "application/json",
      };
      const requested = await fetch(
        `${base}/management-api/page-printers/${office!.id}/test-page`,
        {
          method: "POST",
          headers: { cookie: venue.managerCookie },
        },
      );
      expect(requested.status).toBe(202);
      const claimed = await fetch(`${base}/print-api/agent/page-jobs/claim`, {
        method: "POST",
        headers: agentAuth,
      });
      expect(claimed.status).toBe(200);
      const job = (await claimed.json()) as { id: string; generation: number; token: string };
      const renewed = await fetch(`${base}/print-api/agent/page-jobs/${job.id}/renew`, {
        method: "POST",
        headers: agentAuth,
        body: JSON.stringify({ generation: job.generation, token: job.token, hold: "paper_out" }),
      });
      expect(renewed.status).toBe(204);
      const due = new Date(Date.now() - 3 * 60_000).toISOString();
      await suite.db.insert(invoiceDeliveries).values({
        saleId,
        requestKey: "a4-one",
        medium: "a4",
        designation: "original",
        status: "queued",
        generation: 1,
        pagePrinterId: office!.id,
        personId: "staff-one",
        nextAttemptAt: due,
      });

      expect(await invoiceAlerts(base, venue)).toEqual([
        {
          key: `invoice_delivery.undelivered:${saleId}`,
          code: "invoice_delivery.queued_behind_hold",
          params: { invoice: "FB/1", printer: "Back office", hold: "paper_out" },
          severity: "error",
          since: due,
          screen: "orders",
          kind: "ongoing",
          area: "invoice_delivery",
        },
      ]);
    });
  });
});
