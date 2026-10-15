import { makeRuleset } from "@waitron/workforce/test/fixtures.js";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import {
  WORKFORCE_MIGRATIONS,
  absences,
  shiftSwaps,
  shifts,
  rosterVersions,
} from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS, convenioConfig } from "@waitron/workforce-es";
import * as workforceEs from "@waitron/workforce-es";
import type { Logger } from "./logger.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

const noopLog: Logger = () => {};
let locationId: string;
let personId: string;
let managerCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    const seeded = await withTransaction(db, async (tx) => {
      // Through the table definitions, not raw SQL: every `id` here is a NOT NULL `$defaultFn`
      // generator a raw insert never reaches.
      const [loc] = await tx
        .insert(locations)
        .values({
          name: "Main",
          timeZone: "Europe/Madrid",
          invoiceLocales: ["es-ES"],
          operationDescription: "Sale on premises",
        })
        .returning({ id: locations.id });
      const [mgr] = await tx
        .insert(persons)
        .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
        .returning({ id: persons.id });
      const [stf] = await tx
        .insert(persons)
        .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
        .returning({ id: persons.id });
      const mSes = await startManagementSession(tx, { personId: mgr!.id });
      const sSes = await startManagementSession(tx, { personId: stf!.id });
      return {
        locationId: loc!.id,
        personId: mgr!.id,
        mSid: mSes.token,
        sSid: sSes.token,
      };
    });
    locationId = seeded.locationId;
    personId = seeded.personId;
    managerCookie = `${MANAGEMENT_COOKIE}=${seeded.mSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${seeded.sSid}`;
  },
});

function mountApp(): Hono {
  const app = new Hono();
  // A placeholder nodeId: no route here appends a clock event (only roster/swap/absence), so it is
  // plumbed into cfg but never reaches the chain.
  mountWorkforceApi(
    app,
    { db: suite.db, cfg: { nodeId: "00000000-0000-4000-8000-000000000000" } },
    noopLog,
  );
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

async function refusal(res: Response): Promise<[number, string, unknown]> {
  const body = (await res.json()) as { error: { code: string; params: unknown } };
  return [res.status, body.error.code, body.error.params];
}

describe("mountWorkforceApi — locations + roster read/create", () => {
  it("GET /management-api/locations lists the tenant's locations", async () => {
    const res = await send(mountApp(), "GET", "/management-api/locations");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; name: string }[];
    expect(rows).toContainEqual({ id: locationId, name: "Main", timeZone: "Europe/Madrid" });
  });

  it("GET /management-api/roster returns { version: null, shifts: [] } for an empty week", async () => {
    const res = await send(
      mountApp(),
      "GET",
      `/management-api/roster?locationId=${locationId}&period=2026-03-02`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: null, shifts: [] });
  });

  it("POST /management-api/roster creates a draft and returns { versionId } (201)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", {
      body: { locationId, period: "2026-03-09" },
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as { versionId: string }).toMatchObject({
      versionId: expect.any(String),
    });
  });

  it("400s a non-UUID locationId on GET (shared.invalid_id, never a 500)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/roster?locationId=not-a-uuid&period=2026-03-02",
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("400s a GET /roster with no locationId (shared.invalid_id)", async () => {
    const res = await send(mountApp(), "GET", "/management-api/roster?period=2026-03-02");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("400s a POST /roster whose locationId names no location (management.request_invalid, never a 500)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", {
      body: { locationId: crypto.randomUUID(), period: "2026-12-07" },
    });
    expect(await refusal(res)).toEqual([
      400,
      "management.request_invalid",
      { field: "locationId" },
    ]);
  });

  it("400s a malformed period on POST (management.request_invalid)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", {
      body: { locationId, period: "not-a-date" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a POST /roster with a MALFORMED body (never a 500)", async () => {
    // `readJsonBody` coerces the malformed body to `{}`, so `requireBodyUuid` rejects the missing
    // locationId. Sent raw, since `send` would JSON.stringify a valid body.
    const res = await mountApp().request("/management-api/roster", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
  });

  it("400s a shaped-but-invalid calendar date on POST (2026-02-30 → request_invalid, never a 500)", async () => {
    // Shape passes the YYYY-MM-DD regex but Feb 30 is not a real day.
    const res = await send(mountApp(), "POST", "/management-api/roster", {
      body: { locationId, period: "2026-02-30" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("400s a shaped-but-invalid calendar date on GET (2026-13-01 → request_invalid, never a 500)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      `/management-api/roster?locationId=${locationId}&period=2026-13-01`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("401s an unauthenticated request", async () => {
    const res = await send(mountApp(), "GET", "/management-api/locations", { cookie: null });
    expect(res.status).toBe(401);
  });

  it("403s a staff-role session (no schedule.manage)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", {
      body: { locationId, period: "2026-03-09" },
      cookie: staffCookie,
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});

describe("mountWorkforceApi — shift routes", () => {
  async function draftVersion(period: string): Promise<string> {
    const res = await send(mountApp(), "POST", "/management-api/roster", {
      body: { locationId, period },
    });
    return ((await res.json()) as { versionId: string }).versionId;
  }
  const shiftBody = (day: string) => ({
    personId,
    locationId,
    startsAt: `${day}T09:00:00Z`,
    startsOffsetMinutes: 0,
    endsAt: `${day}T17:00:00Z`,
    endsOffsetMinutes: 0,
  });

  it("POST …/roster/:versionId/shifts adds a shift (201) and GET roster shows it", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-06");
    const res = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: shiftBody("2026-04-06"),
    });
    expect(res.status).toBe(201);
    const { shiftId } = (await res.json()) as { shiftId: string };
    const roster = await send(
      app,
      "GET",
      `/management-api/roster?locationId=${locationId}&period=2026-04-06`,
    );
    expect(
      ((await roster.json()) as { shifts: { id: string }[] }).shifts.map((s) => s.id),
    ).toContain(shiftId);
  });

  it("accepts and stores an overnight shift across the summer-time change", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-03-23");
    const body = {
      personId,
      locationId,
      startsAt: "2026-03-28T21:00:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-03-29T02:00:00Z",
      endsOffsetMinutes: 120,
    };
    const added = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, { body });
    expect(added.status).toBe(201);
    const { shiftId } = (await added.json()) as { shiftId: string };
    const roster = await send(
      app,
      "GET",
      `/management-api/roster?locationId=${locationId}&period=2026-03-23`,
    );
    expect(roster.status).toBe(200);
    expect(((await roster.json()) as { shifts: unknown[] }).shifts).toContainEqual({
      id: shiftId,
      rosterVersionId: versionId,
      ...body,
    });
  });

  it("PATCH …/roster/shifts/:shiftId edits a shift (204)", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-13");
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: shiftBody("2026-04-13"),
    });
    const { shiftId } = (await add.json()) as { shiftId: string };
    const res = await send(app, "PATCH", `/management-api/roster/shifts/${shiftId}`, {
      body: { endsAt: "2026-04-13T16:00:00Z" },
    });
    expect(res.status).toBe(204);
  });

  it("PATCH …/roster/shifts/:shiftId moves the person and times it names and retains the other fields", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-06-01");
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: shiftBody("2026-06-01"),
    });
    const { shiftId } = (await add.json()) as { shiftId: string };
    const [other] = await suite.db
      .insert(persons)
      .values({ displayName: "The Cover", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    const res = await send(app, "PATCH", `/management-api/roster/shifts/${shiftId}`, {
      body: {
        personId: other!.id,
        startsAt: "2026-06-01T10:00:00Z",
        startsOffsetMinutes: 120,
        endsAt: "2026-06-01T18:00:00Z",
        endsOffsetMinutes: 60,
      },
    });
    expect(res.status).toBe(204);
    const roster = await send(
      app,
      "GET",
      `/management-api/roster?locationId=${locationId}&period=2026-06-01`,
    );
    const shift = ((await roster.json()) as { shifts: Record<string, unknown>[] }).shifts.find(
      (s) => s.id === shiftId,
    );
    expect(shift).toMatchObject({
      personId: other!.id,
      startsAt: "2026-06-01T10:00:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2026-06-01T18:00:00Z",
      endsOffsetMinutes: 60,
    });
  });

  it.each([
    ["personId", "2026-06-08", { personId: "not-a-uuid" }],
    ["endsAt", "2026-06-15", { endsAt: "nope" }],
    ["endsOffsetMinutes", "2026-06-22", { endsOffsetMinutes: 900 }],
    ["startsOffsetMinutes", "2026-06-29", { startsOffsetMinutes: 900 }],
  ])("PATCH …/roster/shifts/:shiftId refuses a malformed %s", async (field, week, body) => {
    const app = mountApp();
    const versionId = await draftVersion(week);
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: shiftBody(week),
    });
    expect(add.status).toBe(201);
    const { shiftId } = (await add.json()) as { shiftId: string };
    const res = await send(app, "PATCH", `/management-api/roster/shifts/${shiftId}`, { body });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
  });

  it("DELETE …/roster/shifts/:shiftId removes a shift (204)", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-20");
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: shiftBody("2026-04-20"),
    });
    const { shiftId } = (await add.json()) as { shiftId: string };
    const res = await send(app, "DELETE", `/management-api/roster/shifts/${shiftId}`);
    expect(res.status).toBe(204);
  });

  it("404s a shift route with an unknown shift id (shift.not_found)", async () => {
    const res = await send(
      mountApp(),
      "DELETE",
      "/management-api/roster/shifts/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shift.not_found" },
    });
  });

  it("400s a non-UUID :shiftId (shared.invalid_id, never a 500)", async () => {
    const res = await send(mountApp(), "DELETE", "/management-api/roster/shifts/not-a-uuid");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("400s a non-parseable startsAt on add (management.request_invalid, never a 500)", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-27");
    const res = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: { ...shiftBody("2026-04-27"), startsAt: "nope" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it.each([["personId"], ["locationId"]])(
    "400s an add whose %s names no row (management.request_invalid, never a 500)",
    async (field) => {
      const app = mountApp();
      const versionId = await draftVersion(field === "personId" ? "2026-12-14" : "2026-12-21");
      const res = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
        body: { ...shiftBody("2026-12-14"), [field]: crypto.randomUUID() },
      });
      expect(await refusal(res)).toEqual([400, "management.request_invalid", { field }]);
    },
  );

  it("400s a PATCH whose personId names no person (management.request_invalid, never a 500)", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-12-28");
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: shiftBody("2026-12-28"),
    });
    const { shiftId } = (await add.json()) as { shiftId: string };
    const res = await send(app, "PATCH", `/management-api/roster/shifts/${shiftId}`, {
      body: { personId: crypto.randomUUID() },
    });
    expect(await refusal(res)).toEqual([400, "management.request_invalid", { field: "personId" }]);
  });

  it("400s an out-of-range startsOffsetMinutes on add (management.request_invalid, never a 500)", async () => {
    // 900 is an integer, so requireBodyInt passes it; the route's range check refuses it.
    const app = mountApp();
    const versionId = await draftVersion("2026-05-25");
    const res = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: { ...shiftBody("2026-05-25"), startsOffsetMinutes: 900 },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });
});

describe("mountWorkforceApi — publish", () => {
  async function seedConvenio(): Promise<void> {
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(convenioConfig)
        .values({ locationId })
        .onConflictDoNothing({ target: convenioConfig.locationId });
    });
  }

  it("publishes a draft and returns { breaches } (a clean roster → empty array)", async () => {
    await seedConvenio();
    const app = mountApp();
    const create = await send(app, "POST", "/management-api/roster", {
      body: { locationId, period: "2026-05-04" },
    });
    const { versionId } = (await create.json()) as { versionId: string };
    await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: {
        personId,
        locationId,
        startsAt: "2026-05-04T09:00:00Z",
        startsOffsetMinutes: 0,
        endsAt: "2026-05-04T14:00:00Z",
        endsOffsetMinutes: 0,
      },
    });
    const res = await send(app, "POST", `/management-api/roster/${versionId}/publish`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { breaches: unknown[] }).toEqual({ breaches: [] });
  });

  it("returns the advisory breaches but still publishes a breaching roster (owner decision 2026-08-02)", async () => {
    await seedConvenio();
    const app = mountApp();
    const create = await send(app, "POST", "/management-api/roster", {
      body: { locationId, period: "2026-05-11" },
    });
    const { versionId } = (await create.json()) as { versionId: string };
    // A 12h shift breaches the 9h ordinary-daily max AND owes a break — a non-empty breaches array.
    await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: {
        personId,
        locationId,
        startsAt: "2026-05-11T08:00:00Z",
        startsOffsetMinutes: 0,
        endsAt: "2026-05-11T20:00:00Z",
        endsOffsetMinutes: 0,
      },
    });
    const res = await send(app, "POST", `/management-api/roster/${versionId}/publish`);
    expect(res.status).toBe(200);
    const { breaches } = (await res.json()) as { breaches: { kind: string }[] };
    expect(breaches.map((b) => b.kind)).toContain("exceeds_daily_max");
    // Still published:
    const roster = await send(
      app,
      "GET",
      `/management-api/roster?locationId=${locationId}&period=2026-05-11`,
    );
    expect(((await roster.json()) as { version: { status: string } }).version.status).toBe(
      "published",
    );
  });

  it("publishes without labour warnings when the location has no convenio_config (A585-7)", async () => {
    const app = mountApp();
    // A DIFFERENT location with no convenio row.
    const otherLoc = await withTransaction(suite.db, async (tx) => {
      const [r] = await tx
        .insert(locations)
        .values({
          name: "Annex",
          invoiceLocales: ["es-ES"],
          operationDescription: "Sale on premises",
        })
        .returning({ id: locations.id });
      return r!.id;
    });
    const create = await send(app, "POST", "/management-api/roster", {
      body: { locationId: otherLoc, period: "2026-05-18" },
    });
    const { versionId } = (await create.json()) as { versionId: string };
    const res = await send(app, "POST", `/management-api/roster/${versionId}/publish`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ breaches: [] });
    const roster = await send(
      app,
      "GET",
      `/management-api/roster?locationId=${otherLoc}&period=2026-05-18`,
    );
    expect(await roster.json()).toMatchObject({ version: { id: versionId, status: "published" } });
  });

  it("leaves the roster draft when resolving its labour rules fails unexpectedly", async () => {
    const app = mountApp();
    const create = await send(app, "POST", "/management-api/roster", {
      body: { locationId, period: "2026-08-17" },
    });
    const { versionId } = (await create.json()) as { versionId: string };
    const spy = vi
      .spyOn(workforceEs, "resolveWorkTimeRuleset")
      .mockRejectedValueOnce(new Error("rules probe"));
    try {
      const response = await send(app, "POST", `/management-api/roster/${versionId}/publish`);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: "server.internal" } });
      const read = await send(
        app,
        "GET",
        `/management-api/roster?locationId=${locationId}&period=2026-08-17`,
      );
      expect(await read.json()).toMatchObject({ version: { id: versionId, status: "draft" } });
    } finally {
      spy.mockRestore();
    }
  });

  it("404s publish of an unknown version (roster.not_found)", async () => {
    const res = await send(
      mountApp(),
      "POST",
      "/management-api/roster/00000000-0000-0000-0000-000000000000/publish",
    );
    expect(res.status).toBe(404);
  });
});

describe("mountWorkforceApi — swap + absence approvals", () => {
  async function seedAcceptedSwap(): Promise<string> {
    return withTransaction(suite.db, async (tx) => {
      const [shift] = await tx
        .insert(shifts)
        .values({
          personId,
          locationId,
          startsAt: "2026-03-02T09:00:00Z",
          startsOffsetMinutes: 0,
          endsAt: "2026-03-02T13:00:00Z",
          endsOffsetMinutes: 0,
        })
        .returning({ id: shifts.id });
      const [swap] = await tx
        .insert(shiftSwaps)
        .values({
          requestedByPersonId: personId,
          fromShiftId: shift!.id,
          toPersonId: personId,
          status: "accepted",
        })
        .returning({ id: shiftSwaps.id });
      return swap!.id;
    });
  }
  async function seedRequestedAbsence(): Promise<string> {
    return withTransaction(suite.db, async (tx) => {
      const [r] = await tx
        .insert(absences)
        .values({
          personId,
          kind: "holiday",
          startsOn: "2026-03-02",
          endsOn: "2026-03-04",
        })
        .returning({ id: absences.id });
      return r!.id;
    });
  }

  it("GET /management-api/swaps lists the tenant's accepted swaps", async () => {
    const swapId = await seedAcceptedSwap();
    const res = await send(mountApp(), "GET", "/management-api/swaps");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; status: string }[];
    expect(rows.map((r) => r.id)).toContain(swapId);
    expect(rows.every((r) => r.status === "accepted")).toBe(true);
  });

  it("POST /management-api/swaps/:id/decide approves an accepted swap (204)", async () => {
    const swapId = await seedAcceptedSwap();
    const res = await send(mountApp(), "POST", `/management-api/swaps/${swapId}/decide`, {
      body: { decision: "approved" },
    });
    expect(res.status).toBe(204);
    // No longer pending.
    const list = await send(mountApp(), "GET", "/management-api/swaps");
    expect(((await list.json()) as { id: string }[]).map((r) => r.id)).not.toContain(swapId);
  });

  it("404s a decide on an unknown swap (swap.not_found)", async () => {
    const res = await send(
      mountApp(),
      "POST",
      "/management-api/swaps/00000000-0000-0000-0000-000000000000/decide",
      { body: { decision: "approved" } },
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_found" },
    });
  });

  it("409s a decide on a non-accepted swap (swap.not_decidable)", async () => {
    const swapId = await seedAcceptedSwap();
    await send(mountApp(), "POST", `/management-api/swaps/${swapId}/decide`, {
      body: { decision: "approved" },
    });
    const again = await send(mountApp(), "POST", `/management-api/swaps/${swapId}/decide`, {
      body: { decision: "rejected" },
    });
    expect(again.status).toBe(409);
    expect((await again.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_decidable" },
    });
  });

  it("400s a bad decision body (management.request_invalid, never an enum 500)", async () => {
    const swapId = await seedAcceptedSwap();
    const res = await send(mountApp(), "POST", `/management-api/swaps/${swapId}/decide`, {
      body: { decision: "maybe" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("GET /management-api/absences lists the tenant's requested absences", async () => {
    const absenceId = await seedRequestedAbsence();
    const res = await send(mountApp(), "GET", "/management-api/absences");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; status: string }[];
    expect(rows.map((r) => r.id)).toContain(absenceId);
    expect(rows.every((r) => r.status === "requested")).toBe(true);
  });

  it("POST /management-api/absences/:id/decide approves a requested absence (204)", async () => {
    const absenceId = await seedRequestedAbsence();
    const res = await send(mountApp(), "POST", `/management-api/absences/${absenceId}/decide`, {
      body: { decision: "approved" },
    });
    expect(res.status).toBe(204);
    const list = await send(mountApp(), "GET", "/management-api/absences");
    expect(((await list.json()) as { id: string }[]).map((r) => r.id)).not.toContain(absenceId);
  });

  it("404s a decide on an unknown absence (absence.not_found)", async () => {
    const res = await send(
      mountApp(),
      "POST",
      "/management-api/absences/00000000-0000-0000-0000-000000000000/decide",
      { body: { decision: "rejected" } },
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "absence.not_found" },
    });
  });

  it("403s the swap routes to a staff-role session (no swap.approve)", async () => {
    const res = await send(mountApp(), "GET", "/management-api/swaps", { cookie: staffCookie });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("403s the absence routes to a staff-role session (no absence.decide)", async () => {
    const res = await send(mountApp(), "GET", "/management-api/absences", { cookie: staffCookie });
    expect(res.status).toBe(403);
  });
});

describe("mountWorkforceApi — planned-vs-actual", () => {
  it("GET /management-api/planned-vs-actual returns [] for an empty window", async () => {
    const res = await send(
      mountApp(),
      "GET",
      `/management-api/planned-vs-actual?locationId=${locationId}&from=2026-03-02&to=2026-03-09`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("400s a non-UUID locationId (shared.invalid_id)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/planned-vs-actual?locationId=not-a-uuid&from=2026-03-02&to=2026-03-09",
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("400s a request with no locationId (shared.invalid_id)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/planned-vs-actual?from=2026-03-02&to=2026-03-09",
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("400s a malformed from/to (management.request_invalid)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      `/management-api/planned-vs-actual?locationId=${locationId}&from=nope&to=2026-03-09`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("403s a staff-role session (no schedule.manage)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      `/management-api/planned-vs-actual?locationId=${locationId}&from=2026-03-02&to=2026-03-09`,
      { cookie: staffCookie },
    );
    expect(res.status).toBe(403);
  });
});

describe("roster warnings while planning", () => {
  async function warningLocation(withRules = true, overrides = {}) {
    const [location] = await suite.db
      .insert(locations)
      .values({
        name: "Warnings",
        timeZone: "Europe/Madrid",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
      })
      .returning();
    if (withRules)
      await suite.db.insert(convenioConfig).values({ locationId: location!.id, ...overrides });
    return location!.id;
  }
  async function version(
    locationId: string,
    periodStart: string,
    status: "published" | "draft" | "superseded",
  ) {
    const end = new Date(Date.parse(periodStart) + 6 * 86400000).toISOString().slice(0, 10);
    const [row] = await suite.db
      .insert(rosterVersions)
      .values({
        locationId,
        periodStart,
        periodEnd: end,
        status,
        publishedAt: status === "draft" ? null : "2026-01-01T00:00:00Z",
      })
      .returning();
    return row!.id;
  }
  async function planned(
    locationId: string,
    startsAt: string,
    endsAt: string,
    rosterVersionId: string | null = null,
    offset = 0,
    worker = personId,
  ) {
    const [row] = await suite.db
      .insert(shifts)
      .values({
        locationId,
        personId: worker,
        startsAt,
        endsAt,
        startsOffsetMinutes: offset,
        endsOffsetMinutes: offset,
        rosterVersionId,
      })
      .returning();
    return row!.id;
  }
  const read = (locationId: string, period = "2026-03-02", cookie = managerCookie) =>
    send(
      mountApp(),
      "GET",
      `/management-api/roster/breaches?locationId=${locationId}&period=${period}`,
      { cookie },
    );

  it("uses preferred drafts and adjacent weeks, keeps boundary rest warnings and returns the resolved rules", async () => {
    const loc = await warningLocation();
    const previous = await version(loc, "2026-02-23", "published");
    const published = await version(loc, "2026-03-02", "published");
    const draft = await version(loc, "2026-03-02", "draft");
    const superseded = await version(loc, "2026-03-02", "superseded");
    const next = await version(loc, "2026-03-09", "published");
    const sundayBefore = await planned(
      loc,
      "2026-03-01T19:00:00Z",
      "2026-03-01T23:00:00Z",
      previous,
    );
    const monday = await planned(loc, "2026-03-02T06:00:00Z", "2026-03-02T10:00:00Z", draft);
    const ignoredPublished = await planned(
      loc,
      "2026-03-02T07:00:00Z",
      "2026-03-02T11:00:00Z",
      published,
    );
    const ignoredHistory = await planned(
      loc,
      "2026-03-04T00:00:00Z",
      "2026-03-05T00:00:00Z",
      superseded,
    );
    await planned(loc, "2026-03-03T09:00:00Z", "2026-03-03T13:00:00Z");
    const sunday = await planned(loc, "2026-03-08T22:00:00Z", "2026-03-09T00:00:00Z", draft);
    const nextMonday = await planned(loc, "2026-03-09T05:00:00Z", "2026-03-09T09:00:00Z", next);
    const response = await read(loc, "2026-03-04");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ruleset: unknown;
      breaches: Array<Record<string, unknown>>;
    };
    expect(body.ruleset).toEqual(makeRuleset());
    expect(body.breaches.filter((b) => b.kind === "rest_too_short")).toEqual([
      {
        kind: "rest_too_short",
        personId,
        previousShiftId: sundayBefore,
        shiftId: monday,
        restMinutes: 420,
        requiredMinutes: 720,
      },
      {
        kind: "rest_too_short",
        personId,
        previousShiftId: sunday,
        shiftId: nextMonday,
        restMinutes: 300,
        requiredMinutes: 720,
      },
    ]);
    expect(body.breaches).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ shiftId: ignoredPublished })]),
    );
    expect(body.breaches).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ shiftId: ignoredHistory })]),
    );
    expect(body.breaches.filter((b) => b.kind === "night_work").map((b) => b.shiftId)).toEqual([
      sunday,
    ]);
  });

  it("reads unattached shifts by their local calendar date and scopes them to this location", async () => {
    const loc = await warningLocation();
    const included = await planned(loc, "2026-03-01T23:30:00Z", "2026-03-02T07:30:00Z", null, 60);
    const excluded = await planned(loc, "2026-03-08T23:30:00Z", "2026-03-09T07:30:00Z", null, 60);
    const foreignLoc = await warningLocation();
    const foreign = await planned(foreignLoc, "2026-03-02T08:00:00Z", "2026-03-02T20:00:00Z");
    const response = await read(loc);
    expect(response.status).toBe(200);
    const { breaches } = (await response.json()) as { breaches: Array<Record<string, unknown>> };
    expect(breaches.filter((b) => b.kind === "break_owed").map((b) => b.shiftId)).toEqual([
      included,
    ]);
    expect(breaches.some((b) => b.shiftId === excluded || b.shiftId === foreign)).toBe(false);
  });

  it("keeps day/week warnings in the requested week and omits the annual cap", async () => {
    const loc = await warningLocation(true, {
      maxOrdinaryDailyMinutes: 60,
      maxWeeklyMinutes: 120,
      annualOvertimeCapHours: 0,
    });
    for (const day of ["2026-02-24", "2026-03-03", "2026-03-10"])
      await planned(loc, `${day}T09:00:00Z`, `${day}T13:00:00Z`);
    const response = await read(loc);
    expect(response.status).toBe(200);
    const { breaches } = (await response.json()) as { breaches: Array<Record<string, unknown>> };
    expect(breaches).toEqual([
      {
        kind: "exceeds_daily_max",
        personId,
        workDate: "2026-03-03",
        plannedMinutes: 240,
        maxMinutes: 60,
      },
      {
        kind: "exceeds_weekly_max",
        personId,
        weekStart: "2026-03-02",
        plannedMinutes: 240,
        maxMinutes: 120,
      },
    ]);
  });

  it("judges weekly rest with surrounding weeks, but not for a person whose only shifts are in the requested week", async () => {
    const loc = await warningLocation();
    const [worker] = await suite.db
      .insert(persons)
      .values({ displayName: crypto.randomUUID() })
      .returning();
    await planned(loc, "2026-03-01T09:00:00Z", "2026-03-01T17:00:00Z");
    for (let day = 2; day <= 8; day++)
      for (const person of [personId, worker!.id]) {
        const date = `2026-03-${String(day).padStart(2, "0")}`;
        await planned(loc, `${date}T09:00:00Z`, `${date}T17:00:00Z`, null, 0, person);
      }
    await planned(loc, "2026-03-09T09:00:00Z", "2026-03-09T17:00:00Z");
    const response = await read(loc);
    expect(response.status).toBe(200);
    const { breaches } = (await response.json()) as { breaches: Array<Record<string, unknown>> };
    expect(breaches.filter((b) => b.kind === "weekly_rest_insufficient")).toEqual([
      {
        kind: "weekly_rest_insufficient",
        personId,
        weekStart: "2026-03-02",
        longestRestMinutes: 960,
        requiredMinutes: 2160,
      },
    ]);
  });

  it("returns convenio.not_found when no labour rules row exists", async () => {
    const loc = await warningLocation(false);
    expect(await refusal(await read(loc))).toEqual([
      409,
      "convenio.not_found",
      { locationId: loc },
    ]);
  });
  it("refuses staff and unauthenticated reads", async () => {
    const loc = await warningLocation();
    const denied = await read(loc, "2026-03-02", staffCookie);
    expect(denied.status).toBe(403);
    expect(await refusal(denied)).toEqual([
      403,
      "authorization.not_permitted",
      { permission: "schedule.manage" },
    ]);
    const response = await send(
      mountApp(),
      "GET",
      `/management-api/roster/breaches?locationId=${loc}&period=2026-03-02`,
      { cookie: null },
    );
    expect(response.status).toBe(401);
  });
  it.each(["", "2026-02-30", "not-a-date"])("refuses the invalid period %s", async (period) => {
    const loc = await warningLocation();
    expect((await read(loc, period)).status).toBe(400);
  });
});
