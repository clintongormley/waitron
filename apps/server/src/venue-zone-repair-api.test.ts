import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { createStaffApp } from "./cloud-remote.js";
import { chromium, type BrowserServer, type Browser } from "playwright";
import { freePorts } from "./testing/free-ports.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { once } from "node:events";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, settings, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { persons, managementSessions, startManagementSession } from "@waitron/identity";
import * as requestKit from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { mountVenueZoneRepairApi } from "./venue-zone-repair-api.js";
import { TradingAdmission } from "./trading-admission.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const PATH = "/management-api/venue-details/time-zone-repair";
const ORIGIN = "https://manage.example.test";
const RAW = "Invalid/Zone?secret=must-not-escape";
const AT = new Date("2026-10-14T23:30:00.000Z");
const body = { timeZone: "Europe/Madrid", expectedClockRevision: 1, confirmed: true };
let scope: { nodeId: string };
let token: string;
let actor: string;
let app: Hono;
let admission: TradingAdmission;
let restart = vi.fn<() => void>();
let outgoing: ServerResponse;
let logs: unknown[];
beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Counter",
    province: "Madrid",
    timeZone: RAW,
    dayCutover: "06:00:00",
    invoiceLocales: ["en-GB"],
    operationDescription: "Restaurant service",
  });
  scope = { nodeId: await seedNode(suite.db) };
  const [person] = await seedPersons(suite.db, { displayName: "Manager", role: "manager" });
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
  venueState: suite.db.all(
    sql`select json_extract(v.doc, '$.fiscalTerritory') as fiscal_territory, json_extract(v.doc, '$.operationDescription') as operation_description, json_extract(b.doc, '$.timeZone') as time_zone, c.day_cutover from (select doc from settings where module = 'venue') v join settings b on b.module = 'business_day' join day_cutover_changes c on c.effective_business_day = '2000-01-01'`,
  ),
  settings: suite.db.all(sql`select * from settings where module = 'business_day'`),
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
      await setBuiltInRoleForTest(suite.db, actor, role);
      const read = await request("GET");
      expect(read.status).toBe(200);
      const view = await read.json();
      expect(view).toMatchObject({
        nodeId: scope.nodeId,
        category: "invalid",
        eligible: true,
        admission: { state: "invalid" },
        clockRevision: 1,
      });
      expect(restart).not.toHaveBeenCalled();
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        repaired: true,
        clockRevision: 2,
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
  it("logs a restart that throws once the confirmed repair is answered", async () => {
    restart.mockImplementation(() => {
      throw new AppError(
        "venue.time_zone_not_ready",
        { reason: "restart_required" },
        { reason: "probe" },
      );
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(() => outgoing.emit("finish")).not.toThrow();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(logs).toContainEqual([
      "error",
      "server.restart_failed",
      { errorCode: "venue.time_zone_not_ready", errno: null, reason: "probe" },
    ]);
  });
  it.each(["staff", "supervisor"] as const)(
    "refuses live %s permission on both routes",
    async (role) => {
      await setBuiltInRoleForTest(suite.db, actor, role);
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
    ...["nodeId", "extra", "payment", "date", "force", "dayCutover"].map((key) => ({
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
        if (change === "demote") await setBuiltInRoleForTest(suite.db, actor, "staff");
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
        clockRevision: 2,
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
      await request("POST", { ...body, expectedClockRevision: 10 }),
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
  it.each(["GET", "POST"])(
    "answers %s with 409 venue.not_found, as the settings routes do, with no venue row",
    async (method) => {
      const [venueRow] = await suite.db.select().from(settings).where(eq(settings.module, "venue"));
      await suite.db.execute(sql`pragma foreign_keys = off`);
      try {
        await suite.db.execute(sql`delete from settings where module = 'venue'`);
        const response = await request(method);
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: { code: "venue.not_found", params: {} } });
      } finally {
        await suite.db.insert(settings).values(venueRow!);
        await suite.db.execute(sql`pragma foreign_keys = on`);
      }
      expect(restart).not.toHaveBeenCalled();
    },
  );
  it("answers 409 venue.not_found with no taxpayer row", async () => {
    const [taxpayer] = await suite.db.select().from(tenants);
    await suite.db.execute(sql`pragma foreign_keys = off`);
    try {
      await suite.db.execute(sql`delete from tenants`);
      const response = await request("GET");
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "venue.not_found", params: {} } });
    } finally {
      await suite.db.insert(tenants).values(taxpayer!);
      await suite.db.execute(sql`pragma foreign_keys = on`);
    }
  });
});

it("serves a native same-origin browser GET with the dashboard no-referrer policy, then confirms by POST", async () => {
  const seen: { method: string; origin?: string; site?: string }[] = [];
  const realApp = new Hono();
  realApp.use("*", async (c, next) => {
    if (c.req.path === PATH)
      seen.push({
        method: c.req.method,
        origin: c.req.header("origin"),
        site: c.req.header("sec-fetch-site"),
      });
    await next();
  });
  realApp.get("/manage", (c) =>
    c.html('<!doctype html><meta name="referrer" content="no-referrer"><title>Manager</title>'),
  );
  const [port] = await freePorts(1);
  const origin = `http://127.0.0.1:${port}`;
  mountVenueZoneRepairApi(
    realApp,
    {
      db: suite.db,
      scope,
      admission,
      managementOrigin: origin,
      requestRestart: restart,
      now: () => AT,
    },
    () => {},
  );
  const server = serve({ fetch: realApp.fetch, hostname: "127.0.0.1", port });
  let browserServer: BrowserServer | undefined;
  let browser: Browser | undefined;
  try {
    await once(server, "listening");
    browserServer = await chromium.launchServer({ headless: true });
    browser = await chromium.connect(browserServer.wsEndpoint());
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "waitron_management_session",
        value: token,
        url: origin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${origin}/manage`);
    const read = await page.evaluate(async (path) => {
      const response = await fetch(path, {
        credentials: "include",
        headers: { "x-waitron-live": "1" },
      });
      return { status: response.status, body: await response.json() };
    }, PATH);
    expect(seen[0]).toEqual({ method: "GET", origin: undefined, site: "same-origin" });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ eligible: true, category: "invalid", clockRevision: 1 });
    const preview = await page.evaluate(async (path) => {
      const response = await fetch(path + "?timeZone=Europe%2FMadrid", { credentials: "include" });
      return { status: response.status, body: await response.json() };
    }, PATH);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      preview: { civilDate: "2026-10-15", offsetMinutes: 120 },
    });
    const saved = await page.evaluate(
      async ({ path, input }) => {
        const response = await fetch(path, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        return { status: response.status, body: await response.json() };
      },
      { path: PATH, input: body },
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ repaired: true, clockRevision: 2, admission: "restart_required" });
    expect(seen.at(-1)).toEqual({ method: "POST", origin, site: "same-origin" });
    expect(restart).toHaveBeenCalledTimes(1);
    expect(rows().incidents).toHaveLength(1);
  } finally {
    await browser?.close();
    await browserServer?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each([
  ["GET", ORIGIN, "same-origin", undefined, 200],
  ["GET", ORIGIN, "same-site", undefined, 403],
  ["GET", ORIGIN, "cross-site", undefined, 403],
  ["GET", ORIGIN, undefined, undefined, 403],
  ["GET", "https://foreign.example", "same-origin", undefined, 403],
  ["GET", ORIGIN, "same-origin", "https://foreign.example", 403],
  ["POST", ORIGIN, "same-origin", undefined, 403],
] as const)(
  "origin proof %s %s %s %s returns %s",
  async (method, urlOrigin, site, origin, expected) => {
    const before = rows();
    const response = await app.request(
      urlOrigin + PATH,
      {
        method,
        headers: {
          cookie: `waitron_management_session=${token}`,
          "content-type": "application/json",
          ...(site === undefined ? {} : { "sec-fetch-site": site }),
          ...(origin === undefined ? {} : { origin }),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      },
      { outgoing },
    );
    expect(response.status).toBe(expected);
    if (expected !== 200)
      expect(await response.json()).toEqual({
        error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
      });
    expect(rows()).toEqual(before);
    expect(restart).not.toHaveBeenCalled();
  },
);

it("uses the staff origin for remote time-zone repair and refuses another origin", async () => {
  const staff = createStaffApp(app, "https://staff.example.test");
  const requestRemote = (method: string, origin?: string) =>
    staff.request(
      "https://staff.example.test" + PATH,
      {
        method,
        headers: {
          cookie: `waitron_management_session=${token}`,
          "content-type": "application/json",
          ...(origin ? { origin } : { "sec-fetch-site": "same-origin" }),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      },
      { outgoing },
    );
  await refusal(
    await requestRemote("POST", "https://attacker.test"),
    403,
    "authorization.not_permitted",
  );
  expect((await requestRemote("GET")).status).toBe(200);
  expect((await requestRemote("POST", "https://staff.example.test")).status).toBe(200);
  expect(admission.snapshot()).toEqual({ state: "restart_required" });
});
