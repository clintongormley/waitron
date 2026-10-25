import { Hono } from "hono";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  endManagementSession,
  hashPin,
  hashSessionToken,
  managementSessions,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { PersonalDataPart, PersonalDataSubject } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { locationId as brandLocationId } from "@waitron/shared";
import { PERSONAL_DATA_README_WORDS } from "./i18n/personal-data-readme.js";
import { ALL_MODULE_PERMISSIONS } from "./modules.js";
import {
  mountPersonalDataExportApi,
  type PersonalDataExportDeps,
} from "./personal-data-export-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const NOW = new Date("2026-10-04T22:30:00Z");
const UNKNOWN_ID = "0f6b2c1e-7d4a-4e9b-8c3f-5a1d2e3f4a5b";
const MALFORMED_ID = "not-a-uuid";
const staffPath = (id: string) => `/management-api/staff/${id}/personal-data/export`;
const OWN_PATH = "/management-api/me/personal-data/export";
const MARTA = {
  displayName: "Marta López",
  email: "marta@example.test",
  telephone: "+34611222333",
  firstNames: "MARTA-FIRST-CANARY",
  // A real hash, so her export reads it as a set PIN rather than a placeholder.
  pinHash: hashPin("2468"),
};

const identityModules = ALL_MODULES.filter((m) => m.name === "identity");
const logger = vi.fn();
let nodeId: string;
let ids: Record<"admin" | "otherAdmin" | "manager" | "supervisor" | "staff" | "marta", string>;
let tokens: Record<"admin" | "otherAdmin" | "manager" | "supervisor" | "staff", string>;
let martaToken: string;
let subjects: PersonalDataSubject[];
let duringBuild: (() => Promise<void>) | undefined;
let extraContent: string;

const stubPart: PersonalDataPart = {
  owner: "server",
  part: {
    files: ["extra.json"],
    prepare: async (_tx, subject) => {
      subjects.push(subject);
      return async () => {
        await duringBuild?.();
        return [{ name: "extra.json", content: extraContent }];
      };
    },
  },
};

function mounted(patch: Partial<PersonalDataExportDeps> = {}) {
  const app = new Hono();
  const deps: PersonalDataExportDeps = {
    db: suite.db,
    nodeId,
    modules: identityModules,
    serverParts: [stubPart],
    venueLocale: "en-GB",
    now: () => NOW,
    ...patch,
  };
  mountPersonalDataExportApi(app, deps, logger);
  return app;
}
const ask = (
  path: string,
  token: string | null,
  patch: Partial<PersonalDataExportDeps> = {},
  headers: Record<string, string> = {},
) =>
  mounted(patch).request(path, {
    headers: token === null ? headers : { ...headers, cookie: `${MANAGEMENT_COOKIE}=${token}` },
  });
const lastSeen = (token: string) =>
  suite.db
    .select({ lastSeenAt: managementSessions.lastSeenAt })
    .from(managementSessions)
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)))
    .get()!.lastSeenAt;
async function unzipped(response: Response) {
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}
async function refused(response: Response, status: number, error: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(await response.json()).toEqual({ error });
}
const notPermitted = {
  code: "authorization.not_permitted",
  params: { permission: "personal_data.export" },
};

beforeAll(() => {
  registerModulePermissions(ALL_MODULE_PERMISSIONS);
});

beforeEach(async () => {
  subjects = [];
  duringBuild = undefined;
  extraContent = '{"extra":true}\n';
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
  nodeId = await seedNode(suite.db, brandLocationId(location!.id));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Ana Admin", email: "ana@example.test", role: "admin" },
      { displayName: "Otto Admin", email: "otto@example.test", role: "admin" },
      { displayName: "Mia Manager", email: "mia@example.test", role: "manager" },
      { displayName: "Sam Supervisor", email: "sam@example.test", role: "supervisor" },
      { displayName: "Stella Staff", email: "stella@example.test", role: "staff" },
      { ...MARTA, role: "staff" },
    ])
    .returning();
  const [admin, otherAdmin, manager, supervisor, staff, marta] = rows.map((r) => r.id);
  ids = {
    admin: admin!,
    otherAdmin: otherAdmin!,
    manager: manager!,
    supervisor: supervisor!,
    staff: staff!,
    marta: marta!,
  };
  const start = (personId: string) =>
    withTransaction(suite.db, async (tx) => (await startManagementSession(tx, { personId })).token);
  martaToken = await start(ids.marta);
  suite.db.run(
    sql`update persons set status = 'suspended', locale = 'es-ES' where id = ${ids.marta}`,
  );
  suite.db.run(sql`update persons set locale = 'en-GB' where id = ${ids.admin}`);
  tokens = {
    admin: await start(ids.admin),
    otherAdmin: await start(ids.otherAdmin),
    manager: await start(ids.manager),
    supervisor: await start(ids.supervisor),
    staff: await start(ids.staff),
  };
});

describe("GET /management-api/staff/:id/personal-data/export", () => {
  it("gives an admin a disabled person's files, named for her", async () => {
    const response = await ask(staffPath(ids.marta), tokens.admin);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="marta-lopez-2026-10-05.zip"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(subjects.map((s) => s.personId)).toEqual([ids.marta]);
    const files = await unzipped(response);
    expect(files["profile.json"]).toContain(MARTA.email);
  });

  it("gives an admin another admin's files", async () => {
    const response = await ask(staffPath(ids.otherAdmin), tokens.admin);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="otto-admin-2026-10-05.zip"',
    );
    expect(subjects.map((s) => s.personId)).toEqual([ids.otherAdmin]);
    const files = await unzipped(response);
    expect(files["profile.json"]).toContain("otto@example.test");
    expect(files["profile.json"]).not.toContain("ana@example.test");
  });

  for (const role of ["manager", "supervisor", "staff"] as const) {
    it(`refuses a ${role} another person's files`, async () => {
      await refused(await ask(staffPath(ids.marta), tokens[role]), 403, notPermitted);
      expect(subjects).toEqual([]);
    });
  }

  it("refuses a staff member naming themselves, whose own copy is the own route's", async () => {
    await refused(await ask(staffPath(ids.staff), tokens.staff), 403, notPermitted);
    const response = await ask(OWN_PATH, tokens.staff);
    expect(response.status).toBe(200);
    const text = Object.values(await unzipped(response)).join("\n");
    expect(text).toContain("stella@example.test");
    for (const value of [...Object.values(MARTA), ids.marta]) expect(text).not.toContain(value);
    expect(subjects.map((s) => s.personId)).toEqual([ids.staff]);
  });

  it("checks the permission before the id, so a refused caller learns nothing of who exists", async () => {
    await refused(await ask(staffPath(UNKNOWN_ID), tokens.manager), 403, notPermitted);
    await refused(await ask(staffPath(MALFORMED_ID), tokens.manager), 403, notPermitted);
  });

  it("answers an admin's unknown or malformed id as a missing person", async () => {
    for (const id of [UNKNOWN_ID, MALFORMED_ID])
      await refused(await ask(staffPath(id), tokens.admin), 404, {
        code: "person.not_found",
        params: { personId: id },
      });
    expect(subjects).toEqual([]);
  });

  it("checks the permission before the query: a manager sending one is refused the permission", async () => {
    await refused(await ask(`${staffPath(ids.marta)}?x=1`, tokens.manager), 403, notPermitted);
    expect(subjects).toEqual([]);
  });

  it("checks the query before the id: an admin's malformed id with a query is refused the query", async () => {
    await refused(await ask(`${staffPath(MALFORMED_ID)}?x=1`, tokens.admin), 400, {
      code: "management.request_invalid",
      params: { field: "query" },
    });
    expect(subjects).toEqual([]);
  });

  it("refuses an admin's request carrying a query", async () => {
    await refused(await ask(`${staffPath(ids.marta)}?x=1`, tokens.admin), 400, {
      code: "management.request_invalid",
      params: { field: "query" },
    });
    expect(subjects).toEqual([]);
  });

  it("refuses a request with no cookie", async () => {
    await refused(await ask(staffPath(ids.marta), null), 401, {
      code: "management_session.required",
      params: {},
    });
  });

  it("refuses an admin's ended session", async () => {
    await withTransaction(suite.db, (tx) => endManagementSession(tx, tokens.admin));
    await refused(await ask(staffPath(ids.marta), tokens.admin), 401, {
      code: "management_session.required",
      params: {},
    });
  });

  it("refuses a disabled admin's live session", async () => {
    suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, ids.admin)).run();
    await refused(await ask(staffPath(ids.marta), tokens.admin), 403, {
      code: "person.suspended",
      params: { personId: ids.admin },
    });
  });

  it("writes the README in her language, not the admin's saved or browser language", async () => {
    const response = await ask(
      staffPath(ids.marta),
      tokens.admin,
      {},
      {
        "accept-language": "en-GB",
      },
    );
    expect(response.status).toBe(200);
    expect(subjects.map((s) => s.language)).toEqual(["es"]);
    const files = await unzipped(response);
    expect(files["README.txt"]!.split("\n")[0]).toBe(
      PERSONAL_DATA_README_WORDS.es.title.replace("{venue}", "Test SL"),
    );
  });

  for (const [venueLocale, language] of [
    ["es-ES", "es"],
    ["en-GB", "en"],
  ] as const) {
    it(`writes the README in the venue's language (${venueLocale}) when she has none saved`, async () => {
      const browser = { "accept-language": language === "es" ? "en-GB" : "es-ES" };
      const response = await ask(staffPath(ids.otherAdmin), tokens.admin, { venueLocale }, browser);
      expect(response.status).toBe(200);
      expect(subjects.map((s) => s.language)).toEqual([language]);
      const files = await unzipped(response);
      expect(files["README.txt"]!.split("\n")[0]).toBe(
        PERSONAL_DATA_README_WORDS[language].title.replace("{venue}", "Test SL"),
      );
    });
  }

  it("checks the permission again after building, and sends nothing to a demoted admin", async () => {
    duringBuild = () =>
      withTransaction(suite.db, async (tx) => {
        await tx.update(persons).set({ role: "manager" }).where(eq(persons.id, ids.admin));
      });
    await refused(await ask(staffPath(ids.marta), tokens.admin), 403, notPermitted);
    expect(subjects.map((s) => s.personId)).toEqual([ids.marta]);
  });

  it("checks again after building, and sends nothing to an admin disabled meanwhile", async () => {
    duringBuild = () =>
      withTransaction(suite.db, async (tx) => {
        await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, ids.admin));
      });
    await refused(await ask(staffPath(ids.marta), tokens.admin), 403, {
      code: "person.suspended",
      params: { personId: ids.admin },
    });
    expect(subjects.map((s) => s.personId)).toEqual([ids.marta]);
  });

  it("checks again after building, and sends nothing once the admin's session has ended", async () => {
    duringBuild = () =>
      withTransaction(suite.db, async (tx) => {
        await endManagementSession(tx, tokens.admin);
      });
    await refused(await ask(staffPath(ids.marta), tokens.admin), 401, {
      code: "management_session.required",
      params: {},
    });
    expect(subjects.map((s) => s.personId)).toEqual([ids.marta]);
  });

  it("changes no row, not the admin session's last-seen time nor a waiting change", async () => {
    suite.db
      .update(managementSessions)
      .set({ lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString() })
      .where(eq(managementSessions.tokenHash, hashSessionToken(tokens.admin)))
      .run();
    suite.db.run(
      sql`insert into change_log (id, payload) values ('pd1', '{"resource":"zz","id":"1"}')`,
    );
    const changes = () => suite.db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
    const before = lastSeen(tokens.admin);
    const changesBefore = changes();
    expect((await ask(staffPath(ids.marta), tokens.admin)).status).toBe(200);
    expect(lastSeen(tokens.admin)).toBe(before);
    expect(changes()).toBe(changesBefore);
    expect(suite.db.all(sql`select id from change_log`)).toEqual([{ id: "pd1" }]);
  });

  it("carries none of her hashes, nor the admin's session token hash", async () => {
    const response = await ask(staffPath(ids.marta), tokens.admin);
    expect(response.status).toBe(200);
    const files = await unzipped(response);
    const text = Object.values(files).join("\n");
    expect(text).toContain(MARTA.email);
    expect((JSON.parse(files["sign-in.json"]!) as { pinSet: boolean }).pinSet).toBe(true);
    expect(text).not.toContain(hashSessionToken(martaToken));
    expect(text).not.toContain(MARTA.pinHash);
    expect(text).not.toContain(hashSessionToken(tokens.admin));
  });
});
