import { seedModuleSettings } from "../test/module-settings.js";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withNodeTransaction, withTransaction, type NodeDatabase } from "@waitron/db";
import { recordTakeFailureTx } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeRecoveryKey } from "./backup-env-writer.js";
import type { StartedServer } from "./boot.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { readSealedStateRow, unsealNodeState, type SealedStateDeps } from "./sealed-state.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

/**
 * The node handle the start gave its sealed-state refresher, so the test writes through it; every
 * refresh it was asked for, and every line it logged.
 */
const seen = vi.hoisted(() => ({
  refresherDeps: [] as unknown[],
  refreshes: [] as Promise<unknown>[],
  logs: [] as unknown[][],
  holdQueuedJob: false,
}));
vi.mock("./sealed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sealed-state.js")>();
  return {
    ...actual,
    sealedStateJob: (...args: Parameters<typeof actual.sealedStateJob>) => ({
      ...actual.sealedStateJob(...args),
      ...(seen.holdQueuedJob ? { minSleepMs: 60_000 } : {}),
    }),
    createSealedStateRefresher: (deps: Parameters<typeof actual.createSealedStateRefresher>[0]) => {
      seen.refresherDeps.push(deps);
      const refresher = actual.createSealedStateRefresher({
        ...deps,
        log: (...line) => {
          seen.logs.push(line);
          deps.log(...line);
        },
      });
      return {
        ...refresher,
        refresh: () => {
          const outcome = refresher.refresh();
          seen.refreshes.push(outcome);
          return outcome;
        },
      };
    },
  };
});

const { beforeServerStarts, startServer } = ephemeralServerFixture();

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const KEY = "recovery-key-sealed-after-node-commits";

async function failuresInSealedRow(nodeId: string, scratch: string): Promise<number | null> {
  const sealed = await withTransaction(suite.db, (tx) => readSealedStateRow(tx, nodeId));
  if (sealed === null) return null;
  const entry = unsealNodeState(sealed, KEY).find((e) => e.name === "node.dump");
  if (entry === undefined) return null;
  const file = join(scratch, `node-dump-${Date.now()}-${Math.random()}.db`);
  await writeFile(file, entry.bytes);
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const row = copy
      .prepare("select failures from node_take_failures where node_id = ?")
      .get(nodeId) as { failures: number } | undefined;
    return row?.failures ?? null;
  } finally {
    copy.close();
  }
}

async function addFailure(node: NodeDatabase, nodeId: string): Promise<void> {
  await withNodeTransaction(node, (tx) => recordTakeFailureTx(tx, nodeId, new Date()));
}

/** Starts a set-up box on the suite's venue, its node holding one failed take, with state in `scratch`. */
async function startBox(scratch: string) {
  const venue = await setupVenue(suite.db);
  const nodeId = venue.cfg.nodeId;
  await addFailure(suite.node, nodeId);
  const migrationsRoot = join(scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await seedModuleSettings(suite.db, { "fiscal-none": false });
  await writeRecoveryKey(scratch, {
    recoveryKey: KEY,
    keyRotatedAt: "2026-10-31T08:00:00.000Z",
  });
  // The sealed row needs every recovery file, which a set-up box holds.
  await writeFile(join(scratch, "trading.env"), `WAITRON_NODE_ID=${nodeId}\n`);
  await ensureBoxSecrets({ stateDir: scratch, hostnames: ["localhost"], now: () => new Date() });
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  const env = {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_LOG_DIR: join(scratch, "logs"),
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
  };
  return { nodeId, server: await startServer(env, env) };
}

it("a node change committed after the last refresh is in the next sealed row", async () => {
  seen.refresherDeps.length = 0;
  beforeServerStarts();
  const scratch = await mkdtemp(join(tmpdir(), "waitron-sealed-node-commit-"));
  let server: StartedServer | undefined;
  try {
    const started = await startBox(scratch);
    const nodeId = started.nodeId;
    server = started.server;

    // The start's own refresh sealed the count the box held then.
    expect(await failuresInSealedRow(nodeId, scratch)).toBe(1);
    expect(seen.refresherDeps).toHaveLength(1);
    const { node } = seen.refresherDeps[0] as SealedStateDeps;

    await addFailure(node, nodeId);

    await vi.waitFor(
      async () => {
        expect(await failuresInSealedRow(nodeId, scratch)).toBe(2);
      },
      { timeout: 10_000, interval: 100 },
    );
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);

it("a node change committed just before close is sealed before the database closes", async () => {
  seen.refresherDeps.length = 0;
  seen.holdQueuedJob = true;
  beforeServerStarts();
  const scratch = await mkdtemp(join(tmpdir(), "waitron-sealed-node-commit-"));
  let server: StartedServer | undefined;
  try {
    const started = await startBox(scratch);
    server = started.server;
    const { node } = seen.refresherDeps[0] as SealedStateDeps;
    seen.refreshes.length = 0;
    seen.logs.length = 0;

    await addFailure(node, started.nodeId);
    expect(seen.refreshes).toHaveLength(0);
    await server.close();
    server = undefined;
    await Promise.all(seen.refreshes);
    expect(await failuresInSealedRow(started.nodeId, scratch)).toBe(2);

    expect(seen.logs).toEqual([["info", "backup.sealed_state_refreshed", expect.anything()]]);
  } finally {
    await server?.close();
    seen.holdQueuedJob = false;
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);
