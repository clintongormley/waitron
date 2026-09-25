import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  persons,
  managementSessions,
  startManagementSession,
  hashPin,
  hashSessionToken,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { createCloudConnection } from "./cloud-client.js";
import { mountCloudApi } from "./cloud-api.js";
import type { ReplacementView } from "./cloud-replacement.js";
import { cloudFixture } from "../test/cloud-fixture.js";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60000,
});
async function person(role: "manager" | "staff") {
  return withTransaction(suite.db, async (tx) => {
    const [p] = await tx
      .insert(persons)
      .values({ displayName: role, pinHash: hashPin("1234"), role })
      .returning();
    const session = await startManagementSession(tx, { personId: p!.id });
    return { id: p!.id, session: session.token, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}
it("requires a live manager, correct Origin and serving primary; status reads are passive", async () => {
  const f = await cloudFixture();
  try {
    const manager = await person("manager"),
      staff = await person("staff");
    let primary = true;
    const app = new Hono();
    mountCloudApi(
      app,
      {
        db: suite.db,
        connection: createCloudConnection(f.options),
        managementOrigin: "https://venue.test",
        isPrimary: () => primary,
      },
      () => {},
    );
    const send = (cookie: string, origin = "https://venue.test") =>
      app.request("/management-api/cloud/start", {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: "{}",
      });
    expect((await send("")).status).toBe(401);
    expect((await send(staff.cookie)).status).toBe(403);
    const oldActivity = new Date(Date.now() - 60000).toISOString();
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: oldActivity })
      .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)));
    expect((await send(manager.cookie, "https://attacker.test")).status).toBe(403);
    expect(
      (
        await suite.db
          .select()
          .from(managementSessions)
          .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)))
      )[0]!.lastSeenAt,
    ).toBe(oldActivity);
    primary = false;
    expect((await send(manager.cookie)).status).toBe(409);
    primary = true;
    const before = (
      await suite.db
        .select()
        .from(managementSessions)
        .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)))
    )[0]!.lastSeenAt;
    expect(
      (await app.request("/management-api/cloud/status", { headers: { cookie: manager.cookie } }))
        .status,
    ).toBe(200);
    expect(
      (
        await suite.db
          .select()
          .from(managementSessions)
          .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)))
      )[0]!.lastSeenAt,
    ).toBe(before);
    expect(f.requests).toHaveLength(0);
    const connected = await send(manager.cookie);
    expect(connected.status).toBe(200);
    const body = await connected.json();
    expect(body.localVenueId).toBe(f.options.localVenueId);
    expect(body.privateKey).toBeUndefined();
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: oldActivity })
      .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)));
    expect(
      (
        await app.request("/management-api/cloud/check", {
          method: "POST",
          headers: {
            cookie: manager.cookie,
            origin: "https://venue.test",
            "content-type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await suite.db
          .select()
          .from(managementSessions)
          .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)))
      )[0]!.lastSeenAt,
    ).not.toBe(oldActivity);
    await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, manager.id));
    expect((await send(manager.cookie)).status).toBe(403);
    await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, manager.id));
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: new Date(Date.now() - 3600000).toISOString() })
      .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)));
    expect((await send(manager.cookie)).status).toBe(401);
  } finally {
    await f.close();
  }
});
it("gates replacement requests before and after a network wait", async () => {
  const manager = await person("manager"),
    staff = await person("staff");
  let primary = true;
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const replacement = {
    status: vi.fn(async () => null),
    eligible: vi.fn(async () => true),
    prepare: vi.fn(async (authorize?: () => Promise<void>) => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await authorize?.();
      return { state: "awaiting_owner" } as ReplacementView;
    }),
    check: vi.fn(),
  };
  const app = new Hono();
  mountCloudApi(
    app,
    { db: suite.db, replacement, managementOrigin: "https://venue.test", isPrimary: () => primary },
    () => {},
  );
  const send = (cookie: string, origin = "https://venue.test") =>
    app.request("/management-api/cloud/replacement/prepare", {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: "{}",
    });
  expect((await send("")).status).toBe(401);
  expect((await send(staff.cookie)).status).toBe(403);
  expect((await send(manager.cookie, "https://attacker.test")).status).toBe(403);
  expect(replacement.prepare).toHaveBeenCalledTimes(0);
  primary = false;
  expect((await send(manager.cookie)).status).toBe(409);
  primary = true;
  const pending = send(manager.cookie);
  await waiting;
  primary = false;
  release();
  expect((await pending).status).toBe(409);
});
it("losing permission or primary role during the Cloud status wait prevents a completion signature", async () => {
  const f = await cloudFixture();
  try {
    const manager = await person("manager");
    let primary = true;
    const connection = createCloudConnection(f.options);
    const app = new Hono();
    mountCloudApi(
      app,
      {
        db: suite.db,
        connection,
        managementOrigin: "https://venue.test",
        isPrimary: () => primary,
      },
      () => {},
    );
    await connection.start();
    f.approve();
    const approved = await connection.check();
    const send = () =>
      app.request("/management-api/cloud/complete", {
        method: "POST",
        headers: {
          cookie: manager.cookie,
          origin: "https://venue.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requestId: approved.requestId,
          organisationId: f.organisationId,
          legalBusinessId: f.legalBusinessId,
        }),
      });
    f.onStatus(async () => {
      await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, manager.id));
    });
    expect((await send()).status).toBe(403);
    expect(f.requests.some((v) => v[2] === "complete")).toBe(false);
    await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, manager.id));
    f.onStatus(async () => {
      primary = false;
    });
    expect((await send()).status).toBe(409);
    expect(f.requests.some((v) => v[2] === "complete")).toBe(false);
    primary = true;
    f.onStatus(async () => {});
    expect((await send()).status).toBe(200);
    expect(f.requests.filter((v) => v[2] === "complete")).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it("rejects malformed or extra browser inputs and reports an unconfigured server without creating state", async () => {
  const manager = await person("manager");
  const app = new Hono();
  mountCloudApi(
    app,
    { db: suite.db, managementOrigin: "https://venue.test", isPrimary: () => true },
    () => {},
  );
  const headers = {
    cookie: manager.cookie,
    origin: "https://venue.test",
    "content-type": "application/json",
  };
  expect(
    await (await app.request("/management-api/cloud/status", { headers })).json(),
  ).toMatchObject({ configured: false, state: "not_connected" });
  for (const body of [
    "null",
    "[1]",
    "broken",
    "x".repeat(4097),
    '{"localVenueId":"caller"}',
    '{"restart":null}',
    '{"restart":"true"}',
  ]) {
    const result = await app.request("/management-api/cloud/start", {
      method: "POST",
      headers,
      body,
    });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: { code: "cloud.request_invalid" } });
  }
  expect(
    (await app.request("/management-api/cloud/start", { method: "POST", headers, body: "{}" }))
      .status,
  ).toBe(409);
  expect(
    (await app.request("/management-api/cloud/complete", { method: "POST", headers, body: "{}" }))
      .status,
  ).toBe(400);
});

it("refresh and revoke require a live manager and exact Origin; revoke rechecks after a pending exchange", async () => {
  const { installationFixture } = await import("../test/cloud-installation-fixture.js");
  const f = await installationFixture();
  try {
    const manager = await person("manager"),
      staff = await person("staff");
    let primary = true;
    const app = new Hono();
    mountCloudApi(
      app,
      {
        db: suite.db,
        connection: f.client,
        managementOrigin: "https://venue.test",
        isPrimary: () => primary,
      },
      () => {},
    );
    const send = (action: string, cookie = manager.cookie, origin = "https://venue.test") =>
      app.request("/management-api/cloud/" + action, {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: "{}",
      });
    for (const action of ["refresh", "revoke"]) {
      expect((await send(action, "")).status).toBe(401);
      expect((await send(action, staff.cookie)).status).toBe(403);
      expect((await send(action, manager.cookie, "https://attacker.test")).status).toBe(403);
    }
    expect((await send("refresh")).status).toBe(200);
    primary = false;
    expect((await send("refresh")).status).toBe(409);
    primary = true;
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.delay(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, manager.id));
    });
    const refreshing = f.client.refresh();
    await started;
    const oldActivity = new Date(Date.now() - 60000).toISOString();
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: oldActivity })
      .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)));
    const revoking = send("revoke");
    try {
      await vi.waitFor(async () => {
        const [row] = await suite.db
          .select()
          .from(managementSessions)
          .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)));
        expect(row!.lastSeenAt).not.toBe(oldActivity);
      });
    } finally {
      release();
    }
    await refreshing;
    expect((await revoking).status).toBe(403);
    expect(f.requests.some((v) => v[2] === "revoke")).toBe(false);
    f.delay(async () => {});
    await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, manager.id));
    primary = false;
    expect((await send("revoke")).status).toBe(200);
    expect((await f.client.status()).installation?.state).toBe("revoked");
  } finally {
    await f.close();
  }
});
