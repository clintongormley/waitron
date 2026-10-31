import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withNodeTransaction, withTransaction, type NodeDatabase } from "@waitron/db";
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

/** The node handle the start gave its sealed-state refresher, so the test writes through it. */
const seen = vi.hoisted(() => ({ refresherDeps: [] as unknown[] }));
vi.mock("./sealed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sealed-state.js")>();
  return {
    ...actual,
    createSealedStateRefresher: (deps: Parameters<typeof actual.createSealedStateRefresher>[0]) => {
      seen.refresherDeps.push(deps);
      return actual.createSealedStateRefresher(deps);
    },
  };
});

const { beforeServerStarts, startServer } = ephemeralServerFixture();

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const KEY = "recovery-key-sealed-after-node-commits";

async function verifierInSealedRow(nodeId: string, scratch: string): Promise<string | null> {
  const sealed = await withTransaction(suite.db, (tx) => readSealedStateRow(tx, nodeId));
  if (sealed === null) return null;
  const entry = unsealNodeState(sealed, KEY).find((e) => e.name === "node.dump");
  if (entry === undefined) return null;
  const file = join(scratch, `node-dump-${Date.now()}-${Math.random()}.db`);
  await writeFile(file, entry.bytes);
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const row = copy
      .prepare("select verifier from node_recovery_key where node_id = ?")
      .get(nodeId) as { verifier: string } | undefined;
    return row?.verifier ?? null;
  } finally {
    copy.close();
  }
}

async function putVerifier(node: NodeDatabase, nodeId: string, verifier: string): Promise<void> {
  // Plain SQL: the server does not depend on `@waitron/node-db`, which declares the table.
  await withNodeTransaction(node, async (tx) => {
    await tx.run(
      sql`insert into node_recovery_key (node_id, verifier, key_name, updated_at)
          values (${nodeId}, ${verifier}, 'key-one', ${new Date().toISOString()})
          on conflict (node_id) do update set verifier = excluded.verifier`,
    );
  });
}

it("a recovery key replaced after the last refresh is in the next sealed row", async () => {
  seen.refresherDeps.length = 0;
  beforeServerStarts();
  const scratch = await mkdtemp(join(tmpdir(), "waitron-sealed-node-commit-"));
  let server: StartedServer | undefined;
  try {
    const venue = await setupVenue(suite.db);
    const nodeId = venue.cfg.nodeId;
    await putVerifier(suite.node, nodeId, "verifier-before-start");
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
    server = await startServer(env, env);

    // The start's own refresh sealed the verifier the box held then.
    expect(await verifierInSealedRow(nodeId, scratch)).toBe("verifier-before-start");
    expect(seen.refresherDeps).toHaveLength(1);
    const { node } = seen.refresherDeps[0] as SealedStateDeps;

    await putVerifier(node, nodeId, "verifier-after-refresh");

    await vi.waitFor(
      async () => {
        expect(await verifierInSealedRow(nodeId, scratch)).toBe("verifier-after-refresh");
      },
      { timeout: 10_000, interval: 100 },
    );
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);
