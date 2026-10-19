import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { venueFiscalSelection } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import "./errors.js";

// No built-in role holds `venue.configure` without `catalogue.manage`, so `authorizeManager` is
// wrapped to refuse whatever `gate.withheld` names.
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

const PATH = "/management-api/venue-defaults";
let managerCookie: string;
let supervisorCookie: string;
let locationId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    [managerCookie, supervisorCookie, locationId] = await withTransaction(db, async (tx) => {
      const cookieFor = async (role: "manager" | "supervisor") => {
        const [person] = await tx
          .insert(persons)
          .values({ displayName: role, pinHash: hashPin("1234"), role })
          .returning({ id: persons.id });
        const session = await startManagementSession(tx, { personId: person!.id });
        return `${MANAGEMENT_COOKIE}=${session.token}`;
      };
      const [location] = await tx
        .insert(locations)
        .values({
          name: "Bar",
          province: "Madrid",
          invoiceLocales: ["es-ES"],
          operationDescription: "Sale on premises",
        })
        .returning({ id: locations.id });
      return [await cookieFor("manager"), await cookieFor("supervisor"), location!.id];
    });
  },
});

beforeEach(async () => {
  gate.withheld = null;
  await suite.db.execute(sql`delete from catalogue_settings`);
});

function app() {
  const app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: suite.db,
      cfg: { locationId },
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
  return app;
}
const read = (cookie: string) => app().request(PATH, { headers: { cookie } });
const write = (cookie: string) =>
  app().request(PATH, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ defaultProductVatClass: "reduced" }),
  });
async function storedVatClass(): Promise<string | null> {
  const { rows } = await suite.db.execute<{ default_product_vat_class: string }>(
    sql`select default_product_vat_class from catalogue_settings where id = 1`,
  );
  return rows[0]?.default_product_vat_class ?? null;
}
const refusal = (permission: string) => ({
  error: { code: "authorization.not_permitted", params: { permission } },
});

describe("venue.view gates reading the venue defaults and venue.configure gates writing them", () => {
  it("serves a read and refuses a write to a session without venue.configure", async () => {
    gate.withheld = "venue.configure";
    const answer = await read(managerCookie);
    expect(answer.status).toBe(200);
    expect(Object.keys(await answer.json()).sort()).toEqual([
      "defaultProductVatClass",
      "fixedReceiptLanguage",
      "receiptLanguage",
      "receiptLanguageChoices",
    ]);
    const refused = await write(managerCookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual(refusal("venue.configure"));
    expect(await storedVatClass()).toBeNull();
  });

  it("serves a read and refuses a write to a real supervisor session", async () => {
    const answer = await read(supervisorCookie);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(await (await read(managerCookie)).json());
    const refused = await write(supervisorCookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual(refusal("venue.configure"));
    expect(await storedVatClass()).toBeNull();
  });

  it("refuses a read to a session without venue.view", async () => {
    gate.withheld = "venue.view";
    const answer = await read(managerCookie);
    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual(refusal("venue.view"));
  });

  it("serves a read and a write to a session without catalogue.manage", async () => {
    gate.withheld = "catalogue.manage";
    expect((await read(managerCookie)).status).toBe(200);
    const saved = await write(managerCookie);
    expect(saved.status).toBe(200);
    expect((await saved.json()).defaultProductVatClass).toBe("reduced");
    expect((await (await read(managerCookie)).json()).defaultProductVatClass).toBe("reduced");
    expect(await storedVatClass()).toBe("reduced");
  });
});
