import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { tenants, withTransaction } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { readVenueDetails } from "./venue-details.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const realFiscal = () => venueFiscalSelection(ALL_MODULES, "ES-common").contribution!;
let venue: Venue;
let original: string;

function appWith(fiscal: FiscalContribution = realFiscal()): Hono {
  const app = new Hono();
  mountLocationSettingsApi(app, { db: suite.db, cfg: venue.cfg, fiscal }, () => {});
  return app;
}
function rename(body: unknown, cookie: string | null = venue.managerCookie, app = appWith()) {
  return app.request("/management-api/venue-details/legal-name", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie === null ? {} : { cookie }) },
    body: JSON.stringify(body),
  });
}
async function taxpayer() {
  const [row] = await suite.db.select().from(tenants).where(eq(tenants.id, 1));
  return row!;
}
const model = () => withTransaction(suite.db, (tx) => readVenueDetails(tx, venue.cfg));

beforeEach(async () => {
  venue = await setupVenue(suite.db);
  await suite.db.execute(
    sql`update tenants set taxpayer_domicile = 'Calle Mayor 1, 28013 Madrid' where id = 1`,
  );
  original = (await taxpayer()).legalName;
});

describe("changing the taxpayer's legal name", () => {
  it("saves the trimmed name, answers the re-read model and the next read shows it", async () => {
    const before = await taxpayer();
    const response = await rename({ legalName: "  Deli Nueva SL  ", expected: original });
    expect(response.status).toBe(200);
    const read = await model();
    expect(read.issuer.legalName).toBe("Deli Nueva SL");
    expect(await response.json()).toEqual({ model: read });
    const get = await appWith().request("/management-api/venue-details", {
      headers: { cookie: venue.managerCookie },
    });
    expect((await get.json()).issuer.legalName).toBe("Deli Nueva SL");
    expect(await taxpayer()).toEqual({ ...before, legalName: "Deli Nueva SL" });
  });

  it("refuses a stale expected name and writes nothing", async () => {
    const response = await rename({ legalName: "Deli Nueva SL", expected: "Someone Else SL" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_changed", params: { field: "legalName" } },
    });
    expect((await taxpayer()).legalName).toBe(original);
  });

  it("calls a name typed over a stale view changed, not unchanged", async () => {
    const response = await rename({ legalName: original, expected: "Someone Else SL" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_changed", params: { field: "legalName" } },
    });
  });

  it.each([
    ["empty", () => "", "required"],
    ["whitespace-only", () => "   ", "required"],
    ["unchanged", () => ` ${original} `, "unchanged"],
    ["121 characters", () => "a".repeat(121), "fiscal_format"],
    ["a control character", () => "Deli\u0001 SL", "fiscal_format"],
  ])("refuses a name that is %s and writes nothing", async (_label, name, reason) => {
    const response = await rename({ legalName: name(), expected: original });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field: "legalName", reason } },
    });
    expect((await taxpayer()).legalName).toBe(original);
  });

  it.each([
    ["a non-object body", ["Deli Nueva SL"], "body", "type"],
    ["an unknown key", { legalName: "X SL", expected: "", taxId: "B1" }, "body", "unknown_field"],
    ["a non-string name", { legalName: 7, expected: "" }, "legalName", "type"],
    ["a missing expected name", { legalName: "X SL" }, "expected", "type"],
  ])("refuses %s", async (_label, body, field, reason) => {
    const response = await rename(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field, reason } },
    });
    expect((await taxpayer()).legalName).toBe(original);
  });

  it("requires a session and the venue configuration permission", async () => {
    const body = { legalName: "Deli Nueva SL", expected: original };
    const absent = await rename(body, null);
    expect(absent.status).toBe(401);
    expect(await absent.json()).toEqual({
      error: { code: "management_session.required", params: {} },
    });
    const staff = await rename(body, venue.staffCookie);
    expect(staff.status).toBe(403);
    expect(await staff.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
    await suite.db.execute(sql`update persons set role = 'supervisor' where role = 'manager'`);
    const supervisor = await rename(body);
    expect(supervisor.status).toBe(403);
    expect(await supervisor.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
    expect((await taxpayer()).legalName).toBe(original);
  });

  it("accepts a long name when the fiscal regime declares no venue-field rules", async () => {
    const response = await rename(
      { legalName: "a".repeat(121), expected: original },
      venue.managerCookie,
      appWith({ ...realFiscal(), venueFields: undefined }),
    );
    expect(response.status).toBe(200);
    expect((await taxpayer()).legalName).toBe("a".repeat(121));
  });

  it("stores the composed spelling and calls a decomposed spelling of the same name unchanged", async () => {
    const composed = "Caf\u00e9 SL";
    const decomposed = "Cafe\u0301 SL";
    expect((await rename({ legalName: decomposed, expected: original })).status).toBe(200);
    expect((await taxpayer()).legalName).toBe(composed);
    const response = await rename({ legalName: decomposed, expected: composed });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field: "legalName", reason: "unchanged" } },
    });
  });

  it("passes on a setup refusal about another field instead of blaming the name", async () => {
    const real = realFiscal();
    const response = await rename(
      { legalName: "Deli Nueva SL", expected: original },
      venue.managerCookie,
      appWith({
        ...real,
        venueFields: {
          ...real.venueFields!,
          validateLegalName: () => {
            throw new AppError("setup.request_invalid", { field: "taxId" });
          },
        },
      }),
    );
    expect(response.status).not.toBe(200);
    expect((await response.json()).error).toEqual({
      code: "setup.request_invalid",
      params: { field: "taxId" },
    });
    expect((await taxpayer()).legalName).toBe(original);
  });

  it("passes on a validator refusal that is not a field refusal instead of blaming the name", async () => {
    const real = realFiscal();
    const response = await rename(
      { legalName: "Deli Nueva SL", expected: original },
      venue.managerCookie,
      appWith({
        ...real,
        venueFields: {
          ...real.venueFields!,
          validateLegalName: () => {
            throw new AppError("authorization.not_permitted", { permission: "venue.configure" });
          },
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
    expect((await taxpayer()).legalName).toBe(original);
  });
});
