import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { hashPin, startManagementSession } from "@waitron/identity";
import { venueFiscalSelection } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { mountVenueSettingsApi } from "./venue-settings-api.js";
import "./errors.js";

// No built-in role holds `venue.configure` without `venue.view` or without `menu.manage`, so
// `authorizeManager` is wrapped to refuse whatever `gate.withheld` names.
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

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    [managerCookie, supervisorCookie] = await withTransaction(db, async (tx) => {
      const cookieFor = async (role: "manager" | "supervisor") => {
        const [person] = await seedPersons(tx, {
          displayName: role,
          pinHash: hashPin("1234"),
          role,
        });
        const session = await startManagementSession(tx, {
          method: "password",
          personId: person!.id,
        });
        return `${MANAGEMENT_COOKIE}=${session.token}`;
      };
      await seedVenue(tx, {
        name: "Bar",
        province: "Madrid",
        invoiceLocales: ["es-ES"],
      });
      return [await cookieFor("manager"), await cookieFor("supervisor")];
    });
  },
});

beforeEach(async () => {
  gate.withheld = null;
  await suite.db.execute(sql`delete from settings where module = 'menu'`);
});

function app() {
  const app = new Hono();
  mountVenueSettingsApi(
    app,
    {
      db: suite.db,
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
    body: JSON.stringify({ defaultTakeawayVatRate: "4.00" }),
  });
async function storedTakeawayRate(): Promise<string | null> {
  const { rows } = await suite.db.execute<{ default_takeaway_vat_rate: string | null }>(
    sql`select json_extract(doc, '$.defaultTakeawayVatRate') as default_takeaway_vat_rate from settings where module = 'menu'`,
  );
  return rows[0]?.default_takeaway_vat_rate ?? null;
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
      "defaultTakeawayVatRate",
      "fixedReceiptLanguage",
      "receiptLanguage",
      "receiptLanguageChoices",
      "takeawayVat",
      "vatRates",
    ]);
    const refused = await write(managerCookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual(refusal("venue.configure"));
    expect(await storedTakeawayRate()).toBeNull();
  });

  it("serves a read and refuses a write to a real supervisor session", async () => {
    const answer = await read(supervisorCookie);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(await (await read(managerCookie)).json());
    const refused = await write(supervisorCookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual(refusal("venue.configure"));
    expect(await storedTakeawayRate()).toBeNull();
  });

  it("refuses a read to a session without venue.view", async () => {
    gate.withheld = "venue.view";
    const answer = await read(managerCookie);
    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual(refusal("venue.view"));
  });

  it("serves a read and a write to a session without menu.manage", async () => {
    gate.withheld = "menu.manage";
    expect((await read(managerCookie)).status).toBe(200);
    const saved = await write(managerCookie);
    expect(saved.status).toBe(200);
    expect((await saved.json()).defaultTakeawayVatRate).toBe("4.00");
    expect((await (await read(managerCookie)).json()).defaultTakeawayVatRate).toBe("4.00");
    expect(await storedTakeawayRate()).toBe("4.00");
  });
});
