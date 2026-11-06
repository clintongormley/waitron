import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  hashSessionToken,
  managementSessions,
  persons,
  startManagementSession,
  withPassiveManagementRead,
  type PersonRoleValue,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { mountBoxHostApi } from "./box-host-api.js";
import {
  boxHostRequests,
  type BoxHostRequests,
  type HostUnavailable,
  type NetworkSnapshot,
} from "./box-host-client.js";
import type { Logger } from "./logger.js";
import { answer, closeFakeBoxHosts, fakeBoxHost, noBoxHostPath } from "./testing/fake-box-host.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const SNAPSHOT: NetworkSnapshot = {
  wired: { connected: true, address: "192.168.1.10" },
  wifi: { connectedSsidHex: "4361666550657065", savedSsidHex: "4361666550657065" },
  change: null,
  bootCopy: { state: "current", reason: null, failure: null },
};

interface Person {
  id: string;
  token: string;
  cookie: string;
}

let manager: Person;
let admin: Person;
let supervisor: Person;

async function seedPerson(role: PersonRoleValue, name: string, id?: string): Promise<Person> {
  return withTransaction(suite.db, async (tx) => {
    const [p] = await tx
      .insert(persons)
      .values({
        ...(id === undefined ? {} : { id }),
        displayName: name,
        pinHash: hashPin("1234"),
        role,
      })
      .returning({ id: persons.id });
    const session = await startManagementSession(tx, { personId: p!.id });
    return { id: p!.id, token: session.token, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}

beforeEach(async () => {
  manager = await seedPerson("manager", "Marta");
  admin = await seedPerson("admin", "Ana");
  supervisor = await seedPerson("supervisor", "Sergio");
});

afterEach(async () => {
  await closeFakeBoxHosts();
});

function fakeHost() {
  return {
    networkRead: vi.fn<BoxHostRequests["networkRead"]>(async () => ({
      available: true,
      ...SNAPSHOT,
    })),
    networkScan: vi.fn<BoxHostRequests["networkScan"]>(async () => ({
      available: true,
      networks: [],
    })),
    networkJoin: vi.fn<BoxHostRequests["networkJoin"]>(async () => ({ available: true })),
    networkForget: vi.fn<BoxHostRequests["networkForget"]>(async () => ({ available: true })),
    screenRead: vi.fn<BoxHostRequests["screenRead"]>(async () => ({
      available: true,
      start: "till",
    })),
    screenSet: vi.fn<BoxHostRequests["screenSet"]>(async (set) => ({ available: true, ...set })),
    tagWrite: vi.fn<BoxHostRequests["tagWrite"]>(async () => ({
      available: true,
      tag: "unchanged",
    })),
  } satisfies BoxHostRequests;
}

function mount(
  db: Database,
  host: BoxHostRequests = fakeHost(),
  log: Logger = () => {},
): { app: Hono; host: BoxHostRequests } {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && c.req.header("x-waitron-live") === "1") {
      await withPassiveManagementRead(next);
    } else await next();
  });
  mountBoxHostApi(app, { db, host }, log);
  return { app, host };
}

function get(app: Hono, path: string, cookie?: string, passive = false) {
  return app.request(path, {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(passive ? { "x-waitron-live": "1" } : {}),
    },
  });
}

/** Not through `withTransaction`, whose drain would deliver a change a case left waiting. */
async function setLastSeen(person: Person, at: Date): Promise<void> {
  await suite.db
    .update(managementSessions)
    .set({ lastSeenAt: at.toISOString() })
    .where(eq(managementSessions.tokenHash, hashSessionToken(person.token)));
}

async function lastSeen(person: Person): Promise<string> {
  const [row] = await suite.db
    .select({ lastSeenAt: managementSessions.lastSeenAt })
    .from(managementSessions)
    .where(eq(managementSessions.tokenHash, hashSessionToken(person.token)));
  return row!.lastSeenAt;
}

/** A full disk modelled as a write lock that refuses every turn, reads included, before anything in
 * it runs. */
function lockRefusingDb(error: Error): Database {
  return new Proxy(suite.db, {
    get(target, prop) {
      if (prop === "withWriteLock") {
        return async () => {
          throw error;
        };
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

const DISK_FULL = () => new AppError("storage.disk_full", {});

const NETWORK = "/api/box/network";
const SCREEN = "/api/box/screen";

describe.each([
  ["with room", () => suite.db],
  ["on a full disk", () => lockRefusingDb(DISK_FULL())],
])("%s", (_label, db) => {
  it("a manager reads the network and the start screen as themselves", async () => {
    const host = fakeHost();
    const { app } = mount(db(), host);
    const network = await get(app, NETWORK, manager.cookie);
    expect(network.status).toBe(200);
    expect(await network.json()).toEqual(SNAPSHOT);
    expect(host.networkRead).toHaveBeenCalledTimes(1);
    expect(host.networkRead).toHaveBeenCalledWith({ source: "person", person: manager.id });

    const screen = await get(app, SCREEN, manager.cookie);
    expect(screen.status).toBe(200);
    expect(await screen.json()).toEqual({ start: "till" });
    expect(host.screenRead).toHaveBeenCalledTimes(1);
    expect(host.screenRead).toHaveBeenCalledWith({ source: "person", person: manager.id });
  });

  it("an admin reads them too, as themselves", async () => {
    const host = fakeHost();
    const { app } = mount(db(), host);
    const network = await get(app, NETWORK, admin.cookie);
    expect(network.status).toBe(200);
    expect(await network.json()).toEqual(SNAPSHOT);
    expect(host.networkRead).toHaveBeenCalledWith({ source: "person", person: admin.id });
    const screen = await get(app, SCREEN, admin.cookie);
    expect(screen.status).toBe(200);
    expect(host.screenRead).toHaveBeenCalledWith({ source: "person", person: admin.id });
  });

  async function expectRefused(cookie: string | undefined, status: number, code: string) {
    const host = fakeHost();
    const { app } = mount(db(), host);
    for (const response of [
      await get(app, NETWORK, cookie),
      await get(app, NETWORK, cookie, true),
      await get(app, SCREEN, cookie),
      await get(app, SCREEN, cookie, true),
    ]) {
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
    expect(host.networkRead).toHaveBeenCalledTimes(0);
    expect(host.screenRead).toHaveBeenCalledTimes(0);
  }

  it("refuses a request with no session", async () => {
    await expectRefused(undefined, 401, "management_session.required");
  });

  it("refuses a supervisor, who may not manage the system", async () => {
    await expectRefused(supervisor.cookie, 403, "authorization.not_permitted");
  });

  it("refuses an ended session", async () => {
    await withTransaction(suite.db, (tx) =>
      tx
        .update(managementSessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(managementSessions.tokenHash, hashSessionToken(manager.token))),
    );
    await expectRefused(manager.cookie, 401, "management_session.required");
  });

  it("refuses a session idle for 31 minutes", async () => {
    await setLastSeen(manager, new Date(Date.now() - 31 * 60_000));
    await expectRefused(manager.cookie, 401, "management_session.expired");
  });

  it("refuses a suspended person", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, manager.id)),
    );
    await expectRefused(manager.cookie, 403, "person.suspended");
  });
});

describe("the session's last-seen time", () => {
  const minuteAgo = () => new Date(Date.now() - 60_000);

  it.each([NETWORK, SCREEN])(
    "on %s is left alone by a passive read and moved by one asked for",
    async (path) => {
      const { app } = mount(suite.db);
      const seeded = minuteAgo();
      await setLastSeen(manager, seeded);
      expect((await get(app, path, manager.cookie, true)).status).toBe(200);
      expect(await lastSeen(manager)).toBe(seeded.toISOString());

      const before = minuteAgo();
      await setLastSeen(manager, before);
      expect((await get(app, path, manager.cookie)).status).toBe(200);
      expect(Date.parse(await lastSeen(manager))).toBeGreaterThan(before.getTime());
    },
  );

  it.each([NETWORK, SCREEN])("on %s is left alone on a full disk, passive or not", async (path) => {
    const { app } = mount(lockRefusingDb(DISK_FULL()));
    for (const passive of [true, false]) {
      const seeded = minuteAgo();
      await setLastSeen(manager, seeded);
      expect((await get(app, path, manager.cookie, passive)).status).toBe(200);
      expect(await lastSeen(manager)).toBe(seeded.toISOString());
    }
  });
});

type Unavailable = HostUnavailable<
  "request_invalid" | "actor_invalid" | "fields_invalid" | "host_failed"
>;

const MAPPING: [string, Unavailable, number, unknown][] = [
  [
    "missing ENOENT",
    { available: false, reason: "missing", detail: "ENOENT" },
    409,
    { error: { code: "box_host.unavailable", params: { reason: "missing", detail: "ENOENT" } } },
  ],
  [
    "missing EACCES",
    { available: false, reason: "missing", detail: "EACCES" },
    409,
    { error: { code: "box_host.unavailable", params: { reason: "missing", detail: "EACCES" } } },
  ],
  [
    "unsupported unknown_request",
    { available: false, reason: "unsupported", detail: "unknown_request" },
    409,
    {
      error: {
        code: "box_host.unavailable",
        params: { reason: "unsupported", detail: "unknown_request" },
      },
    },
  ],
  [
    "unsupported request_invalid",
    { available: false, reason: "unsupported", detail: "request_invalid" },
    409,
    {
      error: {
        code: "box_host.unavailable",
        params: { reason: "unsupported", detail: "request_invalid" },
      },
    },
  ],
  [
    "lost",
    { available: false, reason: "lost" },
    502,
    { error: { code: "box_host.failed", params: { reason: "lost" } } },
  ],
  [
    "timeout",
    { available: false, reason: "timeout" },
    502,
    { error: { code: "box_host.failed", params: { reason: "timeout" } } },
  ],
  [
    "malformed",
    { available: false, reason: "malformed" },
    502,
    { error: { code: "box_host.failed", params: { reason: "malformed" } } },
  ],
  [
    "refused request_invalid",
    { available: false, reason: "refused", refusal: "request_invalid" },
    502,
    { error: { code: "box_host.failed", params: { reason: "request_invalid" } } },
  ],
  [
    "refused actor_invalid",
    { available: false, reason: "refused", refusal: "actor_invalid" },
    502,
    { error: { code: "box_host.failed", params: { reason: "actor_invalid" } } },
  ],
  [
    "refused fields_invalid",
    { available: false, reason: "refused", refusal: "fields_invalid" },
    502,
    { error: { code: "box_host.failed", params: { reason: "fields_invalid" } } },
  ],
  [
    "refused host_failed",
    { available: false, reason: "refused", refusal: "host_failed" },
    502,
    { error: { code: "box_host.failed", params: { reason: "host_failed" } } },
  ],
  ["invalid", { available: false, reason: "invalid" }, 500, { error: { code: "server.internal" } }],
];

describe("the host's answer on the network read", () => {
  it.each(MAPPING)("%s", async (_label, hostAnswer, status, body) => {
    const host = fakeHost();
    host.networkRead.mockResolvedValue(hostAnswer);
    const { app } = mount(suite.db, host);
    const response = await get(app, NETWORK, manager.cookie);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });
});

describe("the host's answer on the start screen read", () => {
  const SCREEN_ROWS = new Set([
    "missing ENOENT",
    "unsupported unknown_request",
    "refused host_failed",
  ]);
  it.each(MAPPING.filter(([label]) => SCREEN_ROWS.has(label)))(
    "%s",
    async (_label, hostAnswer, status, body) => {
      const host = fakeHost();
      host.screenRead.mockResolvedValue(hostAnswer);
      const { app } = mount(suite.db, host);
      const response = await get(app, SCREEN, manager.cookie);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    },
  );
});

describe("through the real client", () => {
  it("asks the host with the manager's own id and answers its snapshot", async () => {
    const fake = await fakeBoxHost(
      answer(
        '{"ok":true,"wired":{"connected":true,"address":"192.168.1.10"},"wifi":{"connectedSsidHex":"4361666550657065","savedSsidHex":"4361666550657065"},"change":null,"bootCopy":{"state":"current","reason":null,"failure":null}}\n',
      ),
    );
    const { app } = mount(suite.db, boxHostRequests({ socketPath: fake.path }));
    const response = await get(app, NETWORK, manager.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SNAPSHOT);
    expect(fake.lines).toEqual([
      `network.read {"actor":{"source":"person","person":"${manager.id}"}}`,
    ]);
  });

  it("answers that the box cannot do this when there is no host service", async () => {
    const { app } = mount(suite.db, boxHostRequests({ socketPath: noBoxHostPath() }));
    const response = await get(app, NETWORK, manager.cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "box_host.unavailable", params: { reason: "missing", detail: "ENOENT" } },
    });
  });
});

describe("a person id the protocol would refuse", () => {
  it("is a fault in Waitron, and the host is never asked", async () => {
    const odd = await seedPerson("manager", "Olga", "person_1");
    const host = fakeHost();
    const { app } = mount(suite.db, host);
    const response = await get(app, NETWORK, odd.cookie);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
    expect(host.networkRead).toHaveBeenCalledTimes(0);
  });
});

describe("the log", () => {
  it("records a missing host once, at warn, with its reason and detail", async () => {
    const host = fakeHost();
    host.networkRead.mockResolvedValue({ available: false, reason: "missing", detail: "ENOENT" });
    const log = vi.fn<Logger>();
    const { app } = mount(suite.db, host, log);
    expect((await get(app, NETWORK, manager.cookie)).status).toBe(409);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "box_host.unavailable", {
      reason: "missing",
      detail: "ENOENT",
      requestId: undefined,
    });
  });

  it("records nothing for a read that succeeds", async () => {
    const log = vi.fn<Logger>();
    const { app } = mount(suite.db, fakeHost(), log);
    expect((await get(app, NETWORK, manager.cookie)).status).toBe(200);
    expect(log).toHaveBeenCalledTimes(0);
  });
});

const SCAN = "/api/box/network/scan";
const FORGET = "/api/box/network/forget";
const SSID = "4361666550657065";

function post(
  app: Hono,
  path: string,
  cookie?: string,
  body?: string,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method: "POST",
    headers: { ...(cookie === undefined ? {} : { cookie }), ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

const json = (value: unknown) => JSON.stringify(value);

describe.each([
  ["with room", () => suite.db],
  ["on a full disk", () => lockRefusingDb(DISK_FULL())],
])("the changes, %s", (_label, db) => {
  it("a manager scans, forgets a network and sets the start screen as themselves", async () => {
    const host = fakeHost();
    host.networkScan.mockResolvedValue({
      available: true,
      networks: [{ ssidHex: SSID, signal: 71, security: "wpa-psk" }],
    });
    const { app } = mount(db(), host);
    const actor = { source: "person", person: manager.id };

    const scan = await post(app, SCAN, manager.cookie);
    expect(scan.status).toBe(200);
    expect(await scan.json()).toEqual({
      networks: [{ ssidHex: SSID, signal: 71, security: "wpa-psk" }],
    });
    expect(host.networkScan).toHaveBeenCalledTimes(1);
    expect(host.networkScan).toHaveBeenCalledWith(actor);

    const forget = await post(app, FORGET, manager.cookie, json({ ssidHex: SSID }));
    expect(forget.status).toBe(200);
    expect(await forget.json()).toEqual({});
    expect(host.networkForget).toHaveBeenCalledTimes(1);
    expect(host.networkForget).toHaveBeenCalledWith({ ssidHex: SSID }, actor);

    const screen = await post(app, SCREEN, manager.cookie, json({ start: "till" }));
    expect(screen.status).toBe(200);
    expect(await screen.json()).toEqual({ start: "till" });
    expect(host.screenSet).toHaveBeenCalledTimes(1);
    expect(host.screenSet).toHaveBeenCalledWith({ start: "till" }, actor);
  });

  async function expectRefused(cookie: string | undefined, status: number, code: string) {
    const host = fakeHost();
    const { app } = mount(db(), host);
    for (const response of [
      await post(app, SCAN, cookie),
      await post(app, FORGET, cookie, json({ ssidHex: SSID })),
      await post(app, SCREEN, cookie, json({ start: "till" })),
    ]) {
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
    expect(host.networkScan).toHaveBeenCalledTimes(0);
    expect(host.networkForget).toHaveBeenCalledTimes(0);
    expect(host.screenSet).toHaveBeenCalledTimes(0);
  }

  it("refuses a request with no session", async () => {
    await expectRefused(undefined, 401, "management_session.required");
  });

  it("refuses a supervisor, who may not manage the system", async () => {
    await expectRefused(supervisor.cookie, 403, "authorization.not_permitted");
  });

  it("refuses an ended session", async () => {
    await withTransaction(suite.db, (tx) =>
      tx
        .update(managementSessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(managementSessions.tokenHash, hashSessionToken(manager.token))),
    );
    await expectRefused(manager.cookie, 401, "management_session.required");
  });

  it("refuses a session idle for 31 minutes", async () => {
    await setLastSeen(manager, new Date(Date.now() - 31 * 60_000));
    await expectRefused(manager.cookie, 401, "management_session.expired");
  });

  it("refuses a suspended person", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, manager.id)),
    );
    await expectRefused(manager.cookie, 403, "person.suspended");
  });

  it("checks a supervisor's permission before validating the body", async () => {
    const host = fakeHost();
    const { app } = mount(db(), host);
    const response = await post(app, FORGET, supervisor.cookie, json({ nope: 1 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "system.manage" } },
    });
    expect(host.networkForget).toHaveBeenCalledTimes(0);
  });

  it("checks a supervisor's permission before validating the start screen's body", async () => {
    const host = fakeHost();
    const { app } = mount(db(), host);
    const response = await post(app, SCREEN, supervisor.cookie, json({ start: "Panel" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "system.manage" } },
    });
    expect(host.screenSet).toHaveBeenCalledTimes(0);
  });

  it.each([
    [FORGET, json({ nope: 1 })],
    [SCREEN, json({ start: "Panel" })],
  ])("checks for a session on %s before validating its body", async (path, body) => {
    const host = fakeHost();
    const { app } = mount(db(), host);
    const response = await post(app, path, undefined, body);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "management_session.required", params: {} },
    });
    expect(host.networkForget).toHaveBeenCalledTimes(0);
    expect(host.screenSet).toHaveBeenCalledTimes(0);
  });
});

describe("the start screen's answer", () => {
  it("is the host's reply, not the request", async () => {
    const host = fakeHost();
    host.screenSet.mockResolvedValue({ available: true, start: "dashboard" });
    const { app } = mount(suite.db, host);
    const response = await post(app, SCREEN, manager.cookie, json({ start: "till" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ start: "dashboard" });
    expect(host.screenSet).toHaveBeenCalledWith(
      { start: "till" },
      { source: "person", person: manager.id },
    );
  });
});

describe("the host's own words about the network", () => {
  it.each([
    ["busy", 409, "box_network.busy"],
    ["no_wifi", 409, "box_network.no_wifi"],
  ] as const)("a scan refused %s answers %i %s", async (refusal, status, code) => {
    const host = fakeHost();
    host.networkScan.mockResolvedValue({ available: false, reason: "refused", refusal });
    const { app } = mount(suite.db, host);
    const response = await post(app, SCAN, manager.cookie);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, params: {} } });
  });

  it.each([
    ["busy", 409, "box_network.busy"],
    ["not_saved", 409, "box_network.not_saved"],
  ] as const)("a forget refused %s answers %i %s", async (refusal, status, code) => {
    const host = fakeHost();
    host.networkForget.mockResolvedValue({ available: false, reason: "refused", refusal });
    const { app } = mount(suite.db, host);
    const response = await post(app, FORGET, manager.cookie, json({ ssidHex: SSID }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, params: {} } });
  });
});

describe("the shared answers on the changes", () => {
  const SHARED_ROWS = new Set([
    "missing ENOENT",
    "unsupported unknown_request",
    "timeout",
    "refused fields_invalid",
    "invalid",
  ]);
  const rows = MAPPING.filter(([label]) => SHARED_ROWS.has(label));

  it.each(rows)("scan: %s", async (_label, hostAnswer, status, body) => {
    const host = fakeHost();
    host.networkScan.mockResolvedValue(hostAnswer);
    const { app } = mount(suite.db, host);
    const response = await post(app, SCAN, manager.cookie);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it.each(rows)("forget: %s", async (_label, hostAnswer, status, body) => {
    const host = fakeHost();
    host.networkForget.mockResolvedValue(hostAnswer);
    const { app } = mount(suite.db, host);
    const response = await post(app, FORGET, manager.cookie, json({ ssidHex: SSID }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it.each(rows)("screen: %s", async (_label, hostAnswer, status, body) => {
    const host = fakeHost();
    host.screenSet.mockResolvedValue(hostAnswer);
    const { app } = mount(suite.db, host);
    const response = await post(app, SCREEN, manager.cookie, json({ start: "till" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });
});

describe("bodies refused before the host is asked", () => {
  it.each([
    [FORGET, json({}), "ssidHex"],
    [FORGET, json({ ssidHex: "FF" }), "ssidHex"],
    [FORGET, json({ ssidHex: "ff", extra: 1 }), "body"],
    [FORGET, "[]", "body"],
    [FORGET, "null", "body"],
    [FORGET, '"x"', "body"],
    [FORGET, undefined, "body"],
    [FORGET, "not json", "body"],
    [SCREEN, json({ start: "Panel" }), "start"],
    [SCREEN, json({ start: "dashboard", note: "x" }), "body"],
    [SCREEN, undefined, "body"],
  ])("%s with %s names %s", async (path, body, field) => {
    const host = fakeHost();
    const { app } = mount(suite.db, host);
    const response = await post(app, path, manager.cookie, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field } },
    });
    expect(host.networkForget).toHaveBeenCalledTimes(0);
    expect(host.screenSet).toHaveBeenCalledTimes(0);
  });

  const padded = (size: number) => json({ ssidHex: "ff" }).padEnd(size, " ");

  it.each([
    ["read to the limit", {}],
    ["refused from its Content-Length", { "content-length": "4097" }],
  ])("a 4097-byte body is refused, %s", async (_label, headers) => {
    const host = fakeHost();
    const { app } = mount(suite.db, host);
    const response = await post(app, FORGET, manager.cookie, padded(4097), headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(host.networkForget).toHaveBeenCalledTimes(0);
  });

  it("a 4097-byte start screen body is refused", async () => {
    const host = fakeHost();
    const { app } = mount(suite.db, host);
    const body = json({ start: "till" }).padEnd(4097, " ");
    const response = await post(app, SCREEN, manager.cookie, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(host.screenSet).toHaveBeenCalledTimes(0);
  });

  it("a 4096-byte body is taken", async () => {
    const host = fakeHost();
    const { app } = mount(suite.db, host);
    const response = await post(app, FORGET, manager.cookie, padded(4096));
    expect(response.status).toBe(200);
    expect(host.networkForget).toHaveBeenCalledTimes(1);
    expect(host.networkForget).toHaveBeenCalledWith(
      { ssidHex: "ff" },
      { source: "person", person: manager.id },
    );
  });
});

describe("a scan asked with the live header", () => {
  it("still moves the session's last-seen time, since only a GET is passive", async () => {
    const { app } = mount(suite.db);
    const before = new Date(Date.now() - 60_000);
    await setLastSeen(manager, before);
    expect(
      (await post(app, SCAN, manager.cookie, undefined, { "x-waitron-live": "1" })).status,
    ).toBe(200);
    expect(Date.parse(await lastSeen(manager))).toBeGreaterThan(before.getTime());
  });
});
