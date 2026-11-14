import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadKeyRing, sealNodeSigningKeyTx } from "@waitron/credentials";
import { CORE_MIGRATIONS, nodes, withNodeTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { generateNodeKeyPair, signDocumentBody } from "@waitron/membership";
import { NODE_MIGRATIONS, pinPrimaryKeyTx, setNodeModeTx } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { buildManifest } from "./backup-manifest.js";
import { recoveryArchiveSourceId } from "./recovery-source.js";
import { nodeDumpEntry } from "./testing/node-copy.js";
import { placeFirstCopy } from "./spare-copy-placement.js";
import { checkEmergencyCopy } from "./handover-emergency-check.js";
import { loadBoxEnv } from "./box-env.js";
import { loadRecoveryKey } from "./backup-config.js";

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
const key = "synthetic-archive-key";
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
async function archive() {
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
  const bytes = encryptArtifact(
    packArchive([
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: await readFile(path) },
      await nodeDumpEntry(suite.node, root),
      { name: "secrets/trading.env", bytes: Buffer.from("WAITRON_NODE_ID=the-old-box\n") },
    ]),
    key,
  );
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
    readRecoveryKey: async () => key,
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

it("uses a typed archive key without changing the saved key", async () => {
  await expect(stage({ readRecoveryKey: async () => undefined })).rejects.toMatchObject({
    code: "handover.backup_key_missing",
  });
  await expect(
    stage({
      readRecoveryKey: async () => {
        throw new AppError("backup.recovery_key_too_short", { min: 12 });
      },
      recoveryKey: key,
    }),
  ).resolves.toHaveProperty("source", "selected-backup");
  await expect(
    stage({ readRecoveryKey: async () => undefined, recoveryKey: key }),
  ).resolves.toHaveProperty("source", "selected-backup");
  const saved = "WAITRON_BACKUP_RECOVERY_KEY=a-newer-rotated-recovery-key\n";
  await writeFile(join(root, "backup.env"), saved);
  await expect(
    stage({
      readRecoveryKey: async () => loadRecoveryKey(await loadBoxEnv({}, root)),
      recoveryKey: key,
    }),
  ).resolves.toHaveProperty("source", "selected-backup");
  expect(await readFile(join(root, "backup.env"), "utf8")).toBe(saved);
});

it("keeps the placed source after a second selection is interrupted", async () => {
  const venueDir = join(root, "live");
  await mkdir(venueDir);
  await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, nodeId, "mirror"));
  await suite.node.archiveTo(join(venueDir, "node.db"));
  const first = await stage();
  expect(await placeFirstCopy({ stateDir: root, venueDir, nodeId, log: () => {} })).toBe(true);
  expect(await checkEmergencyCopy({ stateDir: root, venueDir, modules: [] })).toMatchObject(first);
  copyFault.interrupt = true;
  await expect(stage()).rejects.toMatchObject({ code: "EIO" });
  copyFault.interrupt = false;
  await expect(stat(join(root, "pair-copy", "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(join(root, "pair-copy", "venue.db"), "a crash left an unmarked partial copy");
  expect(await placeFirstCopy({ stateDir: root, venueDir, nodeId, log: () => {} })).toBe(false);
  expect(await checkEmergencyCopy({ stateDir: root, venueDir, modules: [] })).toMatchObject(first);
  expect(await readdir(join(root, "pair-copy"))).toEqual(["placed.json"]);
});
