import { seedModuleSettings } from "../test/module-settings.js";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openVenueDatabase, withNodeTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setNodeModeTx } from "@waitron/node-db";
import { NODE_FILE, VENUE_FILE } from "@waitron/store";
import type { StartedServer } from "./boot.js";
import { placeEmergencyCopy } from "./emergency-copy-placement.js";
import {
  bindingFor,
  copyId,
  seedEmergencyCopySource,
  sourceId,
} from "./testing/emergency-copy-source.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { fakeMdnsSocket } from "./testing/fake-mdns-socket.js";
import { listener } from "./testing/ephemeral-listener.js";
import { sha } from "./testing/place-copy-box.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer } = ephemeralServerFixture();

const migrations = migrationOptionsFor(manifestSets(), null);
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const UNACTIVATED = "node.emergency_copy_unactivated";

let server: StartedServer | undefined;
const scratch: string[] = [];
const suite = useVenueDb({ migrations });

afterEach(async () => {
  listener.configured = false;
  try {
    if (server !== undefined) await server.close();
  } finally {
    server = undefined;
    for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
  }
});

interface PlacedCopy {
  venueDir: string;
  stateDir: string;
  migrationsRoot: string;
}

/**
 * The source venue's file placed as Cloud's emergency copy, with its own node.db. The file is in WAL
 * mode, since every store open switches a file that is not, changing its header; `alter` runs on it
 * before its hash is taken.
 */
async function placedCopy(alter?: (db: DatabaseSync) => void): Promise<PlacedCopy> {
  const root = await mkdtemp(join(tmpdir(), "waitron-boot-emergency-copy-"));
  scratch.push(root);
  const venueDir = join(root, "venue");
  const stateDir = join(root, "state");
  const migrationsRoot = join(root, "migrations");
  await mkdir(venueDir);
  await mkdir(stateDir);
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await seedEmergencyCopySource(suite.db);
  await seedModuleSettings(suite.db, { "fiscal-none": false });
  const venuePath = join(venueDir, VENUE_FILE);
  await suite.db.archiveTo(venuePath);
  const raw = new DatabaseSync(venuePath);
  try {
    raw.exec("pragma journal_mode = wal");
    alter?.(raw);
  } finally {
    raw.close();
  }
  await placeEmergencyCopy({
    binding: bindingFor(sha(venuePath)),
    venueDir,
    stateDir,
    environment: "preproduction",
    processEnv: {},
    migrationsRoot,
    modules: [],
    now: () => new Date("2026-11-17T10:10:00.000Z"),
  });
  return { venueDir, stateDir, migrationsRoot };
}

function startEnv(copy: PlacedCopy, nodeId: string | undefined): Record<string, string> {
  return {
    ...KEY_ENV,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_STATE_DIR: copy.stateDir,
    WAITRON_VENUE_DIR: copy.venueDir,
    ...(nodeId === undefined ? {} : { WAITRON_NODE_ID: nodeId }),
    WAITRON_MIGRATIONS_DIR: copy.migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    WAITRON_MAX_TICK_MS: "600000",
    WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
    WAITRON_HTTP_HOST: "0.0.0.0",
  };
}

async function start(env: Record<string, string>): Promise<StartedServer> {
  beforeServerStarts();
  const mdns = fakeMdnsSocket();
  const started = startServer(env, env, { mdnsSocket: () => mdns.socket });
  void started.then((s) => (server = s)).catch(() => undefined);
  return started;
}

/** Both files' hashes: a refused start must leave each byte for byte as placement left it. */
function hashes(copy: PlacedCopy): { venue: string; node: string } {
  return {
    venue: sha(join(copy.venueDir, VENUE_FILE)),
    node: sha(join(copy.venueDir, NODE_FILE)),
  };
}

describe("an ordinary start of a placed emergency copy", () => {
  it("refuses under the source's id, leaving venue.db and node.db unchanged", async () => {
    const copy = await placedCopy();
    const before = hashes(copy);

    await expect(start(startEnv(copy, sourceId))).rejects.toMatchObject({ code: UNACTIVATED });

    expect(hashes(copy)).toEqual(before);
  }, 60_000);

  it("refuses under the copy's own id with the same code, before any other check", async () => {
    const copy = await placedCopy();
    const before = hashes(copy);

    await expect(start(startEnv(copy, copyId))).rejects.toMatchObject({ code: UNACTIVATED });

    expect(hashes(copy)).toEqual(before);
  }, 60_000);

  it("refuses with no node id configured", async () => {
    const copy = await placedCopy();
    const before = hashes(copy);

    await expect(start(startEnv(copy, undefined))).rejects.toMatchObject({ code: UNACTIVATED });

    expect(hashes(copy)).toEqual(before);
  }, 60_000);

  it("refuses a copy older than this software and leaves it unmigrated", async () => {
    const copy = await placedCopy((db) =>
      db.exec(
        "delete from __drizzle_migrations_db where created_at = (select max(created_at) from __drizzle_migrations_db)",
      ),
    );
    const before = hashes(copy);

    await expect(start(startEnv(copy, sourceId))).rejects.toMatchObject({ code: UNACTIVATED });

    expect(hashes(copy)).toEqual(before);
  }, 60_000);

  it("gets past the refusal once the copy's role is primary and the configured id is the copy's", async () => {
    const copy = await placedCopy();
    const store = await openVenueDatabase(copy.venueDir);
    try {
      await withNodeTransaction(store.node, (tx) =>
        setNodeModeTx(tx, copyId, "primary", "emergency_copy"),
      );
    } finally {
      await store.close();
    }

    const code = await start(startEnv(copy, copyId)).then(
      () => null,
      (error: unknown) => (error as { code?: unknown }).code,
    );

    expect(code).not.toBe(UNACTIVATED);
  }, 60_000);
});
