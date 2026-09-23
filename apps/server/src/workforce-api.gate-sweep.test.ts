import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowIso, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { absences, rosterVersions, shiftSwaps, shifts } from "@waitron/workforce";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

/**
 * The workforce write group's `schedule.manage` gate, and what a decide writes, on the engine the box
 * now runs.
 *
 * Named `workforce-api.gate-sweep.test.ts` because sweeping is what separates it from its sibling:
 * the two gate cases below hit EVERY route of a write group with a staff cookie, where
 * `workforce-api.test.ts` refuses ONE route per group. Checkable:
 * `grep -n staffCookie apps/server/src/workforce-api.test.ts` prints six lines, two of them the
 * declaration and its assignment, and the remaining four are the whole of that file's staff
 * refusals — `POST /management-api/roster`, `GET /management-api/swaps`,
 * `GET /management-api/absences`, `GET /management-api/planned-vs-actual` (run 2026-09-22).
 * The file's other two cases read data back THROUGH a route that the sibling's
 * equivalents never see — the decider columns a decide stamps, and a populated planned-vs-actual
 * row where the sibling asserts an empty window.
 *
 * The decide case is the only test that reads `decided_by_person_id` and `decided_at` back THROUGH
 * the route. Receipt for the "only" —
 * `grep -rln 'decided_by_person_id\|decidedByPersonId' --include='*.test.ts' apps packages`
 * returns three files, and the other two read those columns back from the VERB
 * (`packages/workforce/src/shift-swaps.test.ts:271`, `packages/workforce/src/absences.test.ts:205`,
 * each calling `decideSwap`/`setAbsenceStatus` directly). The sibling `workforce-api.test.ts`
 * decide cases assert only the 204 and that the row leaves the pending queue.
 *
 * The end-to-end publish case is DELETED rather than converted: `workforce-api.test.ts`,
 * "publishes a draft and returns { breaches } (a clean roster → empty array)", drives the same two
 * routes to the same `{ breaches: [] }` and seeds a shift onto the draft first, so it is the stronger
 * of the two.
 *
 * The per-suite NIF counter went with the shared container: `useVenueDb` opens one fresh SQLite venue
 * per file and empties it between tests, so the venue provisioned here needs no unique-tax-id dance.
 */
const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};

interface Venue {
  locationId: string;
  personId: string;
  managerCookie: string;
  staffCookie: string;
}

async function setupVenue(): Promise<Venue> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "72000001K",
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const seeded = await withTransaction(suite.db, async (tx) => {
    const loc = await tx.execute<{ id: string }>(sql`select id from locations  limit 1`);
    // Through the table definitions, not raw SQL: every `id` and `created_at` here is a JavaScript
    // `$defaultFn` generator on this engine, which a raw insert never reaches.
    const [mgr] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    const mSes = await startManagementSession(tx, {
      personId: mgr!.id,
    });
    const sSes = await startManagementSession(tx, {
      personId: stf!.id,
    });
    return { locationId: loc.rows[0]!.id, personId: mgr!.id, mSid: mSes.id, sSid: sSes.id };
  });
  return {
    locationId: seeded.locationId,
    personId: seeded.personId,
    managerCookie: `${MANAGEMENT_COOKIE}=${seeded.mSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${seeded.sSid}`,
  };
}

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

async function seedAcceptedSwap(personId: string, locationId: string): Promise<string> {
  const [shift] = await suite.db
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
  const [swap] = await suite.db
    .insert(shiftSwaps)
    .values({
      requestedByPersonId: personId,
      fromShiftId: shift!.id,
      toPersonId: personId,
      status: "accepted",
    })
    .returning({ id: shiftSwaps.id });
  return swap!.id;
}
async function seedRequestedAbsence(personId: string): Promise<string> {
  const [r] = await suite.db
    .insert(absences)
    .values({
      personId,
      kind: "holiday",
      startsOn: "2026-03-02",
      endsOn: "2026-03-04",
    })
    .returning({ id: absences.id });
  return r!.id;
}

describe("Workforce API — the schedule.manage gates, the decider columns, planned-vs-actual", () => {
  it("refuses every roster write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // GUARD-BY-DELETION (authorizeManager), re-run on this engine 2026-09-22 — the receipt it replaces
    // was taken against postgres:18, which this branch retired: deleted the one
    // `await authorizeManager(tx, { managementSessionId: sessionId, permission });` line from
    // `workforce-api.ts`'s `gated` helper and ran this file. TWO cases went red, this one and the
    // swap/absence/planned-vs-actual sweep below, each at its FIRST `expect403` with
    // `expected 200 to be 403`; the run stops there, so routes 2-5 were not individually exercised.
    // Restored from a byte-for-byte copy, verified with `cmp`, and the file passed again.
    const { locationId, staffCookie } = await setupVenue();
    const app = mountApp();
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

  it("a manager decides a swap and an absence — the decider columns come back through the route", async () => {
    const a = await setupVenue();
    const swapA = await seedAcceptedSwap(a.personId, a.locationId);
    const absA = await seedRequestedAbsence(a.personId);
    const appA = mountApp();

    // A positive control that the queues surface the seeded rows at all, so the decides below act on
    // a swap the route really listed rather than on an id nothing ever returned.
    const aSwaps = (
      (await (await send(appA, "GET", "/management-api/swaps", a.managerCookie)).json()) as {
        id: string;
      }[]
    ).map((r) => r.id);
    expect(aSwaps).toContain(swapA);

    // The decide route stamps the decider on the row it approves. What is asserted here is the
    // stamp itself, read back through the route's own write — which nothing else does.
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
    const decided = await suite.db.execute<{
      status: string;
      decided_by_person_id: string | null;
      decided_at: string | null;
    }>(sql`select status, decided_by_person_id, decided_at from shift_swaps where id = ${swapA}`);
    expect(decided.rows[0]!.status).toBe("approved");
    expect(decided.rows[0]!.decided_by_person_id).toBe(a.personId);
    expect(decided.rows[0]!.decided_at).not.toBeNull();

    // And the absence decide lands its decider column too — a separate route and a separate table.
    const aDecidesAbs = await send(
      appA,
      "POST",
      `/management-api/absences/${absA}/decide`,
      a.managerCookie,
      { decision: "rejected" },
    );
    expect(aDecidesAbs.status).toBe(204);
    const decidedAbs = await suite.db.execute<{
      status: string;
      decided_by_person_id: string | null;
    }>(sql`select status, decided_by_person_id from absences where id = ${absA}`);
    expect(decidedAbs.rows[0]!.status).toBe("rejected");
    expect(decidedAbs.rows[0]!.decided_by_person_id).toBe(a.personId);
  });

  it("refuses the swap + absence + planned-vs-actual routes to a staff-role session — 403", async () => {
    // GATE-BY-DELETION. Three separate gate mechanisms stand behind these five routes and each was
    // mutated on its own, on this engine, 2026-09-22 — replacing receipts taken against postgres:18,
    // which this branch retired. The run stops at the first failed assertion, so a single mutation
    // can only ever be OBSERVED at one route; that is why there are three:
    //  (1) the shared `gated` helper (GET /swaps, GET /absences, planned-vs-actual): deleting its one
    //      `authorizeManager` line reddened this case at the staff `GET /management-api/swaps`,
    //      `expected 200 to be 403`.
    //  (2) the inline swap-decide compose: replaced with a lookup returning a manager id without
    //      gating (it needs `authorizedBy` for `decidedByPersonId`, so deleting it outright does not
    //      compile) — red at the swap-decide `expect403`, `expected 404 to be 403`. A 404 is still a
    //      genuine gate signal: the gate gone, the request reaches `decideSwap`, which 404s on the
    //      missing id.
    //  (3) the inline absence-decide compose: the same substitution, red at the absence-decide
    //      `expect403`, `expected 404 to be 403`.
    // Each mutation was restored from a byte-for-byte copy, verified with `cmp`, before the next.
    const { locationId, staffCookie } = await setupVenue();
    const app = mountApp();
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

  it("assembles planned-vs-actual for the tenant's own location", async () => {
    // Seed one shift on a PUBLISHED roster version — the planned side is published-only, so a
    // null-version draft would be excluded — and assert it comes back as a no-show. The windowing and
    // scoping logic itself is covered in `workforce-api.test.ts`.
    const v = await setupVenue();
    // `now()` has no equivalent here: the clock is read in JavaScript and bound. `published_at` is a
    // text column, and `nowIso()` is the canonical spelling every other writer of it uses.
    const [version] = await suite.db
      .insert(rosterVersions)
      .values({
        locationId: v.locationId,
        periodStart: "2026-03-02",
        periodEnd: "2026-03-08",
        status: "published",
        publishedAt: nowIso(),
      })
      .returning({ id: rosterVersions.id });
    await suite.db.insert(shifts).values({
      personId: v.personId,
      locationId: v.locationId,
      startsAt: "2026-03-02T09:00:00Z",
      startsOffsetMinutes: 0,
      endsAt: "2026-03-02T13:00:00Z",
      endsOffsetMinutes: 0,
      rosterVersionId: version!.id,
    });
    const res = await send(
      mountApp(),
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
