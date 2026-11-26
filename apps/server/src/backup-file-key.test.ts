import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as credentials from "@waitron/credentials";
import { makeMasterKey, masterKeyId, sealingPublicKey } from "@waitron/credentials";
import { nodes, taxpayer, withTransaction } from "@waitron/db";
import { seedBusinessDay, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { encodeMasterKeyCode } from "@waitron/shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { heldKeyOpens, openingKeyFor } from "./backup-file-key.js";
import { buildManifest } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";
import { validateArtifactFile } from "./restore.js";
import { heldBackupKey, heldBackupKeyName } from "./testing/backup-key.js";
import { mintMasterKey } from "./testing/master-key.js";
import { writeMasterKeyArchive } from "./testing/master-key-archive.js";
import { nodeDumpEntry } from "./testing/node-copy.js";

vi.mock("@waitron/credentials", async (original) => {
  const actual = await original<typeof import("@waitron/credentials")>();
  return { ...actual, backupKey: vi.fn(actual.backupKey) };
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120000,
});
const NODE_ID = "b7100000-0000-4000-8000-000000000002";
beforeAll(async () => {
  await withTransaction(suite.db, async (tx) => {
    await tx
      .insert(taxpayer)
      .values({ id: 1, country: "ES", taxId: "89890002K", legalName: "Master key venue" });
    await seedVenueSettings(tx, { name: "Master key venue", invoiceLocales: ["es"] });
    await seedBusinessDay(tx, {});
    await tx.insert(nodes).values({ id: NODE_ID, name: "Master key node" });
  });
});

const dirs: string[] = [];
afterEach(async () => {
  vi.mocked(credentials.backupKey).mockClear();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const MASTER_KEY = makeMasterKey();
const ARCHIVE_KEY_ID = masterKeyId(sealingPublicKey(MASTER_KEY)).toString("hex");

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), "backup-file-key-"));
  dirs.push(root);
  const stagingDir = join(root, "staging");
  const stateDir = join(root, "state");
  await mkdir(stagingDir);
  await mkdir(stateDir);
  return { root, stagingDir, stateDir, artifactPath: join(root, "backup.enc") };
}

async function archivePlaintext(root: string): Promise<Buffer> {
  const database = join(root, "source.db");
  await suite.db.archiveTo(database);
  const manifest = await buildManifest({
    db: suite.db,
    node: suite.node,
    modules: ALL_MODULES,
    environment: "preproduction",
    now: new Date("2026-11-26T00:00:00Z"),
  });
  return packArchive([
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    { name: "db.dump", bytes: await readFile(database) },
    await nodeDumpEntry(suite.node, root),
    { name: "secrets/trading.env", bytes: Buffer.from(`WAITRON_NODE_ID=${NODE_ID}\n`) },
    {
      name: "secrets/secrets.env",
      bytes: Buffer.from(
        "WAITRON_CREDENTIALS_KEY=" +
          Buffer.alloc(32, 5).toString("base64") +
          "\nWAITRON_CREDENTIALS_KEY_VERSION=1\n",
      ),
    },
  ]);
}

function validation(f: Awaited<ReturnType<typeof scratch>>, recoveryKey: string) {
  return {
    artifactPath: f.artifactPath,
    stagingDir: f.stagingDir,
    stateDir: f.stateDir,
    recoveryKey,
    migrationsRoot: null,
    modules: ALL_MODULES,
    environment: "preproduction" as const,
  };
}

describe("openingKeyFor", () => {
  it("an archive restores with the master key alone", async () => {
    const f = await scratch();
    await writeMasterKeyArchive(f.artifactPath, await archivePlaintext(f.root), MASTER_KEY, 3);
    const key = await openingKeyFor(
      { artifactPath: f.artifactPath },
      encodeMasterKeyCode(MASTER_KEY),
    );
    expect(key).toBe(heldBackupKey(MASTER_KEY, 3).key);
    const validated = await validateArtifactFile(validation(f, key));
    try {
      expect(validated.manifest.environment).toBe("preproduction");
    } finally {
      await validated.discard();
    }
  });

  it("reads the header from the file's bytes as it does from its path", async () => {
    const f = await scratch();
    await writeMasterKeyArchive(f.artifactPath, Buffer.from("payload"), MASTER_KEY, 2);
    await expect(
      openingKeyFor(
        { artifact: await readFile(f.artifactPath) },
        encodeMasterKeyCode(MASTER_KEY).toLowerCase(),
      ),
    ).resolves.toBe(heldBackupKey(MASTER_KEY, 2).key);
  });

  it("another master key is refused, naming the archive's key", async () => {
    const f = await scratch();
    const archiveKey = await mintMasterKey(suite.db, {
      bytes: MASTER_KEY,
      madeAt: new Date("2026-10-01T12:00:00Z"),
    });
    await writeMasterKeyArchive(
      f.artifactPath,
      Buffer.from("payload"),
      MASTER_KEY,
      4,
      archiveKey.name.slice(0, 10),
    );
    const another = encodeMasterKeyCode(makeMasterKey());
    const refusal = await openingKeyFor({ artifactPath: f.artifactPath }, another).catch(
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({
      code: "promotion.break_glass_invalid",
      params: { masterKeyId: ARCHIVE_KEY_ID, keyNumber: 4, keyName: archiveKey.name },
    });
    await expect(
      openingKeyFor({ artifactPath: f.artifactPath }, encodeMasterKeyCode(MASTER_KEY)),
    ).resolves.toBe(heldBackupKey(MASTER_KEY, 4).key);
  });

  it("a not-whole master key is refused the same way", async () => {
    const f = await scratch();
    await writeMasterKeyArchive(f.artifactPath, Buffer.from("payload"), MASTER_KEY, 1);
    vi.mocked(credentials.backupKey).mockClear();
    const notWhole = encodeMasterKeyCode(MASTER_KEY).slice(0, -5);
    await expect(openingKeyFor({ artifactPath: f.artifactPath }, notWhole)).rejects.toMatchObject({
      code: "promotion.break_glass_invalid",
      params: {
        masterKeyId: ARCHIVE_KEY_ID,
        keyNumber: 1,
        keyName: heldBackupKeyName(MASTER_KEY),
      },
    });
    expect(credentials.backupKey).not.toHaveBeenCalled();
  });

  it("a version 1 file is refused as not a backup file, before any key is derived", async () => {
    const f = await scratch();
    await writeFile(f.artifactPath, encryptArtifact(Buffer.from("payload"), "a passphrase"));
    await expect(
      openingKeyFor({ artifactPath: f.artifactPath }, encodeMasterKeyCode(MASTER_KEY)),
    ).rejects.toMatchObject({ code: "backup.artifact_invalid", params: { reason: "bad_version" } });
    expect(credentials.backupKey).not.toHaveBeenCalled();
  });

  it("a backup whose header's key number is damaged, under the right key, is refused as recovery.passphrase_invalid when it opens", async () => {
    const f = await scratch();
    await writeMasterKeyArchive(f.artifactPath, await archivePlaintext(f.root), MASTER_KEY, 1);
    const bytes = await readFile(f.artifactPath);
    const keyNumberHighByte = "WBK1".length + 1 + 8;
    bytes[keyNumberHighByte] ^= 1;
    await writeFile(f.artifactPath, bytes);
    const key = await openingKeyFor(
      { artifactPath: f.artifactPath },
      encodeMasterKeyCode(MASTER_KEY),
    );
    await expect(validateArtifactFile(validation(f, key))).rejects.toMatchObject({
      code: "recovery.passphrase_invalid",
    });
  });

  it("a backup damaged after its header, under the right key, is refused as recovery.passphrase_invalid, not as a wrong key", async () => {
    const f = await scratch();
    await writeMasterKeyArchive(f.artifactPath, await archivePlaintext(f.root), MASTER_KEY, 1);
    const bytes = await readFile(f.artifactPath);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(f.artifactPath, bytes);
    const key = await openingKeyFor(
      { artifactPath: f.artifactPath },
      encodeMasterKeyCode(MASTER_KEY),
    );
    await expect(validateArtifactFile(validation(f, key))).rejects.toMatchObject({
      code: "recovery.passphrase_invalid",
    });
  });
});

describe("heldKeyOpens", () => {
  const header = {
    version: 2 as const,
    masterKeyId: Buffer.from(ARCHIVE_KEY_ID, "hex"),
    keyNumber: 2,
    masterKeyDay: "2026-10-01",
  };

  it("is true for the key with the header's master key id and number", () => {
    expect(heldKeyOpens(header, heldBackupKey(MASTER_KEY, 2))).toBe(true);
  });

  it("is false for another number of the same master key, or another master key's", () => {
    expect(heldKeyOpens(header, heldBackupKey(MASTER_KEY, 1))).toBe(false);
    expect(heldKeyOpens(header, heldBackupKey(makeMasterKey(), 2))).toBe(false);
  });

  it("is false for a version 1 header", () => {
    expect(heldKeyOpens({ version: 1 }, heldBackupKey(MASTER_KEY, 2))).toBe(false);
  });
});
