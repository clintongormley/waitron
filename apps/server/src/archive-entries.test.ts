import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BACKUP_ROOM_NOTE_FILE,
  BACKUP_ROOM_START_DELETED_FILE,
  backupRoomNoteTemporaryName,
} from "@waitron/provisioning";
import { afterEach, expect, it } from "vitest";
import { assembleArchiveEntries, collectStateParts } from "./archive-entries.js";
import type { BackupManifest } from "./backup-manifest.js";
import { writeVenueAuthority } from "./box-secrets.js";
import { ALL_MODULES } from "./modules.js";
import { restoreSecrets } from "./restore.js";
import { RECOVERY_FILES } from "./state-secrets.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-10-29T00:00:00.000Z",
  environment: "preproduction",
  modules: { core: 1 },
};

it("an archive built with the backup room's files in the state folder holds none of them", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "archive-entries-"));
  dirs.push(stateDir);
  for (const rel of RECOVERY_FILES) {
    await mkdir(join(stateDir, dirname(rel)), { recursive: true });
    await writeFile(join(stateDir, rel), `${rel}-contents`);
  }
  await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=x\n");
  await writeFile(join(stateDir, "modules.json"), '{"modules":{}}\n');
  for (const name of [
    BACKUP_ROOM_NOTE_FILE,
    backupRoomNoteTemporaryName("0123456789ab"),
    BACKUP_ROOM_START_DELETED_FILE,
    `${BACKUP_ROOM_START_DELETED_FILE}.tmp`,
  ])
    await writeFile(join(stateDir, name), '{"version":1}');
  const parts = await collectStateParts({
    stateDir,
    modules: ALL_MODULES,
    resolvers: {},
    snapshotNode: async () => Buffer.from("node"),
  });
  const entries = assembleArchiveEntries(MANIFEST, Buffer.from("dump"), parts);
  expect(entries.map((entry) => entry.name)).toEqual([
    "manifest.json",
    "db.dump",
    "node.dump",
    ...RECOVERY_FILES.map((rel) => `secrets/${rel}`),
    "secrets/backup.env",
    "secrets/modules.json",
  ]);
});

async function stateWithRecoveryFiles(): Promise<string> {
  const stateDir = await mkdtemp(join(tmpdir(), "archive-entries-"));
  dirs.push(stateDir);
  for (const rel of RECOVERY_FILES) {
    await mkdir(join(stateDir, dirname(rel)), { recursive: true });
    await writeFile(join(stateDir, rel), `${rel}-contents`);
  }
  return stateDir;
}

async function collectAndRestore(stateDir: string): Promise<{ names: string[]; restored: string }> {
  const parts = await collectStateParts({
    stateDir,
    modules: [],
    resolvers: {},
    snapshotNode: async () => Buffer.from("node"),
  });
  const entries = assembleArchiveEntries(MANIFEST, Buffer.from("dump"), parts);
  const restored = join(stateDir, "restored");
  await restoreSecrets({
    entries: entries.filter((entry) => entry.name.startsWith("secrets/")),
    stateDir: restored,
    log: () => {},
  });
  return { names: entries.map((entry) => entry.name), restored };
}

it("a joined spare's backup carries the venue's authority beside its own, and restores both apart", async () => {
  const stateDir = await stateWithRecoveryFiles();
  await writeVenueAuthority(stateDir, { certPem: "venue-ca-cert", keyPem: "venue-ca-key" });

  const { names, restored } = await collectAndRestore(stateDir);

  expect(names).toContain("secrets/tls/venue-ca.crt");
  expect(names).toContain("secrets/tls/venue-ca.key");
  expect(await readFile(join(restored, "tls/ca.crt"), "utf8")).toBe("tls/ca.crt-contents");
  expect(await readFile(join(restored, "tls/ca.key"), "utf8")).toBe("tls/ca.key-contents");
  expect(await readFile(join(restored, "tls/venue-ca.crt"), "utf8")).toBe("venue-ca-cert");
  expect(await readFile(join(restored, "tls/venue-ca.key"), "utf8")).toBe("venue-ca-key");
});

it("a box that never joined another is backed up and restored without a venue authority", async () => {
  const stateDir = await stateWithRecoveryFiles();

  const { names, restored } = await collectAndRestore(stateDir);

  expect(names.filter((name) => name.includes("venue-ca"))).toEqual([]);
  expect(await readFile(join(restored, "tls/ca.key"), "utf8")).toBe("tls/ca.key-contents");
  await expect(readFile(join(restored, "tls/venue-ca.key"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("a failing state read waits for the node copy to finish before it rejects", async () => {
  // No recovery files: the secrets read refuses at once.
  const stateDir = await mkdtemp(join(tmpdir(), "archive-entries-"));
  dirs.push(stateDir);
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const collecting = collectStateParts({
    stateDir,
    modules: [],
    resolvers: {},
    snapshotNode: async () => {
      await released;
      return Buffer.from("NODE");
    },
  });
  const settled = collecting.then(
    () => "settled",
    () => "settled",
  );
  const beforeRelease = await Promise.race([
    settled,
    new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
  ]);
  release();
  expect(beforeRelease).toBe("waiting");
  await expect(collecting).rejects.toMatchObject({ code: "recovery.state_incomplete" });
});

it("rejects naming the missing recovery file when it and the node copy both fail", async () => {
  // No recovery files: the secrets read refuses at once, and the node copy fails after it.
  const stateDir = await mkdtemp(join(tmpdir(), "archive-entries-"));
  dirs.push(stateDir);
  const collecting = collectStateParts({
    stateDir,
    modules: [],
    resolvers: {},
    snapshotNode: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error("node copy failed");
    },
  });
  await expect(collecting).rejects.toMatchObject({
    code: "recovery.state_incomplete",
    params: { missing: RECOVERY_FILES[0] },
  });
});

it("rejects naming the missing recovery file when the node copy fails first", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "archive-entries-"));
  dirs.push(stateDir);
  const collecting = collectStateParts({
    stateDir,
    modules: [],
    resolvers: {},
    snapshotNode: () => Promise.reject(new Error("node copy failed")),
  });
  await expect(collecting).rejects.toMatchObject({
    code: "recovery.state_incomplete",
    params: { missing: RECOVERY_FILES[0] },
  });
});
