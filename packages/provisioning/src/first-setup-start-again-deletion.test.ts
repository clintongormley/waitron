import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import {
  BACKUP_ROOM_NOTE_FILE,
  BACKUP_ROOM_START_DELETED_FILE,
  backupRoomNoteTemporaryName,
} from "./spare-space-name.js";
import type { BackupRepairRecord } from "./first-setup-backup-workspace.js";
import { createFirstSetupBackupWorkspace } from "./first-setup-backup-workspace.js";
import { emptyAbandonedBackupRecovery } from "./first-setup-backup-discard.js";
import {
  START_AGAIN_MARKER_FILE,
  assertStartAgainAllowedOnDisk,
  collectStartAgainFindings,
  deleteMarkedAttempt,
  finishStartAgainDeletion,
  startAgainMarkerFor,
  writeStartAgainMarker,
} from "./first-setup-start-again-deletion.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const RECORDS = "first-setup-resolutions";
const NAMESPACE = join(RECORDS, "backup-recovery");
const recoveryId = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
const laterId = "0d2b6b62-4a3e-4a4f-9b56-6a0f1f7d1c11";
const attempt = { attemptId: "7c1f0b55-3f1e-4a52-9d2b-5a0d1c2e3f40", frozenDigest: "e".repeat(64) };
const layout = `layout unexpected: ${NAMESPACE}`;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!isAppError(error)) throw new Error(`expected a refusal, got ${String(error)}`);
  return { code: error.code, reason: error.reason };
}

async function box() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "start-again-deletion-")));
  directories.push(root);
  const roots = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(roots)) await mkdir(path);
  await writeFile(join(roots.stateDir, "first-setup.json"), "attempt record");
  await writeFile(join(roots.venueDir, "first-setup-claim.json"), "claim");
  await writeFile(join(roots.venueDir, "venue.db"), "attempt database bytes");
  (await lockVenueDatabase(roots.venueDir)).release();
  return roots;
}

type Roots = Awaited<ReturnType<typeof box>>;

async function prepared(roots: Roots, id = recoveryId) {
  const base = join(roots.stateDir, NAMESPACE, id);
  const store = createFirstSetupBackupWorkspace(roots);
  const input: Omit<
    BackupRepairRecord,
    "version" | "sequence" | "previousRecordDigest" | "recordedAt"
  > = {
    target: {
      recoveryId: id,
      anchor: roots,
      source: roots,
      target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
      generation: 1,
    },
    observation: {
      inspectionId: "a".repeat(64),
      revision: null,
      ownerGeneration: null,
      originalsDigest: await store.inspect(id),
    },
    sourceId: "b".repeat(64),
    activationSourceId: "c".repeat(64),
    binding: {
      module: "synthetic",
      action: "restore",
      eventId: "4cc6a357-e31c-4c2e-9b40-023c9963bec8",
      sourceId: "c".repeat(64),
      targetNodeId: "47d5be37-2011-4afc-bdc8-46b5cb238deb",
    },
    input: null,
    retainedEvidenceDigest: "d".repeat(64),
    phase: "prepared",
  };
  await store.append(input);
  return { store, input, base, targetVenue: input.target.target.venueDir };
}

/** A recovery that placed a database, then was discarded but not yet emptied. */
async function abandoned(roots: Roots, id = recoveryId) {
  const journal = await prepared(roots, id);
  await journal.store.append({
    ...journal.input,
    input: { accepted: true },
    phase: "placement-started",
  });
  await writeFile(join(journal.targetVenue, "venue.db"), "restored database");
  (await lockVenueDatabase(journal.targetVenue)).release();
  await journal.store.abandon(id);
  return journal;
}

async function tombstone(roots: Roots, id = recoveryId) {
  const journal = await abandoned(roots, id);
  await emptyAbandonedBackupRecovery(roots, id);
  return journal;
}

const statePointer = (roots: Roots) => join(roots.stateDir, NAMESPACE, "current.json");
const venuePointer = (roots: Roots) => join(roots.venueDir, NAMESPACE, "current.json");

it("accepts an emptied tombstone, leaves it off the marker and keeps it through the deletion", async () => {
  const roots = await box();
  const { base } = await tombstone(roots);
  await assertStartAgainAllowedOnDisk(roots);
  const marker = await startAgainMarkerFor(roots, attempt);
  expect(marker.files.map((file) => `${file.root}/${file.name}`).sort()).toEqual([
    "state/first-setup.json",
    "venue/first-setup-claim.json",
    "venue/venue.db",
  ]);
  const records = (await readdir(base)).filter((name) => /^\d+\.json$/.test(name));
  await deleteMarkedAttempt(roots, marker);
  expect(await exists(join(roots.stateDir, "first-setup.json"))).toBe(false);
  expect(await exists(join(roots.venueDir, "venue.db"))).toBe(false);
  expect(await exists(statePointer(roots))).toBe(true);
  expect((await readdir(base)).filter((name) => /^\d+\.json$/.test(name))).toEqual(records);
  expect(await exists(join(roots.stateDir, RECORDS))).toBe(true);
});

it("refuses a discarded recovery not yet emptied: the venue pointer stops the disk check, the unemptied folder the marker", async () => {
  const roots = await box();
  await abandoned(roots);
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    reason: "refused artifact: venue/first-setup-resolutions",
  });
  expect(await refusal(startAgainMarkerFor(roots, attempt))).toEqual({
    code: "setup.start_again_incomplete",
    reason: layout,
  });
});

it("refuses a tombstone whose recovery folder still holds a database, even with the venue pointer gone", async () => {
  const roots = await box();
  const { targetVenue } = await tombstone(roots);
  await writeFile(join(targetVenue, "venue.db"), "restored database");
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
});

it("refuses a pointer to a journal that is not abandoned", async () => {
  const roots = await box();
  await prepared(roots);
  await rm(join(roots.venueDir, RECORDS), { recursive: true });
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
  expect(await refusal(startAgainMarkerFor(roots, attempt))).toEqual({
    code: "setup.start_again_incomplete",
    reason: layout,
  });
});

it("with discarding, marks no journal file beside a prepared journal; without it, refuses", async () => {
  const roots = await box();
  await prepared(roots);
  expect(await exists(venuePointer(roots))).toBe(true);
  expect(await refusal(startAgainMarkerFor(roots, attempt))).toEqual({
    code: "setup.start_again_incomplete",
    reason: layout,
  });
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    reason: "refused artifact: venue/first-setup-resolutions",
  });
  const marker = await startAgainMarkerFor(roots, attempt, { discarding: recoveryId });
  expect(marker.files.map((file) => `${file.root}/${file.name}`).sort()).toEqual([
    "state/first-setup.json",
    "venue/first-setup-claim.json",
    "venue/venue.db",
  ]);
  await assertStartAgainAllowedOnDisk(roots, { discarding: recoveryId });
});

it("with discarding, still accepts the stopped recovery after the attempt's record was rewritten", async () => {
  const roots = await box();
  const { store } = await prepared(roots);
  await writeFile(
    join(roots.stateDir, "first-setup.json"),
    "attempt record after the password step",
  );
  await expect(store.read()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await assertStartAgainAllowedOnDisk(roots, { discarding: recoveryId });
  const marker = await startAgainMarkerFor(roots, attempt, { discarding: recoveryId });
  expect(marker.files.some((file) => file.name.startsWith(RECORDS))).toBe(false);
});

it("with discarding, accepts the recovery beside an earlier tombstone", async () => {
  const roots = await box();
  await tombstone(roots, recoveryId);
  await prepared(roots, laterId);
  await assertStartAgainAllowedOnDisk(roots, { discarding: laterId });
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toMatchObject({
    code: "setup.not_ready",
  });
});

it("refuses discarding a recovery the pointer does not name", async () => {
  const roots = await box();
  await prepared(roots);
  expect(await refusal(assertStartAgainAllowedOnDisk(roots, { discarding: laterId }))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
  expect(await refusal(startAgainMarkerFor(roots, attempt, { discarding: laterId }))).toEqual({
    code: "setup.start_again_incomplete",
    reason: layout,
  });
});

it("refuses discarding another recovery beside a finished tombstone", async () => {
  const roots = await box();
  await tombstone(roots);
  await assertStartAgainAllowedOnDisk(roots);
  expect(await refusal(assertStartAgainAllowedOnDisk(roots, { discarding: laterId }))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
});

it("refuses a pointer to a journal that is not abandoned, even with its folder down to its records", async () => {
  const roots = await box();
  const { base } = await prepared(roots);
  await rm(join(roots.venueDir, RECORDS), { recursive: true });
  for (const name of await readdir(base))
    if (!/^\d+\.json$/.test(name)) await rm(join(base, name), { recursive: true });
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
});

it.each<[string, boolean, (roots: Roots) => Promise<unknown>]>([
  [
    "an empty recovery folder",
    false,
    (roots) => mkdir(join(roots.stateDir, NAMESPACE), { recursive: true }),
  ],
  ["a tombstone with no pointer", true, (roots) => rm(statePointer(roots))],
  [
    "a stray file beside the pointer",
    true,
    (roots) => writeFile(join(roots.stateDir, NAMESPACE, "x"), ""),
  ],
  [
    "a folder that is not a recovery id",
    true,
    (roots) => mkdir(join(roots.stateDir, NAMESPACE, "not-an-id")),
  ],
])("refuses a recovery folder holding %s", async (_, withTombstone, change) => {
  const roots = await box();
  if (withTombstone) await tombstone(roots);
  await change(roots);
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
});

it.each<[string, (roots: Roots) => Promise<unknown>]>([
  ["a file beside the pointer", (roots) => writeFile(join(roots.venueDir, NAMESPACE, "x"), "")],
  ["a folder beside the recovery folder", (roots) => mkdir(join(roots.venueDir, RECORDS, "x"))],
  [
    "a file in place of the recovery folder",
    async (roots) => {
      await rm(join(roots.venueDir, NAMESPACE), { recursive: true });
      await writeFile(join(roots.venueDir, NAMESPACE), "");
    },
  ],
])("with discarding, refuses venue records holding %s", async (_, change) => {
  const roots = await box();
  await prepared(roots);
  await change(roots);
  expect(await refusal(assertStartAgainAllowedOnDisk(roots, { discarding: recoveryId }))).toEqual({
    code: "setup.not_ready",
    reason: "refused artifact: venue/first-setup-resolutions",
  });
});

it("finishes an interrupted deletion beside a tombstone and keeps the tombstone", async () => {
  const roots = await box();
  const { base } = await tombstone(roots);
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt));
  await finishStartAgainDeletion(roots);
  expect(await exists(join(roots.venueDir, START_AGAIN_MARKER_FILE))).toBe(false);
  expect(await exists(join(roots.venueDir, "venue.db"))).toBe(false);
  expect(await exists(join(roots.stateDir, "first-setup.json"))).toBe(false);
  expect(await exists(statePointer(roots))).toBe(true);
  expect((await readdir(base)).some((name) => /^\d+\.json$/.test(name))).toBe(true);
});

it("with discarding, refuses a venue pointer when the state folder holds no recovery records", async () => {
  const roots = await box();
  await prepared(roots);
  await rm(join(roots.stateDir, RECORDS), { recursive: true });
  expect(await exists(venuePointer(roots))).toBe(true);
  expect(await refusal(assertStartAgainAllowedOnDisk(roots, { discarding: recoveryId }))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
  expect(await refusal(startAgainMarkerFor(roots, attempt, { discarding: recoveryId }))).toEqual({
    code: "setup.start_again_incomplete",
    reason: layout,
  });
});

it("with discarding, refuses a venue pointer to another recovery when the state folder's recovery folder is gone", async () => {
  const roots = await box();
  await prepared(roots, laterId);
  await rm(join(roots.stateDir, NAMESPACE), { recursive: true });
  expect(await exists(venuePointer(roots))).toBe(true);
  expect(await refusal(assertStartAgainAllowedOnDisk(roots, { discarding: recoveryId }))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
  expect(await refusal(startAgainMarkerFor(roots, attempt, { discarding: recoveryId }))).toEqual({
    code: "setup.start_again_incomplete",
    reason: layout,
  });
});

it("with discarding, refuses a recovery whose state folder lost its pointer, though the venue folder's remains", async () => {
  const roots = await box();
  await prepared(roots);
  await rm(statePointer(roots));
  expect(await exists(venuePointer(roots))).toBe(true);
  expect(await refusal(assertStartAgainAllowedOnDisk(roots, { discarding: recoveryId }))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
  expect(await refusal(startAgainMarkerFor(roots, attempt, { discarding: recoveryId }))).toEqual({
    code: "setup.start_again_incomplete",
    reason: layout,
  });
});

it("refuses a tombstone holding a file whose name only begins with a lock file's name", async () => {
  const roots = await box();
  const { targetVenue } = await tombstone(roots);
  await writeFile(join(targetVenue, "venue.lock.db"), "restored database");
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    reason: layout,
  });
  expect(await refusal(startAgainMarkerFor(roots, attempt))).toEqual({
    code: "setup.start_again_incomplete",
    reason: layout,
  });
});

it.each([
  [
    "a pointer whose recovery folder is gone",
    "ENOENT",
    async (roots: Roots) => {
      const { base } = await prepared(roots);
      await rm(base, { recursive: true });
      return base;
    },
  ],
  [
    "a records folder that is a file",
    "ENOTDIR",
    async (roots: Roots) => {
      await writeFile(join(roots.stateDir, RECORDS), "not a folder");
      return join(roots.stateDir, NAMESPACE);
    },
  ],
])(
  "reports %s as a failed check when building the marker, naming the error and the path",
  async (_name, code, damage) => {
    const roots = await box();
    const path = await damage(roots);
    expect(await refusal(startAgainMarkerFor(roots, attempt))).toEqual({
      code: "setup.start_again_incomplete",
      reason: `check failed: ${code} ${path}`,
    });
  },
);

it("reports a recovery folder it cannot read as a failed check, naming the error and the path", async () => {
  const roots = await box();
  const { base } = await tombstone(roots);
  const target = join(base, "target");
  await chmod(target, 0o000);
  try {
    expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
      code: "setup.not_ready",
      reason: `check failed: EACCES ${target}`,
    });
  } finally {
    await chmod(target, 0o700);
  }
});

const MODULES = "state/modules.json";
async function heldBox() {
  const roots = await box();
  await writeFile(join(roots.stateDir, "modules.json"), '{"modules":{}}\n');
  return roots;
}
const marked = (marker: Awaited<ReturnType<typeof startAgainMarkerFor>>) =>
  marker.files.map((file) => `${file.root}/${file.name}`).sort();

it("with held, the disk check accepts the setup's modules.json; without it, refuses", async () => {
  const roots = await heldBox();
  await assertStartAgainAllowedOnDisk(roots, { held: true });
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    reason: "refused artifact: state/modules.json",
  });
});

it("the marker names modules.json only with held", async () => {
  const roots = await heldBox();
  expect(marked(await startAgainMarkerFor(roots, attempt, { held: true }))).toEqual([
    "state/first-setup.json",
    MODULES,
    "venue/first-setup-claim.json",
    "venue/venue.db",
  ]);
  expect(marked(await startAgainMarkerFor(roots, attempt))).not.toContain(MODULES);
});

it("a marker naming modules.json is read back, finished, and deletes it", async () => {
  const roots = await heldBox();
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt, { held: true }));
  const collected = await collectStartAgainFindings(roots);
  expect(collected).toMatchObject({ findings: [], blocker: null });
  expect(marked(collected!.marker)).toContain(MODULES);
  await finishStartAgainDeletion(roots);
  expect(await exists(join(roots.venueDir, START_AGAIN_MARKER_FILE))).toBe(false);
  expect(await exists(join(roots.stateDir, "modules.json"))).toBe(false);
  expect(await exists(join(roots.stateDir, "first-setup.json"))).toBe(false);
});

it("a marker not naming modules.json still finds it a refused artifact, and the finisher deletes nothing", async () => {
  const roots = await box();
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt));
  await writeFile(join(roots.stateDir, "modules.json"), '{"modules":{}}\n');
  expect((await collectStartAgainFindings(roots))?.findings).toEqual([
    { kind: "refused-artifact", root: "state", name: "modules.json" },
  ]);
  expect(await refusal(finishStartAgainDeletion(roots))).toEqual({
    code: "setup.start_again_incomplete",
    reason: "refused artifact present: state/modules.json",
  });
  expect(await exists(join(roots.stateDir, "modules.json"))).toBe(true);
  expect(await exists(join(roots.stateDir, "first-setup.json"))).toBe(true);
});

it("a modules.json changed after the marker named it is a changed finding, and the finisher deletes nothing", async () => {
  const roots = await heldBox();
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt, { held: true }));
  await writeFile(join(roots.stateDir, "modules.json"), '{"modules":{"other":{}}}\n');
  expect((await collectStartAgainFindings(roots))?.findings).toEqual([
    { kind: "changed", root: "state", name: "modules.json" },
  ]);
  expect(await refusal(finishStartAgainDeletion(roots))).toEqual({
    code: "setup.start_again_incomplete",
    reason: "size or hash differs: state/modules.json",
  });
  expect(await exists(join(roots.stateDir, "modules.json"))).toBe(true);
  expect(await exists(join(roots.stateDir, "first-setup.json"))).toBe(true);
});

it("deleting the marked attempt deletes the backup room note first", async () => {
  const roots = await box();
  const marker = await startAgainMarkerFor(roots, attempt);
  await writeFile(join(roots.stateDir, BACKUP_ROOM_NOTE_FILE), "{}");
  await deleteMarkedAttempt(roots, marker);
  expect(await exists(join(roots.stateDir, BACKUP_ROOM_NOTE_FILE))).toBe(false);
  expect(await exists(join(roots.venueDir, "venue.db"))).toBe(false);
});

it("the backup room's files written after the marker are no finding, and Start again finishes", async () => {
  const roots = await box();
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt));
  const temporary = backupRoomNoteTemporaryName("0123456789ab");
  const recordTemporary = `${BACKUP_ROOM_START_DELETED_FILE}.tmp`;
  for (const name of [
    BACKUP_ROOM_NOTE_FILE,
    temporary,
    BACKUP_ROOM_START_DELETED_FILE,
    recordTemporary,
  ])
    await writeFile(join(roots.stateDir, name), '{"version":1}');
  expect((await collectStartAgainFindings(roots))?.findings).toEqual([]);
  await finishStartAgainDeletion(roots);
  expect(await exists(join(roots.venueDir, START_AGAIN_MARKER_FILE))).toBe(false);
  expect(await exists(join(roots.venueDir, "venue.db"))).toBe(false);
  expect((await readdir(roots.stateDir)).sort()).toEqual(
    [BACKUP_ROOM_START_DELETED_FILE, temporary, recordTemporary].sort(),
  );
});

it("a backup room note that cannot be deleted stops the deletion before the venue folder changes", async () => {
  const roots = await box();
  const marker = await startAgainMarkerFor(roots, attempt);
  await mkdir(join(roots.stateDir, BACKUP_ROOM_NOTE_FILE));
  const before = (await readdir(roots.venueDir)).sort();
  const refused = await refusal(deleteMarkedAttempt(roots, marker));
  expect(refused.code).toBe("setup.start_again_incomplete");
  expect(refused.reason).toMatch(/^deletion failed: E(PERM|ISDIR) .*backup-room-note\.json$/);
  expect((await readdir(roots.venueDir)).sort()).toEqual(before);
  expect(await exists(join(roots.venueDir, "venue.db"))).toBe(true);
});
