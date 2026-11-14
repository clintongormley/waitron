import { mkdir } from "node:fs/promises";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { serve } from "@hono/node-server";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { catalogues } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartServerSeams, StartedServer } from "./boot.js";
import type { BoxHostRequests, HostUnavailable } from "./box-host-client.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

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
  try {
    scratch = await mkdtemp(join(tmpdir(), "waitron-boot-management-origin-"));
    const migrationsRoot = join(scratch, "migrations");
    await copyMigrationsRoot(migrationsRoot);
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const full = {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_NODE_ID: venue.cfg.nodeId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_MANAGEMENT_ORIGIN: TRUSTED,
      ...env,
    };
    if (env.WAITRON_STAFF_ORIGIN) {
      const material = mintSelfSignedServerCert({
        now: new Date(),
        hostnames: [new URL(env.WAITRON_STAFF_ORIGIN).hostname],
        ipAddresses: [],
      });
      await mkdir(join(scratch, "cloud"), { recursive: true });
      await writeFile(join(scratch, "cloud/staff.key"), material.serverKeyPem);
      await mkdir(join(scratch, "cloud"), { recursive: true });
      await writeFile(join(scratch, "cloud/staff.crt"), material.serverCertPem);
    }
    server = await startServer(full, full, seams);
    await vi.waitFor(async () => {
      expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
    });
    if (seen === undefined) throw new Error("boot did not hand the test its app");
    await body({ venue, host, app: seen, restart });
  } finally {
    if (server !== undefined) await server.close();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  }
}

const url = (path: string) => `http://127.0.0.1:${httpPort()}${path}`;
const otherPort = () => `http://127.0.0.1:${httpPort() + 1}`;

async function answerOf(response: Response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: text };
  }
}

function catalogueNamed(name: string) {
  return suite.db.select().from(catalogues).where(eq(catalogues.name, name)).all();
}

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
        ["/api/box/clock-confirm", "{}"],
        ["/api/box/clock-set", "{}"],
        ["/api/box/screen", JSON.stringify({ start: "till" })],
        ["/management-api/catalogues", JSON.stringify({ name: "From another page" })],
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
      expect(catalogueNamed("From another page")).toEqual([]);
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
        const response = await fetch(url("/management-api/catalogues"), {
          method: "POST",
          headers: { cookie: venue.managerCookie, "content-type": "application/json", ...headers },
          body: JSON.stringify({ name }),
        });
        await response.body?.cancel();
        answers[name] = response.status;
      }
      expect(answers).toEqual(Object.fromEntries(rows.map(([name]) => [name, 201])));
      for (const [name] of rows) expect(catalogueNamed(name)).toHaveLength(1);
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
          "POST /management-api/catalogues",
          "POST /api/box/free-space",
          "POST /api/box/screen",
        ]),
      );
      const uncovered: string[] = [];
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
              cookie: `waitron_management_session=${randomUUID()}`,
              origin: otherPort(),
              "sec-fetch-site": "same-site",
            },
          }),
        );
        const refused =
          answer.status === 403 && JSON.stringify(answer.body) === JSON.stringify(REFUSED);
        if (!refused) uncovered.push(write);
      }
      expect(uncovered).toEqual([]);
    });
  });
});

it("boots and closes a separate staff entrance over the real dashboard API", async () => {
  const [port] = await freePorts(1);
  await withServer(
    { WAITRON_STAFF_ORIGIN: "https://staff.example.test", WAITRON_STAFF_PORT: String(port) },
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
