import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  setSingletonRole,
  stampDeployment,
  tenants,
  tills,
  type Database,
} from "@waitron/db";
import { runTunnelClient } from "@waitron/tunnel";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createCloudSnapshotWorker } from "./cloud-snapshot-worker.js";
import { runCloudSnapshotLoop } from "./cloud-snapshot-loop.js";
import { startServer } from "./boot.js";

/**
 * A sell-only local secondary — `node_roles.mode='primary'` with `singleton_role='secondary'` — is
 * not a mirror, yet must run neither singleton duty (scheduled backup, outbound tunnel client),
 * because the one singleton primary owns them. A default-`primary` directory of the same identity is
 * the control that runs both, so the secondary's absence is not a boot that wired nothing.
 *
 * Each seeding handle is closed before `startServer` is called, and no test reads the database
 * while a server is up.
 */

vi.mock("./cloud-snapshot-worker.js", async (original) => {
  const actual = await original<typeof import("./cloud-snapshot-worker.js")>();
  return { ...actual, createCloudSnapshotWorker: vi.fn(actual.createCloudSnapshotWorker) };
});
vi.mock("./cloud-snapshot-loop.js", async (original) => {
  const actual = await original<typeof import("./cloud-snapshot-loop.js")>();
  return { ...actual, runCloudSnapshotLoop: vi.fn(actual.runCloudSnapshotLoop) };
});
vi.mock("@waitron/tunnel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/tunnel")>();
  return {
    ...actual,
    runTunnelClient: vi.fn(actual.runTunnelClient),
  };
});

beforeEach(() => {
  vi.mocked(runTunnelClient).mockClear();
  vi.mocked(createCloudSnapshotWorker).mockClear();
  vi.mocked(runCloudSnapshotLoop).mockClear();
});

const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// Disables `fiscal-none` so a trading boot does not refuse `module.fiscal_slot_ambiguous`.
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-singleton-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  // Keeps the plain-HTTP landing listener off privileged port 80.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
  ...TILL_ENV,
};

let migrationsRoot: string;
let backupDir: string;
let secondaryVenueDir: string;
let primaryVenueDir: string;

async function seedIdentity(db: Database): Promise<void> {
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90333333P", legalName: "Secondary SL" })
    .onConflictDoNothing();
  await db
    .insert(locations)
    .values({
      id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Loc",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  await db
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_TILL_NODE_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Node",
    })
    .onConflictDoNothing();
  await db
    .insert(tills)
    .values({
      id: TILL_ENV.WAITRON_TILL_TILL_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Till",
    })
    .onConflictDoNothing();
  await db
    .insert(invoiceSeries)
    .values({
      id: TILL_ENV.WAITRON_TILL_SERIES_ID,
      nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
      code: "A",
    })
    .onConflictDoNothing();
}

/** Migrated and seeded here, not by boot, because the rows have to exist before boot reads them. */
async function migratedVenueDir(seed: (db: Database) => Promise<void>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-singleton-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  try {
    await seed(store.venue);
  } finally {
    await store.close();
  }
  return directory;
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-singleton-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  backupDir = await mkdtemp(join(tmpdir(), "waitron-singleton-backup-"));

  // The mode keeps its default 'primary': a `(primary, secondary)` node.
  secondaryVenueDir = await migratedVenueDir(async (db) => {
    await seedIdentity(db);
    await stampDeployment(db, "preproduction");
    await setSingletonRole(db, TILL_ENV.WAITRON_TILL_NODE_ID, "secondary");
  });
  // No `node_roles` row: `readDeploymentAxes` reads it as ('primary', 'primary').
  primaryVenueDir = await migratedVenueDir(async (db) => {
    await seedIdentity(db);
    await stampDeployment(db, "preproduction");
  });
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  if (backupDir !== undefined) await rm(backupDir, { recursive: true, force: true });
  if (secondaryVenueDir !== undefined)
    await rm(secondaryVenueDir, { recursive: true, force: true });
  if (primaryVenueDir !== undefined) await rm(primaryVenueDir, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

/** `WAITRON_HTTP_PORT` refuses "0", so the OS picks a free port first. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Poll `predicate` up to ~10s for its first defined value. */
async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}

/** `boot.ts` logs to `process.stdout.write`; every chunk is still forwarded to the real writer. */
async function withCapturedStdout<T>(fn: (lines: string[]) => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    lines.push(...String(chunk).split("\n").filter(Boolean));
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    return await fn(lines);
  } finally {
    process.stdout.write = original;
  }
}

interface LogLine {
  event: string;
  [key: string]: unknown;
}

/** The first captured line naming `event`, waiting for it to arrive rather than assuming it already has. */
async function waitForEvent(lines: readonly string[], event: string): Promise<LogLine> {
  const found = await poll(() => {
    for (const line of lines) {
      let parsed: LogLine | undefined;
      try {
        parsed = JSON.parse(line) as LogLine;
      } catch {
        continue;
      }
      if (parsed.event === event) return parsed;
    }
    return undefined;
  });
  if (found === undefined) {
    throw new Error(
      `expected a "${event}" log line within the wait window, saw: ${lines.join("\n")}`,
    );
  }
  return found;
}

/** Exact, not prefix: `backup.disabled` and `backup.disabled_open_failed` must be told apart. */
function hasEvent(lines: readonly string[], event: string): boolean {
  return lines.some((line) => {
    try {
      return (JSON.parse(line) as LogLine).event === event;
    } catch {
      return false;
    }
  });
}

// Full duty config on both boots, so only `singleton_role` decides whether the duties run. The relay
// is unreachable on purpose: the suite asserts the wiring, never a live connection.
function dutyEnv(port: number) {
  return {
    ...KEY_ENV,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_TUNNEL_RELAY_URL: "tcp://127.0.0.1:1",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    WAITRON_TUNNEL_BOX_ID: "box-secondary",
    WAITRON_TUNNEL_TOKEN: "tunnel-secret",
  };
}

// Passed as `startServer`'s RAW `base`, not the merged `env`: the supervisor re-reads its config off
// `loadBoxEnv(base, stateDir)` on each reload.
//
// Weaker than it looks: the primary case asserts only that it does NOT take the non-primary branch,
// not that its backup duty ran — the suite has no way to fail the supervisor's open of the venue
// without breaking the boot.
function backupBase() {
  return {
    WAITRON_BACKUP_DIR: backupDir,
    // Without it `loadBackupConfig` throws `backup.recovery_key_missing` before the wiring asserted.
    WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
  };
}

describe("singleton-duty boot (node_roles.singleton_role gating)", () => {
  it("a sell-only local secondary (primary, secondary) runs NEITHER singleton duty, though it is not a mirror", async () => {
    const port = await freePort();
    const [server, lines] = await withCapturedStdout(async (captured) => {
      const started = await startServer(
        {
          ...dutyEnv(port),
          WAITRON_VENUE_DIR: secondaryVenueDir,
        },
        backupBase(),
      );
      // Logged only after boot has decided every duty gate, so the absences below are not "not yet".
      await waitForEvent(captured, "loop.sleeping");
      return [started, captured] as const;
    });
    try {
      expect(hasEvent(lines, "backup.disabled")).toBe(true);
      expect(hasEvent(lines, "backup.disabled_open_failed")).toBe(false);

      expect(runTunnelClient).not.toHaveBeenCalled();
      expect(createCloudSnapshotWorker).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createCloudSnapshotWorker).mock.calls[0]![0].isPrimary()).toBe(false);

      // The secondary still sells: its fiscal pass runs empty, so /health still advances.
      await poll(() => server.health.lastPassAt ?? undefined);
      expect(server.health.lastPassAt).not.toBeNull();
    } finally {
      await server.close();
    }
    expect(vi.mocked(runCloudSnapshotLoop).mock.calls[0]?.[0].signal.aborted).toBe(true);
  }, 60_000);

  it("the singleton primary (primary, primary) of the same identity DOES run both (control: the secondary's absence is real)", async () => {
    const port = await freePort();
    const [server, lines] = await withCapturedStdout(async (captured) => {
      const started = await startServer(
        {
          ...dutyEnv(port),
          WAITRON_VENUE_DIR: primaryVenueDir,
        },
        backupBase(),
      );
      await waitForEvent(captured, "loop.sleeping");
      return [started, captured] as const;
    });
    try {
      // See `backupBase` for why this is the only backup assertion.
      expect(hasEvent(lines, "backup.disabled")).toBe(false);

      expect(runTunnelClient).toHaveBeenCalledTimes(1);
      expect(createCloudSnapshotWorker).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createCloudSnapshotWorker).mock.calls[0]![0].isPrimary()).toBe(true);
      expect(runCloudSnapshotLoop).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
    expect(vi.mocked(runCloudSnapshotLoop).mock.calls[0]?.[0].signal.aborted).toBe(true);
  }, 60_000);
});
