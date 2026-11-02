import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withNodeTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordHandoverRestrictionTx } from "@waitron/node-db";
import type { StartedServer } from "./boot.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

// Stands in for AEAT: every fiscal pass the box starts reaches the drain, which counts it.
const drain = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const real = actual.fiscalSlot(...args);
      return {
        ...real,
        drain: async () => {
          drain.calls += 1;
          return emptyDrainResult();
        },
      };
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

const MIN_TICK_MS = 200;
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

let server: StartedServer | undefined;
let scratch: string | undefined;

afterEach(async () => {
  try {
    if (server !== undefined) await server.close();
  } finally {
    server = undefined;
    drain.calls = 0;
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});

async function boot(options: { restricted: boolean }): Promise<{ port: number; venue: Venue }> {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  const nodeId = venue.cfg.nodeId;
  const ring = loadKeyRing(KEY_ENV);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  await seedTermZeroMembership(
    { db: suite.db, node: suite.node, ring },
    nodeId,
    "https://box.example",
  );
  if (options.restricted) {
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId,
        operationId: null,
        kind: "superseded",
        successorNodeId: "00000000-0000-4000-8000-0000000000aa",
        membershipTerm: 1,
      }),
    );
  }
  const [port] = await freePorts(1);
  scratch = await mkdtemp(join(tmpdir(), "waitron-boot-restricted-"));
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
  const env: Record<string, string> = {
    ...KEY_ENV,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    WAITRON_MAX_TICK_MS: "600000",
    WAITRON_MIN_TICK_MS: String(MIN_TICK_MS),
    WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
  };
  server = await startServer(env, env);
  // A restricted box runs no duty, so its `/health` answers 503, as the pending-adoption start does.
  await vi.waitFor(async () => {
    expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(
      options.restricted ? 503 : 200,
    );
  });
  return { port: httpPort(), venue };
}

describe("a box holding a handover restriction starts restricted", () => {
  it("answers acceptingSales: false with its node id and term", async () => {
    const { port, venue } = await boot({ restricted: true });
    const response = await fetch(`http://127.0.0.1:${port}/api/node`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nodeId: venue.cfg.nodeId,
      term: 0,
      acceptingSales: false,
    });
  }, 60_000);

  it("refuses a till sign-in", async () => {
    const { port } = await boot({ restricted: true });
    const response = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "1234" }),
    });
    expect([403, 404]).toContain(response.status);
  }, 60_000);

  it("mounts no dashboard, till, print or device route", async () => {
    const { port, venue } = await boot({ restricted: true });
    const probes: [string, string][] = [
      ["GET", "/management-api/alerts"],
      ["GET", "/management-api/catalogue-settings"],
      ["DELETE", "/api/session"],
      ["GET", "/api/device/active-profile"],
      ["POST", "/api/device/enrol"],
      ["GET", "/print-api/agent/jobs"],
    ];
    for (const [method, path] of probes) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { cookie: venue.managerCookie, origin: "https://dashboard.example" },
      });
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
  }, 60_000);

  it("starts no fiscal pass", async () => {
    await boot({ restricted: true });
    await new Promise((resolve) => setTimeout(resolve, 2 * MIN_TICK_MS + 2_000));
    expect(drain.calls).toBe(0);
  }, 60_000);

  it("control: the same folder without the row starts the drain", async () => {
    await boot({ restricted: false });
    await vi.waitFor(() => expect(drain.calls).toBeGreaterThan(0), { timeout: 10_000 });
  }, 60_000);
});
