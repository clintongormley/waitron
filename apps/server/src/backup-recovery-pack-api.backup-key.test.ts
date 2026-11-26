import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeMasterKey, masterKeyId, sealingPublicKey } from "@waitron/credentials";
import { masterKeys, readCurrentMasterKey, readRecoveryPacks, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ProvisionedNode } from "@waitron/module";
import { readRecoveryPackPdf } from "@waitron/recovery-pack/src/read-pack-pdf.js";
import { decodeMasterKeyCode } from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { decryptBackupFile, readArtifactFileHeader } from "./artifact-cipher-file.js";
import { loadBackupSettings } from "./backup-config.js";
import { writeBackupKey } from "./backup-env-writer.js";
import { keyFingerprint } from "./backup-key-fingerprint.js";
import { mountBackupRecoveryPackMakeApi } from "./backup-recovery-pack-api.js";
import { createTurns } from "./backup-turns.js";
import { loadBoxEnv } from "./box-env.js";
import { parseEnvFile } from "./env-file.js";
import { loadRecoveryPackFonts } from "./invoice-font.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { BACKUP_NODE_ID } from "./testing/backup-node.js";
import { heldBackupKey } from "./testing/backup-key.js";
import { supervisorWithJob } from "./testing/backup-supervisor.js";
import { mintMasterKey } from "./testing/master-key.js";
import {
  PACK_ARCHIVES as ARCHIVES,
  PACK_RING,
  packRequests,
  seedPackVenue,
} from "./testing/recovery-pack-make.js";

const MADE_AT = "2026-10-30T09:00:00.000Z";
const OLD_ROTATED_AT = "2026-09-20T08:00:00.000Z";
const OLD_MASTER = makeMasterKey();

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let node: ProvisionedNode;
let admin: { personId: string; token: string };
const scratch: string[] = [];
const sockets: TLSSocket[] = [];
const stops: (() => Promise<void>)[] = [];
let logs: unknown[][];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const dir of scratch.splice(0)) {
    await chmod(dir, 0o700).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  logs = [];
  ({ node, admin } = await seedPackVenue(suite.db));
  await mintMasterKey(suite.db, { bytes: OLD_MASTER });
});

async function folder(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A state folder whose `backup.env` holds backup key `n` of the old master key, unless `n` is 0. */
async function stateFolder(n = 3): Promise<string> {
  const dir = await folder("pack-backup-key-state-");
  await mkdir(join(dir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(dir, rel), `dummy ${rel}`);
  if (n > 0)
    await writeBackupKey(dir, { ...heldBackupKey(OLD_MASTER, n), rotatedAt: OLD_ROTATED_AT });
  return dir;
}

function fixture(
  stateDir: string,
  options: {
    reloadBackups?: () => Promise<void>;
    loadFonts?: typeof loadRecoveryPackFonts;
    /** The stream refuses to start again after the key file is written. */
    streamStartFails?: boolean;
  } = {},
) {
  const steps: string[] = [];
  const app = new Hono();
  mountBackupRecoveryPackMakeApi(
    app,
    {
      db: suite.db,
      ring: PACK_RING,
      node,
      turns: createTurns(),
      readBoxEnv: () => loadBoxEnv({}, stateDir),
      backups: () => ({
        schedule: ARCHIVES.schedule,
        retention: ARCHIVES.retention,
        recoveryKey: undefined,
      }),
      loadFonts: options.loadFonts ?? loadRecoveryPackFonts,
      now: () => new Date(MADE_AT),
      stateDir,
      stream: {
        reload: async (write) => {
          steps.push("stream stopped");
          await write?.();
          if (options.streamStartFails === true) throw new Error("stream did not start");
          steps.push("stream started");
        },
      },
      sealedState: {
        refresh: async () => {
          steps.push("sealed");
          return "sealed";
        },
      },
      reloadBackups: async () => {
        steps.push("backups reloaded");
        await options.reloadBackups?.();
      },
    },
    (...values) => logs.push(values),
  );
  const requests = packRequests(app, { token: () => admin.token, sockets });
  return {
    steps,
    make: requests.make,
    received: requests.received,
    status: async () => {
      const response = await requests.status();
      expect(response.status).toBe(200);
      return (await response.json()) as {
        upToDate: boolean;
        reasons: unknown[];
        backupKey: unknown;
      };
    },
  };
}

/** The master key a "Make a new master key" response shows, as bytes. */
const shownBytes = (response: Response) =>
  decodeMasterKeyCode(response.headers.get("x-waitron-master-key")!);
async function poll<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() >= end) throw new Error("poll timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const keyFile = async (stateDir: string) =>
  parseEnvFile(await readFile(join(stateDir, "backup.env"), "utf8"));

describe("Make a new master key moves the backup key to N+1 of the new master key", () => {
  it("the new pack's archives page prints key N+1", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const next = heldBackupKey(shownBytes(response), 4);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect(decodeArchiveRecoveryPack(file.archiveCode!).recoveryKey).toBe(next.key);
    expect(parseRecoveryKit(file.bucketCode!).recoveryKey).toBe(next.key);
    expect(await keyFile(stateDir)).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: next.key,
      WAITRON_BACKUP_KEY_NUMBER: "4",
      WAITRON_BACKUP_MASTER_KEY_ID: next.masterKeyId,
      WAITRON_BACKUP_KEY_ROTATED_AT: MADE_AT,
    });
    // The stream is stopped around the write and the sealed copy follows it, as a key change does.
    expect(f.steps).toEqual(["stream stopped", "sealed", "stream started", "backups reloaded"]);
  });

  it("a plain pack leaves the backup key as it is", async () => {
    const stateDir = await stateFolder(3);
    const before = await readFile(join(stateDir, "backup.env"), "utf8");
    const f = fixture(stateDir);
    const response = await f.make(false);
    expect(response.status).toBe(200);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect(decodeArchiveRecoveryPack(file.archiveCode!).recoveryKey).toBe(
      heldBackupKey(OLD_MASTER, 3).key,
    );
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(before);
    expect(f.steps).toEqual([]);
  });

  it("with no backup key held, a new master key writes its key 1", async () => {
    const stateDir = await stateFolder(0);
    const response = await fixture(stateDir).make(true);
    expect(response.status).toBe(200);
    const next = heldBackupKey(shownBytes(response), 1);
    await response.arrayBuffer();
    expect(await keyFile(stateDir)).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: next.key,
      WAITRON_BACKUP_KEY_NUMBER: "1",
      WAITRON_BACKUP_MASTER_KEY_ID: next.masterKeyId,
    });
  });

  it("a pack made with a new master key is up to date", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const response = await f.make(true);
    const next = heldBackupKey(shownBytes(response), 4);
    await response.arrayBuffer();
    expect((await f.received(1)).status).toBe(204);
    const status = await f.status();
    expect(status).toMatchObject({ upToDate: true, reasons: [] });
    expect(status.backupKey).toEqual({
      number: 4,
      fingerprint: keyFingerprint(next.key),
      changedAt: MADE_AT,
      fromCurrentMasterKey: true,
    });
  });

  it("a failed backup.env write after the commit still answers the pack, and the status says the backup key is not from the current master key", async () => {
    const stateDir = await stateFolder(3);
    const before = await readFile(join(stateDir, "backup.env"), "utf8");
    const f = fixture(stateDir);
    // A folder nothing can be written into: the key file cannot be replaced.
    await chmod(stateDir, 0o500);
    const response = await f.make(true);
    await chmod(stateDir, 0o700);
    expect(response.status).toBe(200);
    const shown = shownBytes(response);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect(file.number).toBe(1);
    const current = await withTransaction(suite.db, (tx) => readCurrentMasterKey(tx));
    expect(Buffer.from(current!.publicKey)).toEqual(sealingPublicKey(shown));
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(before);
    expect(logs).toContainEqual([
      "warn",
      "backup.key_change_after_master_key_failed",
      { errorCode: "EACCES" },
    ]);
    expect((await f.status()).backupKey).toEqual({
      number: 3,
      fingerprint: keyFingerprint(heldBackupKey(OLD_MASTER, 3).key),
      changedAt: OLD_ROTATED_AT,
      fromCurrentMasterKey: false,
    });
  });
});

describe("the backup key is written only once the pack and its master key are saved", () => {
  const masterKeyRows = () => suite.db.select().from(masterKeys);

  it("a refused pack writes no backup key and restarts no stream", async () => {
    const stateDir = await stateFolder(3);
    const before = await readFile(join(stateDir, "backup.env"), "utf8");
    const rowsBefore = await masterKeyRows();
    const f = fixture(stateDir, {
      loadFonts: async () => {
        throw new Error("no fonts");
      },
    });
    const response = await f.make(true);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.has("x-waitron-master-key")).toBe(false);
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(before);
    expect(f.steps).toEqual([]);
    expect(await masterKeyRows()).toEqual(rowsBefore);
    expect(await readRecoveryPacks(suite.db, node.nodeId)).toEqual([]);
  });

  it("an aborted request saves no master key and writes no backup key", async () => {
    const stateDir = await stateFolder(3);
    const before = await readFile(join(stateDir, "backup.env"), "utf8");
    const rowsBefore = await masterKeyRows();
    const aborted = new AbortController();
    const f = fixture(stateDir, {
      // The person goes away while the pack is drawn, before its master key is saved.
      loadFonts: async () => {
        aborted.abort();
        return loadRecoveryPackFonts();
      },
    });
    const response = await f.make(true, { signal: aborted.signal });
    expect(aborted.signal.aborted).toBe(true);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
    expect(response.headers.has("x-waitron-master-key")).toBe(false);
    expect(await masterKeyRows()).toEqual(rowsBefore);
    expect(await readRecoveryPacks(suite.db, node.nodeId)).toEqual([]);
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(before);
    expect(f.steps).toEqual([]);
  });

  it("a failed backup reload after the key is written is logged as a failed reload", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir, {
      reloadBackups: async () => {
        throw new Error("reload refused");
      },
    });
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const next = heldBackupKey(shownBytes(response), 4);
    await response.arrayBuffer();
    expect((await keyFile(stateDir)).WAITRON_BACKUP_RECOVERY_KEY).toBe(next.key);
    const events = logs.filter(([level]) => level === "warn").map(([, event]) => event);
    expect(events).toEqual(["backup.reload_after_write_failed"]);
    expect((await f.status()).backupKey).toMatchObject({ number: 4, fromCurrentMasterKey: true });
  });

  it("reloads the backups when a step after the key file's write fails", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir, { streamStartFails: true });
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const next = heldBackupKey(shownBytes(response), 4);
    await response.arrayBuffer();
    expect((await keyFile(stateDir)).WAITRON_BACKUP_RECOVERY_KEY).toBe(next.key);
    expect(f.steps).toEqual(["stream stopped", "sealed", "backups reloaded"]);
    expect(logs).toContainEqual([
      "warn",
      "backup.key_change_after_master_key_failed",
      { errorCode: "unknown" },
    ]);
  });
});

describe("the status's backup key", () => {
  it("is from the current master key when backup.env names its id", async () => {
    const stateDir = await stateFolder(2);
    expect((await fixture(stateDir).status()).backupKey).toEqual({
      number: 2,
      fingerprint: keyFingerprint(heldBackupKey(OLD_MASTER, 2).key),
      changedAt: OLD_ROTATED_AT,
      fromCurrentMasterKey: true,
    });
  });

  it("is not from the current master key when backup.env names another master key's id", async () => {
    const stateDir = await stateFolder(0);
    const other = heldBackupKey(makeMasterKey(), 1);
    await writeBackupKey(stateDir, other);
    expect((await fixture(stateDir).status()).backupKey).toEqual({
      number: 1,
      fingerprint: keyFingerprint(other.key),
      changedAt: null,
      fromCurrentMasterKey: false,
    });
  });

  it("is null when there is no backup.env", async () => {
    const stateDir = await stateFolder(0);
    expect((await fixture(stateDir).status()).backupKey).toBeNull();
  });
});

describe("a backup written after a new master key", () => {
  async function newMasterKeyThenBackup() {
    const stateDir = await stateFolder(3);
    const dest = await folder("pack-backup-key-dest-");
    const venueDir = await folder("pack-backup-key-venue-");
    const sup = supervisorWithJob({
      nodeId: BACKUP_NODE_ID,
      buildConfig: async () =>
        loadBackupSettings({
          env: await loadBoxEnv({}, stateDir),
          readSealed: async () => ({
            ...ARCHIVES,
            revision: "1",
            destinations: [{ kind: "local-fs", id: "local", dir: dest }],
          }),
        }),
      readSingletonRole: () => "primary",
      venueDir,
      modules: ALL_MODULES,
      environment: "production",
      stateDir,
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
      log: () => {},
    });
    stops.push(() => sup.stop());
    await sup.reload();
    const response = await fixture(stateDir, { reloadBackups: () => sup.reload() }).make(true);
    expect(response.status).toBe(200);
    const newBytes = shownBytes(response);
    await response.arrayBuffer();
    // The reload after the change starts a backup under the new key.
    const written = await poll(async () => {
      const names = (await readdir(dest)).filter((name) => name.endsWith(".backup.enc"));
      for (const name of names) {
        const header = await readArtifactFileHeader(join(dest, name));
        if (header.version === 2 && header.keyNumber === 4) return { name, header };
      }
      return undefined;
    });
    return { path: join(dest, written.name), header: written.header, newBytes, out: dest };
  }

  it("opens with the new key and names it", async () => {
    const { path, header, newBytes, out } = await newMasterKeyThenBackup();
    expect(header).toEqual({
      version: 2,
      masterKeyId: masterKeyId(sealingPublicKey(newBytes)),
      keyNumber: 4,
    });
    await expect(
      decryptBackupFile(path, join(out, "opened"), heldBackupKey(newBytes, 4).key),
    ).resolves.toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it("the old master key does not open it", async () => {
    const { path, out } = await newMasterKeyThenBackup();
    for (const n of [4, 3]) {
      await expect(
        decryptBackupFile(path, join(out, `old-${n}`), heldBackupKey(OLD_MASTER, n).key),
      ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
    }
  }, 60_000);
});
