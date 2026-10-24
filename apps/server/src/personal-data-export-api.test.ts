import { Hono } from "hono";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  IDLE_TIMEOUT_MS,
  endManagementSession,
  hashSessionToken,
  managementSessions,
  persons,
  startManagementSession,
} from "@waitron/identity";
import type { PersonalDataPart, PersonalDataSubject } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { locationId as brandLocationId } from "@waitron/shared";
import {
  mountPersonalDataExportApi,
  sendPersonalData,
  withPersonalDataErrors,
  type PersonalDataAuthorize,
  type PersonalDataExportDeps,
} from "./personal-data-export-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const PATH = "/management-api/me/personal-data/export";
const NOW = new Date("2026-10-04T22:30:00Z");
const MARTA_PIN_HASH = "MARTA-PIN-HASH-CANARY";
const COLLEAGUE = {
  displayName: "Colleague Canary",
  email: "COLLEAGUE-CANARY@example.test",
  telephone: "+34999000111",
  firstNames: "COLLEAGUE-FIRST-CANARY",
  pinHash: "COLLEAGUE-PIN-CANARY",
};

const identityModules = ALL_MODULES.filter((m) => m.name === "identity");
const logger = vi.fn();
let locationId: string, nodeId: string, martaId: string, colleagueId: string;
let martaToken: string, colleagueToken: string;
let order: string[];
let subjects: PersonalDataSubject[];
let duringBuild: (() => Promise<void>) | undefined;

const stubPart: PersonalDataPart = {
  owner: "server",
  part: {
    files: ["extra.json"],
    prepare: async (_tx, subject) => {
      order.push("prepare");
      subjects.push(subject);
      return async () => {
        order.push("build");
        await duringBuild?.();
        return [{ name: "extra.json", content: '{"extra":true}\n' }];
      };
    },
  },
};

function deps(patch: Partial<PersonalDataExportDeps> = {}): PersonalDataExportDeps {
  return {
    db: suite.db,
    nodeId,
    modules: identityModules,
    serverParts: [stubPart],
    now: () => NOW,
    ...patch,
  };
}
function mounted(patch: Partial<PersonalDataExportDeps> = {}) {
  const app = new Hono();
  mountPersonalDataExportApi(app, deps(patch), logger);
  return app;
}
const ask = (app: Hono, token: string | null = martaToken, query = "") =>
  app.request(`${PATH}${query}`, {
    headers: token === null ? {} : { cookie: `${MANAGEMENT_COOKIE}=${token}` },
  });
async function unzipped(response: Response) {
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}
async function refused(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
}
const session = (token: string) =>
  suite.db
    .select({ lastSeenAt: managementSessions.lastSeenAt })
    .from(managementSessions)
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)))
    .get()!;
const setLastSeen = (token: string, at: Date) =>
  suite.db
    .update(managementSessions)
    .set({ lastSeenAt: at.toISOString() })
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)))
    .run();

beforeEach(async () => {
  order = [];
  subjects = [];
  duringBuild = undefined;
  logger.mockClear();
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Venue",
      invoiceLocales: ["es"],
      operationDescription: "Sale on premises",
      timeZone: "Europe/Madrid",
    })
    .returning();
  locationId = location!.id;
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const [marta, colleague] = await suite.db
    .insert(persons)
    .values([
      {
        displayName: "Marta López",
        email: "marta@example.test",
        pinHash: MARTA_PIN_HASH,
        role: "staff",
      },
      { ...COLLEAGUE, role: "staff" },
    ])
    .returning();
  martaId = marta!.id;
  colleagueId = colleague!.id;
  martaToken = await withTransaction(
    suite.db,
    async (tx) => (await startManagementSession(tx, { personId: martaId })).token,
  );
  colleagueToken = await withTransaction(
    suite.db,
    async (tx) => (await startManagementSession(tx, { personId: colleagueId })).token,
  );
});

describe("GET /management-api/me/personal-data/export", () => {
  it("sends the person's own files as a ZIP named for them and the venue's date", async () => {
    const response = await ask(mounted());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="marta-lopez-2026-10-05.zip"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const files = await unzipped(response);
    expect(Object.keys(files).sort()).toEqual(["extra.json", "profile.json", "sign-in.json"]);
    expect(files["profile.json"]).toContain("marta@example.test");
    expect(subjects).toEqual([
      { personId: martaId, at: NOW, timeZone: "Europe/Madrid", locationId },
    ]);
  });

  it("holds none of a colleague's data, and refuses a query naming someone else", async () => {
    const files = await unzipped(await ask(mounted()));
    const text = Object.values(files).join("\n");
    expect(text).toContain("marta@example.test");
    for (const value of [
      ...Object.values(COLLEAGUE),
      colleagueId,
      hashSessionToken(colleagueToken),
    ])
      expect(text).not.toContain(value);

    const response = await ask(mounted(), martaToken, `?personId=${colleagueId}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "query" } },
    });
    expect(subjects).toHaveLength(1);
  });

  it("carries no hash, not even the asking session's own token hash", async () => {
    const text = Object.values(await unzipped(await ask(mounted()))).join("\n");
    expect(text).toContain("marta@example.test");
    expect(text).not.toContain(MARTA_PIN_HASH);
    expect(text).not.toContain(hashSessionToken(martaToken));
  });

  it("refuses a request with no cookie", async () => {
    await refused(await ask(mounted(), null), 401, "management_session.required");
  });

  it("refuses an ended session", async () => {
    await withTransaction(suite.db, (tx) => endManagementSession(tx, martaToken));
    await refused(await ask(mounted()), 401, "management_session.required");
  });

  it("refuses a session idle past the limit", async () => {
    setLastSeen(martaToken, new Date(Date.now() - IDLE_TIMEOUT_MS - 60_000));
    await refused(await ask(mounted()), 401, "management_session.expired");
  });

  it("refuses a suspended person's live session", async () => {
    suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, martaId)).run();
    await refused(await ask(mounted()), 403, "person.suspended");
  });

  it("writes nothing: the session's last-seen time is left as it was", async () => {
    setLastSeen(martaToken, new Date(Date.now() - 5 * 60_000));
    const before = session(martaToken).lastSeenAt;
    expect((await ask(mounted())).status).toBe(200);
    expect(session(martaToken).lastSeenAt).toBe(before);
  });

  it("checks the session again after building, and sends nothing once it has ended", async () => {
    duringBuild = () =>
      withTransaction(suite.db, async (tx) => {
        await endManagementSession(tx, martaToken);
      });
    const response = await ask(mounted());
    expect(order).toEqual(["prepare", "build"]);
    await refused(response, 401, "management_session.required");
  });

  it("dates the file in UTC with no location when this node has no row", async () => {
    const response = await ask(mounted({ nodeId: "no-such-node" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="marta-lopez-2026-10-04.zip"',
    );
    expect(subjects).toEqual([{ personId: martaId, at: NOW, timeZone: "UTC", locationId: null }]);
  });
});

describe("sendPersonalData", () => {
  function testRoute(authorize: PersonalDataAuthorize) {
    const app = new Hono();
    app.get("/t", (c) =>
      withPersonalDataErrors(c, logger, () => sendPersonalData(c, deps(), authorize)),
    );
    return app;
  }

  it("runs the caller's authorisation before reading and again after building", async () => {
    const authorize = vi.fn<PersonalDataAuthorize>(async () => {
      order.push("authorize");
      return { personId: martaId, label: "Marta López" };
    });
    const response = await testRoute(authorize).request("/t");
    expect(response.status).toBe(200);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["authorize", "prepare", "build", "authorize"]);
  });

  it("sends nothing when the second authorisation names a different person", async () => {
    const authorize = vi
      .fn<PersonalDataAuthorize>()
      .mockResolvedValueOnce({ personId: martaId, label: "Marta López" })
      .mockResolvedValueOnce({ personId: colleagueId, label: "Colleague Canary" });
    const response = await testRoute(authorize).request("/t");
    expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
  });
});
