import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { ALL_MODULES } from "./modules.js";
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

it("rejects with the node copy's failure when it and a state read both fail, whichever fails first", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "archive-entries-"));
  dirs.push(stateDir);
  const copyFailure = new Error("node copy failed");
  const collecting = collectStateParts({
    stateDir,
    modules: [],
    resolvers: {},
    snapshotNode: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw copyFailure;
    },
  });
  await expect(collecting).rejects.toBe(copyFailure);
});
