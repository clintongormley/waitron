import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeMasterKey,
  masterKeyId,
  masterKeyNameOf,
  sealingPublicKey,
} from "@waitron/credentials";
import { masterKeys, readCurrentMasterKey, readRecoveryPacks, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ProvisionedNode } from "@waitron/module";
import { readRecoveryPackPdf } from "@waitron/recovery-pack/src/read-pack-pdf.js";
import { decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { decryptBackupFile, readArtifactFileHeader } from "./artifact-cipher-file.js";
import { mountBackupApi } from "./backup-api.js";
import { loadBackupSettings, loadRecoveryKey } from "./backup-config.js";
import { writeBackupKey } from "./backup-env-writer.js";
import { keyFingerprint } from "./backup-key-fingerprint.js";
import { mountBackupRecoveryPackMakeApi } from "./backup-recovery-pack-api.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { loadBoxEnv } from "./box-env.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
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
    now?: () => Date;
    turns?: Turns;
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
      turns: options.turns ?? createTurns(),
      readBoxEnv: () => loadBoxEnv({}, stateDir),
      backups: () => ({
        schedule: ARCHIVES.schedule,
        retention: ARCHIVES.retention,
        recoveryKey: undefined,
      }),
      loadFonts: options.loadFonts ?? loadRecoveryPackFonts,
      now: options.now ?? (() => new Date(MADE_AT)),
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
    confirm: requests.confirm,
    status: async () => {
      const response = await requests.status();
      expect(response.status).toBe(200);
      return (await response.json()) as {
        upToDate: boolean;
        reasons: unknown[];
        backupKey: unknown;
        unreceived: unknown;
        masterKey: unknown;
        newKeyWaiting?: boolean;
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
  it("the new pack's bucket page prints key N+1", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const next = heldBackupKey(shownBytes(response), 4);
    const shownName = decodeURIComponent(response.headers.get("x-waitron-master-key-name")!);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect(parseRecoveryKit(file.bucketCode!).recoveryKey).toBe(next.key);
    expect((await f.confirm(response)).status).toBe(204);
    const held = await keyFile(stateDir);
    expect(held).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: next.key,
      WAITRON_BACKUP_KEY_NUMBER: "4",
      WAITRON_BACKUP_MASTER_KEY_ID: next.masterKeyId,
      WAITRON_BACKUP_MASTER_KEY_DAY: MADE_AT.slice(0, 10),
      WAITRON_BACKUP_KEY_ROTATED_AT: MADE_AT,
    });
    expect(
      masterKeyNameOf(
        Buffer.from(held.WAITRON_BACKUP_MASTER_KEY_ID!, "hex"),
        held.WAITRON_BACKUP_MASTER_KEY_DAY!,
      ),
    ).toBe(shownName);
    // The stream is stopped around the write and the sealed copy follows it, as a key change does.
    expect(f.steps).toEqual(["stream stopped", "sealed", "stream started", "backups reloaded"]);
  });

  it("Print with the master key leaves the backup key as it is", async () => {
    const stateDir = await stateFolder(3);
    const before = await readFile(join(stateDir, "backup.env"), "utf8");
    const f = fixture(stateDir);
    const response = await f.make(encodeMasterKeyCode(OLD_MASTER));
    expect(response.status).toBe(200);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect(parseRecoveryKit(file.bucketCode!).recoveryKey).toBe(heldBackupKey(OLD_MASTER, 3).key);
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(before);
    expect(f.steps).toEqual([]);
  });

  it("with no backup key held, a new master key writes its key 1", async () => {
    const stateDir = await stateFolder(0);
    const f = fixture(stateDir);
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const next = heldBackupKey(shownBytes(response), 1);
    await response.arrayBuffer();
    expect((await f.confirm(response)).status).toBe(204);
    expect(await keyFile(stateDir)).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: next.key,
      WAITRON_BACKUP_KEY_NUMBER: "1",
      WAITRON_BACKUP_MASTER_KEY_ID: next.masterKeyId,
    });
  });

  it("with a backup key held whose number backup.env lacks, a new master key writes its key 1", async () => {
    const stateDir = await stateFolder(3);
    const held = await keyFile(stateDir);
    delete held.WAITRON_BACKUP_KEY_NUMBER;
    await writeFile(join(stateDir, "backup.env"), formatEnvFile(held), { mode: 0o600 });
    const f = fixture(stateDir);
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const next = heldBackupKey(shownBytes(response), 1);
    await response.arrayBuffer();
    expect((await f.confirm(response)).status).toBe(204);
    expect(await keyFile(stateDir)).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: next.key,
      WAITRON_BACKUP_KEY_NUMBER: "1",
    });
  });

  it("a pack made with a new master key is up to date", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const response = await f.make(true);
    const next = heldBackupKey(shownBytes(response), 4);
    await response.arrayBuffer();
    expect((await f.confirm(response)).status).toBe(204);
    const status = await f.status();
    expect(status).toMatchObject({ upToDate: true, reasons: [] });
    expect(status.backupKey).toEqual({
      number: 4,
      fingerprint: keyFingerprint(next.key),
      changedAt: MADE_AT,
      fromCurrentMasterKey: true,
    });
  });

  it("a failed backup.env write after the confirm's commit still answers it, and the status says the backup key is not from the current master key", async () => {
    const stateDir = await stateFolder(3);
    const before = await readFile(join(stateDir, "backup.env"), "utf8");
    const f = fixture(stateDir);
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const shown = shownBytes(response);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect(file.number).toBe(1);
    // A folder nothing can be written into: the key file cannot be replaced.
    await chmod(stateDir, 0o500);
    const confirmed = await f.confirm(response);
    await chmod(stateDir, 0o700);
    expect(confirmed.status).toBe(204);
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

  it("after a failed backup.env write, Change the backup key with the new master key writes the key the pack prints", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const typed = response.headers.get("x-waitron-master-key")!;
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    await chmod(stateDir, 0o500);
    const confirmed = await f.confirm(response);
    await chmod(stateDir, 0o700);
    expect(confirmed.status).toBe(204);
    const printed = parseRecoveryKit(file.bucketCode!).recoveryKey;
    expect((await keyFile(stateDir)).WAITRON_BACKUP_RECOVERY_KEY).toBe(
      heldBackupKey(OLD_MASTER, 3).key,
    );

    const changed = await (
      await rotateApp(stateDir)
    ).post("/api/backup/rotate", { masterKey: typed });
    expect(changed.status).toBe(200);
    await changed.arrayBuffer();
    expect(await keyFile(stateDir)).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: printed,
      WAITRON_BACKUP_KEY_NUMBER: "4",
      WAITRON_BACKUP_MASTER_KEY_ID: masterKeyId(
        sealingPublicKey(decodeMasterKeyCode(typed)),
      ).toString("hex"),
    });
    expect((await f.status()).backupKey).toMatchObject({
      number: 4,
      fingerprint: keyFingerprint(printed),
      fromCurrentMasterKey: true,
    });
  }, 60_000);
});

/** The backup routes, whose "Change the backup key" writes to `stateDir`'s `backup.env`. */
async function rotateApp(stateDir: string) {
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
  const app = new Hono();
  mountBackupApi(
    app,
    {
      supervisor: sup,
      db: suite.db,
      ring: PACK_RING,
      stateDir,
      readRecoveryKey: async () => loadRecoveryKey(await loadBoxEnv({}, stateDir)),
      readBoxEnv: () => loadBoxEnv({}, stateDir),
      sealedState: { refresh: async () => "sealed" },
      readStream: () => ({ state: "off" }),
      stream: { reload: async (write) => void (await write?.()) },
      turns: createTurns(),
    },
    () => {},
  );
  return packRequests(app, { token: () => admin.token, sockets });
}

describe("a new master key whose pack never arrived", () => {
  it("never becomes current, and a second new master key needs only the sign-in", async () => {
    const stateDir = await stateFolder(3);
    let at = Date.parse(MADE_AT);
    const f = fixture(stateDir, { now: () => new Date((at += 60_000)) });
    const oldName = (await withTransaction(suite.db, (tx) => readCurrentMasterKey(tx)))!.name;
    const first = await f.make(true);
    expect(first.status).toBe(200);
    const firstName = decodeURIComponent(first.headers.get("x-waitron-master-key-name")!);
    await first.arrayBuffer();
    const waiting = await f.status();
    expect(waiting).toMatchObject({
      unreceived: { number: 1 },
      masterKey: { name: oldName, pack: null },
      newKeyWaiting: true,
    });
    expect(waiting.unreceived).not.toHaveProperty("holdsCurrentMasterKey");

    const second = await f.make(true, {}, { locale: "en", newMasterKey: true });
    expect(second.status).toBe(200);
    expect(second.headers.get("x-waitron-recovery-pack")).toBe("2");
    const secondBytes = shownBytes(second);
    const secondName = decodeURIComponent(second.headers.get("x-waitron-master-key-name")!);
    await second.arrayBuffer();
    expect(secondName).not.toBe(firstName);
    expect((await f.confirm(second)).status).toBe(204);
    const current = await withTransaction(suite.db, (tx) => readCurrentMasterKey(tx));
    expect(Buffer.from(current!.publicKey)).toEqual(sealingPublicKey(secondBytes));
    expect(await keyFile(stateDir)).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: heldBackupKey(secondBytes, 4).key,
      WAITRON_BACKUP_KEY_NUMBER: "4",
    });
    expect(await f.status()).toMatchObject({
      unreceived: null,
      masterKey: { name: secondName, pack: 2 },
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
    expect((await f.confirm(response)).status).toBe(204);
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
    expect((await f.confirm(response)).status).toBe(204);
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
    const f = fixture(stateDir, { reloadBackups: () => sup.reload() });
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const newBytes = shownBytes(response);
    await response.arrayBuffer();
    expect((await f.confirm(response)).status).toBe(204);
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
      masterKeyDay: MADE_AT.slice(0, 10),
    });
    expect(masterKeyNameOf(header.masterKeyId, header.masterKeyDay)).toBe(
      (await withTransaction(suite.db, (tx) => readCurrentMasterKey(tx)))!.name,
    );
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

describe("a new master key takes over only once its pack's arrival is confirmed", () => {
  const masterKeyRows = () => suite.db.select().from(masterKeys).orderBy(masterKeys.number);
  const packs = () => readRecoveryPacks(suite.db, node.nodeId);
  /** What a refused or lost confirm must leave as it was. */
  async function snapshot(stateDir: string, f: { steps: string[] }) {
    return {
      backupEnv: await readFile(join(stateDir, "backup.env"), "utf8"),
      rows: await masterKeyRows(),
      received: (await packs()).map((pack) => [pack.number, pack.receivedAt]),
      steps: [...f.steps],
    };
  }

  it("Make leaves the current master key and backup.env as they are, reloads nothing, and says a key waits", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    expect((await f.status()).newKeyWaiting).toBeUndefined();
    const before = await snapshot(stateDir, f);
    const response = await f.make(true);
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe(before.backupEnv);
    expect(await masterKeyRows()).toEqual(before.rows);
    expect(f.steps).toEqual([]);
    expect((await f.status()).newKeyWaiting).toBe(true);
  });

  it("the confirm with the shown key makes it current with the pack's time, writes the printed backup key and reloads backups", async () => {
    const stateDir = await stateFolder(3);
    let at = Date.parse(MADE_AT);
    const f = fixture(stateDir, { now: () => new Date((at += 60_000)) });
    const made = await f.make(true);
    const madeAt = made.headers.get("x-waitron-recovery-pack-made-at")!;
    const shown = shownBytes(made);
    const shownName = decodeURIComponent(made.headers.get("x-waitron-master-key-name")!);
    const file = await readRecoveryPackPdf(new Uint8Array(await made.arrayBuffer()));
    const printed = parseRecoveryKit(file.bucketCode!).recoveryKey;
    expect(f.steps).toEqual([]);

    const confirmed = await f.confirm(made);
    expect(confirmed.status).toBe(204);
    const current = await withTransaction(suite.db, (tx) => readCurrentMasterKey(tx));
    expect(current).toMatchObject({
      number: 2,
      name: shownName,
      madeAt: new Date(madeAt),
      madeBy: admin.personId,
    });
    expect(Buffer.from(current!.publicKey)).toEqual(sealingPublicKey(shown));
    expect(await keyFile(stateDir)).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: printed,
      WAITRON_BACKUP_KEY_NUMBER: "4",
      WAITRON_BACKUP_MASTER_KEY_ID: masterKeyId(sealingPublicKey(shown)).toString("hex"),
      WAITRON_BACKUP_KEY_ROTATED_AT: madeAt,
    });
    expect(f.steps).toEqual(["stream stopped", "sealed", "stream started", "backups reloaded"]);
    const [pack] = await packs();
    expect(pack!.receivedAt!.getTime()).toBeGreaterThan(Date.parse(madeAt));
    expect((await f.status()).newKeyWaiting).toBeUndefined();
  });

  it("writes the key the pack printed even when the backup key changed between the make and the confirm", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const made = await f.make(true);
    const file = await readRecoveryPackPdf(new Uint8Array(await made.arrayBuffer()));
    const printed = parseRecoveryKit(file.bucketCode!).recoveryKey;
    const changed = await (
      await rotateApp(stateDir)
    ).post("/api/backup/rotate", { masterKey: encodeMasterKeyCode(OLD_MASTER) });
    expect(changed.status).toBe(200);
    await changed.arrayBuffer();
    expect((await keyFile(stateDir)).WAITRON_BACKUP_RECOVERY_KEY).toBe(
      heldBackupKey(OLD_MASTER, 4).key,
    );

    expect((await f.confirm(made)).status).toBe(204);
    expect(await keyFile(stateDir)).toMatchObject({
      WAITRON_BACKUP_RECOVERY_KEY: printed,
      WAITRON_BACKUP_KEY_NUMBER: "4",
    });
    expect(printed).not.toBe(heldBackupKey(shownBytes(made), 5).key);
  }, 60_000);

  it.each([
    ["a wrong master key", "wrong"],
    ["a code that is not a master key", "garbage"],
    ["no master key", "none"],
    ["a key a later make replaced", "replaced"],
    ["a key the box forgot when it restarted", "restarted"],
  ] as const)("refuses %s, changing nothing", async (_name, kind) => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const made = await f.make(true);
    await made.arrayBuffer();
    if (kind === "replaced") await (await f.make(true)).arrayBuffer();
    const before = await snapshot(stateDir, f);
    const masterKey = {
      wrong: encodeMasterKeyCode(makeMasterKey()),
      garbage: "not a master key",
      none: undefined,
      replaced: made.headers.get("x-waitron-master-key")!,
      restarted: made.headers.get("x-waitron-master-key")!,
    }[kind];
    const confirmer = kind === "restarted" ? fixture(stateDir) : f;
    const response = await confirmer.received(1, {}, masterKey === undefined ? {} : { masterKey });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "recovery.pack_invalid", params: { reason: "unknown_pack" } },
    });
    expect(await snapshot(stateDir, f)).toEqual(before);
    expect(confirmer.steps).toEqual([]);
  });

  it("refuses another manager's confirm of a waiting key, changing nothing", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const made = await f.make(true);
    await made.arrayBuffer();
    const before = await snapshot(stateDir, f);
    const other = await openManagementSession(suite.db, "admin");
    const response = await f.confirm(made, { token: other.token });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "recovery.pack_invalid", params: { reason: "unknown_pack" } },
    });
    expect(await snapshot(stateDir, f)).toEqual(before);
    expect((await f.status()).newKeyWaiting).toBe(true);
  });

  it("refuses a confirm with a field beside the master key, changing nothing", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const made = await f.make(true);
    await made.arrayBuffer();
    const before = await snapshot(stateDir, f);
    const response = await f.received(
      1,
      {},
      { masterKey: made.headers.get("x-waitron-master-key"), more: 1 },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "recovery.pack_invalid", params: { reason: "shape" } },
    });
    expect(await snapshot(stateDir, f)).toEqual(before);
  });

  it("refuses a repeated confirm from another person, or for a pack that did not show the current key", async () => {
    const stateDir = await stateFolder(3);
    let at = Date.parse(MADE_AT);
    const f = fixture(stateDir, { now: () => new Date((at += 60_000)) });
    await (await f.make(encodeMasterKeyCode(OLD_MASTER))).arrayBuffer();
    expect((await f.received(1)).status).toBe(204);
    const made = await f.make(true);
    await made.arrayBuffer();
    expect((await f.confirm(made)).status).toBe(204);
    const after = await snapshot(stateDir, f);
    const other = await openManagementSession(suite.db, "admin");
    const shown = made.headers.get("x-waitron-master-key");
    for (const [number, token] of [
      [2, other.token],
      [1, admin.token],
    ] as const) {
      const response = await f.received(number, { token }, { masterKey: shown });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "recovery.pack_invalid", params: { reason: "unknown_pack" } },
      });
    }
    expect(await snapshot(stateDir, f)).toEqual(after);
  });

  it("a confirm whose request is gone before its backup turn comes changes nothing", async () => {
    const stateDir = await stateFolder(3);
    const queue = createTurns();
    let handed = 0;
    const turns: Turns = (body) => {
      handed += 1;
      return queue(body);
    };
    const f = fixture(stateDir, { turns });
    const made = await f.make(true);
    await made.arrayBuffer();
    const before = await snapshot(stateDir, f);
    const handedBefore = handed;
    let release!: () => void;
    const held = turns(() => new Promise<void>((resolve) => (release = resolve)));
    const aborted = new AbortController();
    const confirming = f.confirm(made, { signal: aborted.signal });
    await vi.waitFor(() => expect(handed).toBe(handedBefore + 2), { timeout: 30_000 });
    aborted.abort();
    release();
    await held;
    expect((await confirming).status).toBe(400);
    expect(await snapshot(stateDir, f)).toEqual(before);
    expect((await f.status()).newKeyWaiting).toBe(true);
  });

  it("a confirm whose request is gone while it waits for the venue's write lock changes nothing", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    const made = await f.make(true);
    await made.arrayBuffer();
    const before = await snapshot(stateDir, f);
    const lockCalls = vi.spyOn(suite.db, "withWriteLock");
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    let release!: () => void;
    const lock = suite.db.withWriteLock(async () => {
      held();
      await new Promise<void>((resolve) => (release = resolve));
    });
    await holding;
    const aborted = new AbortController();
    const confirming = f.confirm(made, { signal: aborted.signal });
    try {
      await vi.waitFor(() => expect(lockCalls).toHaveBeenCalledTimes(2), { timeout: 30_000 });
    } finally {
      aborted.abort();
      release();
      await lock;
      lockCalls.mockRestore();
    }
    const response = await confirming;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "recovery.pack_invalid", params: { reason: "unknown_pack" } },
    });
    expect(await snapshot(stateDir, f)).toEqual(before);
    expect((await f.status()).newKeyWaiting).toBe(true);
  });

  it("a repeated confirm, after the first answer was lost, answers again and writes nothing more", async () => {
    const stateDir = await stateFolder(3);
    let at = Date.parse(MADE_AT);
    const f = fixture(stateDir, { now: () => new Date((at += 60_000)) });
    const made = await f.make(true);
    await made.arrayBuffer();
    expect((await f.confirm(made)).status).toBe(204);
    const after = await snapshot(stateDir, f);
    expect(after.rows).toHaveLength(2);
    expect(after.steps).toEqual(["stream stopped", "sealed", "stream started", "backups reloaded"]);

    const again = await f.confirm(made);
    expect(again.status).toBe(204);
    expect(await snapshot(stateDir, f)).toEqual(after);
    const wrong = await f.received(1, {}, { masterKey: encodeMasterKeyCode(OLD_MASTER) });
    expect(wrong.status).toBe(400);
    expect(await snapshot(stateDir, f)).toEqual(after);
  });

  it("a plain pack's empty confirm still marks it received, and a waiting key's pack refuses one", async () => {
    const stateDir = await stateFolder(3);
    const f = fixture(stateDir);
    await (await f.make(encodeMasterKeyCode(OLD_MASTER))).arrayBuffer();
    expect((await f.received(1)).status).toBe(204);
    expect((await packs())[0]!.receivedAt).not.toBeNull();
    await (await f.make(true)).arrayBuffer();
    expect((await f.received(2)).status).toBe(400);
    expect((await packs())[0]!.receivedAt).toBeNull();
  });
});
