import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { devices } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, persons, sessions } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { attendanceOperationFacts } from "@waitron/workforce";
import { mountTillApi, type TillApiDeps } from "./till-api.js";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { setupPartyVenue, seat, OPERATOR, type PartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, cookie: string, deviceId: string;
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  await suite.db
    .insert(persons)
    .values({ id: OPERATOR, displayName: "Worker", pinHash: hashPin("1234"), role: "admin" });
  const [device] = await suite.db
    .select()
    .from(devices)
    .where(eq(devices.id, v.cfg.origin.deviceId));
  const enrolled = await enrolDeviceForTest(suite.db, v.cfg, {
    name: "Attendance till",
    profileId: device!.deviceProfileId,
  });
  deviceId = enrolled.deviceId;
  cookie = `${DEVICE_COOKIE}=${deviceId}.${enrolled.token}`;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00.987Z"));
});
afterEach(() => vi.useRealTimers());
function app(recorder: AttendanceRecorder | undefined = recordAttendanceFact) {
  const app = new Hono();
  const deps: TillApiDeps = {
    db: suite.db,
    backend: v.backend,
    clock: v.clock,
    cfg: v.cfg,
    secureCookies: false,
    venueLocale: "es",
    workforceEnabled: true,
    attendance: recorder,
  };
  mountTillApi(app, deps, () => {});
  return app;
}
function login(app: Hono, pin = "1234") {
  return app.request("/api/session", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ personId: OPERATOR, pin }),
  });
}
describe("till attendance recorder admission", () => {
  it("captures only the admitted successful PIN session at its stored opening time", async () => {
    const api = app();
    const denied = await login(api, "0000");
    expect(denied.status).toBe(401);
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([]);
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const [session] = await suite.db.select().from(sessions).where(eq(sessions.deviceId, deviceId));
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([
      {
        sequence: 1,
        source: "session",
        key: session!.id,
        personId: OPERATOR,
        locationId: v.cfg.locationId,
        kind: "sign-in",
        at: "2026-10-14T12:00:00.000Z",
        offsetMinutes: 120,
        businessDay: "2026-10-14",
        outcome: "qualifying",
      },
    ]);
  });
  it("an evidence refusal rolls back sign-in and returns no session cookie", async () => {
    const api = app(async () => {
      throw new AppError("attendance.invalid", { reason: "capture refused" });
    });
    const opened = await login(api);
    expect(opened.status).toBe(400);
    expect(await opened.json()).toMatchObject({ error: { code: "attendance.invalid" } });
    expect(opened.headers.get("set-cookie")).toBeNull();
    expect(await suite.db.select().from(sessions).where(eq(sessions.deviceId, deviceId))).toEqual(
      [],
    );
  });
  it("passes the recorder to the actual draft save route after its admission checks", async () => {
    const { partyId } = await seat(v, await v.table("Draft attendance"));
    const api = app();
    const opened = await login(api);
    expect(opened.status).toBe(200);
    const sessionCookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"));
    const saved = await api.request(`/api/parties/${partyId}/drafts`, {
      method: "PUT",
      headers: { cookie: `${cookie}; ${sessionCookie}`, "content-type": "application/json" },
      body: JSON.stringify({
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: v.item("Burger"),
            variantId: null,
            menuVersionId: null,
            options: [],
            extras: [],
            note: null,
            quantity: "1",
            courseId: null,
            noMerge: false,
          },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    const draft = (await saved.json()) as { id: string; revision: number };
    expect(
      (await suite.db.select().from(attendanceOperationFacts)).map((r) => [
        r.source,
        r.key,
        r.personId,
        r.at,
      ]),
    ).toEqual([
      ["session", expect.any(String), OPERATOR, "2026-10-14T12:00:00.000Z"],
      ["draft", `${draft.id}:${draft.revision}:save`, OPERATOR, "2026-10-14T13:00:00.000Z"],
    ]);
  });
});
