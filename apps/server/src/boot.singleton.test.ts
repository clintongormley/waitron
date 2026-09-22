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
import { startServer } from "./boot.js";

/**
 * The primary-only SINGLETON duties (scheduled backup, outbound tunnel client) gate on
 * `singleton_role`, not on `mode` (promotion #158 follow-on). Since swap step 4 the outbox sync
 * SOURCE and retention sweep are deleted, so two singleton duties remain; this suite pins the
 * topology no other boot suite exercises WITH THE SINGLETON-DUTY CONFIGS WIRED: a SELL-ONLY LOCAL
 * SECONDARY — `deployment.mode='primary'` AND `singleton_role='secondary'` — which is NOT a mirror
 * (so `isMirror` is false and the old `!isMirror` gate ran all of them, the active-active
 * duplication this gate fixes) yet must run NEITHER, because the one singleton primary owns them.
 * TWO migrated venue directories holding the SAME identity: a `(primary, secondary)` one that runs
 * neither, and a default-`primary` one that runs both — the control proving the secondary's absence
 * is real, not a boot that silently wired nothing (CLAUDE.md §1).
 *
 * ## What the move off PostgreSQL took out of this file
 *
 * **The ROLE SPLIT is gone and is replaced by nothing.** The header used to say the container was
 * mandatory because boot reads `deployment` as the non-superuser app role. There are no roles on
 * this engine: `pg.connectAs` has no counterpart and `asAppUser` is an inert function
 * (`packages/db/src/testing/roles.ts`). Both boots below run every statement on the one connection
 * `openVenueStore` hands out, so nothing here now shows that the deployment role can read
 * `deployment` and cannot write it.
 *
 * **Boot owns the file, so the suite hands over a DIRECTORY and lets go of it.** `startServer`
 * opens `config.venueDir` itself and holds it for the life of the server, and it states that it
 * never holds two opens of one directory at once (`boot.ts:830-836`). The seeding handle each
 * directory gets below is therefore closed before `startServer` is called, and no test reads the
 * database back while a server is up. `DATABASE_URL` and `WAITRON_MIGRATIONS_DATABASE_URL` are not
 * set because nothing reads them any more:
 * `grep -rn "DATABASE_URL" apps/server/src --include="*.ts" | grep -v "\.test\.ts"` returns three
 * lines and all three are COMMENTS — `restore-command.ts:48`, `backup-config.ts:21` and
 * `testing/postgres.ts:5`, the retiring harness itself.
 */

vi.mock("@waitron/tunnel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/tunnel")>();
  return {
    ...actual,
    runTunnelClient: vi.fn(actual.runTunnelClient),
  };
});

// One shared module mock accumulates calls across tests, so clear the spy before each so the call-count
// assertions stay order-independent (boot.test.ts's own rule). `mockClear` keeps the spy's
// `vi.fn(actual.*)` call-through implementation, resetting only `mock.calls`.
beforeEach(() => {
  vi.mocked(runTunnelClient).mockClear();
});

// The till's fiscal identity — the four WAITRON_TILL_*_ID that put boot into TRADING mode (a secondary is
// a trading boot: it sells, it just files nothing and owns no singletons). Seeded in both venue
// directories so `readOrderFlow` / `readVenueLocale` resolve and the sync source (on the primary
// control) names this node.
const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// A `modules.json` resolving the two-member fiscal slot to Veri*Factu (disabling `fiscal-none`), so a
// trading boot does not refuse `module.fiscal_slot_ambiguous` under the default-on both-enabled set.
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-singleton-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  // Task 3: keep the plain-HTTP landing listener (default port 80) OUT of every boot test — 80 is
  // privileged, and a root CI container would otherwise stand up a live service on it. Its own
  // behaviour is proven directly in landing-listener.test.ts.
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

/**
 * Seed the venue identity — the taxpayer row, location, node, till and series — with the
 * WAITRON_TILL_*_ID into one already-migrated venue handle.
 */
async function seedIdentity(db: Database): Promise<void> {
  // Every row goes in through its TABLE DEFINITION, the same change `packages/db/src/testing/seed.ts`
  // and `testing/fiscal-fixtures.ts` took. Two reasons: a raw insert reaches no `$defaultFn`
  // generator, and `created_at` on `tenants`, `nodes` and `tills` is one of those on this engine; and
  // `array['en']::text[]` is PostgreSQL array syntax with a PostgreSQL cast operator, both refused at
  // prepare here. `on conflict do nothing` stays UNTARGETED, as the statements it replaces were —
  // narrowing it would be a behaviour change this conversion is not making.
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

/**
 * A fresh venue directory, migrated through the manifest and seeded, with the seeding handle CLOSED
 * again before it is returned.
 *
 * Closing is the point. `startServer` opens `config.venueDir` itself and keeps it open for the life
 * of the server, and it holds exactly one open of the directory at a time on purpose
 * (`boot.ts:830-836`); a handle left open here would be a SECOND write queue onto the same file.
 * The migration run is this suite's, not boot's, because the rows below have to exist before boot
 * reads them — boot's own `applyMigrations` over the same directory then finds nothing to do.
 */
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

  // The sell-only local secondary: stamp preproduction (so the deployment guard passes and
  // `setSingletonRole` has a row to update), then set singleton_role='secondary'. The mode column keeps
  // its default 'primary' — this is a `(primary, secondary)` node, valid under `deployment_role_valid_ck`
  // (a mirror could not hold 'secondary' this way; only a real primary-mode box can be a local secondary).
  secondaryVenueDir = await migratedVenueDir(async (db) => {
    await seedIdentity(db);
    await stampDeployment(db, "preproduction");
    await setSingletonRole(db, "secondary");
  });
  // The control keeps the column default ('primary', 'primary') — the singleton primary that owns both.
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

/** An OS-assigned free port, released before use (boot.test.ts's helper — WAITRON_HTTP_PORT rejects "0"). */
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

/** Poll `predicate` up to ~10s for its first defined value (boot.test.ts's shape). */
async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}

/** `boot.ts` hardcodes `process.stdout.write` as its log sink, so capturing it is the only way to observe
 * what it logs. Every chunk is forwarded to the real writer (boot.test.ts's own helper). */
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

/** True if any captured line's `event` is EXACTLY `event`. Exact, not prefix: `backup.disabled` and
 * `backup.disabled_open_failed` must be told apart — a non-primary logs the former (the duty is
 * skipped before the venue is ever opened), a primary whose venue will not open logs the latter. */
function hasEvent(lines: readonly string[], event: string): boolean {
  return lines.some((line) => {
    try {
      return (JSON.parse(line) as LogLine).event === event;
    } catch {
      return false;
    }
  });
}

// The singleton duties' config, present in FULL on both boots so the ONLY thing that decides whether
// they run is `singleton_role`. The relay is unreachable (port 1) on purpose: the real call-through
// worker backs off — this suite asserts the WIRING (started or not), never a live connection. Each
// boot fills in its own `WAITRON_VENUE_DIR`.
function dutyEnv(port: number) {
  return {
    ...KEY_ENV,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_TUNNEL_RELAY_URL: "tcp://127.0.0.1:1",
    WAITRON_TUNNEL_BOX_ID: "box-secondary",
    WAITRON_TUNNEL_TOKEN: "tunnel-secret",
  };
}

// The backup config goes through the RAW `base` arg (2nd `startServer` param), not the merged `env`:
// the supervisor re-reads its config off `loadBoxEnv(base, stateDir)` each reload, so a value only in
// `env` would never reach it.
//
// **A LEVER THIS PAIR OF CASES LOST, stated rather than quietly worked around.** It used to point
// the backup duty at an unreachable database (`WAITRON_BACKUP_DATABASE_URL`, port 1) so that a
// primary — and only a primary — emitted a loud `backup.disabled_probe_failed`. That setting is
// gone with PostgreSQL: the supervisor opens the box's own venue directory, and there is no way to
// make THAT open fail without breaking the whole server the suite is booting. The primary case's
// assertion below is therefore the weaker (but true) one — the primary does NOT take the
// non-primary branch — instead of the stronger "it reached the probe and failed it". Re-founding it
// belongs with whoever converts this suite's two-node harness; nothing in it runs today.
function backupBase() {
  return {
    WAITRON_BACKUP_DIR: backupDir,
    // Required since BR-1 Task 4 — without it loadBackupConfig throws backup.recovery_key_missing
    // before either boot reaches the wiring this suite asserts.
    WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
  };
}

describe("singleton-duty boot (deployment.singleton_role gating)", () => {
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
      // The loop's first sleep is logged strictly AFTER the (synchronous) boot has decided every gate
      // above — the backup/tunnel blocks run before `runLoop` — so once this line has arrived the backup
      // gate has been evaluated and the absence assertions below are not merely "not yet".
      await waitForEvent(captured, "loop.sleeping");
      return [started, captured] as const;
    });
    try {
      // 1. Backup — the supervisor is built and `reload()` runs on every boot, but a NON-PRIMARY takes
      // the disabled branch before the venue is ever opened: `backup.disabled` is logged. The primary
      // control below does NOT log it for the identical config, so this split is the gate (duty
      // skipped on the secondary, entered on the primary), not a missing config.
      expect(hasEvent(lines, "backup.disabled")).toBe(true);
      expect(hasEvent(lines, "backup.disabled_open_failed")).toBe(false);

      // 2. Tunnel client — not dialed (the primary control dials it once).
      expect(runTunnelClient).not.toHaveBeenCalled();

      // The secondary still SELLS: its fiscal pass runs as the trivial empty pass (singletonPass resolves a
      // non-singleton), so /health advances rather than draining/reconciling — the sell-only posture.
      await poll(() => server.health.lastPassAt ?? undefined);
      expect(server.health.lastPassAt).not.toBeNull();
    } finally {
      await server.close();
    }
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
      // The backup gate runs during the (synchronous) boot, so its `backup.*` line is emitted before the
      // first `loop.sleeping` — wait for that to be sure the gate has been decided before asserting.
      await waitForEvent(captured, "loop.sleeping");
      return [started, captured] as const;
    });
    try {
      // 1. Backup — the gate RAN: a singleton primary does not take the non-primary branch, so
      // `backup.disabled` is ABSENT here where the secondary above logs it. The positive twin of the
      // secondary's assertion. See `backupBase` for the stronger assertion this replaced and why its
      // lever no longer exists.
      expect(hasEvent(lines, "backup.disabled")).toBe(false);

      // 2. Tunnel client — dialed once.
      expect(runTunnelClient).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  }, 60_000);
});
