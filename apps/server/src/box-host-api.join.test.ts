import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
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
  type PersonRoleValue,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { mountBoxHostApi } from "./box-host-api.js";
import { boxHostRequests, type BoxHostRequests, type WifiJoin } from "./box-host-client.js";
import type { Logger } from "./logger.js";
import { requestIdMiddleware } from "./request-id.js";
import { answer, closeFakeBoxHosts, fakeBoxHost } from "./testing/fake-box-host.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const JOIN: WifiJoin = {
  ssidHex: "4361666550657065",
  keyMgmt: "wpa-psk",
  psk: "abcdefgh",
  hidden: false,
};
const URL_BASE = "https://box.test";
const PATH = "/api/box/network/join";

interface Person {
  id: string;
  token: string;
  cookie: string;
}

let manager: Person;
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

const sockets: Socket[] = [];

beforeEach(async () => {
  manager = await seedPerson("manager", "Marta");
  supervisor = await seedPerson("supervisor", "Sergio");
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await closeFakeBoxHosts();
});

function fakeHost() {
  return {
    networkRead: vi.fn<BoxHostRequests["networkRead"]>(async () => ({
      available: false,
      reason: "lost",
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

function mount(host: BoxHostRequests, log: Logger = () => {}, db: Database = suite.db): Hono {
  const app = new Hono();
  app.use(
    "*",
    requestIdMiddleware(log, () => new Date()),
  );
  mountBoxHostApi(app, { db, host }, log);
  return app;
}

interface JoinOptions {
  cookie?: string;
  body?: string | Uint8Array | ReadableStream<Uint8Array>;
  socket?: "tls" | "plain" | "none";
  /** `null` sends none, as a `Request` does for a byte body. */
  contentType?: string | null;
  headers?: Record<string, string>;
}

function join(app: Hono, options: JoinOptions = {}) {
  const {
    cookie,
    body = JSON.stringify(JOIN),
    socket = "tls",
    contentType = "application/json",
    headers = {},
  } = options;
  const incoming =
    socket === "tls" ? new TLSSocket(new Socket()) : socket === "plain" ? new Socket() : undefined;
  if (incoming !== undefined) sockets.push(incoming);
  return app.request(
    `${URL_BASE}${PATH}`,
    {
      method: "POST",
      headers: {
        ...(contentType === null ? {} : { "content-type": contentType }),
        ...(cookie === undefined ? {} : { cookie }),
        ...headers,
      },
      body,
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit,
    incoming === undefined ? undefined : { incoming: { socket: incoming } },
  );
}

const json = (value: unknown) => JSON.stringify(value);

/** Not through `withTransaction`, whose drain would deliver a change a case left waiting. */
async function setLastSeen(person: Person, at: Date): Promise<void> {
  await suite.db
    .update(managementSessions)
    .set({ lastSeenAt: at.toISOString() })
    .where(eq(managementSessions.tokenHash, hashSessionToken(person.token)));
}

/** A full disk modelled as a write lock that refuses every turn, reads included. */
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

describe("a join that succeeds", () => {
  it("asks the host with exactly the body and the manager's own id", async () => {
    const host = fakeHost();
    const response = await join(mount(host), { cookie: manager.cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(host.networkJoin).toHaveBeenCalledTimes(1);
    expect(host.networkJoin).toHaveBeenCalledWith(JOIN, { source: "person", person: manager.id });
  });

  it("hands a WPA3 password and a hidden network to the host unchanged", async () => {
    const host = fakeHost();
    const sae = { ...JOIN, keyMgmt: "sae", psk: "é".repeat(128), hidden: true };
    const response = await join(mount(host), { cookie: manager.cookie, body: json(sae) });
    expect(response.status).toBe(200);
    expect(host.networkJoin).toHaveBeenCalledWith(sae, { source: "person", person: manager.id });
  });

  it("is taken from the box's own page", async () => {
    const host = fakeHost();
    const response = await join(mount(host), {
      cookie: manager.cookie,
      headers: { origin: URL_BASE, "sec-fetch-site": "same-origin" },
    });
    expect(response.status).toBe(200);
    expect(host.networkJoin).toHaveBeenCalledTimes(1);
  });

  it("is taken from a page the person opened themselves", async () => {
    const host = fakeHost();
    const response = await join(mount(host), {
      cookie: manager.cookie,
      headers: { origin: URL_BASE, "sec-fetch-site": "none" },
    });
    expect(response.status).toBe(200);
    expect(host.networkJoin).toHaveBeenCalledTimes(1);
  });
});

describe("the connection, checked before the session", () => {
  it.each([
    ["no socket", { socket: "none" }, "unencrypted"],
    ["a plain socket", { socket: "plain" }, "unencrypted"],
    ["another origin", { headers: { origin: "https://elsewhere.example" } }, "other_origin"],
    ["a cross-site fetch", { headers: { "sec-fetch-site": "cross-site" } }, "other_origin"],
  ] as const)("%s is refused", async (_label, options, reason) => {
    const host = fakeHost();
    const log = vi.fn<Logger>();
    const response = await join(mount(host, log), options);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "box_network.join_connection_insecure", params: { reason } },
    });
    expect(log).toHaveBeenCalledWith("warn", "box_network.join_connection_insecure", {
      reason,
      requestId: expect.any(String),
    });
    expect(host.networkJoin).toHaveBeenCalledTimes(0);
  });

  it("refuses an unencrypted join without reading one byte of its body", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(4097).fill(0x20));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const host = fakeHost();
    const response = await join(mount(host), { socket: "none", body });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "box_network.join_connection_insecure", params: { reason: "unencrypted" } },
    });
    expect(pulls).toBe(0);
    expect(host.networkJoin).toHaveBeenCalledTimes(0);
  });
});

describe("the content type", () => {
  it.each([
    ["text/plain", { contentType: "text/plain" }],
    ["none, for a byte body", { contentType: null, body: new TextEncoder().encode(json(JOIN)) }],
  ] as const)("%s is refused", async (_label, options) => {
    const host = fakeHost();
    const response = await join(mount(host), { cookie: manager.cookie, ...options });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(host.networkJoin).toHaveBeenCalledTimes(0);
  });
});

describe.each([
  ["with room", () => suite.db],
  ["on a full disk", () => lockRefusingDb(new AppError("storage.disk_full", {}))],
])("the session, %s", (_label, db) => {
  async function expectRefused(cookie: string | undefined, status: number, code: string) {
    const host = fakeHost();
    const response = await join(
      mount(host, () => {}, db()),
      {
        ...(cookie === undefined ? {} : { cookie }),
      },
    );
    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    expect(host.networkJoin).toHaveBeenCalledTimes(0);
  }

  it("a manager joins", async () => {
    const host = fakeHost();
    const response = await join(
      mount(host, () => {}, db()),
      { cookie: manager.cookie },
    );
    expect(response.status).toBe(200);
    expect(host.networkJoin).toHaveBeenCalledTimes(1);
  });

  it("refuses a request with no session", async () => {
    await expectRefused(undefined, 401, "management_session.required");
  });

  it("refuses a supervisor", async () => {
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
    const response = await join(
      mount(host, () => {}, db()),
      {
        cookie: supervisor.cookie,
        body: "{}",
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "system.manage" } },
    });
    expect(host.networkJoin).toHaveBeenCalledTimes(0);
  });
});

describe("fields refused before the host is asked", () => {
  it.each([
    [{ keyMgmt: "wpa-psk", psk: "abcdefgh", hidden: false }, "ssidHex"],
    [{ ...JOIN, ssidHex: "FF" }, "ssidHex"],
    [{ ...JOIN, ssidHex: 1 }, "ssidHex"],
    [{ ...JOIN, keyMgmt: "wpa-eap" }, "keyMgmt"],
    [{ ...JOIN, keyMgmt: null }, "keyMgmt"],
    [{ ...JOIN, psk: 8 }, "psk"],
    [{ ...JOIN, hidden: "false" }, "hidden"],
    [{ ...JOIN, extra: 1 }, "body"],
  ])("%j names %s", async (body, field) => {
    const host = fakeHost();
    const response = await join(mount(host), { cookie: manager.cookie, body: json(body) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field } },
    });
    expect(host.networkJoin).toHaveBeenCalledTimes(0);
  });
});

describe("a password the protocol refuses", () => {
  it.each([
    [{ ...JOIN, psk: "abcdefg" }, "wpa-psk"],
    [{ ...JOIN, keyMgmt: "sae", psk: "abc\tdefg" }, "sae"],
  ] as const)("answers its own code, naming the field and the key type (%j)", async (body, km) => {
    const host = fakeHost();
    host.networkJoin.mockResolvedValue({ available: false, reason: "invalid" });
    const response = await join(mount(host), { cookie: manager.cookie, body: json(body) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "box_network.password_invalid", params: { field: "psk", keyMgmt: km } },
    });
  });

  it.each([
    [{ ...JOIN, psk: "abcdefg" }, "wpa-psk"],
    [{ ...JOIN, psk: "g".repeat(64) }, "wpa-psk"],
    [{ ...JOIN, keyMgmt: "sae", psk: "abc\tdefg" }, "sae"],
  ] as const)("through the real client, sends nothing to the host (%j)", async (body, km) => {
    const fake = await fakeBoxHost(answer('{"ok":true}\n'));
    const app = mount(boxHostRequests({ socketPath: fake.path }));
    const response = await join(app, { cookie: manager.cookie, body: json(body) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "box_network.password_invalid", params: { field: "psk", keyMgmt: km } },
    });
    expect(fake.lines).toEqual([]);
  });

  it("a password the protocol takes reaches the host through the real client", async () => {
    const fake = await fakeBoxHost(answer('{"ok":true}\n'));
    const app = mount(boxHostRequests({ socketPath: fake.path }));
    const response = await join(app, { cookie: manager.cookie });
    expect(response.status).toBe(200);
    expect(fake.lines).toHaveLength(1);
  });
});

describe("a person id the protocol would refuse", () => {
  it("is a fault in Waitron, and the host is never sent a line", async () => {
    const odd = await seedPerson("manager", "Olga", "person_1");
    const fake = await fakeBoxHost(answer('{"ok":true}\n'));
    const app = mount(boxHostRequests({ socketPath: fake.path }));
    const response = await join(app, { cookie: odd.cookie });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
    expect(fake.lines).toEqual([]);
  });
});

describe("the host's words on a join", () => {
  it.each([
    [
      { available: false, reason: "refused", refusal: "busy" },
      409,
      { error: { code: "box_network.busy", params: {} } },
    ],
    [
      { available: false, reason: "refused", refusal: "no_wifi" },
      409,
      { error: { code: "box_network.no_wifi", params: {} } },
    ],
    [
      { available: false, reason: "missing", detail: "ENOENT" },
      409,
      { error: { code: "box_host.unavailable", params: { reason: "missing", detail: "ENOENT" } } },
    ],
    [
      { available: false, reason: "lost" },
      502,
      { error: { code: "box_host.failed", params: { reason: "lost" } } },
    ],
  ] as const)("%j answers %i", async (hostAnswer, status, body) => {
    const host = fakeHost();
    host.networkJoin.mockResolvedValue(hostAnswer);
    const response = await join(mount(host), { cookie: manager.cookie });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });
});

describe("the password never leaves the body", () => {
  const CANARY = "Canary-psk-7f3a91";
  const SHORT = "Cnry7f3";
  const CONSOLE = ["log", "info", "warn", "error", "debug", "trace"] as const;
  const withPsk = (psk: string) => json({ ...JOIN, psk });

  type Run = (log: Logger) => Promise<{ response: Response; status: number; line?: () => string }>;

  const viaFake =
    (
      setUp: (host: ReturnType<typeof fakeHost>) => void,
      options: (log: Logger) => JoinOptions,
      status: number,
    ): Run =>
    async (log) => {
      const host = fakeHost();
      setUp(host);
      return { response: await join(mount(host, log), options(log)), status };
    };
  const signedIn =
    (body: JoinOptions["body"], extra: Partial<JoinOptions> = {}) =>
    () => ({
      cookie: manager.cookie,
      body,
      ...extra,
    });
  const nothing = () => {};

  const RUNS: [string, Run][] = [
    ["a success", viaFake(nothing, signedIn(withPsk(CANARY)), 200)],
    [
      "a success through the real client",
      async (log) => {
        const fake = await fakeBoxHost(answer('{"ok":true}\n'));
        const app = mount(boxHostRequests({ socketPath: fake.path }), log);
        const response = await join(app, { cookie: manager.cookie, body: withPsk(CANARY) });
        return { response, status: 200, line: () => fake.lines.join("\n") };
      },
    ],
    [
      "busy",
      viaFake(
        (h) =>
          h.networkJoin.mockResolvedValue({ available: false, reason: "refused", refusal: "busy" }),
        signedIn(withPsk(CANARY)),
        409,
      ),
    ],
    [
      "missing",
      viaFake(
        (h) =>
          h.networkJoin.mockResolvedValue({
            available: false,
            reason: "missing",
            detail: "ENOENT",
          }),
        signedIn(withPsk(CANARY)),
        409,
      ),
    ],
    [
      "lost",
      viaFake(
        (h) => h.networkJoin.mockResolvedValue({ available: false, reason: "lost" }),
        signedIn(withPsk(CANARY)),
        502,
      ),
    ],
    [
      "host_failed",
      viaFake(
        (h) =>
          h.networkJoin.mockResolvedValue({
            available: false,
            reason: "refused",
            refusal: "host_failed",
          }),
        signedIn(withPsk(CANARY)),
        502,
      ),
    ],
    [
      "a refused short password",
      viaFake(
        (h) => h.networkJoin.mockResolvedValue({ available: false, reason: "invalid" }),
        signedIn(withPsk(SHORT)),
        400,
      ),
    ],
    [
      "a refused short password through the real client",
      async (log) => {
        const fake = await fakeBoxHost(answer('{"ok":true}\n'));
        const app = mount(boxHostRequests({ socketPath: fake.path }), log);
        const response = await join(app, { cookie: manager.cookie, body: withPsk(SHORT) });
        return { response, status: 400 };
      },
    ],
    [
      "a host that throws with the password",
      viaFake(
        (h) => h.networkJoin.mockRejectedValue(new Error(CANARY)),
        signedIn(withPsk(CANARY)),
        500,
      ),
    ],
    ["no session", viaFake(nothing, () => ({ body: withPsk(CANARY) }), 401)],
    [
      "a supervisor",
      viaFake(nothing, () => ({ cookie: supervisor.cookie, body: withPsk(CANARY) }), 403),
    ],
    ["plain HTTP", viaFake(nothing, signedIn(withPsk(CANARY), { socket: "none" }), 403)],
    [
      "another origin",
      viaFake(
        nothing,
        signedIn(withPsk(CANARY), { headers: { origin: "https://elsewhere.example" } }),
        403,
      ),
    ],
    ["an extra key", viaFake(nothing, signedIn(json({ ...JOIN, note: CANARY })), 400)],
    [
      "a refused SSID",
      viaFake(nothing, signedIn(json({ ...JOIN, ssidHex: "FF", psk: CANARY })), 400),
    ],
    ["a body over the limit", viaFake(nothing, signedIn(withPsk(CANARY).padEnd(4097, " ")), 400)],
    ["malformed JSON", viaFake(nothing, signedIn(`{"psk":${CANARY}}`), 400)],
    [
      "a text body",
      viaFake(nothing, signedIn(withPsk(CANARY), { contentType: "text/plain" }), 400),
    ],
  ];

  it.each(RUNS)("%s", async (_label, run) => {
    const spies = CONSOLE.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    try {
      const log = vi.fn<Logger>();
      const { response, status, line } = await run(log);
      const text = await response.text();
      expect(response.status).toBe(status);
      const logged = JSON.stringify(log.mock.calls);
      expect(log).toHaveBeenCalledWith(
        "debug",
        "http.request",
        expect.objectContaining({ status }),
      );
      for (const secret of [CANARY, CANARY.slice(0, 6), CANARY.slice(-8), SHORT]) {
        expect(logged).not.toContain(secret);
        expect(text).not.toContain(secret);
      }
      if (line !== undefined) expect(line().split(CANARY)).toHaveLength(2);
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
