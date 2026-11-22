import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { withTransaction } from "@waitron/db";
import { seedDevice, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin, startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { PERSON_HEADER } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { Hono } from "hono";
import { expect, it, onTestFinished, vi } from "vitest";
import { requireManagementChangeFromOwnPage } from "./own-page.js";
import { mountProblemReportApi } from "./problem-report-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { retainHttpListener } from "./testing/retained-http-listener.js";
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
        descriptions: async () => [],
        decideDescription: async () => {},
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

  const preview = () =>
    app.request("/api/problem-reports/preview", {
      headers: { cookie: `${token}; ${device}`, [PERSON_HEADER]: staff!.id },
    });
  const attachment = { available: true, id, attachment: '{"version":"1.2.3"}' };
  expect(await (await preview()).json()).toEqual(attachment);
  const listener = await retainHttpListener(
    "127.0.0.1",
    createServer(getRequestListener(app.fetch)),
  );
  onTestFinished(() => listener.close());
  const url = `http://${listener.host}:${listener.port}/api/problem-reports/${id}/send`;
  const headers = { cookie: `${token}; ${device}`, [PERSON_HEADER]: staff!.id };
  const answer = await fetch(url, { method: "POST", headers });
  expect(await answer.json()).toEqual({ delivery: "sent" });
  expect(send).toHaveBeenCalledExactlyOnceWith("till", session.id, id);

  const sendText = () =>
    fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ description: "Drawer jammed", admin: true }),
    });
  expect(await (await sendText()).json()).toEqual({ delivery: "sent", description: "waiting" });
  expect(send).toHaveBeenLastCalledWith("till", session.id, id, {
    text: "Drawer jammed",
    admin: false,
  });

  await setBuiltInRoleForTest(db, staff!.id, "admin");
  expect(await (await preview()).json()).toEqual({ ...attachment, admin: true });
  expect(await (await sendText()).json()).toEqual({ delivery: "sent", description: "queued" });
  expect(send).toHaveBeenLastCalledWith("till", session.id, id, {
    text: "Drawer jammed",
    admin: true,
  });
});

it("restricts review and decisions to an administrator on the box's own page", async () => {
  const db = suite.db;
  const headers = async (role: "admin" | "manager") => {
    const [person] = await seedPersons(db, { displayName: role, role });
    const { token } = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: person!.id, method: "password" }),
    );
    return { cookie: `${MANAGEMENT_COOKIE}=${token}` };
  };
  const admin = await headers("admin");
  const manager = await headers("manager");
  const reportId = randomUUID();
  const drafts = [{ reportId, description: "Drawer failed to open", time: 1767225600000 }];
  const decideDescription = vi.fn(async () => {});
  const app = new Hono();
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
        preview: async () => ({ available: false }),
        send: async () => "sent",
        descriptions: async () => drafts,
        decideDescription,
      },
    },
    log,
  );
  const url = "/management-api/problem-reports/descriptions";
  const read = (headers: HeadersInit) => app.request(url, { headers });
  const approve = (headers: HeadersInit) =>
    app.request(`${url}/${reportId}/send`, { method: "POST", headers });
  expect((await read(manager)).status).toBe(403);
  expect((await approve(manager)).status).toBe(403);
  const foreign = { ...admin, origin: "https://untrusted.test" };
  expect((await read(foreign)).status).toBe(403);
  expect((await approve(foreign)).status).toBe(403);
  expect(await (await read(admin)).json()).toEqual(drafts);
  expect((await approve(admin)).status).toBe(204);
  expect(decideDescription).toHaveBeenCalledExactlyOnceWith(reportId, "send");
});
