import { seedModuleSettings } from "../test/module-settings.js";
import { readFileSync, writeFileSync } from "node:fs";
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
import { loadBoxEnv } from "./box-env.js";
import type { EmergencyCopyBinding } from "./emergency-copy-binding.js";
import { placeEmergencyCopy } from "./emergency-copy-placement.js";
import { runEntry } from "./node-entry.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
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
  binding: EmergencyCopyBinding;
}

/**
 * The source venue's file placed as Cloud's emergency copy, with its own node.db, in `journalMode`.
 * `alter` runs on it before its hash is taken.
 */
async function placedCopy(
  alter?: (db: DatabaseSync) => void,
  journalMode: "wal" | "delete" = "wal",
): Promise<PlacedCopy> {
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
    raw.exec(`pragma journal_mode = ${journalMode}`);
    alter?.(raw);
  } finally {
    raw.close();
  }
  const copy = { venueDir, stateDir, migrationsRoot, binding: bindingFor(sha(venuePath)) };
  await placeAgain(copy);
  return copy;
}

/** Cloud's placement of `copy`'s own binding, as a first placement or a repeat. */
function placeAgain(copy: PlacedCopy): Promise<void> {
  return placeEmergencyCopy({
    binding: copy.binding,
    venueDir: copy.venueDir,
    stateDir: copy.stateDir,
    environment: "preproduction",
    processEnv: {},
    migrationsRoot: copy.migrationsRoot,
    modules: [],
    now: () => new Date("2026-11-17T10:10:00.000Z"),
  });
}

/** Bytes 18 and 19 of a SQLite header: 2 and 2 in WAL mode, 1 and 1 otherwise. */
function headerJournalBytes(copy: PlacedCopy): number[] {
  return [...readFileSync(join(copy.venueDir, VENUE_FILE)).subarray(18, 20)];
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

async function start(
  env: Record<string, string>,
  base: NodeJS.ProcessEnv = env,
): Promise<StartedServer> {
  beforeServerStarts();
  const mdns = fakeMdnsSocket();
  const started = startServer(env, base, { mdnsSocket: () => mdns.socket });
  void started.then((s) => (server = s)).catch(() => undefined);
  return started;
}

/**
 * A whole entry start, as the box runs one: what it threw, or null. Its own certificate, since
 * without one a state folder holding `secrets.env` and no `tls/` serves only the connection page.
 */
async function entryStart(copy: PlacedCopy, env: Record<string, string>): Promise<unknown> {
  const pem = join(copy.stateDir, "..", "server.pem");
  const material = mintSelfSignedServerCert({
    hostnames: ["box.local"],
    ipAddresses: [],
    now: new Date(),
  });
  writeFileSync(pem, material.serverCertPem + material.serverKeyPem);
  try {
    await runEntry({
      args: [],
      baseEnv: { ...env, WAITRON_TLS_CERT_FILE: pem, WAITRON_TLS_KEY_FILE: pem },
      stateDir: copy.stateDir,
      venueDir: copy.venueDir,
      logDir: join(copy.stateDir, "logs"),
      migrationsRoot: copy.migrationsRoot,
      loadBoxEnv,
      readRecoveryState,
      writeRecoveryState,
      startServer: (merged, base) => start(merged as Record<string, string>, base),
      serveStartClockWaiting: () => Promise.reject(new Error("no restore waits here")),
      serveRecovery: async () => {},
      installShutdownHandlers: () => {},
      scheduleStayedUp: () => {},
      log: () => {},
      exit: () => {},
      spareBytes: 0,
    });
    return null;
  } catch (error) {
    return error;
  }
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

  it("refuses under the copy's own id with the same code", async () => {
    const copy = await placedCopy();
    const before = hashes(copy);

    await expect(start(startEnv(copy, copyId))).rejects.toMatchObject({ code: UNACTIVATED });

    expect(hashes(copy)).toEqual(before);
  }, 60_000);

  it("refuses a venue.db not in WAL mode before opening it, so Cloud can place the same copy again", async () => {
    const copy = await placedCopy(undefined, "delete");
    // Failing case for the fixture itself: [2, 2], a file every store open leaves unchanged.
    expect(headerJournalBytes(copy)).toEqual([1, 1]);
    const before = hashes(copy);

    await expect(start(startEnv(copy, sourceId))).rejects.toMatchObject({ code: UNACTIVATED });

    // Failing case, the refusal after the store's open: venue.db's hash moves, its header reads [2, 2].
    expect(hashes(copy)).toEqual(before);
    expect(headerJournalBytes(copy)).toEqual([1, 1]);
    // A changed venue.db fails this with `emergency_copy.hash_mismatch`.
    await expect(placeAgain(copy)).resolves.toBeUndefined();
  }, 60_000);

  it("refuses through a whole entry start before its ahead check opens a venue.db not in WAL mode", async () => {
    const copy = await placedCopy(undefined, "delete");
    const before = hashes(copy);

    // No id in the process's environment: the start takes the copy's from the trading.env placement wrote.
    const thrown = await entryStart(copy, startEnv(copy, undefined));

    expect(thrown).toMatchObject({ code: UNACTIVATED });
    // Failing case, the refusal only after entry's ahead check: venue.db's hash moves.
    expect(hashes(copy)).toEqual(before);
    expect(headerJournalBytes(copy)).toEqual([1, 1]);
    await expect(placeAgain(copy)).resolves.toBeUndefined();
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
