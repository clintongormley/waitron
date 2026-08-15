import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS } from "@waitron/workforce-es";
import type { Logger } from "./logger.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

const noopLog: Logger = () => {};
let tenantId: string;
let locationId: string;
let personId: string;
let managerCookie: string;
let staffCookie: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    const seeded = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const loc = await tx.execute<{ id: string }>(sql`
        insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (current_tenant_id(), 'Main', array['es-ES'], 'Sale on premises') returning id`);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
      const mSes = await startManagementSession(tx, { tenantId, personId: mgr.rows[0]!.id });
      const sSes = await startManagementSession(tx, { tenantId, personId: stf.rows[0]!.id });
      return { locationId: loc.rows[0]!.id, personId: mgr.rows[0]!.id, mSid: mSes.id, sSid: sSes.id };
    });
    locationId = seeded.locationId;
    personId = seeded.personId;
    managerCookie = `${MANAGEMENT_COOKIE}=${seeded.mSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${seeded.sSid}`;
  },
});

function mountApp(): Hono {
  const app = new Hono();
  mountWorkforceApi(app, { db: suite.db, cfg: { tenantId } }, noopLog);
  return app;
}

async function send(
  app: Hono,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const cookie = opts.cookie === undefined ? managerCookie : opts.cookie;
  if (cookie !== null) headers["cookie"] = cookie;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

describe("mountWorkforceApi — locations + roster read/create", () => {
  it("GET /management-api/locations lists the tenant's locations", async () => {
    const res = await send(mountApp(), "GET", "/management-api/locations");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; name: string }[];
    expect(rows).toContainEqual({ id: locationId, name: "Main" });
  });

  it("GET /management-api/roster returns { version: null, shifts: [] } for an empty week", async () => {
    const res = await send(mountApp(), "GET", `/management-api/roster?locationId=${locationId}&period=2026-03-02`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: null, shifts: [] });
  });

  it("POST /management-api/roster creates a draft and returns { versionId } (201)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", {
      body: { locationId, period: "2026-03-09" },
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as { versionId: string }).toMatchObject({ versionId: expect.any(String) });
  });

  it("400s a non-UUID locationId on GET (shared.invalid_id, never a 500)", async () => {
    const res = await send(mountApp(), "GET", "/management-api/roster?locationId=not-a-uuid&period=2026-03-02");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "shared.invalid_id" } });
  });

  it("400s a malformed period on POST (management.request_invalid)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", { body: { locationId, period: "not-a-date" } });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "management.request_invalid" } });
  });

  it("401s an unauthenticated request", async () => {
    const res = await send(mountApp(), "GET", "/management-api/locations", { cookie: null });
    expect(res.status).toBe(401);
  });

  it("403s a staff-role session (no schedule.manage)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", { body: { locationId, period: "2026-03-09" }, cookie: staffCookie });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "authorization.not_permitted" } });
  });
});

describe("mountWorkforceApi — shift routes", () => {
  async function draftVersion(period: string): Promise<string> {
    const res = await send(mountApp(), "POST", "/management-api/roster", { body: { locationId, period } });
    return ((await res.json()) as { versionId: string }).versionId;
  }
  const shiftBody = (day: string) => ({
    personId, locationId,
    startsAt: `${day}T09:00:00Z`, startsOffsetMinutes: 0,
    endsAt: `${day}T17:00:00Z`, endsOffsetMinutes: 0, role: "bar",
  });

  it("POST …/roster/:versionId/shifts adds a shift (201) and GET roster shows it", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-06");
    const res = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, { body: shiftBody("2026-04-06") });
    expect(res.status).toBe(201);
    const { shiftId } = (await res.json()) as { shiftId: string };
    const roster = await send(app, "GET", `/management-api/roster?locationId=${locationId}&period=2026-04-06`);
    expect(((await roster.json()) as { shifts: { id: string }[] }).shifts.map((s) => s.id)).toContain(shiftId);
  });

  it("PATCH …/roster/shifts/:shiftId edits a shift (204)", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-13");
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, { body: shiftBody("2026-04-13") });
    const { shiftId } = (await add.json()) as { shiftId: string };
    const res = await send(app, "PATCH", `/management-api/roster/shifts/${shiftId}`, { body: { role: "kitchen" } });
    expect(res.status).toBe(204);
  });

  it("DELETE …/roster/shifts/:shiftId removes a shift (204)", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-20");
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, { body: shiftBody("2026-04-20") });
    const { shiftId } = (await add.json()) as { shiftId: string };
    const res = await send(app, "DELETE", `/management-api/roster/shifts/${shiftId}`);
    expect(res.status).toBe(204);
  });

  it("404s a shift route with an unknown shift id (shift.not_found)", async () => {
    const res = await send(mountApp(), "DELETE", "/management-api/roster/shifts/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "shift.not_found" } });
  });

  it("400s a non-UUID :shiftId (shared.invalid_id, never a 500)", async () => {
    const res = await send(mountApp(), "DELETE", "/management-api/roster/shifts/not-a-uuid");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "shared.invalid_id" } });
  });
});
