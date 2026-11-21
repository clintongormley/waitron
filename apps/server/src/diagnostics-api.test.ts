import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction, withFoldedPersonChanges } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashSessionToken,
  dashboardSessions,
  persons,
  startManagementSession,
  type BuiltInRoleKey,
} from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { createLogger, type Logger } from "./logger.js";
import { requestIdMiddleware } from "./request-id.js";
import { createLogReader, type LogEvent, type LogReader } from "./log-file.js";
import { ALL_MODULES } from "./modules.js";
import { createVerbosityController } from "./verbosity.js";
import { mountDiagnosticsApi } from "./diagnostics-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

// Exercise diagnostics permission gates, verbosity and limit clamping through the real route.
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** A no-op logger: only the HTTP responses matter here. */
const noopLog: Logger = () => {};

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(73_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  /** A live MANAGEMENT session cookie for a `manager` (holds `system.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds no `system.manage`). */
  staffCookie: string;
  /** A live MANAGEMENT session cookie for a `supervisor` (holds no `system.manage` either). */
  supervisorCookie: string;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupVenue(): Promise<Venue> {
  const taxId = nextNif();
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId,
        legalName: "Deli Test SL",
        name: "Main room",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administrator",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const { managerSid, staffSid, supervisorSid } = await withTransaction(suite.db, async (tx) => {
    // Through the table definition: `persons.id` and `created_at` are NOT NULL `$defaultFn`
    // generators a raw insert never reaches.
    const seedPerson = async (role: BuiltInRoleKey): Promise<string> => {
      const [p] = await seedPersons(tx, {
        displayName: `The ${role}`,
        pinHash: fixturePinHash("1234"),
        role,
      });
      const session = await startManagementSession(tx, { method: "password", personId: p!.id });
      return session.token;
    };
    return {
      managerSid: await seedPerson("manager"),
      staffSid: await seedPerson("staff"),
      supervisorSid: await seedPerson("supervisor"),
    };
  });

  return {
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
    supervisorCookie: `${MANAGEMENT_COOKIE}=${supervisorSid}`,
  };
}

const EVENTS: LogEvent[] = [
  { at: "2026-08-31T10:00:00.000Z", level: "info", event: "one", requestId: "r1" },
  { at: "2026-08-31T10:00:01.000Z", level: "warn", event: "two", requestId: "r2" },
];

/** A stub LogReader that records the last `recent` opts so the limit clamp can be asserted. */
function stubReader(): { reader: LogReader; lastRecentOpts: () => { limit?: number } | undefined } {
  let last: { limit?: number } | undefined;
  return {
    reader: {
      recent: (opts) => {
        last = opts;
        return EVENTS;
      },
      byRequestIds: () => [],
    },
    lastRecentOpts: () => last,
  };
}

/** One Hono app for a venue, wiring the diagnostics routes with a real verbosity controller (default
 * `info`) and the given stub reader. `now` is fixed so `revertsAt` is deterministic. */
function mountApp(reader: LogReader, requestLog?: Logger) {
  const app = new Hono();
  const now = () => new Date("2026-08-31T12:00:00.000Z");
  if (requestLog) app.use("*", requestIdMiddleware(requestLog, now));
  const verbosity = createVerbosityController({
    defaultLevel: "info",
    now,
  });
  mountDiagnosticsApi(
    app,
    {
      db: suite.db,
      reader,
      verbosity,
      now,
    },
    noopLog,
  );
  return { app, verbosity };
}

async function get(app: Hono, path: string, cookie?: string): Promise<Response> {
  return app.request(path, {
    method: "GET",
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function post(app: Hono, path: string, cookie: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("mountDiagnosticsApi — system.manage gate + verbosity", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    const { app } = mountApp(stubReader().reader);
    const res = await get(app, "/management-api/diagnostics/recent");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  describe.each([
    { method: "GET", path: "/management-api/diagnostics/recent" },
    { method: "GET", path: "/management-api/diagnostics/verbosity" },
    { method: "POST", path: "/management-api/diagnostics/verbosity" },
  ])("$method $path", ({ method, path }) => {
    it("answers 401 management_session.expired for an idle-expired manager", async () => {
      const v = await setupVenue();
      const tokenHash = hashSessionToken(v.managerCookie.split("=")[1]!);
      await withTransaction(suite.db, async (tx) => {
        await tx
          .update(dashboardSessions)
          .set({ lastSeenAt: "1970-01-01T00:00:00.000Z" })
          .where(eq(dashboardSessions.tokenHash, tokenHash));
      });
      const stub = stubReader();
      const { app, verbosity } = mountApp(stub.reader);
      const res =
        method === "GET"
          ? await get(app, path, v.managerCookie)
          : await post(app, path, v.managerCookie, { level: "debug", ttlMinutes: 5 });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: "management_session.expired", params: {} },
      });
      expect(stub.lastRecentOpts()).toBeUndefined();
      expect(verbosity.current()).toBe("info");
      expect(verbosity.revertsAt()).toBeNull();
      const [session] = await suite.db
        .select({ lastSeenAt: dashboardSessions.lastSeenAt })
        .from(dashboardSessions)
        .where(eq(dashboardSessions.tokenHash, tokenHash));
      expect(session).toEqual({ lastSeenAt: "1970-01-01T00:00:00.000Z" });
    });

    it("answers 403 person.suspended for a suspended manager with a live session", async () => {
      const v = await setupVenue();
      const tokenHash = hashSessionToken(v.managerCookie.split("=")[1]!);
      const [session] = await suite.db
        .select({ personId: dashboardSessions.personId })
        .from(dashboardSessions)
        .where(eq(dashboardSessions.tokenHash, tokenHash));
      await withTransaction(suite.db, async (tx) => {
        await tx
          .update(persons)
          .set(withFoldedPersonChanges({ status: "suspended" }))
          .where(eq(persons.id, session!.personId));
      });
      const stub = stubReader();
      const { app, verbosity } = mountApp(stub.reader);
      const res =
        method === "GET"
          ? await get(app, path, v.managerCookie)
          : await post(app, path, v.managerCookie, { level: "debug", ttlMinutes: 5 });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "person.suspended", params: { personId: session!.personId } },
      });
      expect(stub.lastRecentOpts()).toBeUndefined();
      expect(verbosity.current()).toBe("info");
      expect(verbosity.revertsAt()).toBeNull();
    });
  });

  it("rejects a staff session with 403 (gate by deletion)", async () => {
    const v = await setupVenue();
    const { app } = mountApp(stubReader().reader);
    const res = await get(app, "/management-api/diagnostics/recent", v.staffCookie);
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("rejects a supervisor session with 403", async () => {
    const v = await setupVenue();
    const { app } = mountApp(stubReader().reader);
    const res = await get(app, "/management-api/diagnostics/recent", v.supervisorCookie);
    expect(res.status).toBe(403);
  });

  it("limits the results within a bounded scan", async () => {
    const { managerCookie } = await setupVenue();
    const dir = mkdtempSync(join(tmpdir(), "diagnostics-route-"));
    try {
      writeFileSync(
        join(dir, "waitron.log"),
        Array.from({ length: 1001 }, (_, index) => JSON.stringify({ ...EVENTS[1], index })).join(
          "\n",
        ),
      );
      const { app } = mountApp(createLogReader({ dir, maxFiles: 0 }));
      for (const [query, count] of [
        ["limit=2", 2],
        ["", 200],
        ["limit=99999", 1000],
        ["limit=0", 1],
        ["limit=abc", 200],
        ["limit=", 200],
      ] as const) {
        const response = await get(
          app,
          `/management-api/diagnostics/recent?${query}`,
          managerCookie,
        );
        expect(response.status).toBe(200);
        const { lines } = (await response.json()) as { lines: LogEvent[] };
        expect(lines).toHaveLength(count);
        expect(lines[0]?.index).toBe(1001 - count);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters the bounded file tail before limiting matches and masks older details", async () => {
    const { managerCookie } = await setupVenue();
    const dir = mkdtempSync(join(tmpdir(), "diagnostics-route-"));
    try {
      const entries: LogEvent[] = [
        {
          at: "2026-08-31T11:55:00.000Z",
          level: "warn",
          event: "mail.retry",
          requestId: "r1",
          params: {
            email: "person@example.test",
            target: "https://user:legacy-secret@example.test",
          },
        },
        { at: "2026-08-31T11:56:00.000Z", level: "debug", event: "loop.sleeping" },
        { at: "2026-08-31T11:57:00.000Z", level: "info", event: "mail.ready" },
        { at: "2026-08-31T11:54:59.000Z", level: "info", event: "outside.window" },
      ];
      writeFileSync(
        join(dir, "waitron.log"),
        entries.map((entry) => JSON.stringify(entry)).join("\n"),
      );
      const { app } = mountApp(createLogReader({ dir, maxFiles: 0 }));
      const read = async (query: string) => {
        const res = await get(app, `/management-api/diagnostics/recent?${query}`, managerCookie);
        expect(res.status).toBe(200);
        return (await res.json()) as {
          lines: LogEvent[];
          timeZone: string;
          oldestScannedAt: string;
        };
      };

      expect(await read("limit=1")).toEqual({
        timeZone: "Europe/Madrid",
        oldestScannedAt: "2026-08-31T11:54:59.000Z",
        lines: [
          {
            ...entries[0],
            params: { email: "p***n@e***e.test", target: "https://user:***@example.test" },
          },
        ],
      });
      const all = await read("level=all");
      expect(all.oldestScannedAt).toBe("2026-08-31T11:55:00.000Z");
      expect(all.lines.map(({ event }) => event)).toEqual([
        "mail.retry",
        "loop.sleeping",
        "mail.ready",
      ]);
      expect((await read("level=info")).lines.map(({ event }) => event)).toEqual([
        "mail.retry",
        "mail.ready",
        "outside.window",
      ]);
      expect((await read("level=error")).lines).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps successful Diagnostics polling out of the request log", async () => {
    const { managerCookie } = await setupVenue();
    const entries: LogEvent[] = [];
    const log = createLogger(
      (line) => entries.push(JSON.parse(line) as LogEvent),
      () => new Date("2026-08-31T12:00:00.000Z"),
      () => "debug",
    );
    const { app } = mountApp(stubReader().reader, log);
    app.get("/other", (c) => c.json({}));
    for (const [path, id, passive, cookie, status] of [
      ["/management-api/diagnostics/recent?level=all", "poll-recent", true, managerCookie, 200],
      ["/management-api/diagnostics/verbosity", "poll-verbosity", true, managerCookie, 200],
      ["/management-api/diagnostics/recent", "failed-poll", true, "", 401],
      ["/management-api/diagnostics/recent", "active-read", false, managerCookie, 200],
      ["/other", "other-poll", true, managerCookie, 200],
    ] as const) {
      const response = await app.request(path, {
        headers: {
          "x-request-id": id,
          "x-waitron-live": passive ? "1" : "0",
          cookie,
        },
      });
      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toBe(id);
    }
    expect(entries.map(({ event, requestId }) => [event, requestId])).toEqual([
      ["http.request", "failed-poll"],
      ["http.request", "active-read"],
      ["http.request", "other-poll"],
    ]);
  });

  it("reports the default verbosity (no active override) as info with a null revert time", async () => {
    const v = await setupVenue();
    const { app } = mountApp(stubReader().reader);
    const res = await get(app, "/management-api/diagnostics/verbosity", v.managerCookie);
    expect(res.status).toBe(200);
    expect((await res.json()) as { level: string; revertsAt: string | null }).toEqual({
      level: "info",
      revertsAt: null,
    });
  });

  it("raises verbosity and reports it back with a revert time", async () => {
    const v = await setupVenue();
    const { app } = mountApp(stubReader().reader);

    const raise = await post(app, "/management-api/diagnostics/verbosity", v.managerCookie, {
      level: "debug",
      ttlMinutes: 5,
    });
    expect(raise.status).toBe(204);

    const res = await get(app, "/management-api/diagnostics/verbosity", v.managerCookie);
    const body = (await res.json()) as { level: string; revertsAt: string | null };
    expect(body.level).toBe("debug");
    // now() is fixed at 12:00:00Z; +5 minutes.
    expect(body.revertsAt).toBe("2026-08-31T12:05:00.000Z");
  });

  it("rejects an invalid level with diagnostics.invalid_verbosity", async () => {
    const v = await setupVenue();
    const { app } = mountApp(stubReader().reader);
    const res = await post(app, "/management-api/diagnostics/verbosity", v.managerCookie, {
      level: "trace",
      ttlMinutes: 5,
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "diagnostics.invalid_verbosity", params: { reason: "level" } },
    });
  });

  it("rejects an out-of-range ttl with diagnostics.invalid_verbosity", async () => {
    const v = await setupVenue();
    const { app } = mountApp(stubReader().reader);
    const res = await post(app, "/management-api/diagnostics/verbosity", v.managerCookie, {
      level: "debug",
      ttlMinutes: 0,
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "diagnostics.invalid_verbosity", params: { reason: "ttl" } },
    });
  });

  it("rejects a ttl above the ceiling too", async () => {
    const v = await setupVenue();
    const { app } = mountApp(stubReader().reader);
    const res = await post(app, "/management-api/diagnostics/verbosity", v.managerCookie, {
      level: "debug",
      ttlMinutes: 121,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "diagnostics.invalid_verbosity" },
    });
  });

  it("coerces an empty POST body to a clean 400, not an opaque 500", async () => {
    const v = await setupVenue();
    const { app } = mountApp(stubReader().reader);
    // No body: `c.req.json()` would throw SyntaxError → the boundary answers `server.internal` 500;
    // `readJsonBody` coerces it to `{}` so the field guard refuses it as `diagnostics.invalid_verbosity`.
    const res = await app.request("/management-api/diagnostics/verbosity", {
      method: "POST",
      headers: { cookie: v.managerCookie, "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "diagnostics.invalid_verbosity", params: { reason: "level" } },
    });
  });
});
