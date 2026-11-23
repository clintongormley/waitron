import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  dashboardSessions,
  outgoingMail,
  readActivityForSubject,
  readSettings,
  readVenue,
  VENUE_SETTINGS,
  withTransaction,
} from "@waitron/db";
import { hashSessionToken } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { timeZoneOffsetMinutes } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { mountVenueSettingsApi } from "./venue-settings-api.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { readVenueDetails } from "./venue-details.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const IBAN = "ES9121000418450200051332";
let venue: Venue;

function save(body: unknown, cookie: string | null = venue.managerCookie) {
  const app = new Hono();
  mountVenueSettingsApi(
    app,
    {
      db: suite.db,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
  return app.request("/management-api/venue-details/bank-account", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie === null ? {} : { cookie }) },
    body: JSON.stringify(body),
  });
}
const alerts = () =>
  suite.db
    .select({ dedupeKey: outgoingMail.dedupeKey, code: outgoingMail.params })
    .from(outgoingMail)
    .where(eq(outgoingMail.kind, "box_alert"));
const stored = async () => (await readSettings(suite.db, VENUE_SETTINGS)).doc.bankAccount;
const valid = {
  iban: "ES91 2100 0418 4502 0005 1332",
  bankName: "Openbank",
  expected: { iban: "", bankName: "" },
};
const managerId = () =>
  suite.db.all<{ id: string }>(sql`select id from persons where display_name = 'The Manager'`)[0]!
    .id;

beforeEach(async () => {
  venue = await setupVenue(suite.db);
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, venue.managerCookie));
});

describe("saving the venue's bank account", () => {
  it("saves the account, answers the re-read model and records who changed it", async () => {
    const response = await save(valid);
    expect(response.status).toBe(200);
    const model = await withTransaction(suite.db, (tx) => readVenueDetails(tx));
    expect(model.bankAccount).toEqual({ iban: IBAN, bankName: "Openbank" });
    expect(await response.json()).toEqual({ model });
    const entries = (
      await readActivityForSubject(suite.db, { kind: "settings", id: "venue" })
    ).filter((entry) => entry.kind === "venue.bank_account_changed");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ personId: managerId(), data: {} });
    const [mail] = await suite.db
      .select({ params: outgoingMail.params })
      .from(outgoingMail)
      .where(eq(outgoingMail.kind, "box_alert"));
    const wording = JSON.parse((mail!.params as { wording: string }).wording) as {
      changedAt: string;
      changedAtOffset: number;
    };
    const { timeZone } = await withTransaction(suite.db, (tx) => readVenue(tx));
    const offset = timeZoneOffsetMinutes(timeZone, new Date(wording.changedAt));
    expect(offset).not.toBe(0);
    expect(wording.changedAtOffset).toBe(offset);
  });

  it("requires a sign-in proved less than 15 minutes ago", async () => {
    await suite.db
      .update(dashboardSessions)
      .set({ provedAt: new Date(Date.now() - 15 * 60_000).toISOString(), proofMethod: "password" })
      .where(eq(dashboardSessions.tokenHash, hashSessionToken(venue.managerCookie.split("=")[1]!)));
    const response = await save(valid);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management_session.proof_required", params: {} },
    });
    expect(await stored()).toBeNull();
  });

  it("requires a session and the venue configuration permission", async () => {
    const absent = await save(valid, null);
    expect(absent.status).toBe(401);
    const staff = await save(valid, venue.staffCookie);
    expect(staff.status).toBe(403);
    expect(await staff.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
    await setBuiltInRoleForTest(suite.db, managerId(), "supervisor");
    const supervisor = await save(valid);
    expect(supervisor.status).toBe(403);
    expect(await stored()).toBeNull();
  });

  it("refuses a stale view as changed", async () => {
    expect((await save(valid)).status).toBe(200);
    const response = await save({ ...valid, iban: "GB82WEST12345698765432" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_changed", params: { field: "iban" } },
    });
    expect(await stored()).toEqual({ iban: IBAN, bankName: "Openbank" });
  });

  it("refuses a bad checksum under the IBAN field", async () => {
    const response = await save({ ...valid, iban: "ES9121000418450200051333" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field: "iban", reason: "checksum" } },
    });
  });

  it.each([
    ["a non-object body", ["x"], "body", "type"],
    ["an unknown key", { ...valid, colour: "red" }, "body", "unknown_field"],
    ["a non-string IBAN", { ...valid, iban: 7 }, "iban", "type"],
    ["a non-string bank name", { ...valid, bankName: null }, "bankName", "type"],
    ["a missing expected value", { iban: IBAN, bankName: "" }, "expected", "type"],
    [
      "an expected value with another key",
      { ...valid, expected: { iban: "", bankName: "", x: "" } },
      "expected",
      "unknown_field",
    ],
    [
      "an expected IBAN that is not a string",
      { ...valid, expected: { iban: null, bankName: "" } },
      "expected",
      "type",
    ],
  ])("refuses %s", async (_label, body, field, reason) => {
    const response = await save(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field, reason } },
    });
    expect(await stored()).toBeNull();
  });

  it("refuses a body carrying a read-only venue field by name", async () => {
    const response = await save({ ...valid, taxId: "B12345678" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_read_only", params: { field: "taxId" } },
    });
  });

  it("emails the administrators after a save, and not after a refused one", async () => {
    expect((await save(valid)).status).toBe(200);
    const [entry] = (
      await readActivityForSubject(suite.db, { kind: "settings", id: "venue" })
    ).filter((activity) => activity.kind === "venue.bank_account_changed");
    const queued = await alerts();
    expect(queued.length).toBeGreaterThan(0);
    for (const row of queued) {
      expect(row.dedupeKey.startsWith(`bank-account:${entry!.id}:`)).toBe(true);
      expect(row.code).toMatchObject({ code: "venue.bank_account_changed" });
    }
    expect((await save({ ...valid, iban: "GB82WEST12345698765432" })).status).toBe(409);
    expect((await save({ ...valid, expected: { iban: IBAN, bankName: "Openbank" } })).status).toBe(
      400,
    );
    expect(await alerts()).toEqual(queued);
  });
});
