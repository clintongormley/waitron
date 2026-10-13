import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { deleteCredential, loadKeyRing, putCredential } from "@waitron/credentials";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import {
  ARCHIVE_PURPOSE,
  readArchiveSettings,
  writeArchiveSettings,
  type ArchiveSettings,
} from "./archive-settings.js";
import { mountBackupApi } from "./backup-api.js";
import { isBackupManagedByEnvironment, loadRecoveryKey } from "./backup-config.js";
import { writeRecoveryKey } from "./backup-env-writer.js";
import { keyFingerprint, type BackupSupervisor } from "./backup-supervisor.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { loadBoxEnv } from "./box-env.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { readStreamSettings } from "./stream-host.js";

const VENUE = "c0000000-0000-4000-8000-000000000002";
const KEY = "recovery-key-one-strong";
const SECRET = "archive-secret-0123456789abcdef";
const ENV_SECRET = "env-secret-0123456789abcdef";
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const PATH = "/api/backup/archive-recovery-pack";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

const BUCKET = {
  region: "eu-west-1",
  bucket: "archive-bucket",
  prefix: "shop/",
  accessKeyId: "AKIAARCHIVE",
  secretAccessKey: SECRET,
};

const RECORD: Omit<ArchiveSettings, "revision"> = {
  enabled: true,
  destinations: [{ kind: "s3", id: "bucket", bucket: BUCKET, venueId: VENUE }],
  schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
  retention: { count: 7, days: 30 },
  destinationTimeoutMs: 15 * 60 * 1000,
};

let cookies: { manager: string; staff: string };

beforeAll(async () => {
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
  cookies = await withTransaction(suite.db, async (tx) => {
    const start = async (role: "manager" | "staff") => {
      const [inserted] = await tx
        .insert(persons)
        .values({ displayName: role, pinHash: hashPin("1234"), role, email: `${role}@x.com` })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: inserted!.id });
      return `${MANAGEMENT_COOKIE}=${session.token}`;
    };
    return { manager: await start("manager"), staff: await start("staff") };
  });
}, 180_000);

afterEach(async () => {
  await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: ARCHIVE_PURPOSE }));
});

interface Rig {
  base?: NodeJS.ProcessEnv;
  key?: string | null;
  turns?: Turns;
  log?: Logger;
  onReadEnv?: () => void;
  /** The key the supervisor reports it loaded, whatever the key file holds. */
  loadedKey?: string;
}

async function rig(opts: Rig = {}) {
  const base = opts.base ?? {};
  const stateDir = mkdtempSync(join(tmpdir(), "backup-pack-state-"));
  const key = opts.key === undefined ? KEY : opts.key;
  if (key !== null) await writeRecoveryKey(stateDir, { recoveryKey: key, keyRotatedAt: undefined });
  const supervisor = {
    current: () => ({
      managedByEnvironment: isBackupManagedByEnvironment(base),
      recoveryKey: opts.loadedKey,
    }),
  } as unknown as BackupSupervisor;
  const app = new Hono();
  mountBackupApi(
    app,
    {
      supervisor,
      db: suite.db,
      ring: RING,
      venueId: VENUE,
      stateDir,
      readRecoveryKey: async () => loadRecoveryKey(await loadBoxEnv(base, stateDir)),
      readBoxEnv: () => {
        opts.onReadEnv?.();
        return loadBoxEnv(base, stateDir);
      },
      sealedState: { refresh: async () => "sealed" },
      readStream: () => ({ state: "off" }),
      turns: opts.turns ?? createTurns(),
    },
    opts.log ?? (() => {}),
  );
  const get = (cookie: string | null = cookies.manager) =>
    app.request(PATH, cookie === null ? {} : { headers: { cookie } });
  return { stateDir, get };
}

const store = (settings: Omit<ArchiveSettings, "revision"> = RECORD) =>
  withTransaction(suite.db, (tx) => writeArchiveSettings(tx, RING, settings));

async function refusal(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  return expect(await res.json()).toMatchObject({ error: { code } });
}

describe("GET /api/backup/archive-recovery-pack", () => {
  it("serves the stored bucket and the key file's key, uncached", async () => {
    const stored = await store();
    const { get } = await rig();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(decodeArchiveRecoveryPack(body.pack)).toEqual({
      version: 1,
      format: "WBK1",
      venueId: VENUE,
      bucket: BUCKET,
      archivePrefix: `shop/archives/${VENUE}/`,
      recoveryKey: KEY,
    });
    expect(body).toEqual({
      pack: body.pack,
      keyFingerprint: keyFingerprint(KEY),
      revision: stored.revision,
    });
  }, 60_000);

  it("carries the key file's rotation time", async () => {
    await store();
    const { stateDir, get } = await rig({ key: null });
    const rotatedAt = "2026-10-01T10:00:00.000Z";
    await writeRecoveryKey(stateDir, { recoveryKey: KEY, keyRotatedAt: rotatedAt });
    expect(await (await get()).json()).toMatchObject({ keyRotatedAt: rotatedAt });
  }, 60_000);

  it("is served while archives are switched off", async () => {
    await store({ ...RECORD, enabled: false });
    const { get } = await rig();
    const res = await get();
    expect(res.status).toBe(200);
    expect(decodeArchiveRecoveryPack((await res.json()).pack).bucket).toEqual(BUCKET);
  }, 60_000);

  it("is served with no bucket copy configured", async () => {
    await store();
    expect(await readStreamSettings(suite.db, RING)).toBeNull();
    const { get } = await rig();
    expect((await get()).status).toBe(200);
  }, 60_000);

  it("refuses when the stored record names only a local folder", async () => {
    await store({
      ...RECORD,
      destinations: [{ kind: "local-fs", id: "primary", dir: tmpdir() }],
    });
    const { get } = await rig();
    await refusal(await get(), 409, "backup.archive_bucket_not_configured");
  }, 60_000);

  it("refuses when nothing is stored", async () => {
    const { get } = await rig();
    await refusal(await get(), 409, "backup.archive_bucket_not_configured");
  }, 60_000);

  it("refuses a stored record it cannot read, naming the read's code", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: ARCHIVE_PURPOSE, value: { settings: "{}" } }),
    );
    await expect(readArchiveSettings(suite.db, RING)).rejects.toMatchObject({
      code: "backup.archive_settings_invalid",
    });
    const { get } = await rig();
    const res = await get();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: {
        code: "backup.archive_settings_unreadable",
        params: { reason: "backup.archive_settings_invalid" },
      },
    });
  }, 60_000);

  it("refuses with no key held", async () => {
    await store();
    const { get } = await rig({ key: null });
    await refusal(await get(), 409, "backup.recovery_key_missing");
  }, 60_000);

  it("never falls back to the key the supervisor loaded", async () => {
    await store();
    const { get } = await rig({ key: null, loadedKey: KEY });
    await refusal(await get(), 409, "backup.recovery_key_missing");
  }, 60_000);

  it("names the missing bucket before the missing key", async () => {
    await refusal(
      await (await rig({ key: null })).get(),
      409,
      "backup.archive_bucket_not_configured",
    );
    await store({ ...RECORD, destinations: [{ kind: "local-fs", id: "primary", dir: tmpdir() }] });
    await refusal(
      await (await rig({ key: null })).get(),
      409,
      "backup.archive_bucket_not_configured",
    );
  }, 60_000);

  it("names the missing bucket before the missing key while the environment owns the settings", async () => {
    const { get } = await rig({ base: { WAITRON_BACKUP_DIR: tmpdir() }, key: null });
    await refusal(await get(), 409, "backup.archive_bucket_not_configured");
  }, 60_000);

  it("names the unreadable record before the missing key", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: ARCHIVE_PURPOSE, value: { settings: "{}" } }),
    );
    const res = await (await rig({ key: null })).get();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: {
        code: "backup.archive_settings_unreadable",
        params: { reason: "backup.archive_settings_invalid" },
      },
    });
  }, 60_000);

  it("serves a bucket whose selected folder is a hyphen", async () => {
    const bucket = { ...BUCKET, prefix: "-" };
    await store({
      ...RECORD,
      destinations: [{ kind: "s3", id: "bucket", bucket, venueId: VENUE }],
    });
    const res = await (await rig()).get();
    expect(res.status).toBe(200);
    expect(decodeArchiveRecoveryPack((await res.json()).pack)).toMatchObject({
      bucket,
      archivePrefix: `-/archives/${VENUE}/`,
    });
  }, 60_000);

  it("refuses a held key under the length floor", async () => {
    await store();
    const { stateDir, get } = await rig({ key: null });
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=short\n");
    await refusal(await get(), 400, "backup.recovery_key_too_short");
  }, 60_000);

  it("serves the environment's bucket while the environment owns the settings", async () => {
    await store();
    const envBucket = {
      region: "eu-south-2",
      bucket: "env-bucket",
      prefix: "",
      accessKeyId: "AKIAENV",
      secretAccessKey: ENV_SECRET,
    };
    const base = {
      WAITRON_BACKUP_DESTINATIONS: JSON.stringify([{ kind: "s3", id: "offsite", ...envBucket }]),
      WAITRON_BACKUP_RECOVERY_KEY: KEY,
    };
    const { get } = await rig({ base, key: null });
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(decodeArchiveRecoveryPack(body.pack)).toMatchObject({
      bucket: envBucket,
      archivePrefix: `archives/${VENUE}/`,
      recoveryKey: KEY,
    });
    expect(body.revision).toBeUndefined();
  }, 60_000);

  it("names the environment's first bucket when it lists several", async () => {
    const first = { ...BUCKET, bucket: "first-bucket", prefix: "-" };
    const second = { ...BUCKET, bucket: "second-bucket", prefix: "" };
    const base = {
      WAITRON_BACKUP_DIR: tmpdir(),
      WAITRON_BACKUP_DESTINATIONS: JSON.stringify([
        { kind: "s3", id: "one", ...first },
        { kind: "s3", id: "two", ...second },
      ]),
      WAITRON_BACKUP_RECOVERY_KEY: KEY,
    };
    const res = await (await rig({ base, key: null })).get();
    expect(res.status).toBe(200);
    expect(decodeArchiveRecoveryPack((await res.json()).pack)).toMatchObject({
      bucket: first,
      archivePrefix: `-/archives/${VENUE}/`,
    });
  }, 60_000);

  it("refuses when the environment owns the settings and names no bucket", async () => {
    await store();
    const base = { WAITRON_BACKUP_DIR: tmpdir(), WAITRON_BACKUP_RECOVERY_KEY: KEY };
    const { get } = await rig({ base, key: null });
    await refusal(await get(), 409, "backup.archive_bucket_not_configured");
  }, 60_000);

  it("refuses an unauthenticated request and a person without system.manage", async () => {
    await store();
    const { get } = await rig();
    await refusal(await get(null), 401, "management_session.required");
    await refusal(await get(cookies.staff), 403, "authorization.not_permitted");
  }, 60_000);

  it("logs neither the bucket's secret nor the key, served or refused", async () => {
    const lines: string[] = [];
    const log: Logger = (level, event, fields) =>
      lines.push(JSON.stringify([level, event, fields]));
    await store();
    expect((await (await rig({ log })).get()).status).toBe(200);
    await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: ARCHIVE_PURPOSE }));
    expect((await (await rig({ log })).get()).status).toBe(409);
    await store();
    const short = await rig({ log, key: null });
    await writeFile(join(short.stateDir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=short-key\n");
    expect((await short.get()).status).toBe(400);
    const text = lines.join("\n");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("short-key");
  }, 60_000);

  it("reads nothing until it has its turn", async () => {
    await store();
    const turns = createTurns();
    let release!: () => void;
    const held = turns(() => new Promise<void>((resolve) => (release = resolve)));
    let reads = 0;
    const { get } = await rig({ turns, onReadEnv: () => (reads += 1) });
    const answer = get();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reads).toBe(0);
    release();
    await held;
    expect((await answer).status).toBe(200);
    expect(reads).toBe(1);
  }, 60_000);
});
