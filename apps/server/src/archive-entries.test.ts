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
