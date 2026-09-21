// The supervisor's lifecycle against a REAL migrated venue directory: enable from off writes an
// encrypted archive, a destination change stops the old sweep, a key rotation copies immediately
// under the new key, a non-primary node runs no duty, a second concurrent `reload()` is refused, and
// a `stop()` racing a `reload()` leaves nothing open.
//
// **What this file used to be, and what was lost.** It was `backup-supervisor.pg.test.ts`, a real
// PostgreSQL suite whose whole point was a DERIVED non-superuser OWNER connection that a boot
// privilege probe accepted. Two of its cases — the owner connection passing the probe, and a reader
// that could not read the migration journals being refused — are DELETED rather than converted, with
// nothing replacing them: the probe asked `pg_class` / `has_table_privilege` whether a role could
// read the fiscal tables, and SQLite has neither roles nor that catalogue. Their only sibling,
// backup-probe.test.ts, is deleted for the same reason, so NOTHING now covers a backup-read
// privilege check — because there is no longer one to cover. Recorded so the loss is visible rather
// than inferred from a shorter file.
//
// What replaces them is the case this engine makes necessary and the old one could not have:
// `archives on its own connection`, below.
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openVenueDatabase,
  runMigrations,
  type SingletonRole,
  type VenueDatabase,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decryptArtifact } from "./artifact-cipher.js";
import { unpackArchive } from "./backup-archive.js";
import type { BackupConfig } from "./backup-config.js";
import { BackupSupervisor, keyFingerprint } from "./backup-supervisor.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import "./errors.js";

// One migrated venue directory, built once and COPIED per test that needs its own. The sweep only
// READS the database (the manifest's journal counts) and copies the file, so a copy is a faithful
// stand-in and migrating once keeps the suite off a per-test migration run.
let templateDir: string;
const scratch: string[] = [];

async function makeVenueDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-bsup-venue-"));
  scratch.push(dir);
  await cp(templateDir, dir, { recursive: true });
  return dir;
}

beforeAll(async () => {
  templateDir = await mkdtemp(join(tmpdir(), "waitron-bsup-template-"));
  scratch.push(templateDir);
  const store = await openVenueDatabase(templateDir);
  try {
    for (const options of migrationOptionsFor(manifestSets(), null)) {
      await runMigrations(store.venue, options);
    }
  } finally {
    // Closed before anything copies the directory, so the copy is not taken mid-write.
    await store.close();
  }
}, 120_000);

const STRONG_KEY_1 = "recovery-key-one-strong";
const STRONG_KEY_2 = "recovery-key-two-different";

type LogLine = { level: string; event: string };

interface Refs {
  config: BackupConfig | undefined;
  role: SingletonRole;
  venueDir: string;
  logs: LogLine[];
  managed: boolean;
}

async function makeStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-bsup-state-"));
  scratch.push(dir);
  await mkdir(join(dir, "tls"), { recursive: true });
  // `collectStateSecrets` fails the tick unless every RECOVERY_FILES path exists.
  for (const rel of RECOVERY_FILES) await writeFile(join(dir, rel), `dummy ${rel}`);
  return dir;
}

async function makeDestDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-bsup-dest-"));
  scratch.push(dir);
  return dir;
}

function localFsConfig(dirs: string[], recoveryKey: string): BackupConfig {
  return {
    destinations: dirs.map((dir, i) => ({
      kind: "local-fs",
      id: i === 0 ? "primary" : `d${i}`,
      dir,
    })),
    recoveryKey,
    schedule: { kind: "interval", ms: 60 * 60 * 1000 }, // hourly: one immediate copy, then it sleeps
    retain: 7,
    retainDays: 30,
    staleAfterMs: 2 * 24 * 60 * 60 * 1000,
    keyRotatedAt: undefined,
  };
}

function makeSupervisor(refs: Refs, stateDir: string): BackupSupervisor {
  return new BackupSupervisor({
    buildConfig: async () => refs.config,
    isManagedByEnvironment: () => refs.managed,
    readSingletonRole: () => refs.role,
    venueDir: refs.venueDir,
    modules: ALL_MODULES,
    environment: "production",
    stateDir,
    jitterSeed: "seed",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
    log: (level, event) => refs.logs.push({ level, event }),
  });
}

async function listArchives(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => n.startsWith("waitron-") && n.endsWith(".backup.enc")).sort();
}

async function poll<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() >= end) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitForArchive(dir: string): Promise<string[]> {
  return poll(async () => {
    const arch = await listArchives(dir);
    return arch.length > 0 ? arch : undefined;
  });
}

async function waitForEvent(refs: Refs, event: string): Promise<void> {
  await poll(async () => (refs.logs.some((l) => l.event === event) ? true : undefined));
}

afterAll(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("BackupSupervisor lifecycle (a real migrated venue directory)", () => {
  it("enable from off writes an archive whose db.dump opens as the venue database", async () => {
    const dest = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      venueDir: await makeVenueDir(),
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir());
    try {
      await sup.reload();
      const [name] = await waitForArchive(dest);
      expect(sup.current().enabled).toBe(true);
      expect(sup.current().keyFingerprint).toBe(keyFingerprint(STRONG_KEY_1));
      expect((await sup.status()).archiveUnderCurrentKey).toBe(true);

      // The archive's `db.dump` entry is the real thing, not a placeholder a fake runner wrote: it
      // opens as a database and answers a query the venue's own schema supports. This is the step's
      // stated bar — take an archive, open it, read from it — reached through the PRODUCT path.
      const entries = unpackArchive(
        decryptArtifact(await readFile(join(dest, name!)), STRONG_KEY_1),
      );
      const copy = join(await makeDestDir(), "restored.db");
      await writeFile(copy, Buffer.from(entries.find((e) => e.name === "db.dump")!.bytes));
      const { DatabaseSync } = await import("node:sqlite");
      const opened = new DatabaseSync(copy);
      try {
        const rows = opened
          .prepare(
            "select count(*) as n from sqlite_master where type = 'table' and name = 'tenants'",
          )
          .all() as { n: number }[];
        expect(rows[0]!.n).toBe(1);
      } finally {
        opened.close();
      }
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("archives on its own connection, so a write transaction held elsewhere does not block it", async () => {
    // The reason the supervisor opens the venue ITSELF rather than taking boot's handle. `VACUUM
    // INTO` is refused on a connection with a transaction open — `cannot VACUUM from within a
    // transaction`, errcode 1, no file written, measured on Node v26.7.0 in
    // `/tmp/f1-restore-probe/vacuum-concurrency.mjs` — while a SECOND connection to the same file
    // succeeds and copies the COMMITTED state. So: hold a write transaction open on another handle
    // to this very directory for the whole of the supervisor's first tick, and require the archive
    // to land anyway.
    //
    // The control is the inversion, and it is not hypothetical: handing this suite's own `boot`
    // handle in through `openVenue` makes the tick fail with that message instead.
    const dest = await makeDestDir();
    const venueDir = await makeVenueDir();
    const boot = await openVenueDatabase(venueDir);
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      venueDir,
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir());
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let opened!: () => void;
    const transactionOpen = new Promise<void>((r) => {
      opened = r;
    });
    // Holds `begin immediate` on boot's connection until the archive has landed. `transactionOpen`
    // removes the race the measurement would otherwise rest on: without it the archive could land
    // before the transaction ever started, and the case would pass while proving nothing.
    const transaction = boot.venue.withWriteLock(async () => {
      opened();
      await held;
    });
    try {
      await transactionOpen;
      await sup.reload();
      await waitForArchive(dest);
      expect(refs.logs.some((l) => l.event === "backup.failed")).toBe(false);
    } finally {
      release();
      await transaction;
      await sup.stop();
      await boot.close();
    }
  }, 60_000);

  it("change destination closes the old handle and writes to the new dir", async () => {
    const destA = await makeDestDir();
    const destB = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([destA], STRONG_KEY_1),
      role: "primary",
      venueDir: await makeVenueDir(),
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir());
    try {
      await sup.reload();
      await waitForArchive(destA);
      const aCount = (await listArchives(destA)).length;

      refs.config = localFsConfig([destB], STRONG_KEY_1);
      await sup.reload();
      await waitForArchive(destB);
      // A stops receiving (its worker + handle were torn down on the reload); B now receives.
      expect((await listArchives(destA)).length).toBe(aCount);
      expect((await listArchives(destB)).length).toBeGreaterThan(0);
      expect(sup.current().destinations.map((d) => d.dir)).toEqual([destB]);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("rotate takes an immediate copy under the new key and updates the fingerprint", async () => {
    const dest = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      venueDir: await makeVenueDir(),
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir());
    try {
      await sup.reload();
      await waitForArchive(dest);
      expect(sup.current().keyFingerprint).toBe(keyFingerprint(STRONG_KEY_1));

      refs.config = localFsConfig([dest], STRONG_KEY_2);
      await sup.reload();
      // Poll until the NEWEST artifact decrypts under K2 — i.e. a fresh archive landed under the
      // rotated key (wrong-key decrypt throws `recovery.passphrase_invalid`).
      await poll(async () => {
        const arch = await listArchives(dest);
        const newest = arch[arch.length - 1];
        if (newest === undefined) return undefined;
        try {
          const plain = decryptArtifact(await readFile(join(dest, newest)), STRONG_KEY_2);
          return unpackArchive(plain).some((e) => e.name === "manifest.json") ? true : undefined;
        } catch {
          return undefined;
        }
      });
      expect(sup.current().keyFingerprint).toBe(keyFingerprint(STRONG_KEY_2));
      expect((await sup.status()).archiveUnderCurrentKey).toBe(true);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("archiveUnderCurrentKey is false when every destination fails", async () => {
    // The Task 3 carry: a "a tick ran" flag would have lied here. An unwritable dest dir makes every
    // `put` fail (EACCES, swallowed as `backup.destination_failed`); nothing is stored, so the derived
    // flag stays FALSE even though a tick completed.
    const dest = await makeDestDir();
    await chmod(dest, 0o500); // read+execute, no write
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      venueDir: await makeVenueDir(),
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir());
    try {
      await sup.reload();
      // Wait for the fan-out to have RUN and failed (the measurement's control: false-because-failed,
      // not false-because-not-yet-run).
      await waitForEvent(refs, "backup.destination_failed");
      expect(await listArchives(dest)).toEqual([]);
      expect((await sup.status()).archiveUnderCurrentKey).toBe(false);
    } finally {
      await sup.stop();
      await chmod(dest, 0o700); // restore so the cleanup can remove it
    }
  }, 60_000);

  it("a copied old-key archive with a post-reload mtime does NOT make archiveUnderCurrentKey true", async () => {
    // The mtime regression: `archiveUnderCurrentKey` used to be derived from a stored object's mtime
    // (lastBackupAt >= reloadedAt). A restored/rsynced OLD-key archive that lands with a FRESH mtime
    // would then read as "an archive under the current key" while it decrypts under a different key —
    // mtime does not prove the key. Here the running sweep stores NOTHING (its copy throws), yet a
    // fresh-mtime archive sits in the dest; the flag must stay false because THIS sweep never stored.
    const dest = await makeDestDir();
    const venueDir = await makeVenueDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      venueDir,
      logs: [],
      managed: false,
    };
    const sup = new BackupSupervisor({
      buildConfig: async () => refs.config,
      isManagedByEnvironment: () => refs.managed,
      readSingletonRole: () => refs.role,
      venueDir,
      modules: ALL_MODULES,
      environment: "production",
      stateDir: await makeStateDir(),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: (level, event) => refs.logs.push({ level, event }),
      // A venue whose archive step fails, so the sweep stores nothing under the current key. The
      // rest of the handle is the real one, so the manifest read still works and the tick reaches
      // the copy before it fails.
      openVenue: async (dir) => {
        const opened = await openVenueDatabase(dir);
        const venue = Object.assign(
          Object.create(Object.getPrototypeOf(opened.venue) as object),
          opened.venue,
          {
            archiveTo: () =>
              Promise.reject(new Error("the copy fails so the sweep stores nothing")),
          },
        ) as typeof opened.venue;
        return { ...opened, venue };
      },
    });
    try {
      await sup.reload();
      await waitForEvent(refs, "backup.failed"); // the tick ran and stored nothing
      // A copied old-key archive lands NOW (post-reload) with a fresh mtime — not written by our sweep.
      await writeFile(join(dest, "waitron-20200101T000000Z.backup.enc"), "old-key-ciphertext");
      const s = await sup.status();
      // The fresh file IS visible to the freshness read (so the OLD mtime path would have said true)…
      expect(s.backupStatus.configured).toBe(true);
      if (s.backupStatus.configured) {
        expect(s.backupStatus.destinations[0].lastBackupAt).not.toBeNull();
      }
      // …but the in-process flag knows THIS sweep stored nothing under the current key.
      expect(s.archiveUnderCurrentKey).toBe(false);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("a venue directory that will not open leaves backup off and never throws at the caller", async () => {
    // The positive twin is `enable from off` above. Here the SAME config points at a directory whose
    // `venue.db` is not a database — `file is not a database`, errcode 26 on Node v26.7.0 — so the
    // open fails. Backup is left OFF and the failure is logged, never propagated: a broken backup
    // duty must not brick the till (CLAUDE.md §5). The log tag names the OPEN, because an open is
    // all that happens here — there is no privilege probe left to have run.
    const dest = await makeDestDir();
    const venueDir = await makeDestDir();
    await writeFile(join(venueDir, "venue.db"), "not a database, just bytes");
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      venueDir,
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir());
    try {
      await expect(sup.reload()).resolves.toBeUndefined();
      expect(refs.logs.some((l) => l.event === "backup.disabled_open_failed")).toBe(true);
      expect(sup.current().enabled).toBe(false);
      await new Promise((r) => setTimeout(r, 300));
      expect(await listArchives(dest)).toEqual([]);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("a non-primary node runs no duty", async () => {
    const dest = await makeDestDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "secondary",
      venueDir: await makeVenueDir(),
      logs: [],
      managed: false,
    };
    const sup = makeSupervisor(refs, await makeStateDir());
    try {
      await sup.reload();
      expect(sup.current().enabled).toBe(false);
      expect(refs.logs.some((l) => l.event === "backup.disabled")).toBe(true);
      // Nothing was opened, no worker started — so no archive can ever land.
      await new Promise((r) => setTimeout(r, 300));
      expect(await listArchives(dest)).toEqual([]);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("a concurrent reload is refused with backup.reload_in_progress (latched)", async () => {
    // No database needed: a `buildConfig` that hangs holds the first reload inside its critical
    // section, so the second reload hits the `#reloading` latch and throws. Release the first to let
    // it settle.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const sup = new BackupSupervisor({
      buildConfig: async () => {
        await gate;
        return undefined;
      },
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      venueDir: await makeVenueDir(),
      modules: ALL_MODULES,
      environment: "production",
      stateDir: await makeStateDir(),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: () => {},
    });
    const first = sup.reload();
    await expect(sup.reload()).rejects.toMatchObject({ code: "backup.reload_in_progress" });
    release();
    await first;
    await sup.stop();
  });

  it("a stop() racing a reload() leaves no running worker and no open database", async () => {
    // Step 8b: `apply`/`rotate` now call `reload()` on a live box, so a shutdown `stop()` can interleave
    // with an in-flight `reload()` at an await point. Without the `#stopped` guard, `stop()` tears down
    // BEFORE `reload()` opens the venue and starts its worker, so the reload would leave a sweep +
    // open files running after `stop()` returned. The invariant that catches that: every handle the
    // supervisor opens is also closed (opened === closed), and after settle no duty is enabled.
    const dest = await makeDestDir();
    let opened = 0;
    let closed = 0;
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      venueDir: await makeVenueDir(),
      logs: [],
      managed: false,
    };
    const sup = new BackupSupervisor({
      buildConfig: async () => refs.config,
      isManagedByEnvironment: () => refs.managed,
      readSingletonRole: () => refs.role,
      venueDir: refs.venueDir,
      modules: ALL_MODULES,
      environment: "production",
      stateDir: await makeStateDir(),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: (level, event) => refs.logs.push({ level, event }),
      // Count every venue the supervisor opens and closes — the leak-detector for the race.
      openVenue: async (dir): Promise<VenueDatabase> => {
        const store = await openVenueDatabase(dir);
        opened += 1;
        const orig = store.close.bind(store);
        return {
          venue: store.venue,
          node: store.node,
          close: async () => {
            closed += 1;
            await orig();
          },
        };
      },
    });
    // Fire the reload and, WITHOUT awaiting it, race a stop() against it — the two interleave at the
    // reload's await points (teardown → buildConfig → openVenue).
    const reloading = sup.reload();
    await sup.stop();
    await reloading.catch(() => {});
    // Let any leaked worker (there must be none) have a window to open/start.
    await new Promise((r) => setTimeout(r, 300));
    expect(sup.current().enabled).toBe(false); // no running duty (#db torn down / never assigned)
    expect(opened).toBe(closed); // every opened venue was closed — nothing leaked
  }, 60_000);
});
