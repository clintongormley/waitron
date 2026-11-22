import { randomUUID } from "node:crypto";
import { withTransaction } from "@waitron/db";
import { seedDevice, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { PERSON_HEADER } from "@waitron/shared";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { requireManagementChangeFromOwnPage } from "./own-page.js";
import { mountProblemReportApi } from "./problem-report-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { deviceCookieForTest } from "./testing/enrol.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("requires the till session's person and device proof before sending a report", async () => {
  const db = suite.db;
  await seedVenueSettings(db);
  const [staff] = await seedPersons(db, {
    displayName: "Cashier",
    pinHash: hashPin("1234"),
    role: "staff",
  });
  const { deviceId } = await seedDevice(db);
  const device = await deviceCookieForTest(db, deviceId);
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { deviceId, personId: staff!.id, pin: "1234" }),
  );
  const token = `${SESSION_COOKIE}=${session.token}`;
  const id = randomUUID();
  const app = new Hono();
  const send = vi.fn(async () => "sent" as const);
  const log = () => {};
  app.use(
    "*",
    requireManagementChangeFromOwnPage(async () => false, log),
  );
  mountProblemReportApi(
    app,
    {
      db,
      reports: {
        preview: async () => ({ available: true, id, attachment: '{"version":"1.2.3"}' }),
        send,
      },
    },
    log,
  );
  const sendFrom = (person: string, cookie: string, origin?: string) =>
    app.request(`/api/problem-reports/${id}/send`, {
      method: "POST",
      headers: { cookie, [PERSON_HEADER]: person, ...(origin ? { origin } : {}) },
    });

  const foreign = await sendFrom(staff!.id, `${token}; ${device}`, "https://untrusted.test");
  expect(foreign.status).toBe(403);
  expect(await foreign.json()).toMatchObject({ error: { code: "till.origin_refused" } });
  const wrongPerson = await sendFrom(randomUUID(), `${token}; ${device}`);
  expect(wrongPerson.status).toBe(409);
  expect(await wrongPerson.json()).toMatchObject({
    error: { code: "session.person_not_signed_in" },
  });
  const missingDevice = await sendFrom(staff!.id, token);
  expect(missingDevice.status).toBe(401);
  expect(await missingDevice.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  expect(send).not.toHaveBeenCalled();

  const preview = await app.request("/api/problem-reports/preview", {
    headers: { cookie: `${token}; ${device}`, [PERSON_HEADER]: staff!.id },
  });
  expect(await preview.json()).toEqual({ available: true, id, attachment: '{"version":"1.2.3"}' });
  const answer = await sendFrom(staff!.id, `${token}; ${device}`);
  expect(await answer.json()).toEqual({ delivery: "sent" });
  expect(send).toHaveBeenCalledExactlyOnceWith("till", session.id, id);
});
