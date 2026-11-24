import { PAYMENTS_SETTINGS } from "@waitron/payments";
import { saveSettings } from "@waitron/db";
import { copyMigrationsRoot, tradingBootEnv } from "./testing/boot-trading-fixture.js";
import { useTestProducer } from "./testing/test-producer.js";
import { DEV_DEVICE_HEADER, DEVICE_COOKIE } from "./device-session.js";
import { seedModuleSettings } from "../test/module-settings.js";
import * as cloudClient from "./cloud-client.js";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { mkdir, copyFile, symlink } from "node:fs/promises";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { serve } from "@hono/node-server";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  menus,
  saveCloudVenueId,
  withTransaction,
  workingOrderLines,
  ticketItems,
} from "@waitron/db";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { offerProducts } from "./testing/zone-offers.js";
import { createOpenOrder } from "./working-order-open.js";
import { fireableLineColumns, fireLines } from "./working-order-kitchen-fire.js";
import { holdChartNamingMainBox } from "./testing/membership-doc-fixture.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartServerSeams, StartedServer } from "./boot.js";
import type { BoxHostRequests, HostUnavailable } from "./box-host-client.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import { MONEY_AND_DRAWER_WRITES } from "./restricted-start.js";
import { sessionHolding } from "./testing/session-holding.js";

const served = vi.hoisted(() => ({
  listeners: [] as {
    fetch: (request: Request, env?: unknown) => Promise<Response>;
    server: ReturnType<typeof serve>;
  }[],
  fetch: undefined as
    ((request: Request, env: { incoming: { socket: unknown } }) => Promise<Response>) | undefined,
}));

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  const mocked = await ephemeralHttpMock();
  return {
    ...mocked,
    serve: (options: Parameters<typeof serve>[0], onListen: Parameters<typeof serve>[1]) => {
      served.fetch = options.fetch as typeof served.fetch;
      const server = mocked.serve(options, onListen);
      served.listeners.push({ fetch: options.fetch as never, server });
      return server;
    },
  };
});

const { startServer, httpPort } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

const REFUSED = { error: { code: "management.origin_refused", params: {} } };
const TRUSTED = "https://till.example.test";

function fakeHost() {
  const refused = async (): Promise<HostUnavailable<never>> => ({
    available: false,
    reason: "missing",
    detail: "ENOENT",
  });
  return {
    networkRead: vi.fn<BoxHostRequests["networkRead"]>(refused),
    networkScan: vi.fn<BoxHostRequests["networkScan"]>(refused),
    networkJoin: vi.fn<BoxHostRequests["networkJoin"]>(refused),
    networkForget: vi.fn<BoxHostRequests["networkForget"]>(refused),
    screenRead: vi.fn<BoxHostRequests["screenRead"]>(refused),
    screenSet: vi.fn<BoxHostRequests["screenSet"]>(async () => ({
      available: true,
      start: "till",
    })),
    tagWrite: vi.fn<BoxHostRequests["tagWrite"]>(refused),
  } satisfies BoxHostRequests;
}

interface Started {
  venue: Venue;
  host: ReturnType<typeof fakeHost>;
  app: Hono;
  /** Stands in for the SIGTERM, so no route can stop the test process. */
  restart: ReturnType<typeof vi.fn<() => void>>;
}

/** Starts the whole server over the suite's venue; the venue is written before the start only. */
async function withServer(
  env: Record<string, string>,
  body: (started: Started) => Promise<void>,
  beforeStart?: (venue: Venue) => Promise<void>,
): Promise<void> {
  served.listeners = [];
  const venue = await setupVenue(suite.db);
  const host = fakeHost();
  const restart = vi.fn<() => void>();
  let seen: Hono | undefined;
  const seams: StartServerSeams = {
    boxHostRequests: host,
    restart,
    requestFromBox: () => false,
    observeApp: (app) => {
      seen = app;
    },
  };
  const [port] = await freePorts(1);
  let scratch: string | undefined;
  let server: StartedServer | undefined;
  let cloud: Awaited<ReturnType<typeof installationFixture>> | undefined;
  let origin: ReturnType<typeof vi.spyOn> | undefined;
  try {
    scratch = await mkdtemp(join(tmpdir(), "waitron-boot-management-origin-"));
    const migrationsRoot = join(scratch, "migrations");
    await copyMigrationsRoot(migrationsRoot);
    await seedModuleSettings(suite.db, { "fiscal-none": false });
    const full = {
      ...tradingBootEnv(suite.db, scratch, venue.cfg.nodeId, migrationsRoot),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MANAGEMENT_ORIGIN: TRUSTED,
      ...env,
    };
    if (env.WAITRON_STAFF_PORT) {
      cloud = await installationFixture(undefined, {
        remoteAccess: () => ({
          state: "ready",
          configuration: { staffHostname: "staff.example.test" },
        }),
      });
      await cloud.client.refresh();
      await withTransaction(suite.db, (tx) => saveCloudVenueId(tx, cloud!.venueId));
      origin = vi.spyOn(cloudClient, "loadCloudOrigin").mockReturnValue(cloud.options.origin);
      Object.assign(full, { WAITRON_CLOUD_ORIGIN: cloud.options.origin });
      const material = mintSelfSignedServerCert({
        now: new Date(),
        hostnames: ["staff.example.test"],
        ipAddresses: [],
      });
      await mkdir(join(scratch, "cloud"), { recursive: true });
      await writeFile(join(scratch, "cloud/staff.key"), material.serverKeyPem);
      await mkdir(join(scratch, "cloud"), { recursive: true });
      await writeFile(join(scratch, "cloud/staff.crt"), material.serverCertPem);
      const source = join(cloud.stateDir, "cloud/connection.json");
      await copyFile(source, join(scratch, "cloud/connection.json"));
      await rm(source);
      await symlink(join(scratch, "cloud/connection.json"), source);
    }
    await beforeStart?.(venue);
    server = await startServer(full, full, seams);
    await vi.waitFor(async () => {
      expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
    });
    if (seen === undefined) throw new Error("boot did not hand the test its app");
    await body({ venue, host, app: seen, restart });
  } finally {
    if (server !== undefined) await server.close();
    origin?.mockRestore();
    await cloud?.close();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  }
}

const url = (path: string) => `http://127.0.0.1:${httpPort()}${path}`;
const otherPort = () => `http://127.0.0.1:${httpPort() + 1}`;

describe("the card-provider notice in the running server", () => {
  it("starts a Prepare box on test accounts when the choice was saved", async () => {
    await withServer(
      { WAITRON_ONBOARDING_INTENT: "prepare" },
      async ({ venue }) => {
        const response = await fetch(url("/management-api/session/me"), {
          headers: { cookie: venue.managerCookie },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ simulatedCardPayments: false });
      },
      async () => {
        await withTransaction(suite.db, (tx) =>
          saveSettings(tx, PAYMENTS_SETTINGS, {
            doc: { ...PAYMENTS_SETTINGS.defaults(), testProviders: true },
            expectedRevision: 0,
            personId: null,
          }),
        );
      },
    );
  });

  it("switches new practice collections and the dashboard notice without restarting", async () => {
    await withServer({ WAITRON_ONBOARDING_INTENT: "prepare" }, async ({ venue }) => {
      const cookie = venue.managerCookie;
      const get = async (path: string) => {
        const response = await fetch(url(path), { headers: { cookie } });
        expect(response.status).toBe(200);
        return response.json();
      };
      const notice = () => get("/management-api/session/me");
      const till = () => get("/api/till");
      const save = async (testProviders: boolean, revision: number) => {
        const response = await fetch(url("/management-api/payments/settings"), {
          method: "PUT",
          headers: { cookie, origin: TRUSTED, "content-type": "application/json" },
          body: JSON.stringify({ tipsEnabled: false, testProviders, revision }),
        });
        expect(await answerOf(response)).toMatchObject({
          status: 200,
          body: { testProvidersAvailable: true },
        });
      };

      expect(await notice()).toMatchObject({ simulatedCardPayments: true });
      const before = await till();
      expect(before).toMatchObject({ cardProvider: "simulator" });
      await save(true, 0);
      expect(await notice()).toMatchObject({ simulatedCardPayments: false });
      const after = await till();
      expect(after).toMatchObject({ cardProvider: "none" });
      expect(after.setupRevision).not.toBe(before.setupRevision);
      await save(false, 1);
      expect(await notice()).toMatchObject({ simulatedCardPayments: true });
      expect(await till()).toMatchObject({
        cardProvider: "simulator",
        setupRevision: before.setupRevision,
      });
    });
  });
});

async function answerOf(response: Response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: text };
  }
}

function menuNamed(name: string) {
  return suite.db.select().from(menus).where(eq(menus.name, name)).all();
}

it("offers a local download without a Cloud report preview on an unlinked box", async () => {
  await withServer({}, async ({ app, venue }) => {
    const response = await app.request("/management-api/problem-reports/preview", {
      headers: { cookie: venue.staffCookie },
    });
    expect(await answerOf(response)).toEqual({ status: 200, body: { available: false } });
  });
});

describe("a management change in the running server", () => {
  it("refuses a change from another port of the box's own address, for a signed-in manager", async () => {
    await withServer({}, async ({ venue, host, restart }) => {
      const sends: [string, string | undefined][] = [
        ["/api/box/free-space", undefined],
        ["/api/box/retire", undefined],
        ["/api/box/restart", undefined],
        ["/management-api/session/me/fresh-sign-in", "{}"],
        ["/management-api/session/me/fresh-sign-in/passkey-options", "{}"],
        ["/api/box/clock-challenge", undefined],
        ["/api/box/clock-set", "{}"],
        ["/api/box/clock-confirm", "{}"],
        ["/api/box/screen", JSON.stringify({ start: "till" })],
        ["/management-api/menus", JSON.stringify({ name: "From another page" })],
        ["/print-api/agent/jobs", undefined],
      ];
      const answers: Record<string, unknown> = {};
      for (const [path, body] of sends) {
        answers[`POST ${path}`] = await answerOf(
          await fetch(url(path), {
            method: "POST",
            headers: {
              cookie: venue.managerCookie,
              origin: otherPort(),
              "sec-fetch-site": "same-site",
              "content-type": "text/plain;charset=UTF-8",
            },
            ...(body === undefined ? {} : { body }),
          }),
        );
      }
      expect(answers).toEqual(
        Object.fromEntries(sends.map(([path]) => [`POST ${path}`, { status: 403, body: REFUSED }])),
      );
      expect(menuNamed("From another page")).toEqual([]);
      expect(host.screenSet).toHaveBeenCalledTimes(0);
      expect(restart).not.toHaveBeenCalled();
    });
  });

  it("takes a change from every page that is the box's own", async () => {
    await withServer({}, async ({ venue }) => {
      const own = `http://127.0.0.1:${httpPort()}`;
      const rows: [string, Record<string, string>][] = [
        ["the box's own page", { origin: own, "sec-fetch-site": "same-origin" }],
        ["the dashboard on managementOrigin", { origin: TRUSTED, "sec-fetch-site": "same-origin" }],
        ["a page on the management origin", { origin: TRUSTED, "sec-fetch-site": "cross-site" }],
        ["a tool sending neither header", {}],
        ["a page the person opened themselves", { origin: own, "sec-fetch-site": "none" }],
      ];
      const answers: Record<string, number> = {};
      for (const [name, headers] of rows) {
        const response = await fetch(url("/management-api/menus"), {
          method: "POST",
          headers: { cookie: venue.managerCookie, "content-type": "application/json", ...headers },
          body: JSON.stringify({ name }),
        });
        await response.body?.cancel();
        answers[name] = response.status;
      }
      expect(answers).toEqual(Object.fromEntries(rows.map(([name]) => [name, 201])));
      for (const [name] of rows) expect(menuNamed(name)).toHaveLength(1);
    });
  });

  it("in dev mode, takes the dev till's and setup app's writes through an HTTPS proxy", async () => {
    await withServer({ WAITRON_ENV: "dev" }, async ({ venue }) => {
      const ports = [
        process.env.WAITRON_TILL_VITE_PORT || "5190",
        process.env.WAITRON_SETUP_VITE_PORT || "5192",
      ];
      const withCookie: Record<string, unknown> = {};
      const without: Record<string, unknown> = {};
      for (const port of ports) {
        const headers = { origin: `http://localhost:${port}`, "sec-fetch-site": "same-origin" };
        const ask = async (sent: Record<string, string>) => {
          const socket = new Socket();
          try {
            return await answerOf(
              await served.fetch!(
                new Request(`https://localhost:${port}/api/session`, {
                  method: "POST",
                  headers: sent,
                }),
                { incoming: { socket } },
              ),
            );
          } finally {
            socket.destroy();
          }
        };
        withCookie[port] = await ask({ cookie: venue.managerCookie, ...headers });
        expect(await ask({ cookie: `waitron_device=${randomUUID()}`, ...headers })).toEqual(
          await ask(headers),
        );
        without[port] = await ask(headers);
      }
      expect(withCookie).toEqual(without);
      for (const port of ports) {
        expect(withCookie[port]).not.toEqual({ status: 403, body: REFUSED });
      }
    });
  });

  it("refuses the attack on every write route the main app registers", async () => {
    await withServer({}, async ({ app }) => {
      const id = randomUUID();
      const writes = [
        ...new Set(
          app.routes
            .filter((route) => ["POST", "PUT", "PATCH", "DELETE"].includes(route.method))
            .map((route) => `${route.method} ${route.path}`),
        ),
      ];
      expect(writes).toEqual(
        expect.arrayContaining([
          "POST /management-api/menus",
          "POST /api/box/free-space",
          "POST /api/box/screen",
        ]),
      );
      const uncovered: string[] = [];
      for (const [cookieName, code] of [
        ["waitron_management_session", "management.origin_refused"],
        ["waitron_till_session", "till.origin_refused"],
        ["waitron_device", "till.origin_refused"],
      ]) {
        for (const write of writes) {
          const [method, path] = write.split(" ") as [string, string];
          const concrete = path
            .split("/")
            .map((segment) => (segment.startsWith(":") ? id : segment === "*" ? "x" : segment))
            .join("/");
          const answer = await answerOf(
            await fetch(url(concrete), {
              method,
              headers: {
                cookie: `${cookieName}=${randomUUID()}`,
                origin: otherPort(),
                "sec-fetch-site": "same-site",
              },
            }),
          );
          const refused =
            answer.status === 403 &&
            JSON.stringify(answer.body) === JSON.stringify({ error: { code, params: {} } });
          if (!refused) uncovered.push(`${cookieName}: ${write}`);
        }
      }
      expect(uncovered).toEqual([]);
    });
  });
});

it("every money or drawer write the restricted start refuses is a POST the full start serves", async () => {
  await withServer({}, async ({ app }) => {
    const posts = new Set(
      app.routes.filter((route) => route.method === "POST").map((route) => route.path),
    );
    expect(MONEY_AND_DRAWER_WRITES.filter((path) => !posts.has(path))).toEqual([]);
  });
});

it("boots and closes a separate staff entrance over the real dashboard API", async () => {
  const [port] = await freePorts(1);
  await withServer(
    { WAITRON_STAFF_HOST: "127.0.0.1", WAITRON_STAFF_PORT: String(port) },
    async ({ venue }) => {
      expect(served.listeners).toHaveLength(2);
      const remote = served.listeners[0]!;
      const response = await remote.fetch(
        new Request("https://staff.example.test/management-api/session/me", {
          headers: { cookie: venue.managerCookie },
        }),
      );
      expect(response.status).toBe(200);
      const local = await served.listeners[1]!.fetch(
        new Request("http://localhost/management-api/session/me", {
          headers: { cookie: venue.managerCookie },
        }),
      );
      const localBody = (await local.json()) as { personId: string };
      expect(await response.json()).toMatchObject({
        personId: localBody.personId,
        roleIds: [
          (
            await suite.db.execute<{ id: string }>(
              sql`select id from roles where built_in_key = 'manager'`,
            )
          ).rows[0]!.id,
        ],
      });
      for (const path of [
        "/setup-api/status",
        "/api/session",
        "/print-api/agent/jobs",
        "/device-api/start",
      ]) {
        expect(
          (await remote.fetch(new Request(`https://staff.example.test${path}`))).status,
          path,
        ).toBe(404);
      }
    },
  );
  expect(served.listeners.every(({ server }) => !server.listening)).toBe(true);
});

it("lets a till on an allowed origin read the device live endpoint's answer", async () => {
  await withServer({}, async () => {
    const path = '/api/live/events?resources=[{"type":"printers"}]';
    const response = await fetch(url(path), { headers: { origin: TRUSTED } });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    expect(response.headers.get("access-control-allow-origin")).toBe(TRUSTED);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

it("protects a real Ready write while accepting own and membership-listed pages", async () => {
  const orderId = randomUUID();
  let cookie: string;
  const listed = "https://spare.venue.test";
  const unlisted = "https://other.venue.test";
  const states = () => suite.db.select({ state: ticketItems.state }).from(ticketItems).all();
  await withServer(
    {},
    async () => {
      const path = `/api/device/orders/${orderId}/ready`;
      for (const origin of [otherPort(), unlisted]) {
        const response = await fetch(url(path), {
          method: "POST",
          headers: { cookie, origin, "sec-fetch-site": "same-site" },
        });
        expect(await answerOf(response)).toEqual({
          status: 403,
          body: { error: { code: "till.origin_refused", params: {} } },
        });
        expect(states()).toEqual([{ state: "queued" }]);
      }
      const listedResponse = await fetch(url(path), {
        method: "POST",
        headers: { cookie, origin: listed },
      });
      expect(await answerOf(listedResponse)).toEqual({ status: 200, body: "" });
      expect(states()).toEqual([{ state: "ready" }]);
      const ownResponse = await fetch(url(path), {
        method: "POST",
        headers: { cookie, origin: new URL(url(path)).origin },
      });
      expect(await answerOf(ownResponse)).toEqual({ status: 200, body: "" });
    },
    async (venue) => {
      const [profile] = await seedDeviceProfiles(suite.db, {
        name: "Origin check pass",
        formFactor: "kds",
        capabilities: ["prepare-orders", "run-the-pass"],
      });
      const device = await enrolDeviceForTest(suite.db, venue.cfg, {
        name: "Origin check pass",
        profileId: profile!.id,
        kitchenScreen: { kind: "pass", stationIds: null, zoneIds: null },
      });
      cookie = `waitron_device=${device.deviceId}.${device.token}`;
      await withTransaction(suite.db, async (tx) => {
        const offers = await offerProducts(tx);
        await createOpenOrder(
          tx,
          venue.cfg,
          orderId,
          offers.toOfferLines([{ productId: venue.coffeeId, quantity: "1" }]),
          null,
          { zoneId: offers.zoneId },
        );
        const lines = await tx
          .select(fireableLineColumns)
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId));
        await fireLines(tx, venue.cfg, orderId, lines);
      });
      await holdChartNamingMainBox(
        suite.db,
        { nodeId: venue.cfg.nodeId, contactUrl: "https://primary.venue.test" },
        { nodeId: randomUUID(), contactUrl: listed },
      );
    },
  );
});

/** The routes a session holding `invoice.inspect` alone may use: its own account, and the tax
 * office's invoices. The sweep below is weaker than its name: a route that refuses its empty body
 * or missing query before reading the session answers the inspector as it answers a cookie naming
 * no session, so the sweep cannot see what it does with valid input. */
const INSPECTOR_ROUTES = [
  "GET /management-api/session/me",
  "DELETE /management-api/session",
  "PUT /management-api/session/me/locale",
  "POST /management-api/session/me/passkey-offer",
  "GET /management-api/session/me/profile",
  "PUT /management-api/session/me/profile",
  "POST /management-api/session/me/profile/email/confirm",
  "PUT /management-api/session/me/password",
  "DELETE /management-api/session/me/passkeys/:id",
  "POST /management-api/session/me/totp/begin",
  "POST /management-api/session/me/totp/finish",
  "POST /management-api/session/me/recovery-codes",
  "DELETE /management-api/session/me/totp",
  "POST /management-api/session/me/google",
  "DELETE /management-api/session/me/google",
  "POST /management-api/session/me/fresh-sign-in",
  "POST /management-api/session/me/fresh-sign-in/passkey-options",
  "POST /management-api/passkey/register/options",
  "POST /management-api/passkey/register/verify",
  "GET /management-api/passkey/signals",
  "GET /management-api/me/personal-data/export",
  "GET /management-api/tax-office/invoices",
  "POST /management-api/tax-office/invoices/:saleId/pdf",
  "POST /management-api/tax-office/months/:month",
  "GET /management-api/tax-office/month-download",
  "GET /management-api/tax-office/month-download/:id/file",
];

const INSPECTOR_REFUSAL = { status: 403, code: "authorization.inspection_only", params: {} };

describe("a session holding invoice.inspect alone, in the running server", () => {
  /** Status and error of every route the app registers for `methods`, sent with `cookie`. */
  async function sweep(app: Hono, cookie: string, methods: readonly string[]) {
    const id = randomUUID();
    const signOut = "DELETE /management-api/session";
    const routes = [
      ...new Set(
        app.routes
          .filter((route) => methods.includes(route.method))
          .map((route) => `${route.method} ${route.path}`),
      ),
    ].sort((a, b) => Number(a === signOut) - Number(b === signOut));
    const answers = new Map<string, { status: number; code?: unknown; params?: unknown }>();
    for (const route of routes) {
      const [method, path] = route.split(" ") as [string, string];
      const concrete = path
        .split("/")
        .map((segment) => (segment.startsWith(":") ? id : segment === "*" ? "x" : segment))
        .join("/");
      const response = await fetch(url(`${concrete}?from=2026-11-01&to=2026-11-30`), {
        method,
        headers: {
          cookie,
          ...(method === "GET" ? {} : { "content-type": "application/json" }),
        },
        ...(method === "GET" ? {} : { body: "{}" }),
      });
      if (response.headers.get("content-type")?.includes("application/json")) {
        const body = (await response.json()) as { error?: { code?: unknown; params?: unknown } };
        answers.set(route, {
          status: response.status,
          code: body.error?.code,
          params: body.error?.params,
        });
      } else {
        await response.body?.cancel();
        answers.set(route, { status: response.status });
      }
    }
    return answers;
  }

  const refusesInspector = (answer: { status: number; code?: unknown; params?: unknown }) =>
    JSON.stringify(answer) === JSON.stringify(INSPECTOR_REFUSAL);

  it("is refused by every route except its own account's and the tax office's", async () => {
    let inspector = "";
    await withServer(
      {},
      async ({ app }) => {
        const all = ["GET", "POST", "PUT", "PATCH", "DELETE"];
        const asInspector = await sweep(app, inspector, all);
        const ended = await sweep(app, `waitron_management_session=${randomUUID()}`, all);
        expect([...asInspector.keys()]).toEqual(expect.arrayContaining(INSPECTOR_ROUTES));
        const leaks: string[] = [];
        for (const [route, answer] of asInspector) {
          if (INSPECTOR_ROUTES.includes(route)) {
            if (refusesInspector(answer) || answer.code === "management_session.required")
              leaks.push(`${route}: refuses its own route, ${JSON.stringify(answer)}`);
            continue;
          }
          const stranger = ended.get(route)!;
          // A route answering a cookie that names no session as it answers the inspector's gives the
          // inspector nothing: it is public, or it refuses the request before reading the session.
          const sameAsStranger = stranger.status === answer.status && stranger.code === answer.code;
          if (!refusesInspector(answer) && !sameAsStranger)
            leaks.push(`${route}: ${JSON.stringify(answer)}`);
        }
        expect(leaks).toEqual([]);
      },
      async () => {
        inspector = (await sessionHolding(suite.db, ["invoice.inspect"])).cookie;
      },
    );
  });

  it("is refused the staff roster through the staff entrance, and an absence with a valid body", async () => {
    let inspector = "";
    const [port] = await freePorts(1);
    await withServer(
      { WAITRON_STAFF_PORT: String(port) },
      async ({ venue }) => {
        const remote = served.listeners[0]!;
        const roster = (cookie: string) =>
          remote.fetch(
            new Request("https://staff.example.test/management-api/staff-roster", {
              headers: { cookie },
            }),
          );
        expect(await answerOf(await roster(inspector))).toEqual({
          status: 403,
          body: { error: { code: INSPECTOR_REFUSAL.code, params: INSPECTOR_REFUSAL.params } },
        });
        expect((await roster(venue.managerCookie)).status).toBe(200);
        const absence = await fetch(url("/management-api/me/schedule/absences"), {
          method: "POST",
          headers: { cookie: inspector, "content-type": "application/json" },
          body: JSON.stringify({
            kind: "holiday",
            startsOn: "2026-11-20",
            endsOn: "2026-11-21",
            note: null,
          }),
        });
        expect(await answerOf(absence)).toEqual({
          status: 403,
          body: { error: { code: INSPECTOR_REFUSAL.code, params: INSPECTOR_REFUSAL.params } },
        });
        expect(suite.db.all<{ n: number }>(sql`select count(*) as n from absences`)[0]!.n).toBe(0);
      },
      async () => {
        inspector = (await sessionHolding(suite.db, ["invoice.inspect"])).cookie;
      },
    );
  });

  it("serves its own account and the tax office's list and month", async () => {
    let inspector = "";
    await withServer(
      {},
      async () => {
        const answers: Record<string, number> = {};
        for (const path of [
          "/management-api/session/me",
          "/management-api/session/me/profile",
          "/management-api/passkey/signals",
          "/management-api/me/personal-data/export",
          "/management-api/tax-office/invoices?from=2026-11-01&to=2026-11-30",
          "/management-api/tax-office/month-download",
          "/management-api/tax-office/month-download/00000000-0000-4000-8000-000000000000/file",
        ]) {
          const response = await fetch(url(path), { headers: { cookie: inspector } });
          await response.body?.cancel();
          answers[path] = response.status;
        }
        const month = await fetch(url("/management-api/tax-office/months/2026-11"), {
          method: "POST",
          headers: { cookie: inspector },
        });
        await month.body?.cancel();
        answers["POST month"] = month.status;
        const locale = await fetch(url("/management-api/session/me/locale"), {
          method: "PUT",
          headers: { cookie: inspector, "content-type": "application/json" },
          body: JSON.stringify({ locale: "es-ES" }),
        });
        answers["PUT locale"] = locale.status;
        const signOut = await fetch(url("/management-api/session"), {
          method: "DELETE",
          headers: { cookie: inspector },
        });
        answers["DELETE session"] = signOut.status;
        const after = await fetch(url("/management-api/session/me"), {
          headers: { cookie: inspector },
        });
        await after.body?.cancel();
        answers["after signing out"] = after.status;
        expect(answers).toEqual({
          "/management-api/session/me": 200,
          "/management-api/session/me/profile": 200,
          "/management-api/passkey/signals": 200,
          "/management-api/me/personal-data/export": 200,
          "/management-api/tax-office/invoices?from=2026-11-01&to=2026-11-30": 200,
          "/management-api/tax-office/month-download": 200,
          "/management-api/tax-office/month-download/00000000-0000-4000-8000-000000000000/file": 404,
          "POST month": 202,
          "PUT locale": 204,
          "DELETE session": 204,
          "after signing out": 401,
        });
      },
      async () => {
        inspector = (await sessionHolding(suite.db, ["invoice.inspect"])).cookie;
      },
    );
  });

  it("builds the month it asks for in the background and hands over the file once", async () => {
    let inspector = "";
    await withServer(
      {},
      async () => {
        const status = async () => {
          const response = await fetch(url("/management-api/tax-office/month-download"), {
            headers: { cookie: inspector },
          });
          return (await response.json()) as { status: string; id?: string; month?: string };
        };
        const asked = await fetch(url("/management-api/tax-office/months/2026-11"), {
          method: "POST",
          headers: { cookie: inspector },
        });
        expect(asked.status).toBe(202);
        expect(await asked.json()).toMatchObject({ status: "building", month: "2026-11" });
        await vi.waitFor(async () => expect((await status()).status).toBe("ready"), {
          timeout: 15_000,
          interval: 100,
        });
        const { id } = await status();
        const file = await fetch(url(`/management-api/tax-office/month-download/${id}/file`), {
          headers: { cookie: inspector },
        });
        expect(file.status).toBe(200);
        const bytes = new Uint8Array(await file.arrayBuffer());
        expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
        await vi.waitFor(async () => expect(await status()).toEqual({ status: "none" }));
      },
      async () => {
        inspector = (await sessionHolding(suite.db, ["invoice.inspect"])).cookie;
      },
    );
  });

  it("leaves a manager and a session with no permission reading as before", async () => {
    let nobody = "";
    await withServer(
      {},
      async ({ app, venue }) => {
        const manager = await sweep(app, venue.managerCookie, ["GET"]);
        expect([...manager].filter(([, answer]) => refusesInspector(answer))).toEqual([]);
        const empty = await sweep(app, nobody, ["GET"]);
        expect([...empty].filter(([, answer]) => refusesInspector(answer))).toEqual([]);
        expect(empty.get("GET /management-api/tax-office/invoices")).toEqual({
          status: 403,
          code: "authorization.not_permitted",
          params: { permission: "invoice.inspect" },
        });
        for (const route of [
          "GET /management-api/orders",
          "GET /management-api/me/schedule/shifts",
          "GET /management-api/session/me/profile",
        ])
          expect(empty.get(route)?.status, route).toBe(200);
      },
      async () => {
        nobody = (await sessionHolding(suite.db, [])).cookie;
      },
    );
  });
});

describe("the booted device chooser", () => {
  useTestProducer();
  it.each([
    ["demo", "preproduction", true],
    ["prepare", "preproduction", false],
    ["live", "production", false],
    ["prepare", "dev", true],
    ["live", "dev", true],
  ] as const)("booted %s on %s exposes chooser=%s", async (intent, environment, allowed) => {
    let deviceId = "";
    let cookie = "";
    await withServer(
      {
        WAITRON_ENV: environment,
        WAITRON_ONBOARDING_INTENT: intent,
        WAITRON_MANAGEMENT_RP_ID: "till.example.test",
      },
      async ({ app }) => {
        expect((await app.request("/api/dev/devices")).status).toBe(allowed ? 200 : 404);
        const response = await app.request("/api/device/me", {
          headers: { [DEV_DEVICE_HEADER]: deviceId, ...(!allowed ? { cookie } : {}) },
        });
        expect(response.status).toBe(allowed ? 200 : 401);
        expect(await response.json()).toMatchObject(
          allowed ? { deviceId } : { error: { code: "device.unauthorized" } },
        );
      },
      async (venue) => {
        const [profile] = await seedDeviceProfiles(suite.db, {
          name: "Chooser till",
          formFactor: "till",
          capabilities: [],
        });
        const enrolled = await enrolDeviceForTest(suite.db, venue.cfg, {
          name: "Chooser till",
          profileId: profile!.id,
        });
        deviceId = enrolled.deviceId;
        cookie = `${DEVICE_COOKIE}=${deviceId}.${enrolled.token}`;
      },
    );
  });
});
