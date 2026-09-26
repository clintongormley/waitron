// The supervisor's lifecycle against a REAL migrated venue directory.
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
import { AppError } from "@waitron/shared";
import "./errors.js";

// Migrated once and COPIED per test: the sweep only reads the database and copies the file.
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

      // The archive's `db.dump` opens as a database and answers a query against the venue's schema.
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

  it("archives while a write transaction is held on another handle", async () => {
    // Shows the archive lands while a transaction is held, not which handle the supervisor opened:
    // the store routes it to the read connection either way (`packages/store/src/index.test.ts`).
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
    // Without `transactionOpen` the archive could land before the transaction started.
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
    // A tick completes but stores nothing, so a "a tick ran" flag would be wrong here.
    const dest = await makeDestDir();
    await chmod(dest, 0o500);
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
      // False because it failed, not because it has not run yet.
      await waitForEvent(refs, "backup.destination_failed");
      expect(await listArchives(dest)).toEqual([]);
      expect((await sup.status()).archiveUnderCurrentKey).toBe(false);
    } finally {
      await sup.stop();
      await chmod(dest, 0o700);
    }
  }, 60_000);

  it("a copied old-key archive with a post-reload mtime does NOT make archiveUnderCurrentKey true", async () => {
    // An mtime does not prove the key: a copied old-key archive can land with a fresh one.
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
      // Only the copy fails, so the tick reaches it.
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
      await waitForEvent(refs, "backup.failed");
      await writeFile(join(dest, "waitron-20200101T000000Z.backup.enc"), "old-key-ciphertext");
      const s = await sup.status();
      // Visible to the freshness read…
      expect(s.backupStatus.configured).toBe(true);
      if (s.backupStatus.configured) {
        expect(s.backupStatus.destinations[0].lastBackupAt).not.toBeNull();
      }
      // …but this sweep stored nothing under the current key.
      expect(s.archiveUnderCurrentKey).toBe(false);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("an old-key archive stored while reload() waits for the old sweep does NOT make archiveUnderCurrentKey true", async () => {
    const dest = await makeDestDir();
    const venueDir = await makeVenueDir();
    const refs: Refs = {
      config: localFsConfig([dest], STRONG_KEY_1),
      role: "primary",
      venueDir,
      logs: [],
      managed: false,
    };
    let entered!: () => void;
    const oldCopyEntered = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    const oldCopyReleased = new Promise<void>((r) => (release = r));
    let opens = 0;
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
      // The first sweep's copy is held until the second reload is waiting for it; the second
      // sweep's copy fails, so nothing is ever stored under the new key.
      openVenue: async (dir) => {
        const first = opens++ === 0;
        const opened = await openVenueDatabase(dir);
        const realArchive = opened.venue.archiveTo.bind(opened.venue);
        const venue = Object.assign(
          Object.create(Object.getPrototypeOf(opened.venue) as object),
          opened.venue,
          {
            archiveTo: first
              ? async (outFile: string) => {
                  entered();
                  await oldCopyReleased;
                  return realArchive(outFile);
                }
              : () => Promise.reject(new Error("the new sweep stores nothing")),
          },
        ) as typeof opened.venue;
        return { ...opened, venue };
      },
    });
    try {
      await sup.reload();
      await oldCopyEntered;
      refs.config = localFsConfig([dest], STRONG_KEY_2);
      const reloading = sup.reload();
      release();
      await reloading;
      await waitForEvent(refs, "backup.failed");

      // The old sweep did store, under the old key, during the reload.
      const [archive] = await listArchives(dest);
      expect(archive).toBeDefined();
      const bytes = await readFile(join(dest, archive!));
      expect(() => decryptArtifact(bytes, STRONG_KEY_1)).not.toThrow();
      expect(sup.current().keyFingerprint).toBe(keyFingerprint(STRONG_KEY_2));
      expect((await sup.status()).archiveUnderCurrentKey).toBe(false);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("a venue directory that will not open leaves backup off and never throws at the caller", async () => {
    // The positive twin is `enable from off` above.
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
      await new Promise((r) => setTimeout(r, 300));
      expect(await listArchives(dest)).toEqual([]);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("a concurrent reload is refused with backup.reload_in_progress (latched)", async () => {
    // A hanging `buildConfig` holds the first reload inside its critical section.
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
    // Without the `#stopped` guard, a reload interleaved with `stop()` would open the venue and start
    // a sweep after `stop()` returned.
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
    const reloading = sup.reload();
    await sup.stop();
    await reloading.catch(() => {});
    // A window for a leaked worker to start.
    await new Promise((r) => setTimeout(r, 300));
    expect(sup.current().enabled).toBe(false);
    expect(opened).toBe(closed);
  }, 60_000);
});

describe("BackupSupervisor — stop() landing inside a reload, and a worker that fails", () => {
  function gate() {
    let release!: () => void;
    let entered!: () => void;
    const released = new Promise<void>((r) => {
      release = r;
    });
    const reached = new Promise<void>((r) => {
      entered = r;
    });
    return { release, entered, released, reached };
  }

  it("adopts no config and opens nothing when stop() lands while the config is being read", async () => {
    const dest = await makeDestDir();
    const reading = gate();
    let opens = 0;
    const sup = new BackupSupervisor({
      buildConfig: async () => {
        reading.entered();
        await reading.released;
        return localFsConfig([dest], STRONG_KEY_1);
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
      openVenue: async (dir) => {
        opens += 1;
        return openVenueDatabase(dir);
      },
    });
    const reloading = sup.reload();
    await reading.reached;
    await sup.stop();
    reading.release();
    await reloading;

    expect(opens).toBe(0);
    expect(sup.current()).toMatchObject({ enabled: false, destinations: [], schedule: undefined });
  });

  it("closes the venue it just opened, even if closing fails, when stop() lands during the open", async () => {
    const dest = await makeDestDir();
    const opening = gate();
    let closes = 0;
    const logs: LogLine[] = [];
    const sup = new BackupSupervisor({
      buildConfig: async () => localFsConfig([dest], STRONG_KEY_1),
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      venueDir: await makeVenueDir(),
      modules: ALL_MODULES,
      environment: "production",
      stateDir: await makeStateDir(),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: (level, event) => logs.push({ level, event }),
      openVenue: async () => {
        opening.entered();
        await opening.released;
        return {
          close: async () => {
            closes += 1;
            throw new Error("closing failed");
          },
        } as unknown as VenueDatabase;
      },
    });
    const reloading = sup.reload();
    await opening.reached;
    await sup.stop();
    opening.release();

    await expect(reloading).resolves.toBeUndefined();
    expect(closes).toBe(1);
    expect(sup.current().enabled).toBe(false);
    expect(logs).toEqual([]);
  });

  it("logs a sweep that rejects as backup.worker_rejected, and stop() still settles when the handle will not close", async () => {
    const dest = await makeDestDir();
    const lines: Array<{ level: string; event: string; fields: unknown }> = [];
    let closes = 0;
    const sup = new BackupSupervisor({
      buildConfig: async () => localFsConfig([dest], STRONG_KEY_1),
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      venueDir: await makeVenueDir(),
      modules: ALL_MODULES,
      environment: "production",
      stateDir: await makeStateDir(),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: (level, event, fields) => lines.push({ level, event, fields }),
      openVenue: async (dir) => {
        const store = await openVenueDatabase(dir);
        return {
          venue: store.venue,
          node: store.node,
          close: async () => {
            closes += 1;
            await store.close();
            throw new Error("closing failed");
          },
        };
      },
      // The sweep's wait between copies is outside its per-tick handling, so a failing wait rejects
      // the whole sweep.
      sleep: () => Promise.reject(new AppError("backup.reload_in_progress", {})),
    });
    try {
      await sup.reload();
      await poll(async () =>
        lines.some((l) => l.event === "backup.worker_rejected") ? true : undefined,
      );
      expect(lines.find((l) => l.event === "backup.worker_rejected")).toEqual({
        level: "error",
        event: "backup.worker_rejected",
        fields: { errorCode: "backup.reload_in_progress" },
      });
    } finally {
      await expect(sup.stop()).resolves.toBeUndefined();
    }
    expect(closes).toBe(1);
    expect(sup.current().enabled).toBe(false);
  }, 60_000);
});
