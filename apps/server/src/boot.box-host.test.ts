import { existsSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { serve } from "@hono/node-server";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartServerSeams, StartedServer } from "./boot.js";
import type { BoxHostRequests, HostUnavailable, NetworkSnapshot } from "./box-host-client.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

const served = vi.hoisted(() => ({
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
      return mocked.serve(options, onListen);
    },
  };
});

const { startServer, httpPort } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

const SNAPSHOT: NetworkSnapshot = {
  wired: { connected: true, address: "192.168.1.10" },
  wifi: { connectedSsidHex: "4361666550657065", savedSsidHex: "4361666550657065" },
  change: null,
  bootCopy: { state: "current", reason: null, failure: null },
};

function fakeHost() {
  const refused = async (): Promise<HostUnavailable<never>> => ({
    available: false,
    reason: "missing",
    detail: "ENOENT",
  });
  return {
    networkRead: vi.fn<BoxHostRequests["networkRead"]>(async () => ({
      available: true,
      ...SNAPSHOT,
    })),
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

/** Starts the whole server over the suite's venue; the venue is written before the start only. */
async function withServer(
  seams: StartServerSeams,
  body: (venue: Venue, managerId: string) => Promise<void>,
): Promise<void> {
  const venue = await setupVenue(suite.db);
  const [manager] = suite.db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.role, "manager"))
    .all();
  const [port] = await freePorts(1);
  let scratch: string | undefined;
  let server: StartedServer | undefined;
  try {
    scratch = await mkdtemp(join(tmpdir(), "waitron-boot-box-host-"));
    const migrationsRoot = join(scratch, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const env = {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_NODE_ID: venue.cfg.nodeId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
    };
    server = await startServer(env, env, seams);
    await vi.waitFor(async () => {
      expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
    });
    await body(venue, manager!.id);
  } finally {
    if (server !== undefined) await server.close();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  }
}

const url = (path: string) => `http://127.0.0.1:${httpPort()}${path}`;

async function answerOf(response: Response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: text };
  }
}

describe("the box host routes in the running server", () => {
  it("ask the stand-in boot was handed, as the signed-in manager, and refuse staff", async () => {
    const host = fakeHost();
    await withServer({ boxHostRequests: host }, async (venue, managerId) => {
      expect(
        await answerOf(
          await fetch(url("/api/box/network"), { headers: { cookie: venue.managerCookie } }),
        ),
      ).toEqual({ status: 200, body: SNAPSHOT });
      expect(host.networkRead).toHaveBeenCalledTimes(1);
      expect(host.networkRead).toHaveBeenCalledWith({ source: "person", person: managerId });

      expect(
        await answerOf(
          await fetch(url("/api/box/screen"), {
            method: "POST",
            headers: { cookie: venue.managerCookie, "content-type": "application/json" },
            body: JSON.stringify({ start: "till" }),
          }),
        ),
      ).toEqual({ status: 200, body: { start: "till" } });
      expect(host.screenSet).toHaveBeenCalledTimes(1);

      expect(
        await answerOf(
          await fetch(url("/api/box/network"), { headers: { cookie: venue.staffCookie } }),
        ),
      ).toEqual({
        status: 403,
        body: { error: { code: "authorization.not_permitted", params: expect.anything() } },
      });
      expect(host.networkRead).toHaveBeenCalledTimes(1);

      // Boot's own middleware runs before the routes; none of it may read a join's body first.
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            controller.enqueue(new Uint8Array(4097).fill(0x20));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const socket = new Socket();
      try {
        const response = await served.fetch!(
          new Request(url("/api/box/network/join"), {
            method: "POST",
            headers: { cookie: venue.managerCookie, "content-type": "application/json" },
            body: stream,
            duplex: "half",
          } as RequestInit),
          { incoming: { socket } },
        );
        expect(await answerOf(response)).toEqual({
          status: 403,
          body: {
            error: {
              code: "box_network.join_connection_insecure",
              params: { reason: "unencrypted" },
            },
          },
        });
        expect(pulls).toBe(0);
        expect(host.networkJoin).toHaveBeenCalledTimes(0);
      } finally {
        socket.destroy();
      }
    });
  });

  it("refuse a manager's change sent by a page on another port, and name it no allowed origin", async () => {
    const host = fakeHost();
    await withServer({ boxHostRequests: host }, async (venue) => {
      const otherPort = `http://127.0.0.1:${httpPort() + 1}`;
      for (const path of ["/api/box/screen", "/api/box/network/forget", "/api/box/network/scan"]) {
        const preflight = await fetch(url(path), {
          method: "OPTIONS",
          headers: {
            origin: otherPort,
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
          },
        });
        // A browser refuses a preflight answer that names no allowed origin.
        expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      }

      for (const [path, body] of [
        ["/api/box/screen", JSON.stringify({ start: "till" })],
        ["/api/box/network/forget", JSON.stringify({ ssidHex: "4361666550657065" })],
        ["/api/box/network/scan", undefined],
      ] as const) {
        expect(
          await answerOf(
            await fetch(url(path), {
              method: "POST",
              headers: {
                cookie: venue.managerCookie,
                origin: otherPort,
                "sec-fetch-site": "same-site",
                "content-type": "text/plain;charset=UTF-8",
              },
              ...(body === undefined ? {} : { body }),
            }),
          ),
        ).toEqual({
          status: 403,
          body: { error: { code: "box_host.origin_refused", params: {} } },
        });
      }
      expect(host.screenSet).toHaveBeenCalledTimes(0);
      expect(host.networkForget).toHaveBeenCalledTimes(0);
      expect(host.networkScan).toHaveBeenCalledTimes(0);
    });
  });

  it("talk to the host's own socket when boot was handed no stand-in", async () => {
    if (existsSync("/run/waitron-box/box.sock")) {
      throw new Error("this case needs a machine with no /run/waitron-box/box.sock");
    }
    await withServer({}, async (venue) => {
      expect(
        await answerOf(
          await fetch(url("/api/box/network"), { headers: { cookie: venue.managerCookie } }),
        ),
      ).toEqual({
        status: 409,
        body: {
          error: { code: "box_host.unavailable", params: { reason: "missing", detail: "ENOENT" } },
        },
      });
    });
  });
});
