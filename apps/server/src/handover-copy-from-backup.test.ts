import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadKeyRing, makeMasterKey, sealNodeSigningKeyTx } from "@waitron/credentials";
import { CORE_MIGRATIONS, nodes, withNodeTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { generateNodeKeyPair, signDocumentBody } from "@waitron/membership";
import { NODE_MIGRATIONS, pinPrimaryKeyTx, setNodeModeTx } from "@waitron/node-db";
import { encodeMasterKeyCode } from "@waitron/shared";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { buildManifest } from "./backup-manifest.js";
import { recoveryArchiveSourceId } from "./recovery-source.js";
import { nodeDumpEntry } from "./testing/node-copy.js";
import { placeFirstCopy } from "./spare-copy-placement.js";
import { checkEmergencyCopy } from "./handover-emergency-check.js";
import { loadBoxEnv } from "./box-env.js";
import { loadBackupKey, loadUsableBackupKey } from "./backup-config.js";
import { backupKeyEnv, heldBackupKey, heldBackupKeyName } from "./testing/backup-key.js";
import { masterKeyArchiveBytes } from "./testing/master-key-archive.js";

const copyFault = vi.hoisted(() => ({ interrupt: false, markerAtWrite: [] as boolean[] }));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    copyFile: async (from: string, to: string) => {
      if (copyFault.interrupt) {
        copyFault.markerAtWrite.push(existsSync(join(to, "..", "ready.json")));
        await real.writeFile(to, "partial selected copy");
        throw Object.assign(new Error("interrupted selected copy"), { code: "EIO" });
      }
      await real.copyFile(from, to);
    },
  };
});

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const main = generateNodeKeyPair();
const spare = generateNodeKeyPair();
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 6).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const masterKey = makeMasterKey();
const held = heldBackupKey(masterKey);
const mainId = "d5000000-0000-4000-8000-000000000001";
const nodeId = "d5000000-0000-4000-8000-000000000002";
let root: string;
let artifactPath: string;
let ciphertext: Uint8Array;
const body = () => ({
  term: 1,
  nodes: [
    { nodeId: mainId, standing: "serving-primary" as const, contactUrl: "https://main.example" },
    { nodeId, standing: "serving-secondary" as const, contactUrl: "https://spare.example" },
  ],
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "selected-handover-"));
  artifactPath = join(root, "input.enc");
  await seedVenue(suite.db, { invoiceLocales: ["en"] });
  await suite.db.insert(nodes).values([
    { id: mainId, name: "Main", publicKey: main.publicKey },
    { id: nodeId, name: "Spare", publicKey: spare.publicKey },
  ]);
  await writeNodeMembership(suite.db, {
    body: body(),
    signerNodeId: mainId,
    signature: signDocumentBody(body(), main.privateKey),
    endorsements: [],
  });
  await withNodeTransaction(suite.node, async (tx) => {
    await sealNodeSigningKeyTx(tx, ring, nodeId, spare.privateKey);
    await pinPrimaryKeyTx(tx, nodeId, { primaryNodeId: mainId, publicKey: main.publicKey });
  });
  ciphertext = await archive();
});
afterEach(async () => {
  copyFault.interrupt = false;
  copyFault.markerAtWrite = [];
  await rm(root, { recursive: true, force: true });
});

it("retires the old marker before replacing a selection, and publishes none after interruption", async () => {
  await stage();
  copyFault.interrupt = true;
  await expect(stage()).rejects.toMatchObject({ code: "EIO" });
  expect(copyFault.markerAtWrite).toEqual([false]);
  await expect(stat(join(root, "pair-copy", "ready.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readdir(join(root, "scratch"))).toEqual([]);
  copyFault.interrupt = false;
  await expect(stage()).resolves.toHaveProperty("source", "selected-backup");
});
async function archive(n = 1, version: 1 | 2 = 2) {
  const path = join(root, "copy.db");
  await rm(path, { force: true });
  await suite.db.archiveTo(path);
  const manifest = await buildManifest({
    db: suite.db,
    node: suite.node,
    modules: [],
    environment: "preproduction",
    now: new Date("2026-11-14T00:00:00Z"),
  });
  const packed = packArchive([
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    { name: "db.dump", bytes: await readFile(path) },
    await nodeDumpEntry(suite.node, root),
    { name: "secrets/trading.env", bytes: Buffer.from("WAITRON_NODE_ID=the-old-box\n") },
  ]);
  const bytes =
    version === 2
      ? masterKeyArchiveBytes(packed, masterKey, n)
      : encryptArtifact(packed, "synthetic-archive-key");
  await writeFile(artifactPath, bytes);
  return bytes;
}
async function stage(overrides = {}) {
  const { stageBackupAsCopy } = await import("./handover-copy-from-backup.js");
  return stageBackupAsCopy({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId,
    stateDir: root,
    artifactPath,
    modules: [],
    environment: "preproduction",
    migrationsRoot: null,
    readBackupKey: async () => held,
    ...overrides,
  });
}

it("stages only the admitted venue file and archive provenance, discarding the archived identity", async () => {
  const selection = await stage();
  expect(selection).toEqual({
    source: "selected-backup",
    sourceId: recoveryArchiveSourceId(ciphertext),
  });
  expect(JSON.parse(await readFile(join(root, "pair-copy", "ready.json"), "utf8"))).toEqual(
    selection,
  );
  expect(await readdir(join(root, "pair-copy"))).toEqual(["ready.json", "venue.db"]);
  expect((await stat(join(root, "pair-copy", "venue.db"))).mode & 0o777).toBe(0o600);
  expect(await readdir(join(root, "scratch"))).toEqual([]);
  expect(await readFile(artifactPath)).toEqual(Buffer.from(ciphertext));
});

it.each(["missing-row", "wrong-key", "untrusted-chart", "missing-chart-node", "different-main"])(
  "refuses %s without publishing a copy",
  async (fault) => {
    const chart = body();
    if (fault === "missing-row") await suite.db.delete(nodes);
    if (fault === "wrong-key") await suite.db.update(nodes).set({ publicKey: main.publicKey });
    if (fault === "missing-chart-node") chart.nodes.pop();
    if (fault === "different-main") {
      chart.nodes[0]!.standing = "serving-secondary";
      chart.nodes.push({
        nodeId: "d5000000-0000-4000-8000-000000000003",
        standing: "serving-primary",
        contactUrl: "https://third.example",
      });
    }
    await writeNodeMembership(suite.db, {
      body: chart,
      signerNodeId: mainId,
      signature: signDocumentBody(
        chart,
        fault === "untrusted-chart" ? spare.privateKey : main.privateKey,
      ),
      endorsements: [],
    });
    await archive();
    if (fault === "different-main")
      await writeNodeMembership(suite.db, {
        body: body(),
        signerNodeId: mainId,
        signature: signDocumentBody(body(), main.privateKey),
        endorsements: [],
      });
    await expect(stage()).rejects.toMatchObject({ code: "handover.copy_predates_destination" });
    await expect(stat(join(root, "pair-copy", "ready.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readdir(join(root, "scratch"))).toEqual([]);
  },
);

it("the emergency switch opens a current backup file with no key typed", async () => {
  await writeFile(
    join(root, "backup.env"),
    Object.entries(backupKeyEnv(held))
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
  );
  await expect(
    stage({ readBackupKey: async () => loadBackupKey(await loadBoxEnv({}, root)) }),
  ).resolves.toEqual({ source: "selected-backup", sourceId: recoveryArchiveSourceId(ciphertext) });
});

it("a file under an older key asks for the master key and names it", async () => {
  const asks = {
    code: "handover.backup_needs_master_key",
    params: { keyName: heldBackupKeyName(masterKey) },
  };
  await expect(
    stage({ readBackupKey: async () => heldBackupKey(masterKey, 2) }),
  ).rejects.toMatchObject(asks);
  await expect(
    stage({ readBackupKey: async () => heldBackupKey(makeMasterKey(), 1) }),
  ).rejects.toMatchObject(asks);
  await expect(stat(join(root, "pair-copy", "ready.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(existsSync(join(root, "scratch"))).toBe(false);
});

it("with the master key it names, the older backup is used, and backup.env is unchanged", async () => {
  ciphertext = await archive(3);
  const saved = Object.entries(backupKeyEnv(heldBackupKey(masterKey, 4)))
    .map(([name, value]) => `${name}=${value}\n`)
    .join("");
  await writeFile(join(root, "backup.env"), saved);
  const readBackupKey = async () => loadBackupKey(await loadBoxEnv({}, root));
  await expect(stage({ readBackupKey })).rejects.toMatchObject({
    code: "handover.backup_needs_master_key",
  });
  await expect(
    stage({ readBackupKey, masterKey: encodeMasterKeyCode(masterKey) }),
  ).resolves.toEqual({ source: "selected-backup", sourceId: recoveryArchiveSourceId(ciphertext) });
  expect(await readFile(join(root, "backup.env"), "utf8")).toBe(saved);
});

it("a wrong master key is refused naming the backup's key", async () => {
  const other = makeMasterKey();
  await expect(
    stage({ readBackupKey: async () => undefined, masterKey: encodeMasterKeyCode(other) }),
  ).rejects.toMatchObject({
    code: "promotion.break_glass_invalid",
    params: { keyName: heldBackupKeyName(masterKey), keyNumber: 1 },
  });
  await expect(stat(join(root, "pair-copy", "ready.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("a spare with no backup.env, or one holding a key too short to use, asks for the master key", async () => {
  await expect(
    stage({ readBackupKey: async () => loadBackupKey(await loadBoxEnv({}, root)) }),
  ).rejects.toMatchObject({
    code: "handover.backup_needs_master_key",
    params: { keyName: heldBackupKeyName(masterKey) },
  });
  await writeFile(
    join(root, "backup.env"),
    Object.entries({ ...backupKeyEnv(held), WAITRON_BACKUP_RECOVERY_KEY: "too-short" })
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
  );
  await expect(
    stage({ readBackupKey: async () => loadUsableBackupKey(await loadBoxEnv({}, root)) }),
  ).rejects.toMatchObject({ code: "handover.backup_needs_master_key" });
});

it("a spare holding the file's key with its number and id but no master key day opens it with no key typed", async () => {
  ciphertext = await archive(4);
  const withoutDay = backupKeyEnv(heldBackupKey(masterKey, 4));
  delete withoutDay.WAITRON_BACKUP_MASTER_KEY_DAY;
  await writeFile(
    join(root, "backup.env"),
    Object.entries(withoutDay)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
  );
  await expect(
    stage({ readBackupKey: async () => loadUsableBackupKey(await loadBoxEnv({}, root)) }),
  ).resolves.toEqual({ source: "selected-backup", sourceId: recoveryArchiveSourceId(ciphertext) });
});

it("refuses a version 1 file, with or without a master key", async () => {
  await archive(1, 1);
  for (const typed of [{}, { masterKey: encodeMasterKeyCode(masterKey) }])
    await expect(stage(typed)).rejects.toMatchObject({
      code: "backup.artifact_invalid",
      params: { reason: "bad_version" },
    });
  expect(existsSync(join(root, "scratch"))).toBe(false);
});

it("keeps the placed source after a second selection is interrupted", async () => {
  const venueDir = join(root, "live");
  await mkdir(venueDir);
  await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, nodeId, "mirror", "adopt"));
  await suite.node.archiveTo(join(venueDir, "node.db"));
  const first = await stage();
  expect(await placeFirstCopy({ stateDir: root, venueDir, nodeId, log: () => {} })).toBe(true);
  expect(await checkEmergencyCopy({ stateDir: root, venueDir, modules: [] })).toMatchObject(first);
  copyFault.interrupt = true;
  await expect(stage()).rejects.toMatchObject({ code: "EIO" });
  copyFault.interrupt = false;
  await expect(stat(join(root, "pair-copy", "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(join(root, "pair-copy", "venue.db"), "a crash left an unmarked partial copy");
  expect(await checkEmergencyCopy({ stateDir: root, venueDir, modules: [] })).toMatchObject(first);
  expect(await placeFirstCopy({ stateDir: root, venueDir, nodeId, log: () => {} })).toBe(false);
  expect(await checkEmergencyCopy({ stateDir: root, venueDir, modules: [] })).toMatchObject(first);
  expect(await readdir(join(root, "pair-copy"))).toEqual(["placed.json"]);
});

it("a cancelled backup-copy check preserves the ready copy and discards validation scratch", async () => {
  await stage();
  const before = await readFile(join(root, "pair-copy", "venue.db"));
  const marker = await readFile(join(root, "pair-copy", "ready.json"));
  const reason = new Error("request closed");
  await expect(stage({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  expect(await readFile(join(root, "pair-copy", "venue.db"))).toEqual(before);
  expect(await readFile(join(root, "pair-copy", "ready.json"))).toEqual(marker);
  expect(await readdir(join(root, "scratch"))).toEqual([]);
});
