import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPin, startManagementSession } from "@waitron/identity";
import { enqueuePrintJob } from "@waitron/printing";
import { mountPrintApi } from "./print-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import type { Logger } from "./logger.js";
import "./errors.js";

// Real Postgres (a manifest template clone), NOT PGlite — mandatory for THIS surface (CLAUDE.md §4).
// These routes read and write as `app_user` (the agent guard + claim + report, the management
// list/revoke/CRUD), and the properties this suite is FOR are the ones PGlite's all-superuser,
// single-backend connection FALSE-passes: the table grants the routes need, the `printer.manage` gate
// proven by DELETION, the claim COMMITTING within the request (observed cross-connection), and
// revocation stopping the Bearer instantly under the real deployment role. The claim's `for update … skip locked` under true concurrency is proven separately (by deletion)
// in packages/printing's runtime.race.test.ts; the SERVER path calls that same `claimPrintJobs`.
const noopLog: Logger = () => {};

interface Tenant {
  tenantId: string;
  locationId: string;
}

let tenantA: Tenant;
let managerCookie: string;
let staffCookie: string;

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared clone and `tenants_country_tax_id_key` is unique, so
// each needs its own NIF — the per-suite counter the sibling real-Postgres suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(76_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function seedTenantWithLocation(): Promise<Tenant> {
  const tenantId = randomUUID();
  await suite.admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${tenantId}, 'ES', ${nextNif()}, 'Deli Test SL')`);
  const loc = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  return { tenantId, locationId: loc.rows[0]!.id };
}

beforeAll(async () => {
  tenantA = await seedTenantWithLocation();
  const { managerSid, staffSid } = await withTenant(suite.admin, tenantA.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: tenantA.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: tenantA.tenantId,
      personId: stf.rows[0]!.id,
    });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });
  managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
  staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
});

/** The print API mounted over the REAL app-role pool (suite.admin), scoped to `tenant`. */
function mountApp(tenant: Tenant): Hono {
  const app = new Hono();
  mountPrintApi(app, { db: suite.admin, cfg: tenant }, noopLog);
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

async function enrolAgent(app: Hono, label: string): Promise<{ agentId: string; token: string }> {
  const codeRes = await send(app, "POST", "/management-api/print-agents/codes", {
    cookie: managerCookie,
    body: { label },
  });
  expect(codeRes.status).toBe(201);
  const { code } = (await codeRes.json()) as { code: string };
  const enrol = await send(app, "POST", "/print-api/agent/enrol", { body: { code } });
  expect(enrol.status).toBe(200);
  return (await enrol.json()) as { agentId: string; token: string };
}

async function createPrinter(app: Hono, agentId: string, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "network_tcp", agentId, host: "10.0.0.9" },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function enqueue(tenant: Tenant, printerId: string, payload: Uint8Array): Promise<string> {
  return withTenant(suite.admin, tenant.tenantId, async (tx) => {
    await asAppUser(tx);
    const { jobId } = await enqueuePrintJob(tx, tenant, printerId, payload);
    return jobId;
  });
}

/** Seed one kitchen station for `tenant` directly (owner SQL) — the attach target the mapping routes
 * wire a printer to. A fresh unique name each call keeps `kitchen_stations_name_key` happy across the
 * shared clone. */
async function seedStation(tenant: Tenant, name: string): Promise<string> {
  const row = await suite.admin.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, is_default, active)
    values (${tenant.tenantId}, ${tenant.locationId}, ${name}, false, true) returning id`);
  return row.rows[0]!.id;
}

describe("Print API over real Postgres (as the app role)", () => {
  it("enrol → claim (committed within the request) → report done, all as the app role", async () => {
    const app = mountApp(tenantA);
    const { agentId, token } = await enrolAgent(app, "Cocina");
    const printerId = await createPrinter(app, agentId, "Cocina real");
    const jobId = await enqueue(tenantA, printerId, new Uint8Array([0x41, 0x42]));

    const claim = await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
    expect(claim.status).toBe(200);
    expect(((await claim.json()) as { jobs: { id: string }[] }).jobs.map((j) => j.id)).toEqual([
      jobId,
    ]);

    // COMMIT BOUNDARY (Ruling 6): a SEPARATE connection (suite.admin, a distinct pooled backend) sees
    // the claimed job as `printing` the instant the response has returned — proof the claim's
    // transaction COMMITTED within the request and the server holds no lock/tx across the agent's push.
    const seen = await suite.admin.execute<{ status: string }>(
      sql`select status from print_jobs where id = ${jobId}`,
    );
    expect(seen.rows[0]!.status).toBe("printing");

    const report = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "done" },
    });
    expect(report.status).toBe(204);
    const done = await suite.admin.execute<{ status: string; delivered_at: string | null }>(
      sql`select status, delivered_at from print_jobs where id = ${jobId}`,
    );
    expect(done.rows[0]!.status).toBe("done");
    expect(done.rows[0]!.delivered_at).not.toBeNull();
  });

  it("claims ONLY the calling agent's own printers' jobs under RLS (cross-agent → empty)", async () => {
    const app = mountApp(tenantA);
    const mine = await enrolAgent(app, "Mine RLS");
    const other = await enrolAgent(app, "Other RLS");
    const otherPrinter = await createPrinter(app, other.agentId, "Other printer RLS");
    const jobId = await enqueue(tenantA, otherPrinter, new Uint8Array([1]));

    const res = await send(app, "GET", "/print-api/agent/jobs", { bearer: mine.token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { jobs: unknown[] }).jobs).toHaveLength(0);
    const untouched = await suite.admin.execute<{ status: string }>(
      sql`select status from print_jobs where id = ${jobId}`,
    );
    expect(untouched.rows[0]!.status).toBe("queued");
  });

  it("a REVOKED agent fails the claim instantly under RLS (401)", async () => {
    const app = mountApp(tenantA);
    const { agentId, token } = await enrolAgent(app, "Revocable");
    await createPrinter(app, agentId, "Revocable printer");
    expect((await send(app, "GET", "/print-api/agent/jobs", { bearer: token })).status).toBe(200);

    const revoke = await send(app, "POST", `/management-api/print-agents/${agentId}/revoke`, {
      cookie: managerCookie,
    });
    expect(revoke.status).toBe(204);
    const afterRevoke = await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
    expect(afterRevoke.status).toBe(401);
  });

  it("the management routes require printer.manage — 401 unauth, 403 staff, 200 manager (gate proven by deletion)", async () => {
    // THE GUARD, proven by DELETION as the app role: a `staff`-role session holds no `printer.manage`,
    // so `authorizeManager` (inside print-api's `gated`) throws `authorization.not_permitted` before any
    // op runs. Deleting the `authorizeManager(...)` call from print-api.ts's `gated` makes every staff
    // request below SUCCEED (201/200), flipping the 403 assertions red; restoring it turns them green.
    const app = mountApp(tenantA);

    // Unauthenticated → 401 on a representative gated route.
    const unauth = await send(app, "GET", "/management-api/printers");
    expect(unauth.status).toBe(401);
    expect((await unauth.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });

    // Staff session → 403 (the gate refuses it).
    const staff = await send(app, "POST", "/management-api/print-agents/codes", {
      cookie: staffCookie,
      body: { label: "nope" },
    });
    expect(staff.status).toBe(403);
    expect((await staff.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });

    // Manager session → 201 (the gate admits it).
    const manager = await send(app, "POST", "/management-api/print-agents/codes", {
      cookie: managerCookie,
      body: { label: "Gate OK" },
    });
    expect(manager.status).toBe(201);
  });
});

describe("Station ↔ printer mapping routes over real Postgres (printer.manage)", () => {
  it("attaches, lists both directions, is idempotent, and detaches a pair as a manager", async () => {
    const app = mountApp(tenantA);
    const agent = await enrolAgent(app, "Mapping agent");
    const printerId = await createPrinter(app, agent.agentId, "Mapping printer");
    const stationId = await seedStation(tenantA, `Cocina ${randomUUID()}`);
    const at = `/management-api/stations/${stationId}/printers/${printerId}`;
    const byStation = `/management-api/stations/${stationId}/printers`;
    const byPrinter = `/management-api/printers/${printerId}/stations`;

    // Attach → 204.
    expect((await send(app, "POST", at, { cookie: managerCookie })).status).toBe(204);

    // Both reads see the pair: the station-centric list and the R-J printer-centric mirror.
    const station = (await (
      await send(app, "GET", byStation, { cookie: managerCookie })
    ).json()) as { stationId: string; printerId: string }[];
    expect(station).toContainEqual({ stationId, printerId });
    const printer = (await (
      await send(app, "GET", byPrinter, { cookie: managerCookie })
    ).json()) as { stationId: string; printerId: string }[];
    expect(printer).toContainEqual({ stationId, printerId });

    // Re-attaching the same pair is an idempotent no-op (204, no duplicate row).
    expect((await send(app, "POST", at, { cookie: managerCookie })).status).toBe(204);
    expect(
      ((await (await send(app, "GET", byStation, { cookie: managerCookie })).json()) as unknown[])
        .length,
    ).toBe(1);

    // Detach → 204, and both reads are empty again.
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
    const agent = await enrolAgent(app, "Miss agent");
    const printerId = await createPrinter(app, agent.agentId, "Miss printer");
    const stationId = await seedStation(tenantA, `Barra ${randomUUID()}`);

    // Unknown station → station.not_found (404).
    const noStation = await send(
      app,
      "POST",
      `/management-api/stations/${randomUUID()}/printers/${printerId}`,
      { cookie: managerCookie },
    );
    expect(noStation.status).toBe(404);
    expect(await noStation.json()).toMatchObject({ error: { code: "station.not_found" } });

    // Unknown printer → printer.not_found (404).
    const noPrinter = await send(
      app,
      "POST",
      `/management-api/stations/${stationId}/printers/${randomUUID()}`,
      { cookie: managerCookie },
    );
    expect(noPrinter.status).toBe(404);
    expect(await noPrinter.json()).toMatchObject({ error: { code: "printer.not_found" } });

    // Malformed station id → shared.invalid_id (400) from requireUuidParam, before any query.
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
    // The mapping routes funnel through the SAME `gated` helper the sibling management routes use, so
    // the by-deletion proof recorded on that block covers these too: deleting the `authorizeManager(...)`
    // call from print-api.ts's `gated` flips this staff case from 403 to 204; restoring it turns it green.
    const app = mountApp(tenantA);
    const agent = await enrolAgent(app, "Gate agent");
    const printerId = await createPrinter(app, agent.agentId, "Gate printer");
    const stationId = await seedStation(tenantA, `Plancha ${randomUUID()}`);
    const at = `/management-api/stations/${stationId}/printers/${printerId}`;

    // Unauthenticated → 401 on a representative mapping route.
    const unauth = await send(app, "GET", `/management-api/stations/${stationId}/printers`);
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toMatchObject({
      error: { code: "management_session.required" },
    });

    // Staff session → 403 (the gate refuses it).
    const staff = await send(app, "POST", at, { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });

    // Manager session → 204 (the gate admits it).
    const manager = await send(app, "POST", at, { cookie: managerCookie });
    expect(manager.status).toBe(204);
  });
});

/** Seed one till for `tenant` directly (owner SQL) — the target the receipt-printer route configures. */
async function seedTill(tenant: Tenant, name: string): Promise<string> {
  const row = await suite.admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenant.tenantId}, ${tenant.locationId}, ${name}) returning id`);
  return row.rows[0]!.id;
}

/** Read a till's currently-set receipt printer id (owner SQL, a distinct connection). */
async function tillReceiptPrinterId(tillId: string): Promise<string | null> {
  const row = await suite.admin.execute<{ receipt_printer_id: string | null }>(
    sql`select receipt_printer_id from tills where id = ${tillId}`,
  );
  return row.rows[0]!.receipt_printer_id;
}

/** Read a location's currently-set receipt print mode (owner SQL, a distinct connection). */
async function locationPrintMode(locationId: string): Promise<string> {
  const row = await suite.admin.execute<{ receipt_print_mode: string }>(
    sql`select receipt_print_mode from locations where id = ${locationId}`,
  );
  return row.rows[0]!.receipt_print_mode;
}

/** Read a location's currently-set drawer-open policy (owner SQL, a distinct connection). */
async function locationDrawerPolicy(locationId: string): Promise<string> {
  const row = await suite.admin.execute<{ drawer_open_policy: string }>(
    sql`select drawer_open_policy from locations where id = ${locationId}`,
  );
  return row.rows[0]!.drawer_open_policy;
}

describe("Receipt-printer + print-mode config routes over real Postgres (printer.manage)", () => {
  it("sets, then clears, a till's receipt printer as a manager (persists both ways)", async () => {
    const app = mountApp(tenantA);
    const agent = await enrolAgent(app, "Recibos agent");
    const printerId = await createPrinter(app, agent.agentId, "Recibos");
    const tillId = await seedTill(tenantA, `Caja ${randomUUID()}`);

    // Set it.
    const set = await send(app, "PATCH", `/management-api/tills/${tillId}/receipt-printer`, {
      cookie: managerCookie,
      body: { printerId },
    });
    expect(set.status).toBe(204);
    expect(await tillReceiptPrinterId(tillId)).toBe(printerId);

    // Clear it (a till with no printer just doesn't print, §2).
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
    expect(await tillReceiptPrinterId(tillId)).toBeNull(); // unchanged
  });

  it("400s an unknown till and a malformed printerId body", async () => {
    const app = mountApp(tenantA);
    // Unknown till → management.request_invalid (there is no till.* code — retired at the node-id rekey).
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

    // A body with no printerId field at all → management.request_invalid naming the field.
    const tillId = await seedTill(tenantA, `Caja ${randomUUID()}`);
    const noField = await send(app, "PATCH", `/management-api/tills/${tillId}/receipt-printer`, {
      cookie: managerCookie,
      body: {},
    });
    expect(noField.status).toBe(400);
    expect(await noField.json()).toMatchObject({ error: { code: "management.request_invalid" } });

    // A non-uuid printerId → management.request_invalid (400, `requireBodyUuid`'s code), never a 22P02 → 500.
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
    const agent = await enrolAgent(app, "Recibos agent 2");
    const printerId = await createPrinter(app, agent.agentId, "Recibos 2");
    const withPrinterName = `Caja ${randomUUID()}`;
    const withoutPrinterName = `Caja ${randomUUID()}`;
    const tillWith = await seedTill(tenantA, withPrinterName);
    const tillWithout = await seedTill(tenantA, withoutPrinterName);

    // Point one till at the printer via the existing config route; leave the other unset.
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
    // Exact shape, both directions (a printer set, and null when unset — the picker's "none").
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
    // The list route funnels through the SAME `gated` helper as the sibling config/printer routes, so
    // the by-deletion proof recorded on the first gate block covers it too: deleting the
    // `authorizeManager(...)` call from print-api.ts's `gated` flips this staff case from 403 to 200,
    // turning the assertion red; restoring it turns it green.
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
    // Every config route funnels through the SAME `gated` helper as the sibling printer/mapping routes, so
    // the by-deletion proof recorded on the first gate block covers these too: deleting the
    // `authorizeManager(...)` call from print-api.ts's `gated` flips every staff case below from 403 to a
    // 2xx success, turning these assertions red; restoring it turns them green.
    const app = mountApp(tenantA);
    const tillId = await seedTill(tenantA, `Caja ${randomUUID()}`);
    const tillRoute = `/management-api/tills/${tillId}/receipt-printer`;
    const modeRoute = `/management-api/locations/${tenantA.locationId}/receipt-print-mode`;
    const policyRoute = `/management-api/locations/${tenantA.locationId}/drawer-open-policy`;

    // Unauthenticated → 401 on each route.
    for (const route of [tillRoute, modeRoute, policyRoute]) {
      const unauth = await send(app, "PATCH", route, {
        body: { printerId: null, mode: "auto", policy: "gated" },
      });
      expect(unauth.status).toBe(401);
      expect(await unauth.json()).toMatchObject({ error: { code: "management_session.required" } });
    }

    // Staff session → 403 (the gate refuses it) on each route, BEFORE any write.
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

    // Manager session → 204 (the gate admits it) on each route.
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
