import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite: capture runs under FORCE ROW LEVEL SECURITY as the non-superuser app
// role, which PGlite (superuser) bypasses — a false pass (CLAUDE.md §4). The full manifest runs
// (startRealPostgres → applyMigrations over the whole manifest, `sync` last), so the container carries
// the sync_capture triggers over the enrolled commercial tables (catalogues, payments, …).
//
// origin.gate.test.ts already proves withTenant's 4th arg reaches sync_log.origin_id for a raw write;
// THIS suite guards that the real API call sites (fix B) actually pass cfg.nodeId / deps.nodeId, so the
// enrolled writes those paths perform capture a real origin rather than the all-zero sentinel.
const LOCALE = "es-ES";

const suite = useRealPostgres({
  start: startRealPostgres,
  timeoutMs: 180_000,
});

/** A no-op logger: only the HTTP responses and the captured sync_log rows matter here. */
const noopLog: Logger = () => {};

// A producing node's id, and the all-zero uuid capture defaults origin to when app.node_id is unset.
const NODE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ZERO = "00000000-0000-0000-0000-000000000000";

// mountCatalogueApi needs a real media directory on deps even though the catalogue POST never writes one.
let mediaDir: string;
beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), "waitron-sync-origin-rls-"));
});
afterAll(async () => {
  if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
});

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling RLS suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `person.manage`). */
  managerCookie: string;
}

/** Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant — seed a
 * MANAGER and mint a live management session, returning the cookie the catalogue routes read. Each test
 * gets its OWN tenant, so its captured sync_log rows are that test's alone and order-independent. */
async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );

  const managerSid = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    return managerSession.id;
  });

  return { tenantId: venue.tenantId, managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}` };
}

/** Mounts the catalogue API for one tenant under a given producing node id. */
function mountApp(tenantId: string, nodeId: string): Hono {
  const app = new Hono();
  mountCatalogueApi(app, { db: suite.admin, cfg: { tenantId, nodeId }, mediaDir, maxUploadBytes: 1024 * 1024 }, noopLog);
  return app;
}

/** POST a catalogue via the manager cookie, asserting 201, and return nothing — the sync_log row it
 * captured is read back separately. */
async function postCatalogue(app: Hono, cookie: string, name: string): Promise<void> {
  const res = await app.request("/management-api/catalogues", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
}

/** The origin_id captured for this tenant's most recent `catalogues` write (RLS-bypassing admin read). */
async function catalogueOrigin(tenantId: string): Promise<string | null> {
  const r = await suite.admin.execute<{ v: string | null }>(
    sql`select origin_id::text as v from sync_log
        where table_name = 'catalogues' and tenant_id = ${tenantId}
        order by seq desc limit 1`,
  );
  return r.rows[0]?.v ?? null;
}

describe("sync origin attribution through the real API call sites (fix B)", () => {
  it("a catalogue write captures sync_log.origin_id = cfg.nodeId (all-zero without the fix)", async () => {
    // Guard-by-deletion: with fix B, catalogue-api's `gated` passes { nodeId: cfg.nodeId } to
    // withTenant, so the enrolled catalogues INSERT captures NODE_C. Revert the fix (drop the 4th arg)
    // and app.node_id is unset → capture falls back to the all-zero origin → this expect fails.
    const venue = await setupVenue();
    const app = mountApp(venue.tenantId, NODE_C);
    await postCatalogue(app, venue.managerCookie, "Carta con origen");
    expect(await catalogueOrigin(venue.tenantId)).toBe(NODE_C);

    // Control (the two directions visibly differ, CLAUDE.md §1): the SAME path under the all-zero node
    // id captures the all-zero origin — so the captured origin tracks cfg.nodeId, not a constant.
    const zeroVenue = await setupVenue();
    const zeroApp = mountApp(zeroVenue.tenantId, ZERO);
    await postCatalogue(zeroApp, zeroVenue.managerCookie, "Carta sin origen");
    expect(await catalogueOrigin(zeroVenue.tenantId)).toBe(ZERO);
  });
});
