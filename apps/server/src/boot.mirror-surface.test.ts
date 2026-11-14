import { seedModuleSettings } from "../test/module-settings.js";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  locations,
  nodes,
  stampDeployment,
  tenants,
  withNodeTransaction,
} from "@waitron/db";
import { loadKeyRing, sealNodeSigningKeyTx } from "@waitron/credentials";
import { generateNodeKeyPair } from "@waitron/membership";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer, StartServerSeams } from "./boot.js";
import { serverFixture } from "./testing/server-fixture.js";
import { fakeMdnsSocket } from "./testing/fake-mdns-socket.js";
import { writeTlsSet } from "./testing/box-tls.js";
import { writePendingAdoption, type PendingAdoption } from "./finish-adoption.js";
import { mintSelfSignedServerCert, reissueServerLeaf } from "./self-signed-cert.js";
import { CONNECTION_TEXT } from "./connection-bootstrap-strings.js";
import { leafHostnamesFor } from "./box-name.js";
import { resetObserver } from "./testing/connection-reset.js";
import { beginHandover } from "./handover-store.js";

const served = vi.hoisted(() => [] as { port: number; server: import("node:net").Server }[]);
const fetchWrap = vi.hoisted(() => ({
  wrap: <T>(fetch: T): T => fetch,
}));

vi.mock("@hono/node-server", async () => {
  const actual = await vi.importActual<typeof import("@hono/node-server")>("@hono/node-server");
  return {
    ...actual,
    serve: (
      options: Parameters<typeof actual.serve>[0],
      onListen: Parameters<typeof actual.serve>[1],
    ) => {
      const server = actual.serve(
        { ...options, fetch: fetchWrap.wrap(options.fetch), port: 0 },
        onListen,
      );
      served.push({ port: options.port ?? 0, server: server as import("node:net").Server });
      return server;
    },
  };
});

const { startServer } = serverFixture();
const reset = resetObserver();
fetchWrap.wrap = reset.wrap as typeof fetchWrap.wrap;

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

const LOCATION = "b8000000-0000-4000-8000-000000000001";
const NODE = "b8000000-0000-4000-8000-000000000002";
const ORIGIN = "b8000000-0000-4000-8000-000000000003";
const SERIES = "b8000000-0000-4000-8000-000000000004";
const MADE_UP = "b8000000-0000-4000-8000-0000000000ff";
// Never bound: the mock binds port 0 and keeps the configured number to tell the listeners apart.
const HTTP_PORT = 18443;
const LANDING_PORT = 18080;

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

let migrationsRoot: string;

beforeAll(async () => {
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-surface-migrations-"));
  for (const [index, set] of manifestSets().entries())
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
});

afterAll(async () => {
  await rm(migrationsRoot, { recursive: true, force: true });
});

type Start = "mirror" | "mirror-zone-repair" | "latch" | "primary" | "primary-zone-repair";

const LATCH: PendingAdoption = {
  originNodeId: ORIGIN,
  standby: { nodeId: NODE, publicKey: "synthetic-public" },
  nodeName: "Spare",
  filingModule: "none",
  taxModule: "vat",
  reserved: { modules: { "fiscal-none": {} }, series: [], endorsement: {} as never },
};

async function seedVenue(): Promise<void> {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90222222J", legalName: "Surface SL" });
  await suite.db.insert(locations).values({ id: LOCATION });
  await seedVenueSettings(suite.db, {
    name: "Venue",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
  });
  await seedBusinessDay(suite.db, {});
}

/** Seeds the venue for `start` and boots it; `fromBox`, when given, decides who each request is
 * from in place of the connection's address. */
async function boot(
  start: Start,
  options: { landing?: boolean; fromBox?: { current: boolean } },
): Promise<{ server: StartedServer; app: Hono; stateDir: string }> {
  await seedVenue();
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-surface-state-"));
  const own = mintSelfSignedServerCert({
    hostnames: ["waitron.local"],
    ipAddresses: [],
    now: new Date(),
  });
  await writeTlsSet(stateDir, own);
  const setupApp = join(stateDir, "setup");
  await mkdir(join(setupApp, "assets"), { recursive: true });
  await writeFile(join(setupApp, "index.html"), "<main>Handover fixture</main>");
  await writeFile(join(setupApp, "assets", "app.js"), "");
  await withNodeTransaction(suite.node, (tx) =>
    sealNodeSigningKeyTx(tx, loadKeyRing(KEY_ENV), NODE, generateNodeKeyPair().privateKey),
  );
  if (start === "latch") {
    await suite.db.insert(nodes).values({
      id: ORIGIN,
      name: "Main",
      filingModule: "none",
      taxModule: "vat",
    });
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode({ venue: suite.db, node: suite.node }, NODE, "mirror");
    await seedModuleSettings(suite.db, { "fiscal-verifactu": false });
    await writePendingAdoption(stateDir, LATCH);
  } else {
    await suite.db.insert(nodes).values({ id: NODE, name: "Node" });
    await suite.db.insert(invoiceSeries).values({ id: SERIES, nodeId: NODE, code: "A" });
    await stampDeployment(suite.db, "preproduction");
    await seedModuleSettings(suite.db, { "fiscal-none": false });
    if (start === "mirror" || start === "mirror-zone-repair") {
      await setNodeMode({ venue: suite.db, node: suite.node }, NODE, "mirror");
      await writeMirrorLink(suite.node, NODE, {
        originUrl: "http://127.0.0.1:1/",
        boxHostname: "main-box.local",
        boxCaPem: own.caCertPem,
        originNodeId: ORIGIN,
      });
    }
    if (start.endsWith("zone-repair"))
      await suite.db.execute(
        sql`update settings set doc = json_set(doc, '$.timeZone', 'Invalid/Zone') where module = 'business_day'`,
      );
  }
  return { ...(await startOn(stateDir, options)), stateDir };
}

/** Starts the server on the venue already seeded and on `stateDir`, as a restart of the box does. */
async function startOn(
  stateDir: string,
  options: { landing?: boolean; fromBox?: { current: boolean } },
): Promise<{ server: StartedServer; app: Hono }> {
  const setupApp = join(stateDir, "setup");
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  let app: Hono | undefined;
  const mdns = fakeMdnsSocket();
  const seams: StartServerSeams = {
    observeApp: (observed) => (app = observed),
    ...(options.fromBox === undefined
      ? {}
      : {
          requestFromBox: () => options.fromBox!.current,
          requestProvenFromBox: () => options.fromBox!.current,
        }),
    mdnsSocket: () => mdns.socket,
  };
  served.splice(0);
  const server = await startServer(
    {
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: stateDir,
      WAITRON_LOG_DIR: join(stateDir, "logs"),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_HTTP_HOST: "0.0.0.0",
      WAITRON_HTTP_PORT: String(HTTP_PORT),
      WAITRON_HTTP_LANDING_PORT: options.landing === true ? String(LANDING_PORT) : "0",
      WAITRON_NODE_ID: NODE,
      ...KEY_ENV,
      WAITRON_ENV: "preproduction",
      WAITRON_SETUP_APP_DIR: setupApp,
    },
    {},
    seams,
  );
  return { server, app: app! };
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const OWN_HOST = `127.0.0.1:${HTTP_PORT}`;
const OWN_ORIGIN = `https://${OWN_HOST}`;

/** Every method and concrete path the app's routes name, each param filled with a made-up value. */
function walkTargets(app: Hono): { method: string; path: string }[] {
  const targets = new Map<string, { method: string; path: string }>();
  const add = (method: string, path: string) => targets.set(`${method} ${path}`, { method, path });
  for (const route of app.routes) {
    if (route.path === "*" || route.path === "/*") continue;
    const path =
      route.path === "/help/:lang/:page"
        ? "/help/en/products"
        : route.path.replace(/:[^/{]+(\{[^}]*\})?/g, MADE_UP).replace(/\*$/, "x");
    const methods = route.method === "ALL" ? ["GET", "POST"] : [route.method];
    for (const method of methods) {
      add(method, path);
      add("OPTIONS", path);
    }
  }
  for (const path of ["/", "/manage", "/manage/staff", "/handover/assets/app.js"]) add("GET", path);
  return [...targets.values()].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

interface Answer {
  status: number;
  code?: string;
}

async function answerOf(app: Hono, method: string, path: string): Promise<Answer> {
  // An `Origin` and `Host` the connection writes accept, so only who sent them can refuse them.
  const headers = SAFE.has(method) ? undefined : { origin: OWN_ORIGIN, host: OWN_HOST };
  const response = await app.request(`${OWN_ORIGIN}${path}`, { method, headers });
  const text = await response.text();
  // Whether `/health` answers 200 or 503 depends on the start's passes, not on the gates.
  if (path === "/health" && response.status === 503 && method === "GET") return { status: 200 };
  let code: string | undefined;
  try {
    const body = JSON.parse(text) as { error?: string | { code?: string } };
    code = typeof body.error === "string" ? body.error : body.error?.code;
  } catch {
    code = undefined;
  }
  return code === undefined ? { status: response.status } : { status: response.status, code };
}

// D8 item 1 (docs/superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md): a mirror's open reads.
const OPEN_READS: Record<string, Answer> = {
  "/health": { status: 200 },
  "/help/en/products": { status: 200 },
  "/help/x": { status: 404 },
  "/legal": { status: 404 },
  "/legal/about": { status: 200 },
  "/legal/declaration": { status: 404 },
  "/legal/declaration.pdf": { status: 404 },
  "/legal/declaration.txt": { status: 404 },
  [`/legal/declaration/${MADE_UP}`]: { status: 404 },
  "/legal/x": { status: 404 },
  "/public/availability": { status: 503 },
  "/public/menu": { status: 503 },
  "/public/menu/x": { status: 404 },
  "/api/node": { status: 200 },
  [`/api/node/handover/${MADE_UP}`]: { status: 404, code: "handover.operation_unknown" },
  "/": { status: 200 },
  "/manage": { status: 200 },
  "/manage/staff": { status: 200 },
  "/manage/x": { status: 200 },
  "/setup/trust": { status: 200 },
  "/setup/connection": { status: 200 },
  "/ca.crt": { status: 200 },
  "/setup-api/ca.crt": { status: 200 },
  "/handover/x": { status: 404 },
  "/handover/assets/app.js": { status: 200 },
};

const MIRROR_WRITES: Record<string, Answer> = {
  "/api/node/peer-status": { status: 400, code: "handover.request_invalid" },
  "/api/node/membership": { status: 200 },
  "/management-api/promote": { status: 403, code: "promotion.from_box_only" },
  "/management-api/promote/preparation": { status: 403, code: "promotion.from_box_only" },
  "/api/node/handover/offer": { status: 400, code: "handover.request_invalid" },
  [`/api/node/handover/${MADE_UP}/preparation`]: {
    status: 403,
    code: "authorization.not_permitted",
  },
  [`/api/node/handover/${MADE_UP}/activate`]: { status: 403, code: "authorization.not_permitted" },
  "/api/node/handover/emergency/declare": { status: 403, code: "authorization.not_permitted" },
  "/api/node/handover/emergency/preview": { status: 403, code: "authorization.not_permitted" },
  "/api/node/backup-settings": { status: 400, code: "spare.settings_invalid" },
  "/setup-api/connection/repair": { status: 403, code: "connection.refused" },
  "/setup-api/connection/continue": { status: 403, code: "connection.refused" },
};

const GATE_PASSES = (path: string) =>
  path === "/api/node" ||
  /^\/api\/node\/handover\/[^/]+$/.test(path) ||
  /^\/handover\/[^/]+$/.test(path);

function mirrorExpected(method: string, path: string): Answer {
  if (path === "/public/menu")
    return { status: SAFE.has(method) && method !== "OPTIONS" ? 503 : 405 };
  if (path === "/public/menu/x") return { status: 404 };
  if (SAFE.has(method)) {
    if (method === "GET" && OPEN_READS[path] !== undefined) return OPEN_READS[path];
    if (method === "OPTIONS" && GATE_PASSES(path)) return { status: 404 };
    return { status: 403, code: "node.spare" };
  }
  return MIRROR_WRITES[path] ?? { status: 403, code: "node.read_only" };
}

async function walk(app: Hono, expectedOf: (method: string, path: string) => Answer) {
  const actual: string[] = [];
  const expected: string[] = [];
  for (const { method, path } of walkTargets(app)) {
    actual.push(`${method} ${path} ${JSON.stringify(await answerOf(app, method, path))}`);
    expected.push(`${method} ${path} ${JSON.stringify(expectedOf(method, path))}`);
  }
  expect(actual).toEqual(expected);
}

const LATCH_ANSWERS: Record<string, Answer> = {
  "GET /health": { status: 200 },
  "GET /api/box/status": { status: 200 },
  "POST /api/node/peer-status": { status: 400, code: "handover.request_invalid" },
  "POST /api/node/membership": { status: 200 },
  "POST /setup-api/connection/repair": { status: 403, code: "connection.refused" },
  "POST /setup-api/connection/continue": { status: 403, code: "connection.refused" },
  "GET /help/en/products": { status: 200 },
  "GET /help/x": { status: 404 },
  "GET /legal/about": { status: 200 },
  "GET /public/availability": { status: 503 },
  "GET /public/menu": { status: 503 },
  "GET /public/menu/x": { status: 404 },
  "POST /public/menu": { status: 405 },
  "OPTIONS /public/menu": { status: 405 },
  "POST /public/menu/x": { status: 404 },
  "GET /setup/trust": { status: 200 },
  "GET /setup/connection": { status: 200 },
  "GET /ca.crt": { status: 200 },
  "GET /setup-api/ca.crt": { status: 200 },
};

async function listenerFor(port: number): Promise<AddressInfo> {
  const listener = served.find((entry) => entry.port === port);
  if (listener === undefined) throw new Error(`no listener was started for ${port}`);
  if (!listener.server.listening) await once(listener.server, "listening");
  return listener.server.address() as AddressInfo;
}

async function landingAddress(): Promise<string> {
  return (await listenerFor(LANDING_PORT)).address;
}

const REPAIR_REQUEST =
  `POST /setup-api/connection/repair HTTP/1.1\r\nHost: ${OWN_HOST}\r\n` +
  `Origin: ${OWN_ORIGIN}\r\nContent-Length: 0\r\n\r\n`;

/** A repair over a kept connection from this machine to the real HTTPS listener. */
async function repairOverLoopback(port: number): Promise<number> {
  const request = httpsRequest({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: "/setup-api/connection/repair",
    headers: { host: OWN_HOST, origin: OWN_ORIGIN, "content-length": "0" },
    rejectUnauthorized: false,
  });
  request.end();
  const [response] = (await once(request, "response")) as [import("node:http").IncomingMessage];
  response.resume();
  return response.statusCode!;
}

async function repair(app: Hono): Promise<Answer> {
  return answerOf(app, "POST", "/setup-api/connection/repair");
}

describe("a spare's network surface", () => {
  it("a mirror serves the network only what D8 lists", async () => {
    const { server, app, stateDir } = await boot("mirror", { fromBox: { current: false } });
    try {
      await walk(app, mirrorExpected);
      expect(suite.node.all(sql`select * from node_handover_operations`)).toEqual([]);
      const settings = await app.request(`${OWN_ORIGIN}/api/node/backup-settings`, {
        method: "POST",
        headers: { origin: OWN_ORIGIN, host: OWN_HOST },
      });
      expect([settings.status, await settings.json()]).toEqual([
        400,
        { error: { code: "spare.settings_invalid", params: { reason: "envelope" } } },
      ]);
      expect(existsSync(join(stateDir, "backup.env"))).toBe(false);
      for (const path of ["/", "/manage", "/manage/staff"])
        expect(await (await app.request(path)).text()).toContain(
          "Restaurant screens are closed here",
        );
      expect(await (await app.request("/api/node")).json()).toMatchObject({
        acceptingSales: false,
      });
      expect(await (await app.request("/public/availability")).json()).toEqual({
        available: false,
      });
      expect(await (await app.request("/ca.crt")).text()).toBe(
        await readFile(join(stateDir, "tls", "ca.crt"), "utf8"),
      );
      expect(await (await app.request("/help/en/products")).text()).toContain("<h1>");
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a mirror repairing its time zone serves the network no more than a full start", async () => {
    const { server, app, stateDir } = await boot("mirror-zone-repair", {
      fromBox: { current: false },
    });
    try {
      // The repair start's gate refuses these two before they reach the route a full start opens.
      const stricter = new Set(["OPTIONS /api/node", "GET /handover/assets/app.js"]);
      await walk(app, (method, path) =>
        stricter.has(`${method} ${path}`)
          ? { status: 409, code: "venue.time_zone_not_ready" }
          : mirrorExpected(method, path),
      );
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a mirror serves the network the handover page of its own destination operation", async () => {
    const { server, app, stateDir } = await boot("mirror", { fromBox: { current: false } });
    try {
      const operationId = "b8000000-0000-4000-8000-000000000005";
      await beginHandover(
        { node: suite.node, nodeId: NODE },
        {
          operationId,
          scenario: "controlled",
          venue: { country: "ES", taxId: "90222222J", environment: "preproduction" },
          sourceNodeId: ORIGIN,
          destinationNodeId: NODE,
          membership: { term: 1, digest: "0".repeat(64) },
        },
        "destination",
      );
      const page = await app.request(`/handover/${operationId}`, {
        headers: { accept: "text/html" },
      });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Handover fixture");
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a joining spare serves the network only what D8 item 7 lists", async () => {
    const { server, app, stateDir } = await boot("latch", { fromBox: { current: false } });
    try {
      await walk(app, (method, path) => LATCH_ANSWERS[`${method} ${path}`] ?? { status: 404 });
      for (const path of ["/", "/manage", "/api/node", "/management-api/catalogues"])
        expect((await app.request(path)).status).toBe(404);
      expect(await (await app.request("/api/box/status")).json()).toEqual({ adoption: "pending" });
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it.each<[Start, string]>([
    ["mirror", "127.0.0.1"],
    ["mirror-zone-repair", "127.0.0.1"],
    ["latch", "127.0.0.1"],
    ["primary", "0.0.0.0"],
    ["primary-zone-repair", "0.0.0.0"],
  ])(
    "a spare's landing listener is on loopback only: the %s start binds %s",
    async (start, host) => {
      const { server, stateDir } = await boot(start, {
        landing: true,
        fromBox: { current: false },
      });
      try {
        expect(await landingAddress()).toBe(host);
      } finally {
        await server.close();
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.each<Start>(["mirror", "latch"])(
    "a spare's connection repair answers only the box itself: the %s start",
    async (start) => {
      const fromBox = { current: false };
      const { server, app, stateDir } = await boot(start, { fromBox });
      try {
        const before = await readFile(join(stateDir, "tls", "server.pem"));
        expect(await repair(app)).toEqual({ status: 403, code: "connection.refused" });
        expect(await readFile(join(stateDir, "tls", "server.pem"))).toEqual(before);
        fromBox.current = true;
        expect(await repair(app)).toEqual({ status: 200 });
      } finally {
        await server.close();
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.each<Start>(["mirror", "latch"])(
    "a spare refuses a connection repair whose client reset before it ran: the %s start",
    async (start) => {
      const { server, stateDir } = await boot(start, {});
      try {
        const { port } = await listenerFor(HTTP_PORT);
        const before = await readFile(join(stateDir, "tls", "server.pem"));
        const answer = await reset.sendThenReset(port, REPAIR_REQUEST, { tls: true });
        expect([answer.status, JSON.parse(answer.body)]).toEqual([
          403,
          { error: "connection.refused" },
        ]);
        expect(await readFile(join(stateDir, "tls", "server.pem"))).toEqual(before);
        expect(await repairOverLoopback(port)).toBe(200);
      } finally {
        await server.close();
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.each<Start>(["mirror", "latch"])(
    "a restart repairs the connection of a spare whose certificate lacks its address: the %s start",
    async (start) => {
      const fromBox = { current: false };
      const first = await boot(start, { fromBox });
      const { stateDir } = first;
      let running: StartedServer | undefined = first.server;
      const page = async (app: Hono) => {
        const html = await (await app.request("/setup/connection")).text();
        return {
          state: /data-connection-state="([^"]+)"/.exec(html)?.[1],
          status: /<p id="connection-status"[^>]*>([^<]*)<\/p>/.exec(html)?.[1],
        };
      };
      try {
        expect((await page(first.app)).state).toBe("healthy");
        const tls = join(stateDir, "tls");
        const leaf = reissueServerLeaf({
          caCertPem: await readFile(join(tls, "ca.crt"), "utf8"),
          caKeyPem: await readFile(join(tls, "ca.key"), "utf8"),
          hostnames: leafHostnamesFor(NODE),
          ipAddresses: [],
          now: new Date(),
        });
        await writeFile(join(tls, "server.pem"), leaf.serverCertPem + leaf.serverKeyPem);
        expect(await page(first.app)).toEqual({
          state: "repair-required",
          status: CONNECTION_TEXT.en.serverOnly,
        });
        await running.close();
        running = undefined;
        // In this fixture the joining start's latch is finished, as a real spare's never is yet.
        if (start === "latch") await writePendingAdoption(stateDir, LATCH);
        const again = await startOn(stateDir, { fromBox });
        running = again.server;
        expect(await page(again.app)).toEqual({ state: "healthy", status: "Certificate ready." });
      } finally {
        await running?.close();
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("a main box's connection repair is served from another address, as before", async () => {
    const { server, app, stateDir } = await boot("primary", { fromBox: { current: false } });
    try {
      expect(await repair(app)).toEqual({ status: 200 });
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);
});
