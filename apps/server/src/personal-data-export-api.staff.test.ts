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
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { PersonalDataPart, PersonalDataSubject } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { locationId as brandLocationId } from "@waitron/shared";
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
  pinHash: "MARTA-PIN-CANARY",
};

const identityModules = ALL_MODULES.filter((m) => m.name === "identity");
const logger = vi.fn();
let nodeId: string;
let ids: Record<"admin" | "otherAdmin" | "manager" | "supervisor" | "staff" | "marta", string>;
let tokens: Record<"admin" | "otherAdmin" | "manager" | "supervisor" | "staff", string>;
let subjects: PersonalDataSubject[];

const stubPart: PersonalDataPart = {
  owner: "server",
  part: {
    files: ["extra.json"],
    prepare: async (_tx, subject) => {
      subjects.push(subject);
      return async () => [{ name: "extra.json", content: '{"extra":true}\n' }];
    },
  },
};

function mounted() {
  const app = new Hono();
  const deps: PersonalDataExportDeps = {
    db: suite.db,
    nodeId,
    modules: identityModules,
    serverParts: [stubPart],
    venueLocale: "en-GB",
    now: () => NOW,
  };
  mountPersonalDataExportApi(app, deps, logger);
  return app;
}
const ask = (path: string, token: string | null) =>
  mounted().request(path, {
    headers: token === null ? {} : { cookie: `${MANAGEMENT_COOKIE}=${token}` },
  });
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
  suite.db.run(
    sql`update persons set status = 'suspended', locale = 'es-ES' where id = ${ids.marta}`,
  );
  const start = (personId: string) =>
    withTransaction(suite.db, async (tx) => (await startManagementSession(tx, { personId })).token);
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
});
