import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { mountUnitsApi } from "./units-api.js";
import "./errors.js";

// Every role holding `catalogue.manage` also holds `person.manage`, so no real person holds one
// without the other: `authorizeManager` is wrapped to refuse whatever `gate.withheld` names.
const gate = vi.hoisted(() => ({ withheld: null as string | null }));
vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  return {
    ...actual,
    authorizeManager: async (...args: Parameters<typeof actual.authorizeManager>) => {
      const [, request] = args;
      if (request.permission === gate.withheld) {
        throw new AppError("authorization.not_permitted", { permission: request.permission });
      }
      return actual.authorizeManager(...args);
    },
  };
});

const log: Logger = () => {};
let cookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    cookie = await withTransaction(db, async (tx) => {
      const [manager] = await tx
        .insert(persons)
        .values({ displayName: "Manager", pinHash: hashPin("1234"), role: "manager" })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: manager!.id });
      return `${MANAGEMENT_COOKIE}=${session.token}`;
    });
  },
});

beforeEach(() => {
  gate.withheld = null;
});

const writes: [label: string, path: string, method: string, body: unknown][] = [
  [
    "the new-product VAT class",
    "/management-api/catalogue-settings",
    "PUT",
    { defaultProductVatClass: "reduced" },
  ],
  [
    "a unit",
    "/management-api/units",
    "POST",
    { name: { en: "portion" }, precision: 0, abbreviation: { en: "pt" } },
  ],
];

function send(path: string, method: string, body: unknown) {
  const app = new Hono();
  mountCatalogueApi(app, { db: suite.db, venueLocale: "en-GB" }, log);
  mountUnitsApi(app, { db: suite.db, venueLocale: "en-GB" }, log);
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("catalogue.manage gates the catalogue and units writes", () => {
  it.each(writes)(
    "refuses %s to a session holding person.manage only",
    async (_l, path, method, body) => {
      gate.withheld = "catalogue.manage";
      const response = await send(path, method, body);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "authorization.not_permitted", params: { permission: "catalogue.manage" } },
      });
    },
  );

  it.each(writes)(
    "serves %s to a session holding catalogue.manage only",
    async (_l, path, method, body) => {
      gate.withheld = "person.manage";
      const response = await send(path, method, body);
      expect(response.status).toBeLessThan(300);
    },
  );
});
