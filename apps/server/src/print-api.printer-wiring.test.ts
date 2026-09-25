import { LiveEvents, changeSubscriber, mountLiveApi } from "./live-api.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  kitchenStations,
  locations,
  nowIso,
  printAgents,
  printJobs,
  tenants,
  tills,
  withTransaction,
  installChangeFeed,
  subscribeToChanges,
  CORE_CHANGE_SOURCES,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { enqueuePrintJob } from "@waitron/printing";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { mountPrintApi } from "./print-api.js";
import { acceptPrintAgentJoinRequest } from "./join-requests.js";
import { createPairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * The routes only this half of the pair drives: the station ↔ printer mapping, a till's receipt
 * printer, a location's print mode and drawer-open policy, the tills list, the change events and the
 * job resend, plus the `printer.manage` gate and the key-scoped claim eligibility.
 */
const noopLog: Logger = () => {};

interface Tenant {
  locationId: string;
}

let tenantA: Tenant;
let managerCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(76_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function seedTenantWithLocation(): Promise<Tenant> {
  // Through the table definitions: `tenants.created_at` and `locations.id` are `$defaultFn`
  // generators a raw insert never reaches.
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: nextNif(), legalName: "Deli Test SL" });
  const [loc] = await suite.db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  return { locationId: loc!.id };
}

beforeAll(async () => {
  tenantA = await seedTenantWithLocation();
  const { managerSid, staffSid } = await withTransaction(suite.db, async (tx) => {
    const [mgr] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    const managerSession = await startManagementSession(tx, {
      personId: mgr!.id,
    });
    const staffSession = await startManagementSession(tx, {
      personId: stf!.id,
    });
    return { managerSid: managerSession.token, staffSid: staffSession.token };
  });
  managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
  staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
});

/** Every join-request statement filters by `cfg.nodeId`, so the knock and the accept must name the
 * same node. */
const venueNodeId = brandNodeId(randomUUID());

function cfgOf(tenant: Tenant): TillConfig {
  return {
    tillId: brandTillId(randomUUID()),
    nodeId: venueNodeId,
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(tenant.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "ticket_then_pay",
  };
}

function mountApp(tenant: Tenant): Hono {
  const app = new Hono();
  const pairingMode = createPairingMode();
  pairingMode.open();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg: cfgOf(tenant),
      pairingMode,
      readMembership: async () => null,
      venueLocale: "es-ES",
    },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown; cookie?: string; bearer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined) headers["cookie"] = opts.cookie;
  if (opts.bearer !== undefined) headers["authorization"] = `Bearer ${opts.bearer}`;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

/** Accepts through the verb; the accept route is `join-api.ts`'s. */
async function joinAndAccept(
  app: Hono,
  label: string,
  tenant: Tenant = tenantA,
): Promise<{ agentId: string; token: string }> {
  const knock = await send(app, "POST", "/print-api/agent/join", { body: { name: label } });
  expect(knock.status).toBe(201);
  const { token, verificationNumber } = (await knock.json()) as {
    token: string;
    verificationNumber: string;
  };
  const joinId = token.slice(0, token.indexOf("."));
  await withTransaction(suite.db, async (tx) => {
    const result = await acceptPrintAgentJoinRequest(tx, cfgOf(tenant), joinId, {
      choice: verificationNumber,
    });
    expect(result.ok).toBe(true);
  });
  return { agentId: joinId, token };
}

async function createPrinter(app: Hono, agentId: string, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "network_tcp", agentId, host: "10.0.0.9" },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createUsbPrinter(app: Hono, localKey: string, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "usb", localKey },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function enqueue(tenant: Tenant, printerId: string, payload: Uint8Array): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { jobId } = await enqueuePrintJob(tx, tenant, printerId, payload);
    return jobId;
  });
}

async function seedStation(tenant: Tenant, name: string): Promise<string> {
  // Through the table definition: `id` and `created_at` are `$defaultFn` generators a raw insert
  // never reaches.
  const [row] = await suite.db
    .insert(kitchenStations)
    .values({ locationId: tenant.locationId, name, isDefault: false, active: true })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

/** Through the table definition, so the `flag` column's read mapping turns the stored 0/1 into a
 * boolean. */
async function agentActive(agentId: string): Promise<boolean> {
  const [row] = await suite.db
    .select({ active: printAgents.active })
    .from(printAgents)
    .where(eq(printAgents.id, agentId));
  return row!.active;
}

/** `joinAndAccept` mints only human-enrolled agents (`node_id` null), so a self-enrolled one is
 * inserted directly. `node_id` is unique, so each call needs a fresh one. */
async function seedNodeAgent(tenant: Tenant, nodeId: string): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({
      locationId: tenant.locationId,
      name: "Self-enrolled",
      nodeId,
      tokenHash: "x",
    })
    .returning({ id: printAgents.id });
  return row!.id;
}

describe("Print API — the agent lifecycle end to end", () => {
  it("enrol → claim (the status written inside the request) → report done", async () => {
    const app = mountApp(tenantA);
    const { agentId, token } = await joinAndAccept(app, "Cocina");
    const printerId = await createPrinter(app, agentId, "Cocina real");
    const jobId = await enqueue(tenantA, printerId, new Uint8Array([0x41, 0x42]));

    const claim = await send(app, "POST", "/print-api/agent/jobs", { bearer: token });
    expect(claim.status).toBe(200);
    expect(((await claim.json()) as { jobs: { id: string }[] }).jobs.map((j) => j.id)).toEqual([
      jobId,
    ]);

    const seen = await suite.db.execute<{ status: string }>(
      sql`select status from print_jobs where id = ${jobId}`,
    );
    expect(seen.rows[0]!.status).toBe("printing");

    const report = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "done" },
    });
    expect(report.status).toBe(204);
    const done = await suite.db.execute<{ status: string; delivered_at: string | null }>(
      sql`select status, delivered_at from print_jobs where id = ${jobId}`,
    );
    expect(done.rows[0]!.status).toBe("done");
    expect(done.rows[0]!.delivered_at).not.toBeNull();
  });

  it("derived eligibility: a usb job is NOT claimed by a box that cannot see its key", async () => {
    const app = mountApp(tenantA);
    const mine = await joinAndAccept(app, "Mine");
    const serial = `SN-${randomUUID()}`;
    const usbPrinter = await createUsbPrinter(app, serial, "Other USB");
    const jobId = await enqueue(tenantA, usbPrinter, new Uint8Array([1]));

    const res = await send(app, "POST", "/print-api/agent/jobs", {
      bearer: mine.token,
      body: { visible: [], scanned: [] },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { jobs: unknown[] }).jobs).toHaveLength(0);
    const untouched = await suite.db.execute<{ status: string }>(
      sql`select status from print_jobs where id = ${jobId}`,
    );
    expect(untouched.rows[0]!.status).toBe("queued");
  });

  it("persists the agent host and edits names", async () => {
    const app = mountApp(tenantA);
    const { agentId, token } = await joinAndAccept(app, "Name before edit");
    const pulled = await send(app, "POST", "/print-api/agent/jobs", {
      bearer: token,
      body: { visible: [], scanned: [], host: "kitchen.local" },
    });
    expect(pulled.status).toBe(200);
    const edited = await send(app, "PATCH", `/management-api/print-agents/${agentId}`, {
      cookie: managerCookie,
      body: { name: "Kitchen" },
    });
    expect(edited.status).toBe(204);
    const listed = await send(app, "GET", "/management-api/print-agents", {
      cookie: managerCookie,
    });
    expect(await listed.json()).toContainEqual(
      expect.objectContaining({ id: agentId, name: "Kitchen", host: "kitchen.local" }),
    );
  });

  it("discovered-printers reads registered keys + agent names", async () => {
    const app = mountApp(tenantA);
    const { agentId, token } = await joinAndAccept(app, "Inventory");
    const registered = `SN-${randomUUID()}`;
    const unregistered = `SN-${randomUUID()}`;
    await send(app, "POST", "/print-api/agent/jobs", {
      bearer: token,
      body: {
        visible: [
          { transport: "usb", localKey: registered, make: "Epson" },
          { transport: "usb", localKey: unregistered },
        ],
        scanned: [],
      },
    });
    await createUsbPrinter(app, registered, "Registered");

    const res = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      agentId: string;
      agentName: string | null;
      localKey?: string;
      alreadyRegistered: boolean;
    }[];
    expect(rows.find((r) => r.localKey === registered)).toMatchObject({
      agentId,
      agentName: "Inventory",
      alreadyRegistered: true,
    });
    expect(rows.find((r) => r.localKey === unregistered)).toMatchObject({
      alreadyRegistered: false,
    });
  });

  it("a REVOKED agent fails the claim instantly (401)", async () => {
    const app = mountApp(tenantA);
    const { agentId, token } = await joinAndAccept(app, "Revocable");
    await createPrinter(app, agentId, "Revocable printer");
    expect((await send(app, "POST", "/print-api/agent/jobs", { bearer: token })).status).toBe(200);

    const revoke = await send(app, "POST", `/management-api/print-agents/${agentId}/revoke`, {
      cookie: managerCookie,
    });
    expect(revoke.status).toBe(204);
    const afterRevoke = await send(app, "POST", "/print-api/agent/jobs", { bearer: token });
    expect(afterRevoke.status).toBe(401);
  });

  it("the management routes require printer.manage — 401 unauth, 403 staff, 200 manager (gate proven by deletion)", async () => {
    // A `staff`-role session holds no `printer.manage`.
    const app = mountApp(tenantA);

    const unauth = await send(app, "GET", "/management-api/printers");
    expect(unauth.status).toBe(401);
    expect((await unauth.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });

    const staff = await send(app, "GET", "/management-api/print-agents", { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect((await staff.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });

    const manager = await send(app, "GET", "/management-api/print-agents", {
      cookie: managerCookie,
    });
    expect(manager.status).toBe(200);
  });

  it("the discovery routes require printer.manage — 401 unauth, 403 staff, 2xx manager (gate proven by deletion)", async () => {
    const app = mountApp(tenantA);
    const routes = [
      { method: "POST", path: "/management-api/printer-discovery/start" },
      { method: "POST", path: "/management-api/printer-discovery/probe" },
      { method: "GET", path: "/management-api/discovered-printers" },
    ] as const;

    for (const { method, path } of routes) {
      const body = path.endsWith("/probe") ? { host: "192.168.20.247", port: 9100 } : undefined;
      const unauth = await send(app, method, path, { body });
      expect(unauth.status).toBe(401);
      expect((await unauth.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });

      const staff = await send(app, method, path, { cookie: staffCookie, body });
      expect(staff.status).toBe(403);
      expect((await staff.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });

      const manager = await send(app, method, path, {
        cookie: managerCookie,
        body,
      });
      expect(manager.status).toBe(200);
    }
  });

  it("allow-again reactivates a revoked agent (printer.manage)", async () => {
    const app = mountApp(tenantA);
    const { agentId } = await joinAndAccept(app, "Reactivable");
    const revoke = await send(app, "POST", `/management-api/print-agents/${agentId}/revoke`, {
      cookie: managerCookie,
    });
    expect(revoke.status).toBe(204);
    expect(await agentActive(agentId)).toBe(false);

    const allow = await send(app, "POST", `/management-api/print-agents/${agentId}/allow`, {
      cookie: managerCookie,
    });
    expect(allow.status).toBe(204);
    expect(await agentActive(agentId)).toBe(true);
  });

  it("allow-again on an unknown id is agent.not_found (404)", async () => {
    const app = mountApp(tenantA);
    const res = await send(app, "POST", `/management-api/print-agents/${randomUUID()}/allow`, {
      cookie: managerCookie,
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "agent.not_found" },
    });
  });

  it("the agents list carries node provenance", async () => {
    const app = mountApp(tenantA);
    const someNode = randomUUID();
    const id = await seedNodeAgent(tenantA, someNode);
    const res = await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; nodeId: string | null }>;
    expect(rows.find((r) => r.id === id)?.nodeId).toBe(someNode);
  });
});

describe("Station ↔ printer mapping routes (printer.manage)", () => {
  it("attaches, lists both directions, is idempotent, and detaches a pair as a manager", async () => {
    const app = mountApp(tenantA);
    const agent = await joinAndAccept(app, "Mapping agent");
    const printerId = await createPrinter(app, agent.agentId, "Mapping printer");
    const stationId = await seedStation(tenantA, `Cocina ${randomUUID()}`);
    const at = `/management-api/stations/${stationId}/printers/${printerId}`;
    const byStation = `/management-api/stations/${stationId}/printers`;
    const byPrinter = `/management-api/printers/${printerId}/stations`;

    expect((await send(app, "POST", at, { cookie: managerCookie })).status).toBe(204);

    const station = (await (
      await send(app, "GET", byStation, { cookie: managerCookie })
    ).json()) as { stationId: string; printerId: string }[];
    expect(station).toContainEqual({ stationId, printerId });
    const printer = (await (
      await send(app, "GET", byPrinter, { cookie: managerCookie })
    ).json()) as { stationId: string; printerId: string }[];
    expect(printer).toContainEqual({ stationId, printerId });

    expect((await send(app, "POST", at, { cookie: managerCookie })).status).toBe(204);
    expect(
      ((await (await send(app, "GET", byStation, { cookie: managerCookie })).json()) as unknown[])
        .length,
    ).toBe(1);

    expect((await send(app, "DELETE", at, { cookie: managerCookie })).status).toBe(204);
    expect(
      ((await (await send(app, "GET", byStation, { cookie: managerCookie })).json()) as unknown[])
        .length,
    ).toBe(0);
    expect(
      ((await (await send(app, "GET", byPrinter, { cookie: managerCookie })).json()) as unknown[])
        .length,
    ).toBe(0);
  });

  it("404s an unknown station/printer and 400s a malformed id (never a 22P02 → 500)", async () => {
    const app = mountApp(tenantA);
    const agent = await joinAndAccept(app, "Miss agent");
    const printerId = await createPrinter(app, agent.agentId, "Miss printer");
    const stationId = await seedStation(tenantA, `Barra ${randomUUID()}`);

    const noStation = await send(
      app,
      "POST",
      `/management-api/stations/${randomUUID()}/printers/${printerId}`,
      { cookie: managerCookie },
    );
    expect(noStation.status).toBe(404);
    expect(await noStation.json()).toMatchObject({ error: { code: "station.not_found" } });

    const noPrinter = await send(
      app,
      "POST",
      `/management-api/stations/${stationId}/printers/${randomUUID()}`,
      { cookie: managerCookie },
    );
    expect(noPrinter.status).toBe(404);
    expect(await noPrinter.json()).toMatchObject({ error: { code: "printer.not_found" } });

    const malformed = await send(
      app,
      "POST",
      `/management-api/stations/not-a-uuid/printers/${printerId}`,
      { cookie: managerCookie },
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
  });

  it("require printer.manage — 401 unauth, 403 staff, 204 manager (gate proven by deletion via the shared `gated`)", async () => {
    const app = mountApp(tenantA);
    const agent = await joinAndAccept(app, "Gate agent");
    const printerId = await createPrinter(app, agent.agentId, "Gate printer");
    const stationId = await seedStation(tenantA, `Plancha ${randomUUID()}`);
    const at = `/management-api/stations/${stationId}/printers/${printerId}`;

    const unauth = await send(app, "GET", `/management-api/stations/${stationId}/printers`);
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toMatchObject({
      error: { code: "management_session.required" },
    });

    const staff = await send(app, "POST", at, { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });

    const manager = await send(app, "POST", at, { cookie: managerCookie });
    expect(manager.status).toBe(204);
  });
});

async function seedTill(tenant: Tenant, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(tills)
    .values({ locationId: tenant.locationId, name })
    .returning({ id: tills.id });
  return row!.id;
}

async function tillReceiptPrinterId(tillId: string): Promise<string | null> {
  const row = await suite.db.execute<{ receipt_printer_id: string | null }>(
    sql`select receipt_printer_id from tills where id = ${tillId}`,
  );
  return row.rows[0]!.receipt_printer_id;
}

async function locationPrintMode(locationId: string): Promise<string> {
  const row = await suite.db.execute<{ receipt_print_mode: string }>(
    sql`select receipt_print_mode from locations where id = ${locationId}`,
  );
  return row.rows[0]!.receipt_print_mode;
}

async function locationDrawerPolicy(locationId: string): Promise<string> {
  const row = await suite.db.execute<{ drawer_open_policy: string }>(
    sql`select drawer_open_policy from locations where id = ${locationId}`,
  );
  return row.rows[0]!.drawer_open_policy;
}

describe("Receipt-printer + print-mode config routes (printer.manage)", () => {
  it("sets, then clears, a till's receipt printer as a manager (persists both ways)", async () => {
    const app = mountApp(tenantA);
    const agent = await joinAndAccept(app, "Recibos agent");
    const printerId = await createPrinter(app, agent.agentId, "Recibos");
    const tillId = await seedTill(tenantA, `Caja ${randomUUID()}`);

    const set = await send(app, "PATCH", `/management-api/tills/${tillId}/receipt-printer`, {
      cookie: managerCookie,
      body: { printerId },
    });
    expect(set.status).toBe(204);
    expect(await tillReceiptPrinterId(tillId)).toBe(printerId);

    const cleared = await send(app, "PATCH", `/management-api/tills/${tillId}/receipt-printer`, {
      cookie: managerCookie,
      body: { printerId: null },
    });
    expect(cleared.status).toBe(204);
    expect(await tillReceiptPrinterId(tillId)).toBeNull();
  });

  it("404s a printer that is not one of the till's location's printers (never a 23503 → 500)", async () => {
    const app = mountApp(tenantA);
    const tillId = await seedTill(tenantA, `Caja ${randomUUID()}`);
    const res = await send(app, "PATCH", `/management-api/tills/${tillId}/receipt-printer`, {
      cookie: managerCookie,
      body: { printerId: randomUUID() },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "printer.not_found" } });
    expect(await tillReceiptPrinterId(tillId)).toBeNull();
  });

  it("400s an unknown till and a malformed printerId body", async () => {
    const app = mountApp(tenantA);
    // There is no `till.*` code.
    const unknown = await send(
      app,
      "PATCH",
      `/management-api/tills/${randomUUID()}/receipt-printer`,
      {
        cookie: managerCookie,
        body: { printerId: null },
      },
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "management.request_invalid" } });

    const tillId = await seedTill(tenantA, `Caja ${randomUUID()}`);
    const noField = await send(app, "PATCH", `/management-api/tills/${tillId}/receipt-printer`, {
      cookie: managerCookie,
      body: {},
    });
    expect(noField.status).toBe(400);
    expect(await noField.json()).toMatchObject({ error: { code: "management.request_invalid" } });

    const badUuid = await send(app, "PATCH", `/management-api/tills/${tillId}/receipt-printer`, {
      cookie: managerCookie,
      body: { printerId: "not-a-uuid" },
    });
    expect(badUuid.status).toBe(400);
    expect(await badUuid.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  });

  it("sets a location's receipt print mode as a manager (persists)", async () => {
    const app = mountApp(tenantA);
    for (const mode of ["never", "on_request", "auto"] as const) {
      const res = await send(
        app,
        "PATCH",
        `/management-api/locations/${tenantA.locationId}/receipt-print-mode`,
        { cookie: managerCookie, body: { mode } },
      );
      expect(res.status).toBe(204);
      expect(await locationPrintMode(tenantA.locationId)).toBe(mode);
    }
  });

  it("400s an unknown location and a bad print-mode value", async () => {
    const app = mountApp(tenantA);
    const unknown = await send(
      app,
      "PATCH",
      `/management-api/locations/${randomUUID()}/receipt-print-mode`,
      { cookie: managerCookie, body: { mode: "auto" } },
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "management.request_invalid" } });

    const badMode = await send(
      app,
      "PATCH",
      `/management-api/locations/${tenantA.locationId}/receipt-print-mode`,
      { cookie: managerCookie, body: { mode: "sometimes" } },
    );
    expect(badMode.status).toBe(400);
    expect(await badMode.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  });

  it("sets a location's drawer open policy as a manager (persists)", async () => {
    const app = mountApp(tenantA);
    for (const policy of ["open", "gated"] as const) {
      const res = await send(
        app,
        "PATCH",
        `/management-api/locations/${tenantA.locationId}/drawer-open-policy`,
        { cookie: managerCookie, body: { policy } },
      );
      expect(res.status).toBe(204);
      expect(await locationDrawerPolicy(tenantA.locationId)).toBe(policy);
    }
  });

  it("400s an unknown location and a bad drawer-open-policy value", async () => {
    const app = mountApp(tenantA);
    const unknown = await send(
      app,
      "PATCH",
      `/management-api/locations/${randomUUID()}/drawer-open-policy`,
      { cookie: managerCookie, body: { policy: "gated" } },
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "management.request_invalid" } });

    const badPolicy = await send(
      app,
      "PATCH",
      `/management-api/locations/${tenantA.locationId}/drawer-open-policy`,
      { cookie: managerCookie, body: { policy: "sometimes" } },
    );
    expect(badPolicy.status).toBe(400);
    expect(await badPolicy.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  });

  it("GET /management-api/tills lists the venue's tills as { id, label, locationId, receiptPrinterId } (printer set + unset)", async () => {
    const app = mountApp(tenantA);
    const agent = await joinAndAccept(app, "Recibos agent 2");
    const printerId = await createPrinter(app, agent.agentId, "Recibos 2");
    const withPrinterName = `Caja ${randomUUID()}`;
    const withoutPrinterName = `Caja ${randomUUID()}`;
    const tillWith = await seedTill(tenantA, withPrinterName);
    const tillWithout = await seedTill(tenantA, withoutPrinterName);

    const set = await send(app, "PATCH", `/management-api/tills/${tillWith}/receipt-printer`, {
      cookie: managerCookie,
      body: { printerId },
    });
    expect(set.status).toBe(204);

    const res = await send(app, "GET", "/management-api/tills", { cookie: managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{
      id: string;
      label: string;
      locationId: string;
      receiptPrinterId: string | null;
    }>;
    expect(rows.find((r) => r.id === tillWith)).toEqual({
      id: tillWith,
      label: withPrinterName,
      locationId: tenantA.locationId,
      receiptPrinterId: printerId,
    });
    expect(rows.find((r) => r.id === tillWithout)).toEqual({
      id: tillWithout,
      label: withoutPrinterName,
      locationId: tenantA.locationId,
      receiptPrinterId: null,
    });
  });

  it("GET /management-api/tills requires printer.manage — 401 unauth, 403 staff, 200 manager (gate proven by deletion via the shared `gated`)", async () => {
    const app = mountApp(tenantA);
    const unauth = await send(app, "GET", "/management-api/tills");
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toMatchObject({ error: { code: "management_session.required" } });
    const staff = await send(app, "GET", "/management-api/tills", { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    const manager = await send(app, "GET", "/management-api/tills", { cookie: managerCookie });
    expect(manager.status).toBe(200);
  });

  it("require printer.manage on ALL config routes — 401 unauth, 403 staff, 2xx manager (gate proven by deletion via the shared `gated`)", async () => {
    const app = mountApp(tenantA);
    const tillId = await seedTill(tenantA, `Caja ${randomUUID()}`);
    const tillRoute = `/management-api/tills/${tillId}/receipt-printer`;
    const modeRoute = `/management-api/locations/${tenantA.locationId}/receipt-print-mode`;
    const policyRoute = `/management-api/locations/${tenantA.locationId}/drawer-open-policy`;

    for (const route of [tillRoute, modeRoute, policyRoute]) {
      const unauth = await send(app, "PATCH", route, {
        body: { printerId: null, mode: "auto", policy: "gated" },
      });
      expect(unauth.status).toBe(401);
      expect(await unauth.json()).toMatchObject({ error: { code: "management_session.required" } });
    }

    const staffTill = await send(app, "PATCH", tillRoute, {
      cookie: staffCookie,
      body: { printerId: null },
    });
    expect(staffTill.status).toBe(403);
    expect(await staffTill.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    const staffMode = await send(app, "PATCH", modeRoute, {
      cookie: staffCookie,
      body: { mode: "never" },
    });
    expect(staffMode.status).toBe(403);
    expect(await staffMode.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    const staffPolicy = await send(app, "PATCH", policyRoute, {
      cookie: staffCookie,
      body: { policy: "open" },
    });
    expect(staffPolicy.status).toBe(403);
    expect(await staffPolicy.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });

    expect(
      (await send(app, "PATCH", tillRoute, { cookie: managerCookie, body: { printerId: null } }))
        .status,
    ).toBe(204);
    expect(
      (await send(app, "PATCH", modeRoute, { cookie: managerCookie, body: { mode: "auto" } }))
        .status,
    ).toBe(204);
    expect(
      (
        await send(app, "PATCH", policyRoute, {
          cookie: managerCookie,
          body: { policy: "gated" },
        })
      ).status,
    ).toBe(204);
  });
});

it("delivers enqueue and agent completion events with fresh printer aggregates", async () => {
  const app = mountApp(tenantA);
  const bus = new LiveEvents();
  mountLiveApi(app, { db: suite.db, bus, resourceTypes: ["printers", "print_jobs"] }, noopLog);
  const { agentId, token } = await joinAndAccept(app, "Live agent");
  const printerId = await createPrinter(app, agentId, "Live printer");
  await installChangeFeed(suite.db, CORE_CHANGE_SOURCES);
  const unsubscribe = subscribeToChanges(changeSubscriber(bus, noopLog));
  const url = `/management-api/events?resources=${encodeURIComponent(JSON.stringify([{ type: "printers", id: printerId }]))}`;
  const response = await send(app, "GET", url, { cookie: managerCookie });
  const reader = response.body!.getReader();
  const changes: string[] = [];
  const reading = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      const text = new TextDecoder().decode(next.value);
      if (text.includes("event: change")) changes.push(text);
    }
  })();
  const printer = async (): Promise<{ pendingJobs: number; lastPrintAt: string | null }> => {
    const response = await send(app, "GET", "/management-api/printers", { cookie: managerCookie });
    const rows = (await response.json()) as {
      id: string;
      pendingJobs: number;
      lastPrintAt: string | null;
    }[];
    return rows.find((row) => row.id === printerId)!;
  };
  try {
    expect(await printer()).toMatchObject({ pendingJobs: 0, lastPrintAt: null });
    const jobId = await enqueue(tenantA, printerId, new Uint8Array([65]));
    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0));
    expect(changes[0]).toContain(printerId);
    expect(changes[0]).not.toContain("payload");
    expect(await printer()).toMatchObject({ pendingJobs: 1, lastPrintAt: null });
    expect((await send(app, "POST", "/print-api/agent/jobs", { bearer: token })).status).toBe(200);
    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(1));
    const count = changes.length;
    expect(
      (
        await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
          bearer: token,
          body: { status: "done" },
        })
      ).status,
    ).toBe(204);
    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(count));
    expect(await printer()).toMatchObject({ pendingJobs: 0, lastPrintAt: expect.any(String) });
  } finally {
    await reader.cancel();
    await reading;
    unsubscribe();
    bus.close();
  }
});

describe("print job resend", () => {
  it("requires print.resend and copies the original bytes without changing its history", async () => {
    const app = mountApp(tenantA);
    const printerId = await createUsbPrinter(app, randomUUID(), "Resend");
    const originalId = await enqueue(
      tenantA,
      printerId,
      new Uint8Array([0, 255, 27, 64, 29, 86, 0]),
    );
    await suite.db
      .update(printJobs)
      .set({ status: "done", deliveredAt: nowIso() })
      .where(eq(printJobs.id, originalId));
    const path = `/management-api/print-jobs/${originalId}/resend`;
    expect((await send(app, "POST", path)).status).toBe(401);
    const denied = await send(app, "POST", path, { cookie: staffCookie });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: "authorization.not_permitted", params: { permission: "print.resend" } },
    });
    const response = await send(app, "POST", path, { cookie: managerCookie });
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    expect(jobId).not.toBe(originalId);
    const rows = await suite.db.execute<{
      id: string;
      status: string;
      payload: string;
      attempts: number;
    }>(
      sql`select id, status, lower(hex(payload)) as payload, attempts from print_jobs where id in (${jobId}, ${originalId}) order by status`,
    );
    expect(rows.rows).toEqual([
      { id: originalId, status: "done", payload: "00ff1b401d5600", attempts: 0 },
      { id: jobId, status: "queued", payload: "00ff1b401d5600", attempts: 0 },
    ]);
    const listed = await send(app, "GET", "/management-api/print-jobs", { cookie: managerCookie });
    const jobs = (await listed.json()) as { id: string; canResend: boolean }[];
    expect(jobs.find((job) => job.id === originalId)?.canResend).toBe(true);
    expect(jobs.find((job) => job.id === jobId)?.canResend).toBe(false);
    const pending = await send(app, "POST", `/management-api/print-jobs/${jobId}/resend`, {
      cookie: managerCookie,
    });
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ error: { code: "print_job.not_resendable" } });
    await suite.db.execute(sql`update print_jobs set kind = 'drawer' where id = ${originalId}`);
    const drawerResend = await send(app, "POST", path, { cookie: managerCookie });
    expect(drawerResend.status).toBe(409);
    expect(await drawerResend.json()).toMatchObject({
      error: { code: "print_job.not_resendable" },
    });
    const afterDrawer = await send(app, "GET", "/management-api/print-jobs", {
      cookie: managerCookie,
    });
    expect(
      ((await afterDrawer.json()) as { id: string; canResend: boolean }[]).find(
        (job) => job.id === originalId,
      )?.canResend,
    ).toBe(false);
    expect(
      (
        await send(app, "POST", `/management-api/print-jobs/${randomUUID()}/resend`, {
          cookie: managerCookie,
        })
      ).status,
    ).toBe(404);
  });
});
