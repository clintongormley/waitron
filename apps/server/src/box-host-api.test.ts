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
