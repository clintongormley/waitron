import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { once } from "node:events";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import {
  IDENTITY_MIGRATIONS,
  persons,
  managementSessions,
  startManagementSession,
} from "@waitron/identity";
import { locationId } from "@waitron/shared";
import * as requestKit from "@waitron/server-kit";
import { mountVenueZoneRepairApi } from "./venue-zone-repair-api.js";
import { TradingAdmission } from "./trading-admission.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
  ],
});
const PATH = "/management-api/venue-details/time-zone-repair";
const ORIGIN = "https://manage.example.test";
const RAW = "Invalid/Zone?secret=must-not-escape";
const AT = new Date("2026-10-14T23:30:00.000Z");
const body = { timeZone: "Europe/Madrid", expectedClockRevision: 0, confirmed: true };
let scope: { nodeId: string; locationId: string };
let token: string;
let actor: string;
let app: Hono;
let admission: TradingAdmission;
let restart = vi.fn<() => void>();
let outgoing: ServerResponse;
let logs: unknown[];
beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Counter",
      province: "Madrid",
      timeZone: RAW,
      dayCutover: "06:00:00",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant service",
    })
    .returning();
  scope = { locationId: location!.id, nodeId: await seedNode(suite.db, locationId(location!.id)) };
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Manager", role: "manager" })
    .returning();
  actor = person!.id;
  token = (await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId: actor })))
    .token;
  admission = new TradingAdmission();
  admission.repairOnly("invalid");
  restart = vi.fn();
  logs = [];
  outgoing = new ServerResponse(new IncomingMessage(new Socket()));
  app = new Hono();
  mountVenueZoneRepairApi(
    app,
    {
      db: suite.db,
      scope,
      admission,
      managementOrigin: ORIGIN,
      requestRestart: restart,
      now: () => AT,
    },
    (...fields) => logs.push(fields),
  );
});
afterEach(() => vi.restoreAllMocks());
function request(method = "POST", input: unknown = body, headers: Record<string, string> = {}) {
  return app.request(
    PATH,
    {
      method,
      headers: {
        cookie: `waitron_management_session=${token}`,
        origin: ORIGIN,
        "content-type": "application/json",
        ...headers,
      },
      ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
    },
    { outgoing },
  );
}
const rows = () => ({
  locations: suite.db.all(sql`select * from locations`),
  settings: suite.db.all(sql`select * from location_business_day_settings`),
  incidents: suite.db.all(sql`select * from incidents`),
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function refusal(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

describe("time-zone repair management boundary", () => {
  it.each(["manager", "admin"] as const)(
    "allows %s reads and confirmed writes, staying closed until restart",
    async (role) => {
      await suite.db.update(persons).set({ role }).where(eq(persons.id, actor));
      const read = await request("GET");
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({
        ...scope,
        category: "invalid",
        eligible: true,
        admission: { state: "invalid" },
        clockRevision: 0,
      });
      expect(restart).not.toHaveBeenCalled();
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        repaired: true,
        clockRevision: 1,
        admission: "restart_required",
      });
      expect(admission.snapshot()).toEqual({ state: "restart_required" });
      expect(() => admission.require()).toThrow(
        expect.objectContaining({
          code: "venue.time_zone_not_ready",
          params: { reason: "restart_required" },
        }),
      );
      expect(rows().incidents).toHaveLength(1);
      expect(restart).not.toHaveBeenCalled();
      outgoing.emit("finish");
      outgoing.emit("close");
      expect(restart).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["staff", "supervisor"] as const)(
    "refuses live %s permission on both routes",
    async (role) => {
      await suite.db.update(persons).set({ role }).where(eq(persons.id, actor));
      const before = rows();
      for (const method of ["GET", "POST"])
        await refusal(await request(method), 403, "authorization.not_permitted");
      expect(rows()).toEqual(before);
      expect(restart).not.toHaveBeenCalled();
    },
  );
  it.each(["GET", "POST"])("requires a real management cookie for %s", async (method) => {
    const before = rows();
    await refusal(await request(method, body, { cookie: "" }), 401, "management_session.required");
    expect(rows()).toEqual(before);
  });
  it.each(["", "https://other.example.test", `${ORIGIN}/`, "null"])(
    "requires the exact Origin %j on both routes",
    async (origin) => {
      const before = rows();
      for (const method of ["GET", "POST"])
        await refusal(await request(method, body, { origin }), 403, "authorization.not_permitted");
      expect(rows()).toEqual(before);
    },
  );
  it.each(["text/plain", "application/x-www-form-urlencoded", ""])(
    "requires JSON instead of %j",
    async (contentType) => {
      const before = rows();
      await refusal(
        await request("POST", body, { "content-type": contentType }),
        400,
        "management.request_invalid",
      );
      expect(rows()).toEqual(before);
      expect(restart).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    [],
    "text",
    {},
    { ...body, confirmed: false },
    { ...body, confirmed: "true" },
    { ...body, expectedClockRevision: -1 },
    { ...body, expectedClockRevision: 0.5 },
    { ...body, expectedClockRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...body, expectedClockRevision: "0" },
    { ...body, expectedClockRevision: null },
    { ...body, timeZone: null },
    ...["nodeId", "locationId", "payment", "date", "force", "dayCutover"].map((key) => ({
      ...body,
      [key]: "forged",
    })),
  ])("refuses malformed/forged request %# without writes", async (input) => {
    const before = rows();
    await refusal(await request("POST", input), 400, "management.request_invalid");
    expect(rows()).toEqual(before);
    expect(restart).not.toHaveBeenCalled();
  });
  it("refuses malformed JSON without logging the request", async () => {
    const before = rows();
    const response = await app.request(
      PATH,
      {
        method: "POST",
        headers: {
          cookie: `waitron_management_session=${token}`,
          origin: ORIGIN,
          "content-type": "application/json",
        },
        body: '{"secret": "private-body"',
      },
      { outgoing },
    );
    await refusal(response, 400, "management.request_invalid");
    expect(rows()).toEqual(before);
    expect(JSON.stringify(logs)).not.toContain("private-body");
    expect(JSON.stringify(logs)).not.toContain(token);
  });
  it.each([
    ["revoke", 401, "management_session.required"],
    ["suspend", 403, "person.suspended"],
    ["expire", 401, "management_session.expired"],
    ["demote", 403, "authorization.not_permitted"],
  ] as const)(
    "rereads live authorization after parsing when session changes: %s",
    async (change, status, code) => {
      const parsed = gate();
      const resume = gate();
      const realRead = requestKit.readJsonBody;
      vi.spyOn(requestKit, "readJsonBody").mockImplementation(async (c) => {
        const value = await realRead(c);
        parsed.resolve();
        await resume.promise;
        return value;
      });
      const pending = request();
      try {
        await parsed.promise;
        if (change === "revoke")
          await suite.db.update(managementSessions).set({ endedAt: AT.toISOString() });
        if (change === "expire")
          await suite.db.update(managementSessions).set({ lastSeenAt: "2000-01-01T00:00:00.000Z" });
        if (change === "suspend")
          await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, actor));
        if (change === "demote")
          await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, actor));
        const before = rows();
        resume.resolve();
        await refusal(await pending, status, code);
        expect(rows()).toEqual(before);
        expect(restart).not.toHaveBeenCalled();
        expect(admission.snapshot()).toEqual({ state: "invalid" });
      } finally {
        resume.resolve();
        await pending;
      }
    },
  );
  it("does not restart after commit failure", async () => {
    await suite.db.execute(
      sql`create trigger refuse_zone_api_audit before insert on incidents begin select raise(abort, 'private-audit-failure'); end`,
    );
    try {
      const before = rows();
      await refusal(await request(), 500, "server.internal");
      expect(rows()).toEqual(before);
      outgoing.emit("finish");
      outgoing.emit("close");
      expect(restart).not.toHaveBeenCalled();
      expect(admission.snapshot()).toEqual({ state: "invalid" });
      expect(JSON.stringify(logs)).not.toContain("private-audit-failure");
    } finally {
      await suite.db.execute(sql`drop trigger refuse_zone_api_audit`);
    }
  });
  it("restarts after a committed disconnect without a second write", async () => {
    expect((await request()).status).toBe(200);
    const after = rows();
    outgoing.emit("close");
    outgoing.emit("finish");
    expect(restart).toHaveBeenCalledTimes(1);
    await refusal(await request(), 409, "venue.time_zone_repair_not_needed");
    expect(rows()).toEqual(after);
    expect(restart).toHaveBeenCalledTimes(1);
  });
  it("requires the adapter response before it commits", async () => {
    const before = rows();
    const response = await app.request(
      PATH,
      {
        method: "POST",
        headers: {
          cookie: `waitron_management_session=${token}`,
          origin: ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      {},
    );
    await refusal(response, 500, "server.internal");
    expect(rows()).toEqual(before);
    expect(admission.snapshot()).toEqual({ state: "invalid" });
  });
  it("requires an Origin header rather than just a matching URL", async () => {
    const before = rows();
    for (const method of ["GET", "POST"]) {
      const response = await app.request(
        PATH,
        {
          method,
          headers: {
            cookie: `waitron_management_session=${token}`,
            "content-type": "application/json",
          },
          ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        },
        { outgoing },
      );
      await refusal(response, 403, "authorization.not_permitted");
    }
    expect(rows()).toEqual(before);
  });
  it("accepts JSON with a charset and refuses forged query fields", async () => {
    const before = rows();
    const response = await app.request(
      `${PATH}?nodeId=forged`,
      { headers: { origin: ORIGIN, cookie: `waitron_management_session=${token}` } },
      { outgoing },
    );
    await refusal(response, 400, "management.request_invalid");
    expect(rows()).toEqual(before);
    expect(
      (await request("POST", body, { "content-type": "application/json; charset=utf-8" })).status,
    ).toBe(200);
  });
  it("uses the installed Hono Node outgoing response to restart after the committed JSON finishes", async () => {
    const events: string[] = [];
    const realApp = new Hono();
    const onRestart = vi.fn(() => {
      expect(rows().incidents).toHaveLength(1);
      expect(admission.snapshot()).toEqual({ state: "restart_required" });
      events.push("restart");
    });
    realApp.use("*", async (c, next) => {
      (c.env as HttpBindings).outgoing.on("finish", () => events.push("finish"));
      await next();
    });
    mountVenueZoneRepairApi(
      realApp,
      {
        db: suite.db,
        scope,
        admission,
        managementOrigin: ORIGIN,
        requestRestart: onRestart,
        now: () => AT,
      },
      (...fields) => logs.push(fields),
    );
    const server = serve({ fetch: realApp.fetch, hostname: "127.0.0.1", port: 0 });
    try {
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Missing HTTP address");
      const response = await fetch(`http://127.0.0.1:${address.port}${PATH}`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie: `waitron_management_session=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        repaired: true,
        clockRevision: 1,
        admission: "restart_required",
      });
      expect(events).toEqual(["finish", "restart"]);
      expect(onRestart).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logs)).not.toContain(RAW);
    } finally {
      if ("closeAllConnections" in server) server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("rejects a stale revision and country-excluded preview without leaking the old zone", async () => {
    const before = rows();
    await refusal(
      await request("POST", { ...body, expectedClockRevision: 9 }),
      409,
      "venue.business_day_changed",
    );
    const response = await app.request(
      `${PATH}?timeZone=Europe%2FLondon`,
      { headers: { origin: ORIGIN, cookie: `waitron_management_session=${token}` } },
      { outgoing },
    );
    await refusal(response, 400, "venue.time_zone_invalid");
    expect(rows()).toEqual(before);
    expect(JSON.stringify(logs)).not.toContain(RAW);
    expect(JSON.stringify(logs)).not.toContain(token);
  });
});
