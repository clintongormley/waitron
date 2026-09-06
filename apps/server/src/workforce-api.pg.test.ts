import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";

// Real Postgres, not PGlite: this suite proves the workforce write group's `schedule.manage` gate BY
// DELETION, and that a decide lands `decided_by_person_id` through app_user's TABLE-level UPDATE grant
// (which a column-level grant would not cover). Every DB touch goes through `withTenant` + `asAppUser`
// from `suite.admin`, so the routes run as the non-superuser app role; a PGlite superuser holds every
// privilege, so a missing or narrowed grant would pass there (CLAUDE.md §4). The route mechanics are
// already proven in-process on PGlite (`workforce-api.test.ts`).
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });
const noopLog: Logger = () => {};

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  locationId: string;
  personId: string;
  managerCookie: string;
  staffCookie: string;
}

async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
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
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
  const seeded = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const loc = await tx.execute<{ id: string }>(
      sql`select id from locations where tenant_id = ${venue.tenantId} limit 1`,
    );
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${venue.tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${venue.tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const mSes = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const sSes = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: stf.rows[0]!.id,
    });
    return { locationId: loc.rows[0]!.id, personId: mgr.rows[0]!.id, mSid: mSes.id, sSid: sSes.id };
  });
  return {
    tenantId: venue.tenantId,
    locationId: seeded.locationId,
    personId: seeded.personId,
    managerCookie: `${MANAGEMENT_COOKIE}=${seeded.mSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${seeded.sSid}`,
  };
}

function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountWorkforceApi(app, { db: suite.admin, cfg: { tenantId } }, noopLog);
  return app;
}

async function send(
  app: Hono,
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function seedAcceptedSwap(
  tenantId: string,
  personId: string,
  locationId: string,
): Promise<string> {
  const shift = await suite.admin.execute<{ id: string }>(sql`
    insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes, ends_at, ends_offset_minutes)
    values (${tenantId}, ${personId}, ${locationId}, '2026-03-02T09:00:00Z', 0, '2026-03-02T13:00:00Z', 0) returning id`);
  const swap = await suite.admin.execute<{ id: string }>(sql`
    insert into shift_swaps (tenant_id, requested_by_person_id, from_shift_id, to_person_id, status)
    values (${tenantId}, ${personId}, ${shift.rows[0]!.id}, ${personId}, 'accepted') returning id`);
  return swap.rows[0]!.id;
}
async function seedRequestedAbsence(tenantId: string, personId: string): Promise<string> {
  const r = await suite.admin.execute<{ id: string }>(sql`
    insert into absences (tenant_id, person_id, absence_kind, starts_on, ends_on)
    values (${tenantId}, ${personId}, 'holiday', '2026-03-02', '2026-03-04') returning id`);
  return r.rows[0]!.id;
}

describe("Workforce API over real Postgres (roster publish, decide columns, gates)", () => {
  it("refuses every roster write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // GUARD-BY-DELETION (authorizeManager), run 2026-08-15 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): with the authorizeManager call removed from
    // workforce-api.ts's `gated` helper (and the inline publish one stubbed to a fixed authorizedBy),
    // the staff GET /roster below returned 200 instead of 403 — this test went red at the FIRST
    // `expect403`, `expected 200 to be 403`, and halted there, so routes 2-5 weren't individually
    // exercised in that run; the gate is what turns this suite red when removed. Restored the call and
    // the test passed again.
    const { tenantId, locationId, staffCookie } = await setupVenue();
    const app = mountApp(tenantId);
    const missing = "00000000-0000-0000-0000-000000000000";
    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };
    await expect403(
      await send(
        app,
        "GET",
        `/management-api/roster?locationId=${locationId}&period=2026-03-02`,
        staffCookie,
      ),
    );
    await expect403(
      await send(app, "POST", "/management-api/roster", staffCookie, {
        locationId,
        period: "2026-03-02",
      }),
    );
    await expect403(
      await send(app, "POST", `/management-api/roster/${missing}/shifts`, staffCookie, {
        personId: missing,
        locationId,
        startsAt: "2026-03-02T09:00:00Z",
        startsOffsetMinutes: 0,
        endsAt: "2026-03-02T13:00:00Z",
        endsOffsetMinutes: 0,
        role: null,
      }),
    );
    await expect403(
      await send(app, "DELETE", `/management-api/roster/shifts/${missing}`, staffCookie),
    );
    await expect403(
      await send(app, "POST", `/management-api/roster/${missing}/publish`, staffCookie),
    );
  });

  it("publishes end-to-end as the app role and returns the breaches array", async () => {
    const v = await setupVenue();
    // Seed the location's convenio_config (as admin — owner; tenant_id set explicitly).
    await suite.admin.execute(
      sql`insert into convenio_config (tenant_id, location_id) values (${v.tenantId}, ${v.locationId})`,
    );
    const app = mountApp(v.tenantId);
    const create = await send(app, "POST", "/management-api/roster", v.managerCookie, {
      locationId: v.locationId,
      period: "2026-06-01",
    });
    const versionId = ((await create.json()) as { versionId: string }).versionId;
    const res = await send(
      app,
      "POST",
      `/management-api/roster/${versionId}/publish`,
      v.managerCookie,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { breaches: unknown[] }).toEqual({ breaches: [] });
  });

  it("a manager decides a swap and an absence — the decider columns land through app_user's table-level UPDATE grant", async () => {
    const a = await setupVenue();
    const swapA = await seedAcceptedSwap(a.tenantId, a.personId, a.locationId);
    const absA = await seedRequestedAbsence(a.tenantId, a.personId);
    const appA = mountApp(a.tenantId);

    // A positive control that the queues surface the seeded rows at all, so the decides below act on
    // a swap the route really listed rather than on an id nothing ever returned.
    const aSwaps = (
      (await (await send(appA, "GET", "/management-api/swaps", a.managerCookie)).json()) as {
        id: string;
      }[]
    ).map((r) => r.id);
    expect(aSwaps).toContain(swapA);

    // A decides its own swap as app_user; the decider column is stamped. This is the §5
    // receipt Task 2 deferred: migration 0010 added `decided_by_person_id`/`decided_at` with NO new
    // grant, relying on 0008's TABLE-level `GRANT ... UPDATE ON shift_swaps TO app_user` covering the
    // later-added columns. Proven load-bearing in BOTH directions on 2026-08-15 against postgres:18
    // (TESTCONTAINERS_RYUK_DISABLED=true): with the table-level grant (production reality) this decide
    // is a 204 and the read-back shows the stamp; when instead app_user's UPDATE was narrowed to
    // `grant update (status, decided_at)` — i.e. a grant NOT covering decided_by_person_id — a direct
    // app_user write of that column raised `42501 permission denied for table shift_swaps` and the
    // route returned 500, reddening `expect(aDecides.status).toBe(204)`. (A column-level
    // `revoke update (decided_by_person_id)` was a NO-OP — Postgres won't revoke a column privilege
    // held implicitly via a table-level grant, CLAUDE.md §3 — hence the revoke-table-then-partial-grant
    // shape.) The grant was then restored.
    const aDecides = await send(
      appA,
      "POST",
      `/management-api/swaps/${swapA}/decide`,
      a.managerCookie,
      {
        decision: "approved",
      },
    );
    expect(aDecides.status).toBe(204);
    const decided = await suite.admin.execute<{
      status: string;
      decided_by_person_id: string | null;
      decided_at: string | null;
    }>(sql`select status, decided_by_person_id, decided_at from shift_swaps where id = ${swapA}`);
    expect(decided.rows[0]!.status).toBe("approved");
    expect(decided.rows[0]!.decided_by_person_id).toBe(a.personId);
    expect(decided.rows[0]!.decided_at).not.toBeNull();

    // And the absence decide lands its decider column too (same grant receipt on `absences`).
    const aDecidesAbs = await send(
      appA,
      "POST",
      `/management-api/absences/${absA}/decide`,
      a.managerCookie,
      { decision: "rejected" },
    );
    expect(aDecidesAbs.status).toBe(204);
    const decidedAbs = await suite.admin.execute<{
      status: string;
      decided_by_person_id: string | null;
    }>(sql`select status, decided_by_person_id from absences where id = ${absA}`);
    expect(decidedAbs.rows[0]!.status).toBe("rejected");
    expect(decidedAbs.rows[0]!.decided_by_person_id).toBe(a.personId);
  });

  it("refuses the swap + absence + planned-vs-actual routes to a staff-role session — 403", async () => {
    // GATE-BY-DELETION (authorizeManager). Each of the three gate mechanisms proven independently on
    // 2026-08-15 against postgres:18 via Testcontainers (TESTCONTAINERS_RYUK_DISABLED=true); each was
    // restored afterwards:
    //  (1) `gated` helper (GET /swaps, GET /absences, planned-vs-actual): removing its authorizeManager
    //      call made the staff GET /management-api/swaps below return 200 not 403 — red at the FIRST
    //      expect403 (`expected 200 to be 403`); it halted there so the later routes weren't exercised
    //      in THAT run, hence (2)/(3) below ran with (1) restored.
    //  (2) inline swap-decide compose: removing its authorizeManager (and stubbing authorizedBy) made
    //      POST /swaps/:missing/decide return 404 not 403 (the gate gone, the request reaches
    //      `decideSwap`, which 404s on the missing id) — red at the swap-decide expect403.
    //  (3) inline absence-decide compose: same, red at the absence-decide expect403 (line ~410),
    //      `expected 404 to be 403`, with (1) and (2) intact so #1-#3 passed and it reached #4.
    // A 404 rather than 200 for the decide routes is still a genuine gate signal: the 403 is what the
    // gate produces; without it the request falls through to the verb.
    const { tenantId, locationId, staffCookie } = await setupVenue();
    const app = mountApp(tenantId);
    const missing = "00000000-0000-0000-0000-000000000000";
    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };
    await expect403(await send(app, "GET", "/management-api/swaps", staffCookie));
    await expect403(
      await send(app, "POST", `/management-api/swaps/${missing}/decide`, staffCookie, {
        decision: "approved",
      }),
    );
    await expect403(await send(app, "GET", "/management-api/absences", staffCookie));
    await expect403(
      await send(app, "POST", `/management-api/absences/${missing}/decide`, staffCookie, {
        decision: "approved",
      }),
    );
    await expect403(
      await send(
        app,
        "GET",
        `/management-api/planned-vs-actual?locationId=${locationId}&from=2026-03-02&to=2026-03-09`,
        staffCookie,
      ),
    );
  });

  it("assembles planned-vs-actual for the tenant's own location as the app role", async () => {
    // The route assembles + returns rows under withTenant + asAppUser (the windowing/scoping logic is
    // already covered on PGlite in Task 5). Seed one shift on a PUBLISHED roster version as admin
    // (tenant_id explicit; the planned side is published-only, so a null-version draft would be excluded)
    // and assert it comes back as a no-show — proving the read runs as app_user without leaking or 500-ing.
    const v = await setupVenue();
    const version = await suite.admin.execute<{ id: string }>(sql`
      insert into roster_versions (tenant_id, location_id, period_start, period_end, status, published_at)
      values (${v.tenantId}, ${v.locationId}, '2026-03-02', '2026-03-08', 'published', now()) returning id`);
    await suite.admin.execute(sql`
      insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes, ends_at, ends_offset_minutes, roster_version_id)
      values (${v.tenantId}, ${v.personId}, ${v.locationId}, '2026-03-02T09:00:00Z', 0, '2026-03-02T13:00:00Z', 0, ${version.rows[0]!.id})`);
    const res = await send(
      mountApp(v.tenantId),
      "GET",
      `/management-api/planned-vs-actual?locationId=${v.locationId}&from=2026-03-02&to=2026-03-09`,
      v.managerCookie,
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      personId: string;
      workDate: string;
      noShow: boolean;
      plannedMinutes: number;
    }[];
    const row = rows.find((r) => r.personId === v.personId && r.workDate === "2026-03-02");
    expect(row).toBeDefined();
    expect(row!.noShow).toBe(true);
    expect(row!.plannedMinutes).toBe(240);
  });
});
