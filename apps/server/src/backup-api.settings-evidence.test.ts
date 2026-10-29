// `GET /api/backup/settings-evidence` on a real venue database, one case per row of the design's
// cause table: each failure is produced by a real supervisor loading the record as boot does.
import { mkdtempSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { deleteCredential, loadKeyRing, putCredential, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue } from "@waitron/provisioning";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import {
  ARCHIVE_PURPOSE,
  archiveNamespace,
  archiveRecord,
  readArchiveSettingsWithMeta,
  writeArchiveSettings,
  type ArchiveSettings,
} from "./archive-settings.js";
import { mountBackupApi, type BackupApiDeps } from "./backup-api.js";
import { isBackupManagedByEnvironment, loadBackupSettings } from "./backup-config.js";
import { loadBoxEnv } from "./box-env.js";
import { readSettingsEvidence, type SettingsEvidenceDeps } from "./backup-settings-evidence.js";
import { BackupSupervisor, keyFingerprint } from "./backup-supervisor.js";
import { createTurns } from "./backup-turns.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const PASSWORD = "correct horse";
const MANAGER_EMAIL = "manager@x.com";
const KEY_1 = "recovery-key-one-strong";
const VENUE = "c0000000-0000-4000-8000-000000000002";
const ringOf = (byte: number, version: string, previous?: { byte: number; version: string }) =>
  loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, byte).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: version,
    ...(previous === undefined
      ? {}
      : {
          WAITRON_CREDENTIALS_KEY_PREVIOUS: Buffer.alloc(32, previous.byte).toString("base64"),
          WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: previous.version,
        }),
  });
const RING = ringOf(7, "1");

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

const venueDir = mkdtempSync(join(tmpdir(), "settings-evidence-venue-"));
const cleanup: (() => Promise<void>)[] = [];

const DAILY = { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } } as const;
const BUCKET = {
  endpoint: "https://s3.example.test",
  region: "eu-west-1",
  bucket: "venue-archives",
  prefix: "waitron",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "bucket-secret-value",
};

function folderSettings(dir: string): Omit<ArchiveSettings, "revision"> {
  return {
    enabled: true,
    destinations: [{ kind: "local-fs", id: "primary", dir }],
    schedule: DAILY,
    retention: { count: 7, days: 30 },
    destinationTimeoutMs: 60_000,
  };
}

interface Scenario {
  stateDir: string;
  base: NodeJS.ProcessEnv;
  /** The box's key ring now; the record may have been written under another. */
  ring: KeyRing;
  clock: { at: Date };
}

async function scenario(over: Partial<Scenario> = {}): Promise<Scenario> {
  const stateDir = mkdtempSync(join(tmpdir(), "settings-evidence-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  return {
    stateDir,
    base: {},
    ring: RING,
    clock: { at: new Date("2026-10-29T09:00:00.000Z") },
    ...over,
  };
}

function makeSupervisor(sc: Scenario): BackupSupervisor {
  const sup = new BackupSupervisor({
    buildConfig: async () =>
      loadBackupSettings({
        managedByEnvironment: isBackupManagedByEnvironment(sc.base),
        env: await loadBoxEnv(sc.base, sc.stateDir),
        readSealedWithMeta: () => readArchiveSettingsWithMeta(suite.db, sc.ring),
        venueId: VENUE,
      }),
    isManagedByEnvironment: () => isBackupManagedByEnvironment(sc.base),
    // A secondary starts no sweep, so a clean load writes nothing into the folders these cases look at.
    readSingletonRole: () => "secondary",
    venueDir,
    modules: ALL_MODULES,
    environment: "production",
    stateDir: sc.stateDir,
    jitterSeed: "seed",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
    now: () => sc.clock.at,
    log: () => {},
  });
  cleanup.push(() => sup.stop());
  return sup;
}

function buildApp(sup: BackupSupervisor, sc: Scenario, extra: Partial<BackupApiDeps> = {}): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  mountBackupApi(
    app,
    {
      supervisor: sup,
      db: suite.db,
      ring: sc.ring,
      venueId: VENUE,
      stateDir: sc.stateDir,
      readRecoveryKey: async () => undefined,
      readBoxEnv: () => loadBoxEnv(sc.base, sc.stateDir),
      sealedState: { refresh: async () => "sealed" },
      readStream: () => ({ state: "off" }),
      turns: createTurns(),
      ...extra,
    },
    () => {},
  );
  return app;
}

async function setupTenant(): Promise<void> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "76000001K",
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "admin@x.com",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(persons).values({
      displayName: "The Manager",
      email: MANAGER_EMAIL,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(PASSWORD),
      role: "manager",
    });
  });
}

async function evidence(app: Hono): Promise<Record<string, unknown>> {
  const login = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const res = await app.request("/api/backup/settings-evidence", { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const write = (ring: KeyRing, settings: Omit<ArchiveSettings, "revision">) =>
  withTransaction(suite.db, (tx) => writeArchiveSettings(tx, ring, settings));

const recordNow = () => readArchiveSettingsWithMeta(suite.db, RING).then((r) => r.meta);

const storeKey = (sc: Scenario, key: string) =>
  writeFile(join(sc.stateDir, "backup.env"), `WAITRON_BACKUP_RECOVERY_KEY=${key}\n`);

const destDir = () => mkdtempSync(join(tmpdir(), "settings-evidence-dest-"));

afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop().catch(() => {});
  await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: ARCHIVE_PURPOSE }));
});

describe("GET /api/backup/settings-evidence", () => {
  beforeAll(async () => {
    await setupTenant();
  }, 180_000);

  it("a record locked with a key number this box no longer holds: both numbers, no destinations", async () => {
    await write(RING, folderSettings(destDir()));
    const meta = await recordNow();
    const sc = await scenario({ ring: ringOf(9, "3", { byte: 8, version: "2" }) });
    const sup = makeSupervisor(sc);
    await storeKey(sc, KEY_1);
    await sup.reload();
    sc.clock.at = new Date("2026-10-29T09:05:00.000Z");

    expect(await evidence(buildApp(sup, sc))).toEqual({
      readAt: "2026-10-29T09:05:00.000Z",
      managedByEnvironment: false,
      failures: [
        {
          at: "2026-10-29T09:00:00.000Z",
          code: "credentials.key_version_unknown",
          detail: { keyVersion: 1 },
          recordDigest: meta!.digest,
          recordWrittenAt: meta!.writtenAt,
        },
      ],
      lastCleanLoadAt: null,
      record: { keyVersion: 1, writtenAt: meta!.writtenAt, digest: meta!.digest },
      rewrittenSinceLastFailure: false,
      boxKeyNumbers: { current: 3, previous: 2 },
      now: {
        state: "unreadable",
        code: "credentials.key_version_unknown",
        detail: { keyVersion: 1 },
      },
      recoveryKey: { held: true, tooShort: false, fingerprint: keyFingerprint(KEY_1) },
    });
  }, 60_000);

  it("a record under this box's key number that its key does not open: the number, no destinations", async () => {
    await write(RING, folderSettings(destDir()));
    const meta = await recordNow();
    const sc = await scenario({ ring: ringOf(9, "1") });
    const sup = makeSupervisor(sc);
    await sup.reload();

    const body = await evidence(buildApp(sup, sc));
    expect(body.failures).toEqual([
      expect.objectContaining({ code: "credentials.decrypt_failed", detail: null }),
    ]);
    expect(body.record).toEqual({
      keyVersion: 1,
      writtenAt: meta!.writtenAt,
      digest: meta!.digest,
    });
    expect(body.boxKeyNumbers).toEqual({ current: 1 });
    expect(body.now).toEqual({
      state: "unreadable",
      code: "credentials.decrypt_failed",
      detail: null,
    });
  }, 60_000);

  it("a record whose retention cannot be used: the part, no destinations", async () => {
    const { json } = archiveRecord(folderSettings(destDir()));
    const bad = { ...JSON.parse(json), retention: { count: 0, days: 30 } };
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        purpose: ARCHIVE_PURPOSE,
        value: { settings: JSON.stringify(bad) },
      }),
    );
    const sc = await scenario();
    const sup = makeSupervisor(sc);
    await sup.reload();

    const body = await evidence(buildApp(sup, sc));
    expect(body.failures).toEqual([
      expect.objectContaining({
        code: "backup.archive_settings_invalid",
        detail: { reason: "retention" },
      }),
    ]);
    expect(body.now).toEqual({
      state: "unreadable",
      code: "backup.archive_settings_invalid",
      detail: { reason: "retention" },
    });
  }, 60_000);

  it("no recovery key on the box: the record reads, so its folder and bucket are shown", async () => {
    const folder = destDir();
    const settings = folderSettings(folder);
    await write(RING, {
      ...settings,
      destinations: [
        ...settings.destinations,
        { kind: "s3", id: "bucket", bucket: BUCKET, venueId: VENUE },
      ],
    });
    const sc = await scenario();
    const sup = makeSupervisor(sc);
    await sup.reload();

    const body = await evidence(buildApp(sup, sc));
    expect(body.failures).toEqual([
      expect.objectContaining({ code: "backup.recovery_key_missing", detail: null }),
    ]);
    expect(body.now).toEqual({
      state: "readable",
      destinations: [
        { kind: "folder", dir: folder, look: "folder" },
        {
          kind: "bucket",
          endpoint: BUCKET.endpoint,
          region: BUCKET.region,
          bucket: BUCKET.bucket,
          accessKeyId: BUCKET.accessKeyId,
          archiveFolder: archiveNamespace(BUCKET.prefix, VENUE),
        },
      ],
    });
    expect(body.recoveryKey).toEqual({ held: false, tooShort: false });
  }, 60_000);

  it("a recovery key too short to use: the record reads, the key is held and too short", async () => {
    const folder = destDir();
    await write(RING, folderSettings(folder));
    const sc = await scenario();
    await storeKey(sc, "short");
    const sup = makeSupervisor(sc);
    await sup.reload();

    const body = await evidence(buildApp(sup, sc));
    expect(body.failures).toEqual([
      expect.objectContaining({ code: "backup.recovery_key_too_short", detail: { min: 12 } }),
    ]);
    expect(body.now).toEqual({
      state: "readable",
      destinations: [{ kind: "folder", dir: folder, look: "folder" }],
    });
    expect(body.recoveryKey).toEqual({ held: true, tooShort: true });
  }, 60_000);

  it("a box setting that is not a whole number: the variable, and the record's destinations", async () => {
    const folder = destDir();
    await write(RING, folderSettings(folder));
    const sc = await scenario({ base: { WAITRON_BACKUP_STALE_AFTER_MS: "soon" } });
    await storeKey(sc, KEY_1);
    const sup = makeSupervisor(sc);
    await sup.reload();

    const body = await evidence(buildApp(sup, sc));
    expect(body.failures).toEqual([
      expect.objectContaining({
        code: "server.config_invalid",
        detail: { variable: "WAITRON_BACKUP_STALE_AFTER_MS" },
      }),
    ]);
    expect(body.now).toEqual({
      state: "readable",
      destinations: [{ kind: "folder", dir: folder, look: "folder" }],
    });
  }, 60_000);

  it("a clean load: no failures, the time it loaded, and the destinations", async () => {
    const folder = destDir();
    await write(RING, folderSettings(folder));
    const sc = await scenario();
    await storeKey(sc, KEY_1);
    const sup = makeSupervisor(sc);
    await sup.reload();

    const body = await evidence(buildApp(sup, sc));
    expect(body).toMatchObject({
      failures: [],
      lastCleanLoadAt: "2026-10-29T09:00:00.000Z",
      rewrittenSinceLastFailure: false,
      now: { state: "readable", destinations: [{ kind: "folder", dir: folder, look: "folder" }] },
      recoveryKey: { held: true, tooShort: false, fingerprint: keyFingerprint(KEY_1) },
    });
  }, 60_000);

  it("no record at all: absent, and no record facts", async () => {
    const sc = await scenario();
    const sup = makeSupervisor(sc);
    await sup.reload();

    const body = await evidence(buildApp(sup, sc));
    expect(body).toMatchObject({
      failures: [],
      record: null,
      rewrittenSinceLastFailure: false,
      now: { state: "absent" },
    });
  }, 60_000);

  it("a record rewritten after the newest failure says so, and describes the new record", async () => {
    await write(RING, folderSettings(destDir()));
    const sc = await scenario();
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, sc);
    expect((await evidence(app)).rewrittenSinceLastFailure).toBe(false);

    const folder = destDir();
    await write(RING, folderSettings(folder));
    const meta = await recordNow();
    const body = await evidence(app);
    expect(body.rewrittenSinceLastFailure).toBe(true);
    expect(body.record).toEqual({
      keyVersion: 1,
      writtenAt: meta!.writtenAt,
      digest: meta!.digest,
    });
    expect(body.now).toEqual({
      state: "readable",
      destinations: [{ kind: "folder", dir: folder, look: "folder" }],
    });
  }, 60_000);

  it("looks at a folder without writing: missing, not a folder, or unknown when the look fails", async () => {
    const parent = destDir();
    const file = join(parent, "a-file");
    await writeFile(file, "x");
    const missing = join(parent, "gone");
    const denied = join(parent, "denied");
    await write(RING, {
      ...folderSettings(missing),
      destinations: [
        { kind: "local-fs", id: "primary", dir: missing },
        { kind: "local-fs", id: "second", dir: file },
        { kind: "local-fs", id: "third", dir: denied },
      ],
    });
    const sc = await scenario();
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, sc, {
      statFolder: (dir) =>
        dir === denied
          ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
          : stat(dir),
    });

    expect((await evidence(app)).now).toEqual({
      state: "readable",
      destinations: [
        { kind: "folder", dir: missing, look: "missing" },
        { kind: "folder", dir: file, look: "not_a_folder" },
        { kind: "folder", dir: denied, look: "unknown" },
      ],
    });
  }, 60_000);

  it("settings the environment owns: the saved record's facts, but no destinations", async () => {
    await write(RING, folderSettings(destDir()));
    const meta = await recordNow();
    const sc = await scenario({
      base: { WAITRON_BACKUP_DIR: destDir(), WAITRON_BACKUP_RECOVERY_KEY: KEY_1 },
    });
    const sup = makeSupervisor(sc);
    await sup.reload();

    const body = await evidence(buildApp(sup, sc));
    expect(body).toMatchObject({
      managedByEnvironment: true,
      record: { digest: meta!.digest },
      now: { state: "readable", destinations: [] },
    });
  }, 60_000);

  describe("readSettingsEvidence", () => {
    const depsFor = (sc: Scenario, sup: BackupSupervisor): SettingsEvidenceDeps => ({
      db: suite.db,
      ring: sc.ring,
      current: () => sup.current(),
      loadHistory: () => sup.loadHistory(),
      readBoxEnv: () => loadBoxEnv(sc.base, sc.stateDir),
      now: () => sup.now(),
      statFolder: stat,
      lookTimeoutMs: sup.statusReadTimeoutMs,
    });

    it("a folder look that does not answer within the limit is unknown", async () => {
      const folder = destDir();
      await write(RING, folderSettings(folder));
      const sc = await scenario();
      const sup = makeSupervisor(sc);
      await sup.reload();
      const answer = await readSettingsEvidence({
        ...depsFor(sc, sup),
        statFolder: () => new Promise(() => {}),
        lookTimeoutMs: 20,
      });
      expect(answer.now).toEqual({
        state: "readable",
        destinations: [{ kind: "folder", dir: folder, look: "unknown" }],
      });
    }, 60_000);

    it("a failure that is not the record's own is thrown, not answered as unreadable", async () => {
      const sc = await scenario();
      const sup = makeSupervisor(sc);
      const failure = new Error("the database went away");
      const db = new Proxy(suite.db, {
        get: () => {
          throw failure;
        },
      });
      await expect(readSettingsEvidence({ ...depsFor(sc, sup), db })).rejects.toBe(failure);
    }, 60_000);
  });
});
