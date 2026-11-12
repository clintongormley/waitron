import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult } from "@waitron/fiscal";
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

const drain = vi.hoisted(() => ({ calls: [] as number[] }));

// The real contribution stays, so the module's route and outbox read are the real ones; only the
// drain is a counter whose `nextDueAt: null` lets the loop sleep its ceiling.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const real = actual.fiscalSlot(...args);
      return {
        ...real,
        drain: async () => {
          drain.calls.push(performance.now());
          return emptyDrainResult();
        },
      };
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

const RETRY = "/management-api/fiscal-outbox/retry";

it("hands the configured tunnel folder to the real Cloud worker and publishes its assigned peer", async () => {
  const f = await installationFixture();
  const publicKey = randomBytes(32).toString("base64"),
    gatewayPublicKey = randomBytes(32).toString("base64");
  const source = join(f.stateDir, "cloud/connection.json");
  const saved = JSON.parse(await readFile(source, "utf8"));
  f.patch({
    services: ["continuous_backup", "remote_access", "retained_snapshots"].map((service) => ({
      service,
      state: "ready",
      health: "unknown",
      failure: null,
      observedAt: null,
      configuration:
        service === "remote_access"
          ? {
              version: 1,
              ...saved.view.registration,
              peerPublicKey: publicKey,
              gatewayPublicKey,
              port: 443,
              address: "10.77.17.2",
              endpoint: "gateway.test.waitron.io:51820",
            }
          : {},
    })),
  });
  try {
    await boot({
      modules: VERIFACTU,
      testSubmissions: false,
      beforeStart: async (venue, directory, env) => {
        saved.localVenueId = venue.cfg.locationId;
        saved.view.localVenueId = venue.cfg.locationId;
        await mkdir(join(directory, "cloud"), { recursive: true });
        const destination = join(directory, "cloud/connection.json");
        await writeFile(destination, JSON.stringify(saved), { mode: 0o600 });
        await rm(source);
        await symlink(destination, source);
        env.WAITRON_CLOUD_ORIGIN = f.options.origin;
        env.WAITRON_ENV = "dev";
        env.WAITRON_TUNNEL_CONTROL_DIR = join(directory, "tunnel");
        await mkdir(env.WAITRON_TUNNEL_CONTROL_DIR);
        await writeFile(join(env.WAITRON_TUNNEL_CONTROL_DIR, "public-key"), publicKey + "\n");
      },
    });
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(join(scratch!, "tunnel", "peer.json"), "utf8"))).toEqual({
        address: "10.77.17.2",
        gatewayPublicKey,
        endpoint: "gateway.test.waitron.io:51820",
      });
    });
  } finally {
    try {
      if (server) await server.close();
    } finally {
      server = undefined;
      await f.close();
    }
  }
});

interface Booted {
  port: number;
  venue: Venue;
}

let server: StartedServer | undefined;
let scratch: string | undefined;

afterEach(async () => {
  try {
    if (server !== undefined) await server.close();
  } finally {
    server = undefined;
    drain.calls = [];
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});

async function boot(options: {
  modules: Record<string, boolean>;
  testSubmissions: boolean;
  seed?: (venue: Venue) => Promise<void>;
  staleTunnel?: "with-origin" | "without-origin";
  beforeStart?: (venue: Venue, stateDir: string, env: Record<string, string>) => Promise<void>;
}): Promise<Booted> {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  await options.seed?.(venue);
  const [port] = await freePorts(1);
  scratch = await mkdtemp(join(tmpdir(), "waitron-boot-fiscal-retry-"));
  const migrationsRoot = join(scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await writeFile(join(scratch, "modules.json"), JSON.stringify({ modules: options.modules }));
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const env: Record<string, string> = {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: venue.cfg.nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    ...(options.testSubmissions ? { WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled" } : {}),
  };
  if (options.staleTunnel) {
    env.WAITRON_TUNNEL_CONTROL_DIR = join(scratch, "tunnel");
    await mkdir(env.WAITRON_TUNNEL_CONTROL_DIR);
    await writeFile(join(env.WAITRON_TUNNEL_CONTROL_DIR, "peer.json"), "stale");
    if (options.staleTunnel === "without-origin") delete env.WAITRON_CLOUD_ORIGIN;
  }
  await options.beforeStart?.(venue, scratch, env);
  server = await startServer(env, env, { timings: { maxTickMs: 600000, minTickMs: 200 } });
  await vi.waitFor(async () => {
    expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
  });
  return { port: httpPort(), venue };
}

function press({ port, venue }: Booted): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${RETRY}`, {
    method: "POST",
    headers: {
      cookie: venue.managerCookie,
      origin: "https://dashboard.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
}

async function readOutbox({ port, venue }: Booted): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}/api/box/health`, {
    headers: { cookie: venue.managerCookie },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { outbox: unknown }).outbox;
}

const VERIFACTU = { "fiscal-none": false };

it("submits the container's public key through boot's real Cloud worker", async () => {
  const submitted: unknown[][] = [];
  const f = await installationFixture(undefined, {
    tunnel: async (values, saved, _req, res) => {
      submitted.push(values);
      const state = saved as unknown as { lifecycle: { view: object } };
      res.end(JSON.stringify(state.lifecycle.view));
    },
  });
  const publicKey = randomBytes(32).toString("base64");
  const source = join(f.stateDir, "cloud/connection.json");
  const saved = JSON.parse(await readFile(source, "utf8"));
  try {
    await boot({
      modules: VERIFACTU,
      testSubmissions: false,
      beforeStart: async (venue, directory, env) => {
        saved.localVenueId = venue.cfg.locationId;
        saved.view.localVenueId = venue.cfg.locationId;
        await mkdir(join(directory, "cloud"), { recursive: true });
        const destination = join(directory, "cloud/connection.json");
        await writeFile(destination, JSON.stringify(saved), { mode: 0o600 });
        await rm(source);
        await symlink(destination, source);
        env.WAITRON_CLOUD_ORIGIN = f.options.origin;
        env.WAITRON_ENV = "dev";
        env.WAITRON_TUNNEL_CONTROL_DIR = join(directory, "tunnel");
        await mkdir(env.WAITRON_TUNNEL_CONTROL_DIR);
        await writeFile(join(env.WAITRON_TUNNEL_CONTROL_DIR, "public-key"), publicKey + "\n");
      },
    });
    await vi.waitFor(
      () =>
        expect(submitted.map((v) => v[7])).toEqual([JSON.stringify({ peerPublicKey: publicKey })]),
      { timeout: 10_000 },
    );
  } finally {
    try {
      if (server) await server.close();
    } finally {
      server = undefined;
      await f.close();
    }
  }
}, 60_000);

describe("boot's Retry now wiring", () => {
  it("a press wakes the fiscal loop out of its ten-minute sleep, and the read shows the outbox", async () => {
    const booted = await boot({ modules: VERIFACTU, testSubmissions: true });
    await vi.waitFor(() => expect(drain.calls.length).toBe(1), { timeout: 10_000 });
    // Control: without a press the loop sleeps on past the first call.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(drain.calls.length).toBe(1);

    const pressed = await press(booted);
    expect(pressed.status).toBe(200);
    expect(await pressed.json()).toEqual({ waiting: 0 });
    await vi.waitFor(() => expect(drain.calls.length).toBe(2), { timeout: 5_000 });

    expect(await readOutbox(booted)).toEqual({
      lastAcceptedAt: null,
      waiting: 0,
      awaitingCertificate: false,
    });
  }, 60_000);

  it("while the box does not file, a press is refused, changes no row, and the read has no outbox", async () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const booted = await boot({
      modules: VERIFACTU,
      testSubmissions: false,
      seed: async (venue) => {
        await seedPendingEnvios(suite.db, {
          count: 2,
          identity: {
            locationId: venue.cfg.locationId,
            nodeId: venue.cfg.nodeId,
            nif: "B12345678",
          },
        });
        await suite.db.execute(sql`update envios set proximo_intento_en = ${future}`);
      },
    });
    const snapshot = async () => {
      const rows: unknown[][] = [];
      for (const query of [
        sql`select * from envios order by registro_id`,
        sql`select * from management_sessions order by token_hash`,
        sql`select * from persons order by id`,
      ])
        rows.push((await suite.db.execute(query)).rows);
      return rows;
    };
    const unchanged = await snapshot();
    expect(unchanged[0]).toHaveLength(2);

    const pressed = await press(booted);
    expect(pressed.status).toBe(409);
    expect(await pressed.json()).toEqual({ error: { code: "fiscal.not_filing", params: {} } });
    expect(await snapshot()).toEqual(unchanged);
    expect(await readOutbox(booted)).toBeNull();
  }, 60_000);

  // A control: it passes before boot hands the route anything, and pins that fiscal-none mounts no
  // Retry now route and has no outbox to read.
  it("with fiscal-none filling the slot, nothing answers the press and the read has no outbox", async () => {
    const booted = await boot({
      modules: { "fiscal-verifactu": false, "fiscal-none": true },
      testSubmissions: true,
      seed: async (venue) => {
        await suite.db.execute(
          sql`update nodes set filing_module = 'none' where id = ${venue.cfg.nodeId}`,
        );
      },
    });
    const pressed = await press(booted);
    expect({ status: pressed.status, body: await pressed.text() }).toEqual({
      status: 404,
      body: "404 Not Found",
    });
    expect(await readOutbox(booted)).toBeNull();
  }, 60_000);
});

it.each(["with-origin", "without-origin"] as const)(
  "clears a stale peer during an unconnected boot %s",
  async (staleTunnel) => {
    await boot({ modules: VERIFACTU, testSubmissions: false, staleTunnel });
    await vi.waitFor(async () => {
      await expect(readFile(join(scratch!, "tunnel", "peer.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  },
);
