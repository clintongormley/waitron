import { once } from "node:events";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { StripeReconciler } from "@waitron/payments-stripe";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { setImmediate as nextTurn } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  locations,
  nodes,
  tenants,
  stampDeployment,
  withTransaction,
  locationBusinessDaySettings,
  setDeploymentMode,
  writeMirrorConfig,
  writeNodeMembership,
  workingOrders,
  incidents,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  hashPassword,
  persons,
  startManagementSession,
  managementSessions,
} from "@waitron/identity";
import { AppError, decimal, deviceOrigin } from "@waitron/shared";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { insertInitiated } from "@waitron/payments";
import { generateSync } from "otplib";
import { accountPurposeKey } from "./account-key.js";
import { enrolAuthenticator } from "./testing/authenticator.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { readZoneContext, validateRetainedZoneClock } from "./venue-zone-context.js";
import { runAttendanceLoop } from "./attendance-loop.js";
import { runAttendanceEmailLoop } from "./attendance-email-worker.js";
import { runInvoiceEmailLoop } from "./invoice-email-worker.js";
import { runPendingCardLoop } from "./pending-card-recovery.js";
import { runTenderRefundRecoveryLoop } from "./tender-refund-recovery.js";
import { startMenuActivation } from "./menu-activation.js";
import { readVenueDetails } from "./venue-details.js";
import { serverFixture } from "./testing/server-fixture.js";
import {
  copyMigrationsRoot,
  withMockedKill,
  startFakeSmtp,
  withCapturedStdout,
  TRADING_STATE_DIR,
} from "./testing/boot-harness.js";
import type { StartedServer } from "./boot.js";

const listener = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof import("@hono/node-server").serve> | undefined,
}));
vi.mock("@hono/node-server", async (load) => {
  const actual = await load<typeof import("@hono/node-server")>();
  return {
    ...actual,
    serve: vi.fn((options, onListen) => {
      listener.current = actual.serve({ ...options, port: 0 }, onListen);
      return listener.current;
    }),
  };
});
vi.mock("./venue-zone-context.js", async (load) => {
  const actual = await load<typeof import("./venue-zone-context.js")>();
  return {
    ...actual,
    readZoneContext: vi.fn(actual.readZoneContext),
    validateRetainedZoneClock: vi.fn(actual.validateRetainedZoneClock),
  };
});
vi.mock("./venue-details.js", async (load) => {
  const actual = await load<typeof import("./venue-details.js")>();
  return { ...actual, readVenueDetails: vi.fn(actual.readVenueDetails) };
});
vi.mock("./attendance-loop.js", async (load) => {
  const a = await load<typeof import("./attendance-loop.js")>();
  return { ...a, runAttendanceLoop: vi.fn(a.runAttendanceLoop) };
});
vi.mock("./attendance-email-worker.js", async (load) => {
  const a = await load<typeof import("./attendance-email-worker.js")>();
  return { ...a, runAttendanceEmailLoop: vi.fn(a.runAttendanceEmailLoop) };
});
vi.mock("./invoice-email-worker.js", async (load) => {
  const a = await load<typeof import("./invoice-email-worker.js")>();
  return { ...a, runInvoiceEmailLoop: vi.fn(a.runInvoiceEmailLoop) };
});
vi.mock("./pending-card-recovery.js", async (load) => {
  const a = await load<typeof import("./pending-card-recovery.js")>();
  return { ...a, runPendingCardLoop: vi.fn(a.runPendingCardLoop) };
});
vi.mock("./tender-refund-recovery.js", async (load) => {
  const a = await load<typeof import("./tender-refund-recovery.js")>();
  return { ...a, runTenderRefundRecoveryLoop: vi.fn(a.runTenderRefundRecoveryLoop) };
});
vi.mock("./menu-activation.js", async (load) => {
  const a = await load<typeof import("./menu-activation.js")>();
  return { ...a, startMenuActivation: vi.fn(a.startMenuActivation) };
});

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const fixture = serverFixture();
const NODE = "33333333-3333-4333-8333-333333333333";
const LOCATION = "55555555-5555-4555-8555-555555555555";
const ORIGIN = "http://127.0.0.1:32123";
const PATH = "/management-api/venue-details/time-zone-repair";
const PASSWORD = "syntheticPassword123";
const duties = [
  runAttendanceLoop,
  runAttendanceEmailLoop,
  runInvoiceEmailLoop,
  runPendingCardLoop,
  runTenderRefundRecoveryLoop,
  startMenuActivation,
];
let scratch: string;
let server: StartedServer | undefined;
let manager: string;
let staff: string;
let managerToken: string;
let staffToken: string;
let env: Record<string, string>;
let url: string;
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.clearAllMocks();
  listener.current = undefined;
  fixture.beforeServerStarts();
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90000001R", legalName: "Zone Admission SL" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Counter",
    invoiceLocales: ["en-GB"],
    operationDescription: "Restaurant service",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  });
  await suite.db
    .insert(nodes)
    .values({ id: NODE, locationId: LOCATION, name: "Node", filingModule: "verifactu" });
  await stampDeployment(suite.db, "preproduction");
  const people = await suite.db
    .insert(persons)
    .values([
      {
        displayName: "Manager",
        role: "manager",
        email: "manager@example.test",
        passwordHash: hashPassword(PASSWORD),
      },
      {
        displayName: "Staff",
        role: "staff",
        email: "staff@example.test",
        passwordHash: hashPassword(PASSWORD),
      },
    ])
    .returning();
  manager = people[0]!.id;
  staff = people[1]!.id;
  managerToken = (
    await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId: manager }))
  ).token;
  staffToken = (
    await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId: staff }))
  ).token;
  scratch = await mkdtemp(join(tmpdir(), "waitron-zone-admission-"));
  await copyMigrationsRoot(join(scratch, "migrations"));
  await mkdir(join(scratch, "dashboard"));
  await writeFile(
    join(scratch, "dashboard/index.html"),
    '<html lang="en"><title>Synthetic dashboard</title><body>Dashboard fixture</body></html>',
  );
  await writeFile(
    join(scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const file = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  env = {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: "32123",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_ACCOUNT_KEY: Buffer.alloc(32, 11).toString("base64"),
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(file),
    WAITRON_TILL_NODE_ID: NODE,
    WAITRON_TILL_LOCATION_ID: LOCATION,
    WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
    WAITRON_DASHBOARD_APP_DIR: join(scratch, "dashboard"),
    WAITRON_MANAGEMENT_ORIGIN: ORIGIN,
    WAITRON_ENV: "preproduction",
  };
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  vi.restoreAllMocks();
});
afterAll(async () => {
  if (TRADING_STATE_DIR !== undefined)
    await rm(TRADING_STATE_DIR, { recursive: true, force: true });
});
async function boot() {
  server = await fixture.startServer(env);
  if (!listener.current!.listening) await once(listener.current!, "listening");
  url = `http://127.0.0.1:${(listener.current!.address() as AddressInfo).port}`;
  return server;
}
function request(path: string, method = "GET", body?: unknown, token = managerToken) {
  return fetch(`${url}${path}`, {
    method,
    headers: {
      cookie: `waitron_management_session=${token}`,
      origin: ORIGIN,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function rawZone(value: string) {
  fixture.beforeServerStarts();
  await suite.db.update(locations).set({ timeZone: value }).where(eq(locations.id, LOCATION));
}
async function refusal(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
function noDuties() {
  for (const duty of duties) expect(duty).not.toHaveBeenCalled();
}

describe("startup zone admission", () => {
  it("retains one committed repair after a lost answer and a failed restart", async () => {
    await rawZone("Invalid/Zone");
    const input = { timeZone: "Europe/Madrid", expectedClockRevision: 0, confirmed: true };
    await withMockedKill(async (kills) => {
      await boot();
      const answer = await request(PATH, "POST", input);
      await answer.body?.cancel();
      await vi.waitFor(() => expect(kills).toHaveLength(1));
      const status = await request(PATH);
      expect(await status.json()).toMatchObject({
        eligible: false,
        admission: { state: "restart_required" },
        clockRevision: 1,
      });
      await refusal(await request(PATH, "POST", input), 409, "venue.time_zone_repair_not_needed");
      expect(await (await request("/api/node")).json()).toEqual({ acceptingSales: false });
      noDuties();
      await server!.close();
      server = undefined;
    });
    const repaired = await suite.db
      .select()
      .from(incidents)
      .where(eq(incidents.code, "venue.time_zone_repaired"));
    expect(repaired).toHaveLength(1);
    expect(repaired[0]!.acknowledgedBy).toBe(manager);
    const fault = new AppError("venue.time_zone_conversion_failed", { reason: "invalid_instant" });
    vi.mocked(validateRetainedZoneClock).mockRejectedValueOnce(fault);
    await expect(boot()).rejects.toBe(fault);
    noDuties();
    expect(
      await suite.db.select().from(incidents).where(eq(incidents.code, "venue.time_zone_repaired")),
    ).toEqual(repaired);
    expect((await suite.db.select().from(locations))[0]!.timeZone).toBe("Europe/Madrid");
    expect((await suite.db.select().from(locationBusinessDaySettings))[0]!.revision).toBe(1);
    await boot();
    expect((await (await request("/api/node")).json()).acceptingSales).toBe(true);
    expect(runPendingCardLoop).toHaveBeenCalledOnce();
  });

  it.each([
    new AppError("venue.time_zone_conversion_failed", { reason: "invalid_instant" }),
    new AppError("venue.time_zone_target_invalid", { reason: "mismatch" }),
    new TypeError("synthetic formatter failure"),
  ])("keeps a startup classification failure fatal without granting repair (%j)", async (fault) => {
    vi.mocked(readZoneContext).mockRejectedValueOnce(fault);
    await expect(boot()).rejects.toBe(fault);
    noDuties();
    expect(listener.current).toBeUndefined();
    expect((await suite.db.select().from(locations))[0]!.timeZone).toBe("Europe/Madrid");
    expect(await suite.db.select().from(locationBusinessDaySettings)).toEqual([]);
  });

  it("does not bind or start any normal duty while raw-zone validation is delayed", async () => {
    const entered = gate();
    const release = gate();
    const actual =
      await vi.importActual<typeof import("./venue-zone-context.js")>("./venue-zone-context.js");
    vi.mocked(readZoneContext).mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return actual.readZoneContext(...args);
    });
    const starting = boot();
    try {
      expect(
        await Promise.race([
          entered.promise.then(() => "validating"),
          starting.then(() => "bound"),
        ]),
      ).toBe("validating");
      await nextTurn();
      noDuties();
      expect(listener.current).toBeUndefined();
    } finally {
      release.resolve();
      await starting;
    }
    expect((await (await request("/api/node")).json()).acceptingSales).toBe(true);
    expect(runAttendanceLoop).toHaveBeenCalledOnce();
    expect(runInvoiceEmailLoop).toHaveBeenCalledOnce();
  });
  it.each(["", "Invalid/Zone?secret=must-not-escape"])(
    "boots %j into narrow authentication without ordinary loaders or duties",
    async (zone) => {
      await rawZone(zone);
      await boot();
      noDuties();
      const health = await request("/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true, tradingAvailable: false });
      expect(await (await request("/api/node")).json()).toEqual({ acceptingSales: false });
      expect(await (await request("/management-api/locales")).json()).toMatchObject({
        venueName: "Zone Admission SL",
      });
      const session = await request("/management-api/session/me");
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({
        venueName: "Zone Admission SL",
        tradingAdmission: { state: zone === "" ? "missing" : "invalid" },
      });
      for (const path of [
        "/management-api/venue-details",
        "/management-api/reports",
        "/management-api/alerts",
        "/api/clock/state",
        "/management-api/live",
      ])
        await refusal(await request(path), 409, "venue.time_zone_not_ready");
      const context = await request(PATH);
      expect(context.status).toBe(200);
      expect(await context.json()).toMatchObject({
        eligible: true,
        nodeId: NODE,
        locationId: LOCATION,
      });
      expect(readVenueDetails).not.toHaveBeenCalled();
      noDuties();
      const asset = await fetch(`${url}/manage/account?token=synthetic`, {
        headers: { Accept: "text/html" },
      });
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("Dashboard fixture");
    },
  );
  it("lets staff read the explanation and log out, without context or confirmation authority", async () => {
    await rawZone("Invalid/Zone");
    await boot();
    const session = await request("/management-api/session/me", "GET", undefined, staffToken);
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      role: "staff",
      venueName: "Zone Admission SL",
      tradingAdmission: { state: "invalid" },
    });
    await refusal(
      await request(PATH, "GET", undefined, staffToken),
      403,
      "authorization.not_permitted",
    );
    await refusal(
      await request(
        PATH,
        "POST",
        { timeZone: "Europe/Madrid", expectedClockRevision: 0, confirmed: true },
        staffToken,
      ),
      403,
      "authorization.not_permitted",
    );
    expect((await request("/management-api/session", "DELETE", undefined, staffToken)).status).toBe(
      204,
    );
    await refusal(
      await request("/management-api/session/me", "GET", undefined, staffToken),
      401,
      "management_session.required",
    );
  });
  it("keeps password login generic, and permits real login/session/logout in repair mode", async () => {
    await rawZone("Invalid/Zone");
    await boot();
    for (const email of ["unknown@example.test", "manager@example.test"]) {
      const response = await request(
        "/management-api/session",
        "POST",
        { email, password: "wrong" },
        "",
      );
      await refusal(response, 401, "password.invalid");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    const response = await request(
      "/management-api/session",
      "POST",
      { email: "manager@example.test", password: PASSWORD },
      "",
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    const session = await fetch(`${url}/management-api/session/me`, { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      personId: manager,
      tradingAdmission: { state: "invalid" },
    });
    expect(readVenueDetails).not.toHaveBeenCalled();
    noDuties();
  });
  it.each(["suspended", "revoked", "expired"])(
    "refuses a %s existing session on the narrow read",
    async (state) => {
      await rawZone("Invalid/Zone");
      if (state === "suspended")
        await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, manager));
      else
        await suite.db
          .update(managementSessions)
          .set(
            state === "expired"
              ? { lastSeenAt: "2000-01-01T00:00:00.000Z" }
              : { endedAt: new Date().toISOString() },
          )
          .where(eq(managementSessions.personId, manager));
      await boot();
      const response = await request("/management-api/session/me");
      expect([401, 403]).toContain(response.status);
      expect((await response.json()).error.code).toBe(
        state === "suspended"
          ? "person.suspended"
          : state === "expired"
            ? "management_session.expired"
            : "management_session.required",
      );
    },
  );
  it("retains MFA before issuing a new session in repair mode", async () => {
    await rawZone("Invalid/Zone");
    const secret = await enrolAuthenticator(suite.db, manager, PASSWORD, {
      current: { version: 1, key: accountPurposeKey(Buffer.alloc(32, 11), "totp") },
    });
    const before = (await suite.db.select().from(managementSessions)).length;
    await boot();
    const missing = await request(
      "/management-api/session",
      "POST",
      { email: "manager@example.test", password: PASSWORD },
      "",
    );
    await refusal(missing, 401, "totp.required");
    expect(missing.headers.get("set-cookie")).toBeNull();
    await server!.close();
    server = undefined;
    expect((await suite.db.select().from(managementSessions)).length).toBe(before);
    await boot();
    const response = await request(
      "/management-api/session",
      "POST",
      { email: "manager@example.test", password: PASSWORD, totp: generateSync({ secret }) },
      "",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    noDuties();
  });
  it("starts a restored database snapshot in repair-only mode", async () => {
    await rawZone("Invalid/Zone");
    const restored = join(scratch, "restored");
    await mkdir(restored);
    await suite.db.archiveTo(join(restored, "venue.db"));
    env.WAITRON_VENUE_DIR = restored;
    await boot();
    expect(await (await request("/api/node")).json()).toEqual({ acceptingSales: false });
    const status = await request(PATH);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      eligible: true,
      category: "invalid",
      nodeId: NODE,
      locationId: LOCATION,
    });
    noDuties();
    expect(readVenueDetails).not.toHaveBeenCalled();
  });
  it.each(["mirror", "fenced"] as const)(
    "keeps the %s write refusal outside zone confirmation",
    async (mode) => {
      await rawZone("Invalid/Zone");
      if (mode === "mirror") {
        await setDeploymentMode(suite.db, NODE, "mirror");
        await writeMirrorConfig(suite.db, NODE, {
          relayUrl: "https://127.0.0.1:1/",
          boxHostname: "box.test",
          boxCaPem: "unused",
          originNodeId: NODE,
        });
      } else
        await writeNodeMembership(
          suite.db,
          signedMembershipDoc(1, {
            signerNodeId: NODE,
            nodes: [{ nodeId: NODE, contactUrl: "https://box.test", standing: "sell-only" }],
          }),
        );
      await boot();
      expect(await (await request("/api/node")).json()).toEqual({ acceptingSales: false });
      await refusal(
        await request(PATH, "POST", {
          timeZone: "Europe/Madrid",
          expectedClockRevision: 0,
          confirmed: true,
        }),
        403,
        "node.read_only",
      );
      noDuties();
    },
  );
  it("does not reinterpret a valid-zone conversion failure as repair authority", async () => {
    const fault = new AppError("venue.time_zone_conversion_failed", {
      reason: "unreadable_offset",
    });
    vi.mocked(validateRetainedZoneClock).mockRejectedValueOnce(fault);
    await expect(boot()).rejects.toBe(fault);
    noDuties();
    expect(listener.current).toBeUndefined();
  });
  it("delivers account recovery mail through the existing UTC display fallback", async () => {
    await rawZone("Invalid/Zone");
    const smtp = await startFakeSmtp();
    try {
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, loadKeyRing(env), {
          purpose: "email.smtp",
          value: { url: `smtp://127.0.0.1:${smtp.port}`, from: "synthetic@example.test" },
        }),
      );
      await boot();
      expect(
        (
          await request(
            "/management-api/password-reset",
            "POST",
            { email: "manager@example.test" },
            "",
          )
        ).status,
      ).toBe(202);
      await vi.waitFor(() => expect(smtp.messages).toHaveLength(1), { timeout: 10_000 });
      expect(smtp.messages[0]).toContain("UTC");
      expect(smtp.messages[0]).toContain("/manage/account");
      expect(smtp.messages[0]).not.toContain("Invalid/Zone");
      noDuties();
    } finally {
      await server?.close();
      server = undefined;
      await smtp.close();
    }
  });
  it("keeps signed webhook settlement retryable without accepting an unverified event", async () => {
    await rawZone("Invalid/Zone");
    const reference = `cs_${randomUUID()}`;
    const secret = "whsec_synthetic_boot_zone";
    const { deviceId } = await seedDevice(suite.db, { locationId: LOCATION });
    await withTransaction(suite.db, async (tx) => {
      const [order] = await tx
        .insert(workingOrders)
        .values({ source: "device", deviceId, locationId: LOCATION, orderNumber: 1 })
        .returning();
      await insertInitiated(tx, {
        origin: deviceOrigin(deviceId),
        workingOrderId: order!.id,
        provider: "stripe",
        paymentRef: randomUUID(),
        externalRef: reference,
        amount: decimal("12.10"),
      });
      await putCredential(tx, loadKeyRing(env), {
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_synthetic_zone",
          webhookSecret: secret,
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/cancel",
        },
      });
    });
    const before = JSON.stringify(suite.db.all(sql`select * from payments order by id`));
    const body = JSON.stringify({
      id: "evt_boot_zone",
      object: "event",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: reference, object: "checkout.session", amount_total: 1210 } },
    });
    const sdk = new Stripe("sk_test_synthetic_zone");
    await withCapturedStdout(async (lines) => {
      await boot();
      const signature = sdk.webhooks.generateTestHeaderString({ payload: body, secret });
      for (let attempt = 0; attempt < 2; attempt++) {
        const refused = await fetch(`${url}/webhooks/stripe`, {
          method: "POST",
          headers: { "stripe-signature": signature },
          body,
        });
        expect(refused.status).toBe(500);
        expect(await refused.text()).toBe("");
      }
      const invalid = await fetch(`${url}/webhooks/stripe`, {
        method: "POST",
        headers: { "stripe-signature": "invalid" },
        body,
      });
      expect(invalid.status).toBe(400);
      expect(lines.join("\n")).not.toContain(reference);
      expect(lines.join("\n")).not.toContain(secret);
      expect(lines.join("\n")).not.toContain(body);
      expect(lines.join("\n")).not.toContain("Invalid/Zone");
      noDuties();
      await server!.close();
      server = undefined;
    });
    expect(JSON.stringify(suite.db.all(sql`select * from payments order by id`))).toBe(before);
    await withMockedKill(async (kills) => {
      await boot();
      const repaired = await request(PATH, "POST", {
        timeZone: "Europe/Madrid",
        expectedClockRevision: 0,
        confirmed: true,
      });
      expect(repaired.status).toBe(200);
      await repaired.body?.cancel();
      await vi.waitFor(() => expect(kills).toHaveLength(1));
      await server!.close();
      server = undefined;
    });
    const audit = vi
      .spyOn(StripeReconciler.prototype, "reconcile")
      .mockRejectedValue(new Error("Synthetic offline settlement audit"));
    try {
      await boot();
      expect((await (await request("/api/node")).json()).acceptingSales).toBe(true);
      const signature = sdk.webhooks.generateTestHeaderString({ payload: body, secret });
      const deliver = () =>
        fetch(`${url}/webhooks/stripe`, {
          method: "POST",
          headers: { "stripe-signature": signature },
          body,
        });
      const first = await deliver();
      expect(first.status).toBe(200);
      expect(await first.text()).toBe("");
      const settled = suite.db.all(sql`select * from payments order by id`);
      expect(settled).toHaveLength(1);
      expect(settled[0]).toMatchObject({
        state: "captured",
        external_ref: reference,
        amount: 1210,
      });
      const duplicate = await deliver();
      expect(duplicate.status).toBe(200);
      expect(await duplicate.text()).toBe("");
      expect(suite.db.all(sql`select * from payments order by id`)).toEqual(settled);
    } finally {
      await server?.close();
      server = undefined;
      audit.mockRestore();
    }
  });
  it("commits confirmation through the real listener, then requests restart while admission stays closed", async () => {
    await rawZone("Invalid/Zone");
    await withMockedKill(async (kills) => {
      await boot();
      const result = await request(PATH, "POST", {
        timeZone: "Europe/Madrid",
        expectedClockRevision: 0,
        confirmed: true,
      });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({
        repaired: true,
        admission: "restart_required",
        clockRevision: 1,
      });
      await vi.waitFor(() => expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]));
      expect(await (await request("/api/node")).json()).toEqual({ acceptingSales: false });
      expect(await (await request("/management-api/session/me")).json()).toMatchObject({
        tradingAdmission: { state: "restart_required" },
      });
      noDuties();
      await server!.close();
      server = undefined;
    });
    const [location] = await suite.db.select().from(locations).where(eq(locations.id, LOCATION));
    expect(location!.timeZone).toBe("Europe/Madrid");
    expect((await suite.db.select().from(locationBusinessDaySettings))[0]!.revision).toBe(1);
    await boot();
    expect((await (await request("/api/node")).json()).acceptingSales).toBe(true);
    expect(runPendingCardLoop).toHaveBeenCalledOnce();
  });
});
