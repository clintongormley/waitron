import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, startManagementSession, type PersonRoleValue } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { BOX_HOST_ROUTE_CALLS, mountBoxHostApi } from "./box-host-api.js";
import { requireManagementChangeFromOwnPage } from "./own-page.js";
import type { BoxHostRequests, NetworkSnapshot } from "./box-host-client.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const SNAPSHOT: NetworkSnapshot = {
  wired: { connected: true, address: "192.168.1.10" },
  wifi: { connectedSsidHex: "4361666550657065", savedSsidHex: "4361666550657065" },
  change: null,
  bootCopy: { state: "current", reason: null, failure: null },
};
const JOIN = { ssidHex: "4361666550657065", keyMgmt: "wpa-psk", psk: "abcdefgh", hidden: false };
const URL_BASE = "https://box.test";

let managerCookie: string;
let supervisorCookie: string;

async function seedCookie(role: PersonRoleValue, name: string): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const [p] = await seedPersons(tx, { displayName: name, pinHash: hashPin("1234"), role });
    const session = await startManagementSession(tx, { personId: p!.id });
    return `${MANAGEMENT_COOKIE}=${session.token}`;
  });
}

const sockets: Socket[] = [];

beforeEach(async () => {
  managerCookie = await seedCookie("manager", "Marta");
  supervisorCookie = await seedCookie("supervisor", "Sergio");
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
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

type Host = ReturnType<typeof fakeHost>;
type RouteMethod = Exclude<keyof Host, "tagWrite">;

/** Makes the method wait until the returned release is called, then answer as it did before. */
function hold(host: Host, method: RouteMethod): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fn = host[method] as unknown as {
    getMockImplementation(): (...args: unknown[]) => Promise<unknown>;
    mockImplementationOnce(impl: (...args: unknown[]) => Promise<unknown>): void;
  };
  const answerAfter = fn.getMockImplementation();
  fn.mockImplementationOnce(async (...args) => {
    await gate;
    return answerAfter(...args);
  });
  return release;
}

function mount(host: BoxHostRequests): Hono {
  const app = new Hono();
  app.use(
    "*",
    requireManagementChangeFromOwnPage(
      async () => false,
      () => {},
    ),
  );
  mountBoxHostApi(app, { db: suite.db, host }, () => {});
  return app;
}

async function request(
  app: Hono,
  method: "GET" | "POST",
  path: string,
  options: {
    body?: unknown;
    cookie?: string;
    socket?: "tls" | "none";
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const { body, cookie = managerCookie, socket = "tls", headers = {} } = options;
  const incoming = socket === "tls" ? new TLSSocket(new Socket()) : undefined;
  if (incoming !== undefined) sockets.push(incoming);
  return app.request(
    `${URL_BASE}${path}`,
    {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    incoming === undefined ? undefined : { incoming: { socket: incoming } },
  );
}

const ROUTES: [string, RouteMethod, (app: Hono) => Promise<Response>][] = [
  ["the network read", "networkRead", (app) => request(app, "GET", "/api/box/network")],
  ["the screen read", "screenRead", (app) => request(app, "GET", "/api/box/screen")],
  ["the scan", "networkScan", (app) => request(app, "POST", "/api/box/network/scan")],
  [
    "the join",
    "networkJoin",
    (app) => request(app, "POST", "/api/box/network/join", { body: JOIN }),
  ],
  [
    "the forget",
    "networkForget",
    (app) => request(app, "POST", "/api/box/network/forget", { body: { ssidHex: JOIN.ssidHex } }),
  ],
  [
    "the screen set",
    "screenSet",
    (app) => request(app, "POST", "/api/box/screen", { body: { start: "till" } }),
  ],
];

const route = (method: RouteMethod) => ROUTES.find(([, m]) => m === method)![2];

/** Starts a scan and a network read and waits until the host has been asked both. */
async function takeBothPlaces(app: Hono, host: Host) {
  const releaseScan = hold(host, "networkScan");
  const releaseRead = hold(host, "networkRead");
  const scan = route("networkScan")(app);
  const read = route("networkRead")(app);
  await vi.waitFor(() => {
    expect(host.networkScan).toHaveBeenCalledTimes(1);
    expect(host.networkRead).toHaveBeenCalledTimes(1);
  });
  return { scan, read, releaseScan, releaseRead };
}

async function expectBusy(response: Promise<Response>): Promise<void> {
  const answered = await response;
  expect(answered.status).toBe(409);
  expect(await answered.json()).toEqual({ error: { code: "box_host.busy", params: {} } });
}

describe("two host calls at a time", () => {
  it("allows two", () => {
    expect(BOX_HOST_ROUTE_CALLS).toBe(2);
  });

  it("refuses a third and a fourth without asking the host, and takes one once a place frees", async () => {
    const host = fakeHost();
    const app = mount(host);
    const { scan, read, releaseScan, releaseRead } = await takeBothPlaces(app, host);
    try {
      await expectBusy(route("screenRead")(app));
      expect(host.screenRead).toHaveBeenCalledTimes(0);
      await expectBusy(route("networkForget")(app));
      expect(host.networkForget).toHaveBeenCalledTimes(0);
      releaseScan();
      expect((await scan).status).toBe(200);
      const screen = await route("screenRead")(app);
      expect(screen.status).toBe(200);
      expect(host.screenRead).toHaveBeenCalledTimes(1);
    } finally {
      releaseScan();
      releaseRead();
    }
    expect((await read).status).toBe(200);
  });

  it.each(ROUTES)("%s is refused while two calls are pending", async (_label, method, send) => {
    const host = fakeHost();
    const app = mount(host);
    const { scan, read, releaseScan, releaseRead } = await takeBothPlaces(app, host);
    const before = host[method].mock.calls.length;
    try {
      await expectBusy(send(app));
      expect(host[method]).toHaveBeenCalledTimes(before);
    } finally {
      releaseScan();
      releaseRead();
    }
    expect((await scan).status).toBe(200);
    expect((await read).status).toBe(200);
  });
});

describe("a place is freed whatever happens", () => {
  it.each([
    [
      "a host call that throws",
      (host: Host) => host.screenRead.mockRejectedValueOnce(new Error("x")),
      500,
    ],
    [
      "a host that is missing",
      (host: Host) =>
        host.screenRead.mockResolvedValueOnce({
          available: false,
          reason: "missing",
          detail: "ENOENT",
        }),
      409,
    ],
  ])("after %s", async (_label, setUp, status) => {
    const host = fakeHost();
    setUp(host);
    const app = mount(host);
    expect((await route("screenRead")(app)).status).toBe(status);
    const releaseScan = hold(host, "networkScan");
    const releaseRead = hold(host, "networkRead");
    const scan = route("networkScan")(app);
    await vi.waitFor(() => expect(host.networkScan).toHaveBeenCalledTimes(1));
    let readAnswered = false;
    const read = route("networkRead")(app).finally(() => (readAnswered = true));
    try {
      await vi.waitFor(() => {
        expect(host.networkRead.mock.calls.length > 0 || readAnswered).toBe(true);
      });
      await expectBusy(route("screenRead")(app));
      expect(host.screenRead).toHaveBeenCalledTimes(1);
    } finally {
      releaseScan();
      releaseRead();
    }
    expect([(await scan).status, (await read).status]).toEqual([200, 200]);
  });
});

describe("refusals take no place", () => {
  it("checks the session, the connection and the page first", async () => {
    const host = fakeHost();
    const app = mount(host);
    const { scan, read, releaseScan, releaseRead } = await takeBothPlaces(app, host);
    try {
      const supervised = await request(app, "GET", "/api/box/screen", {
        cookie: supervisorCookie,
      });
      expect(supervised.status).toBe(403);
      expect(((await supervised.json()) as { error: { code: string } }).error.code).toBe(
        "authorization.not_permitted",
      );
      const plain = await request(app, "POST", "/api/box/network/join", {
        body: JOIN,
        socket: "none",
      });
      expect(plain.status).toBe(403);
      expect(await plain.json()).toEqual({
        error: { code: "box_network.join_connection_insecure", params: { reason: "unencrypted" } },
      });
      for (const [path, body] of [
        ["/api/box/network/forget", { ssidHex: JOIN.ssidHex }],
        ["/api/box/screen", { start: "till" }],
        ["/api/box/network/scan", undefined],
      ] as const) {
        const otherPort = await request(app, "POST", path, {
          body,
          headers: { origin: `${URL_BASE}:8443` },
        });
        expect(otherPort.status).toBe(403);
        expect(await otherPort.json()).toEqual({
          error: { code: "management.origin_refused", params: {} },
        });
      }
      expect(host.screenRead).toHaveBeenCalledTimes(0);
      expect(host.networkJoin).toHaveBeenCalledTimes(0);
      expect(host.networkForget).toHaveBeenCalledTimes(0);
      expect(host.screenSet).toHaveBeenCalledTimes(0);
      expect(host.networkScan).toHaveBeenCalledTimes(1);
    } finally {
      releaseScan();
      releaseRead();
    }
    expect((await scan).status).toBe(200);
    expect((await read).status).toBe(200);
  });
});

describe("no database lock around the host", () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = () =>
    new Promise<string>((resolve) => (timer = setTimeout(() => resolve("timed out"), 1000)));

  it.each([
    ["a write lock", () => suite.db.withWriteLock(async () => "granted")],
    ["a transaction", () => withTransaction(suite.db, async () => "granted")],
  ])("%s is granted while a join is pending", async (_label, take) => {
    const host = fakeHost();
    const release = hold(host, "networkJoin");
    const app = mount(host);
    const joined = route("networkJoin")(app);
    try {
      await vi.waitFor(() => expect(host.networkJoin).toHaveBeenCalledTimes(1));
      expect(await Promise.race([take(), timedOut()])).toBe("granted");
    } finally {
      clearTimeout(timer);
      release();
    }
    expect((await joined).status).toBe(200);
  });
});
