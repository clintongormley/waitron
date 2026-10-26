import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { tenants } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: Venue;

function appWith(): Hono {
  const app = new Hono();
  const fiscal = venueFiscalSelection(ALL_MODULES, "ES-common").contribution!;
  mountLocationSettingsApi(app, { db: suite.db, cfg: venue.cfg, fiscal }, () => {});
  return app;
}
function read(cookie: string | null = venue.managerCookie) {
  return appWith().request("/management-api/venue-privacy", {
    headers: cookie === null ? {} : { cookie },
  });
}
function save(body: unknown, cookie: string | null = venue.managerCookie) {
  return appWith().request("/management-api/venue-privacy", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie === null ? {} : { cookie }) },
    body: JSON.stringify(body),
  });
}
async function taxpayer() {
  const [row] = await suite.db.select().from(tenants).where(eq(tenants.id, 1));
  return row!;
}
const unset = { privacyNoticeUrl: null, privacyEmail: null };
const stored = {
  privacyNoticeUrl: "https://example.com/privacy",
  privacyEmail: "privacy@example.com",
};

beforeEach(async () => {
  venue = await setupVenue(suite.db);
});

describe("the venue's privacy contact", () => {
  it("answers both fields unset on a fresh venue", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(unset);
  });

  it("saves both fields trimmed, answers them and changes nothing else in the taxpayer row", async () => {
    const before = await taxpayer();
    const response = await save({
      privacyNoticeUrl: "  https://example.com/privacy  ",
      privacyEmail: "  privacy@example.com  ",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(stored);
    expect(await (await read()).json()).toEqual(stored);
    expect(await taxpayer()).toEqual({ ...before, ...stored });
  });

  it("leaves the stored web page when only the email is sent", async () => {
    await save(stored);
    const before = await taxpayer();
    const response = await save({ privacyEmail: "data@example.com" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...stored, privacyEmail: "data@example.com" });
    expect(await taxpayer()).toEqual({ ...before, privacyEmail: "data@example.com" });
  });

  it("clears a field sent empty or blank as NULL, never an empty string", async () => {
    await save(stored);
    const before = await taxpayer();
    const response = await save({ privacyNoticeUrl: "", privacyEmail: "   " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(unset);
    expect(await taxpayer()).toEqual({ ...before, ...unset });
    const { rows } = await suite.db.execute<{ url: string | null; email: string | null }>(
      sql`select privacy_notice_url as url, privacy_email as email from tenants where id = 1`,
    );
    expect(rows).toEqual([{ url: null, email: null }]);
  });

  it("stores the composed spelling of a decomposed email", async () => {
    const before = await taxpayer();
    const response = await save({ privacyEmail: "jose\u0301@example.com" });
    expect(response.status).toBe(200);
    expect(await taxpayer()).toEqual({ ...before, privacyEmail: "jos\u00e9@example.com" });
  });

  it.each([
    ["an array body", ["https://example.com/privacy"], { field: "body", reason: "type" }],
    ["a string body", "x", { field: "body", reason: "type" }],
    ["an empty object", {}, { field: "body", reason: "required" }],
    ["another key", { legalName: "X" }, { field: "body", reason: "unknown_field" }],
    ["a null web page", { privacyNoticeUrl: null }, { field: "privacyNoticeUrl", reason: "type" }],
    ["a number as the email", { privacyEmail: 5 }, { field: "privacyEmail", reason: "type" }],
    [
      "a web page without its scheme",
      { privacyNoticeUrl: "example.com/privacy" },
      { field: "privacyNoticeUrl", reason: "web_address" },
    ],
    [
      "a web page of 501 code points",
      { privacyNoticeUrl: `https://example.com/${"a".repeat(481)}` },
      { field: "privacyNoticeUrl", reason: "length" },
    ],
    [
      "an email without a domain ending",
      { privacyEmail: "privacy@example" },
      { field: "privacyEmail", reason: "email" },
    ],
    [
      "an email of 255 code points",
      { privacyEmail: `${"a".repeat(243)}@example.com` },
      { field: "privacyEmail", reason: "length" },
    ],
    [
      "a valid web page beside an invalid email",
      { privacyNoticeUrl: "https://example.com/privacy", privacyEmail: "privacy" },
      { field: "privacyEmail", reason: "email" },
    ],
    [
      "two invalid fields",
      { privacyNoticeUrl: "nope", privacyEmail: "nope" },
      { field: "privacyNoticeUrl", reason: "web_address" },
    ],
  ])("refuses %s and writes nothing", async (_label, body, params) => {
    const before = await taxpayer();
    const response = await save(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "venue.detail_invalid", params } });
    expect(await taxpayer()).toEqual(before);
  });

  it("requires a session for both routes", async () => {
    const before = await taxpayer();
    for (const response of [await read(null), await save(stored, null)]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: "management_session.required", params: {} },
      });
    }
    expect(await taxpayer()).toEqual(before);
  });

  it("lets staff do neither and a supervisor read but not save", async () => {
    const before = await taxpayer();
    const staffRead = await read(venue.staffCookie);
    expect(staffRead.status).toBe(403);
    expect(await staffRead.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.view" } },
    });
    const staffSave = await save(stored, venue.staffCookie);
    expect(staffSave.status).toBe(403);
    expect(await staffSave.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
    await suite.db.execute(sql`update persons set role = 'supervisor' where role = 'manager'`);
    const supervisorRead = await read();
    expect(supervisorRead.status).toBe(200);
    expect(await supervisorRead.json()).toEqual(unset);
    const supervisorSave = await save(stored);
    expect(supervisorSave.status).toBe(403);
    expect(await supervisorSave.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
    expect(await taxpayer()).toEqual(before);
  });

  it("refuses an invalid save from staff and a supervisor on permission, before the body check", async () => {
    const before = await taxpayer();
    const refusal = {
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    };
    const staff = await save({ privacyEmail: "privacy" }, venue.staffCookie);
    expect(staff.status).toBe(403);
    expect(await staff.json()).toEqual(refusal);
    await suite.db.execute(sql`update persons set role = 'supervisor' where role = 'manager'`);
    const supervisor = await save({ privacyEmail: "privacy" });
    expect(supervisor.status).toBe(403);
    expect(await supervisor.json()).toEqual(refusal);
    expect(await taxpayer()).toEqual(before);
  });

  it("answers both routes with the location refusal when there is no taxpayer row", async () => {
    await suite.db.execute(sql`delete from tenants`);
    for (const response of [await read(), await save(stored)]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "locationId" } },
      });
    }
  });
});
