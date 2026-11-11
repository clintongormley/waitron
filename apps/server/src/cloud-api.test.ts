import { createStaffApp } from "./cloud-remote.js";
import { Hono } from "hono";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { AppError } from "@waitron/shared";
import { createCloudConnection } from "./cloud-client.js";
import { mountCloudApi } from "./cloud-api.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import type { ReplacementView } from "./cloud-replacement.js";
import { cloudFixture } from "../test/cloud-fixture.js";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { randomBytes } from "node:crypto";
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
    await setFreshManagementSignIn(tx, session.token);
    return { id: p!.id, session: session.token, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}
it.each(["start", "complete", "revoke", "remote-access"] as const)(
  "requires confirmation before Cloud %s delegates or changes saved state",
  async (action) => {
    const f = await installationFixture();
    try {
      const manager = await person("manager");
      await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, manager.session, false));
      const connection = createCloudConnection(f.options);
      const effect = vi.spyOn(connection, action === "remote-access" ? "setRemoteAccess" : action);
      const before = await readFile(join(f.stateDir, "cloud-connection.json"), "utf8");
      const saved = JSON.parse(before) as { requestId: string };
      const app = new Hono();
      mountCloudApi(
        app,
        { db: suite.db, connection, managementOrigin: "https://venue.test", isPrimary: () => true },
        () => {},
      );
      const response = await app.request(`/management-api/cloud/${action}`, {
        method: "POST",
        headers: {
          cookie: manager.cookie,
          origin: "https://venue.test",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          action === "remote-access"
            ? { enabled: true }
            : action === "complete"
              ? {
                  requestId: saved.requestId,
                  organisationId: f.organisationId,
                  legalBusinessId: f.legalBusinessId,
                }
              : {},
        ),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management_session.proof_required", params: {} },
      });
      expect(effect).not.toHaveBeenCalled();
      expect(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8")).toBe(before);
    } finally {
      await f.close();
    }
  },
);
it.each(["prepare", "check"] as const)(
  "requires confirmation before replacement %s",
  async (action) => {
    const manager = await person("manager");
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, manager.session, false));
    const effect = vi.fn(async () => ({ state: "awaiting_owner" }) as ReplacementView);
    const app = new Hono();
    mountCloudApi(
      app,
      {
        db: suite.db,
        managementOrigin: "https://venue.test",
        isPrimary: () => true,
        replacement: {
          status: async () => null,
          eligible: async () => true,
          approval: async () => null,
          hasProposal: async () => false,
          prepare: effect,
          check: effect,
          recordStop: vi.fn(),
        },
      },
      () => {},
    );
    const response = await app.request(`/management-api/cloud/replacement/${action}`, {
      method: "POST",
      headers: {
        cookie: manager.cookie,
        origin: "https://venue.test",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management_session.proof_required", params: {} },
    });
    expect(effect).not.toHaveBeenCalled();
  },
);
it.each(["complete", "revoke", "remote-access"] as const)(
  "rechecks confirmation inside Cloud %s before saving",
  async (action) => {
    const f = await installationFixture();
    try {
      const manager = await person("manager");
      const afterWait = async (authorize: () => Promise<void>) => {
        await withTransaction(suite.db, (tx) =>
          setFreshManagementSignIn(tx, manager.session, false),
        );
        await authorize();
      };
      const connection = {
        ...f.client,
        complete: (
          choice: Parameters<typeof f.client.complete>[0],
          authorize: () => Promise<void>,
        ) => f.client.complete(choice, () => afterWait(authorize)),
        revoke: (authorize: () => Promise<void>) => f.client.revoke(() => afterWait(authorize)),
        setRemoteAccess: (enabled: boolean, authorize: () => Promise<void>) =>
          f.client.setRemoteAccess(enabled, () => afterWait(authorize)),
      };
      const app = new Hono();
      mountCloudApi(
        app,
        { db: suite.db, connection, managementOrigin: "https://venue.test", isPrimary: () => true },
        () => {},
      );
      const before = await readFile(join(f.stateDir, "cloud-connection.json"), "utf8");
      const saved = JSON.parse(before) as { requestId: string };
      const response = await app.request(`/management-api/cloud/${action}`, {
        method: "POST",
        headers: {
          cookie: manager.cookie,
          origin: "https://venue.test",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          action === "complete"
            ? {
                requestId: saved.requestId,
                organisationId: f.organisationId,
                legalBusinessId: f.legalBusinessId,
              }
            : action === "remote-access"
              ? { enabled: true }
              : {},
        ),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management_session.proof_required", params: {} },
      });
      expect(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8")).toBe(before);
    } finally {
      await f.close();
    }
  },
);
it.each(["prepare", "check"] as const)(
  "rechecks confirmation inside replacement %s",
  async (action) => {
    const manager = await person("manager");
    const change = async (authorize?: () => Promise<void>) => {
      await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, manager.session, false));
      await authorize?.();
      return { state: "awaiting_owner" } as ReplacementView;
    };
    const app = new Hono();
    mountCloudApi(
      app,
      {
        db: suite.db,
        managementOrigin: "https://venue.test",
        isPrimary: () => true,
        replacement: {
          status: async () => null,
          eligible: async () => true,
          approval: async () => null,
          hasProposal: async () => false,
          prepare: change,
          check: change,
          recordStop: async () => {},
        },
      },
      () => {},
    );
    const response = await app.request(`/management-api/cloud/replacement/${action}`, {
      method: "POST",
      headers: {
        cookie: manager.cookie,
        origin: "https://venue.test",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management_session.proof_required", params: {} },
    });
  },
);
it("lets a manager toggle only remote access, with the same origin and primary checks as other Cloud writes", async () => {
  const f = await installationFixture();
  try {
    const manager = await person("manager"),
      staff = await person("staff"),
      app = new Hono();
    const connection = createCloudConnection(f.options);
    let primary = true;
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
    const send = (body: unknown, cookie = manager.cookie, origin = "https://venue.test") =>
      app.request("/management-api/cloud/remote-access", {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    for (const [cookie, origin, code] of [
      ["", "https://venue.test", "management_session.required"],
      [staff.cookie, "https://venue.test", "authorization.not_permitted"],
      [manager.cookie, "https://other.test", "authorization.not_permitted"],
    ]) {
      const reply = await send({ enabled: false }, cookie, origin);
      expect(reply.status).toBe(cookie === "" ? 401 : 403);
      expect((await reply.json()).error.code).toBe(code);
    }
    primary = false;
    expect((await (await send({ enabled: false })).json()).error.code).toBe("cloud.not_primary");
    primary = true;
    for (const body of [
      {},
      { enabled: "false" },
      { enabled: null },
      { enabled: true, extra: true },
    ]) {
      const reply = await send(body);
      expect(reply.status).toBe(400);
      expect((await reply.json()).error.code).toBe("cloud.request_invalid");
    }
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, manager.session, false));
    expect((await (await send({ enabled: false })).json()).remoteAccessEnabled).toBe(false);
    expect((await connection.status()).state).toBe("complete");
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, manager.session));
    expect((await (await send({ enabled: true })).json()).remoteAccessEnabled).toBe(true);
  } finally {
    await f.close();
  }
});
for (const lost of ["primary", "session"] as const)
  it(`refuses a queued remote access change after losing ${lost}`, async () => {
    const f = await installationFixture();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const manager = await person("manager"),
        app = new Hono();
      const connection = createCloudConnection(f.options);
      let primary = true,
        enter!: () => void,
        queued!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        queued = resolve;
      });
      f.delay(async () => {
        enter();
        await hold;
      });
      const refreshing = connection.refresh();
      await entered;
      const original = connection.setRemoteAccess.bind(connection);
      vi.spyOn(connection, "setRemoteAccess").mockImplementation((...args) => {
        queued();
        return original(...args);
      });
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
      const answer = app.request("/management-api/cloud/remote-access", {
        method: "POST",
        headers: {
          cookie: manager.cookie,
          origin: "https://venue.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      });
      await waiting;
      if (lost === "primary") primary = false;
      else
        await suite.db
          .delete(managementSessions)
          .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)));
      release();
      await refreshing;
      const response = await answer;
      expect(response.status).toBe(lost === "primary" ? 409 : 401);
      expect((await response.json()).error.code).toBe(
        lost === "primary" ? "cloud.not_primary" : "management_session.required",
      );
      expect((await connection.status()).remoteAccessEnabled).toBe(true);
    } finally {
      release();
      await f.close();
    }
  });

it("distinguishes a local tunnel refusal from a Cloud outage in the actual management route", async () => {
  const f = await installationFixture();
  try {
    const manager = await person("manager"),
      app = new Hono();
    await writeFile(join(f.stateDir, "public-key"), randomBytes(32).toString("base64"));
    f.patch({
      services: ["continuous_backup", "remote_access", "retained_snapshots"].map((service) => ({
        service,
        state: "ready",
        configuration: {},
        health: "unknown",
        failure: null,
        observedAt: null,
      })),
    });
    const connection = createCloudConnection({ ...f.options, tunnelDir: f.stateDir });
    mountCloudApi(
      app,
      { db: suite.db, connection, managementOrigin: "https://venue.test", isPrimary: () => true },
      () => {},
    );
    const reply = await app.request("/management-api/cloud/refresh", {
      method: "POST",
      headers: {
        cookie: manager.cookie,
        origin: "https://venue.test",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(reply.status).toBe(422);
    expect(await reply.json()).toEqual({ error: { code: "cloud.tunnel_unavailable", params: {} } });
    expect((await connection.status()).installation?.state).toBe("active");
  } finally {
    await f.close();
  }
});
it.each([
  ["cloud.tunnel_unavailable", 422],
  ["cloud.tunnel_conflict", 409],
] as const)(
  "returns the real tunnel refusal %s without changing the installation's control status",
  async (code, status) => {
    const f = await installationFixture(undefined, {
      tunnel: async (_values, _saved, _req, res) => {
        res.writeHead(409);
        res.end(JSON.stringify({ error: "placement_conflict" }));
      },
    });
    try {
      const manager = await person("manager"),
        tunnelDir = join(f.stateDir, "tunnel");
      await mkdir(tunnelDir);
      await writeFile(
        join(tunnelDir, "public-key"),
        code === "cloud.tunnel_unavailable" ? "invalid" : Buffer.alloc(32).toString("base64"),
      );
      const connection = createCloudConnection({ ...f.options, tunnelDir });
      const app = new Hono();
      mountCloudApi(
        app,
        { db: suite.db, connection, managementOrigin: "https://venue.test", isPrimary: () => true },
        () => {},
      );
      const answer = await app.request("/management-api/cloud/refresh", {
        method: "POST",
        headers: {
          cookie: manager.cookie,
          origin: "https://venue.test",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(answer.status).toBe(status);
      expect(await answer.json()).toEqual({ error: { code, params: {} } });
      expect((await connection.status()).installation?.state).toBe("active");
    } finally {
      await f.close();
    }
  },
);
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
it("requires manager, origin and primary, and rechecks primary before responding", async () => {
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
    approval: vi.fn(async () => null),
    hasProposal: vi.fn(async () => false),
    prepare: vi.fn(async (authorize?: () => Promise<void>) => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await authorize?.();
      return { state: "awaiting_owner" } as ReplacementView;
    }),
    check: vi.fn(),
    recordStop: vi.fn(),
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
it("keeps Cloud status visible with a diagnostic when saved replacement state is corrupt", async () => {
  const manager = await person("manager");
  const app = new Hono();
  mountCloudApi(
    app,
    {
      db: suite.db,
      managementOrigin: "https://venue.test",
      isPrimary: () => true,
      replacement: {
        status: async () => {
          throw new AppError("cloud.replacement_state_invalid", {});
        },
        eligible: async () => true,
        approval: async () => null,
        hasProposal: async () => false,
        prepare: vi.fn(),
        check: vi.fn(),
        recordStop: vi.fn(),
      },
    },
    () => {},
  );
  const response = await app.request("/management-api/cloud/status", {
    headers: { cookie: manager.cookie },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    state: "not_connected",
    replacementError: "cloud.replacement_state_invalid",
  });
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
it("Stop access records the stop with the replacement after the permission recheck, before Cloud hears it", async () => {
  const { installationFixture } = await import("../test/cloud-installation-fixture.js");
  const f = await installationFixture();
  try {
    const manager = await person("manager");
    const stops: number[] = [];
    const app = new Hono();
    mountCloudApi(
      app,
      {
        db: suite.db,
        connection: f.client,
        managementOrigin: "https://venue.test",
        isPrimary: () => true,
        replacement: {
          status: async () => null,
          eligible: async () => false,
          approval: async () => null,
          hasProposal: async () => false,
          prepare: vi.fn(),
          check: vi.fn(),
          recordStop: async () => {
            stops.push(f.requests.filter((v) => v[2] === "revoke").length);
          },
        },
      },
      () => {},
    );
    const send = () =>
      app.request("/management-api/cloud/revoke", {
        method: "POST",
        headers: {
          cookie: manager.cookie,
          origin: "https://venue.test",
          "content-type": "application/json",
        },
        body: "{}",
      });
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
    const revoking = send();
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
    expect(stops).toEqual([]);
    f.delay(async () => {});
    await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, manager.id));
    expect((await send()).status).toBe(200);
    expect(stops).toEqual([0]);
    expect((await f.client.status()).installation?.state).toBe("revoked");
  } finally {
    await f.close();
  }
});

it("the plan read needs a live manager on the primary, is passive, and answers without ids", async () => {
  const { installationFixture } = await import("../test/cloud-installation-fixture.js");
  const f = await installationFixture(undefined, {
    billing: async (values, saved, _req, res) => {
      const r = (saved.view as { registration: Record<string, string> }).registration;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          version: 1,
          installationId: r.installationId,
          venueId: r.venueId,
          countryCode: "ES",
          calendarTimeZone: "Europe/Madrid",
          asOf: new Date().toISOString(),
          billing: { status: "unavailable", reason: "state_not_ready" },
          prices: { status: "unavailable", reason: "not_published" },
          accountUrl: `${String(values[1])}/account`,
        }),
      );
    },
  });
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
    const read = (cookie = manager.cookie) =>
      app.request("/management-api/cloud/billing", { headers: { cookie } });
    expect((await read("")).status).toBe(401);
    const refused = await read(staff.cookie);
    expect([refused.status, (await refused.json()).error.code]).toEqual([
      403,
      "authorization.not_permitted",
    ]);
    primary = false;
    const notPrimary = await read();
    expect([notPrimary.status, (await notPrimary.json()).error.code]).toEqual([
      409,
      "cloud.not_primary",
    ]);
    primary = true;
    const oldActivity = new Date(Date.now() - 60000).toISOString();
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: oldActivity })
      .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)));
    const answered = await read();
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({
      asOf: expect.any(String),
      calendarTimeZone: "Europe/Madrid",
      billing: { status: "unavailable", reason: "state_not_ready" },
      prices: { status: "unavailable", reason: "not_published" },
      accountUrl: `${f.options.origin}/account`,
    });
    expect(
      (
        await suite.db
          .select()
          .from(managementSessions)
          .where(eq(managementSessions.tokenHash, hashSessionToken(manager.session)))
      )[0]!.lastSeenAt,
    ).toBe(oldActivity);
    const status = await (
      await app.request("/management-api/cloud/status", { headers: { cookie: manager.cookie } })
    ).json();
    expect([status.accountUrl, status.signupUrl]).toEqual([
      `${f.options.origin}/account`,
      undefined,
    ]);
    const unconfigured = new Hono();
    mountCloudApi(
      unconfigured,
      { db: suite.db, managementOrigin: "https://venue.test", isPrimary: () => true },
      () => {},
    );
    const none = await unconfigured.request("/management-api/cloud/billing", {
      headers: { cookie: manager.cookie },
    });
    expect([none.status, (await none.json()).error.code]).toEqual([409, "cloud.not_configured"]);
  } finally {
    await f.close();
  }
});

it("a box not yet connected links to Cloud's sign-up page, not to an account", async () => {
  const f = await cloudFixture();
  try {
    const manager = await person("manager");
    const app = new Hono();
    mountCloudApi(
      app,
      {
        db: suite.db,
        connection: createCloudConnection(f.options),
        managementOrigin: "https://venue.test",
        isPrimary: () => true,
      },
      () => {},
    );
    const status = await (
      await app.request("/management-api/cloud/status", { headers: { cookie: manager.cookie } })
    ).json();
    expect([status.state, status.signupUrl, status.accountUrl]).toEqual([
      "not_connected",
      `${f.options.origin}/signup`,
      undefined,
    ]);
  } finally {
    await f.close();
  }
});

for (const change of ["the manager is suspended", "the box stops being the primary"] as const)
  it(`the plan read checks again after Cloud answers: refused when ${change} meanwhile`, async () => {
    const { installationFixture } = await import("../test/cloud-installation-fixture.js");
    let primary = true;
    let during: (() => Promise<void>) | undefined;
    const f = await installationFixture(undefined, {
      billing: async (values, saved, _req, res) => {
        await during?.();
        const r = (saved.view as { registration: Record<string, string> }).registration;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            version: 1,
            installationId: r.installationId,
            venueId: r.venueId,
            countryCode: "ES",
            calendarTimeZone: "Europe/Madrid",
            asOf: new Date().toISOString(),
            billing: { status: "unavailable", reason: "state_not_ready" },
            prices: { status: "unavailable", reason: "not_published" },
            accountUrl: `${String(values[1])}/account`,
          }),
        );
      },
    });
    const manager = await person("manager");
    try {
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
      during =
        change === "the manager is suspended"
          ? async () => {
              await suite.db
                .update(persons)
                .set({ status: "suspended" })
                .where(eq(persons.id, manager.id));
            }
          : async () => {
              primary = false;
            };
      const answer = await app.request("/management-api/cloud/billing", {
        headers: { cookie: manager.cookie },
      });
      expect([answer.status, (await answer.json()).error.code]).toEqual(
        change === "the manager is suspended"
          ? [403, "person.suspended"]
          : [409, "cloud.not_primary"],
      );
    } finally {
      await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, manager.id));
      await f.close();
    }
  });

it("uses the staff origin for remote Cloud controls and refuses another origin", async () => {
  const f = await cloudFixture();
  try {
    const manager = await person("manager");
    const local = new Hono();
    mountCloudApi(
      local,
      {
        db: suite.db,
        connection: createCloudConnection(f.options),
        managementOrigin: "https://venue.test",
        isPrimary: () => true,
      },
      () => {},
    );
    const staff = createStaffApp(local, "https://staff.example.test");
    const send = (path: string, origin: string) =>
      staff.request("https://staff.example.test/management-api/cloud/" + path, {
        method: "POST",
        headers: { cookie: manager.cookie, origin, "content-type": "application/json" },
        body: "{}",
      });
    expect((await send("start", "https://attacker.test")).status).toBe(403);
    expect((await send("start", "https://staff.example.test")).status).toBe(200);
    const replacement = await send("replacement/check", "https://staff.example.test");
    expect(replacement.status).toBe(409);
    expect(await replacement.json()).toMatchObject({ error: { code: "cloud.not_configured" } });
  } finally {
    await f.close();
  }
});

it("identifies the actual staff entrance in Cloud status and action replies", async () => {
  const f = await installationFixture();
  try {
    const manager = await person("manager"),
      local = new Hono();
    mountCloudApi(
      local,
      {
        db: suite.db,
        connection: createCloudConnection(f.options),
        managementOrigin: "https://venue.test",
        isPrimary: () => true,
      },
      () => {},
    );
    const staff = createStaffApp(local, "https://staff.example.test");
    const headers = {
      cookie: manager.cookie,
      origin: "https://staff.example.test",
      "content-type": "application/json",
    };
    expect(
      (await (await local.request("/management-api/cloud/status", { headers })).json()).isRemote,
    ).toBe(false);
    expect(
      (
        await (
          await staff.request("https://staff.example.test/management-api/cloud/status", { headers })
        ).json()
      ).isRemote,
    ).toBe(true);
    for (const action of ["remote-access", "refresh"]) {
      const result = await staff.request(
        "https://staff.example.test/management-api/cloud/" + action,
        {
          method: "POST",
          headers,
          body: action === "refresh" ? "{}" : JSON.stringify({ enabled: false }),
        },
      );
      expect(result.status).toBe(200);
      expect((await result.json()).isRemote).toBe(true);
    }
  } finally {
    await f.close();
  }
});
