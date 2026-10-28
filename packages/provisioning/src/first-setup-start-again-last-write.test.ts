import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import type { BackupRepairRecord } from "./first-setup-backup-workspace.js";
import { createFirstSetupBackupWorkspace } from "./first-setup-backup-workspace.js";
import { attemptLastWriteMs } from "./first-setup-start-again-deletion.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const T = 1792150980000;
const HOUR = 3_600_000;
const RECORDS = "first-setup-resolutions";
const BACKUP = join(RECORDS, "backup-recovery");
const recoveryId = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
const recordsId = "3a6f4f7e-2c1d-4b8a-9e0f-1d2c3b4a5f60";

async function box() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "start-again-last-write-")));
  directories.push(root);
  const roots = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(roots)) await mkdir(path);
  await writeFile(join(roots.stateDir, "module-preparation-state.json"), "{}");
  await writeFile(join(roots.stateDir, "first-setup.json"), "attempt record");
  await writeFile(join(roots.venueDir, "first-setup-claim.json"), "claim");
  await writeFile(join(roots.venueDir, "venue.db"), "attempt database bytes");
  (await lockVenueDatabase(roots.venueDir)).release();
  return { root, roots };
}

type Roots = Awaited<ReturnType<typeof box>>["roots"];

/** A backup recovery journal in the state folder, prepared and not stopped, as Start again discards it. */
async function preparedRecovery(roots: Roots) {
  const base = join(roots.stateDir, BACKUP, recoveryId);
  const store = createFirstSetupBackupWorkspace(roots);
  const input: Omit<
    BackupRepairRecord,
    "version" | "sequence" | "previousRecordDigest" | "recordedAt"
  > = {
    target: {
      recoveryId,
      anchor: roots,
      source: roots,
      target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
      generation: 1,
    },
    observation: {
      inspectionId: "a".repeat(64),
      revision: null,
      ownerGeneration: null,
      originalsDigest: await store.inspect(recoveryId),
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
}

async function written(path: string, text = "x") {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
  return path;
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!isAppError(error)) throw new Error(`expected a refusal, got ${String(error)}`);
  return { code: error.code, reason: error.reason };
}

const stamp = (path: string, ms: number) => utimes(path, ms / 1000, ms / 1000);

/** Every file and folder under `path`, and `path` itself, stamped to `ms`. */
async function stampAll(path: string, ms: number): Promise<void> {
  if ((await lstat(path)).isDirectory())
    for (const name of await readdir(path)) await stampAll(join(path, name), ms);
  await stamp(path, ms);
}

it("a side file written later does not move the answer", async () => {
  const { root, roots } = await box();
  await writeFile(join(roots.venueDir, "venue.db-shm"), "shared memory");
  await stampAll(root, T);
  await stamp(join(roots.venueDir, "venue.db-shm"), T + HOUR);
  expect(await attemptLastWriteMs(roots)).toBe(T);
});

const state = (roots: Roots, name: string) => join(roots.stateDir, name);
const venue = (roots: Roots, name: string) => join(roots.venueDir, name);

it.each<[string, (roots: Roots) => Promise<string[]>, { discarding?: string }?]>([
  ["venue.db", async (roots) => [venue(roots, "venue.db")]],
  ["node.db", async (roots) => [await written(venue(roots, "node.db"))]],
  ["venue.db-wal", async (roots) => [await written(venue(roots, "venue.db-wal"))]],
  ["venue.db-shm", async (roots) => [await written(venue(roots, "venue.db-shm"))]],
  ["node.db-wal", async (roots) => [await written(venue(roots, "node.db-wal"))]],
  ["node.db-shm", async (roots) => [await written(venue(roots, "node.db-shm"))]],
  ["the note", async (roots) => [await written(state(roots, "first-setup-start-again.json"))]],
  [
    "the confirmations folder",
    async (roots) => {
      const file = await written(state(roots, "first-setup-start-again-confirmations/a.json"));
      return [file, join(file, "..")];
    },
  ],
  [
    "tls/",
    async (roots) => {
      const file = await written(state(roots, "tls/cert.pem"));
      return [file, join(file, "..")];
    },
  ],
  ["venue.lock", async (roots) => [venue(roots, "venue.lock")]],
  ["the state folder itself", async (roots) => [roots.stateDir]],
  ["the venue folder itself", async (roots) => [roots.venueDir]],
  [
    "a kept backup recovery being discarded, its files and first-setup-resolutions/ itself",
    async (roots) => {
      await preparedRecovery(roots);
      const inside: string[] = [];
      const walk = async (path: string) => {
        inside.push(path);
        if ((await lstat(path)).isDirectory())
          for (const name of await readdir(path)) await walk(join(path, name));
      };
      await walk(state(roots, BACKUP));
      expect(inside.length).toBeGreaterThan(2);
      return [...inside, state(roots, RECORDS)];
    },
    { discarding: recoveryId },
  ],
])("an item outside the attempt's own does not count: %s", async (_name, later, options) => {
  const { root, roots } = await box();
  const paths = await later(roots);
  await stampAll(root, T);
  for (const path of paths) await stamp(path, T + HOUR);
  expect(await attemptLastWriteMs(roots, options)).toBe(T);
});

it.each<[string, (roots: Roots) => Promise<string>]>([
  ["the kept picks file", async (roots) => state(roots, "module-preparation-state.json")],
  [
    "a file in first-fiscal-documents/",
    async (roots) => written(state(roots, "first-fiscal-documents/fiscal-verifactu.json")),
  ],
  [
    "the first-fiscal-documents/ folder",
    async (roots) =>
      join(await written(state(roots, "first-fiscal-documents/fiscal-verifactu.json")), ".."),
  ],
  [
    "first-setup-node-key.json",
    async (roots) => written(state(roots, "first-setup-node-key.json")),
  ],
  [
    "module-operation-public.json",
    async (roots) => written(state(roots, "module-operation-public.json")),
  ],
  [
    "an ownership-recovery record file",
    async (roots) => written(state(roots, `${RECORDS}/${recordsId}/000001.json`)),
  ],
  [
    "an ownership-recovery record's folder",
    async (roots) => join(await written(state(roots, `${RECORDS}/${recordsId}/000001.json`)), ".."),
  ],
  [
    "a step folder",
    async (roots) =>
      join(await written(state(roots, `${RECORDS}/${recordsId}/step-000001/a.json`)), ".."),
  ],
  [
    "first-setup-resolutions/ itself when no backup recovery is kept",
    async (roots) => {
      await written(state(roots, `${RECORDS}/${recordsId}/000001.json`));
      return state(roots, RECORDS);
    },
  ],
  ["first-setup-claim.json", async (roots) => venue(roots, "first-setup-claim.json")],
  ["first-setup.json", async (roots) => state(roots, "first-setup.json")],
])("an item of the attempt's own counts: %s", async (_name, later) => {
  const { root, roots } = await box();
  const path = await later(roots);
  await written(state(roots, "first-setup-node-key.json"));
  await stampAll(root, T);
  await stamp(path, T + HOUR);
  expect(await attemptLastWriteMs(roots)).toBe(T + HOUR);
});

it("a damaged name record's time is one of the attempt's, and the latest listed file decides", async () => {
  const { root, roots } = await box();
  const picks = await written(state(roots, "module-preparation-state.json"), "{damaged");
  const key = await written(state(roots, "first-setup-node-key.json"));
  await stampAll(root, T - 2 * HOUR);
  await stamp(picks, T - HOUR);
  await stamp(key, T + 2 * HOUR);
  expect(await attemptLastWriteMs(roots)).toBe(T + 2 * HOUR);
  await stamp(key, T - HOUR);
  expect(await attemptLastWriteMs(roots)).toBe(T - HOUR);
});

it("a fractional file time rounds up", async () => {
  const { root, roots } = await box();
  await stampAll(root, T);
  await utimes(state(roots, "first-setup.json"), T / 1000, T / 1000 + 1.2345);
  const { mtimeMs } = await lstat(state(roots, "first-setup.json"));
  expect(Number.isInteger(mtimeMs)).toBe(false);
  const answer = await attemptLastWriteMs(roots);
  expect(answer).toBe(Math.ceil(mtimeMs));
  expect(answer).toBeGreaterThan(mtimeMs);
});

it("nothing of the attempt's on disk is no time", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "start-again-last-write-")));
  directories.push(root);
  const roots = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(roots)) await mkdir(path);
  await written(venue(roots, "venue.db-wal"));
  expect(await attemptLastWriteMs(roots)).toBeNull();
});

it("a folder in place of the kept picks file is refused, not skipped", async () => {
  const { roots } = await box();
  const picks = state(roots, "module-preparation-state.json");
  await rm(picks);
  await mkdir(picks);
  expect(await refusal(attemptLastWriteMs(roots))).toEqual({
    code: "setup.start_again_incomplete",
    reason: `layout unexpected: ${picks}`,
  });
});

it("a folder it cannot read is a refusal naming the failed check", async () => {
  const { roots } = await box();
  const documents = join(
    await written(state(roots, "first-fiscal-documents/fiscal-verifactu.json")),
    "..",
  );
  await chmod(documents, 0o000);
  try {
    expect(await refusal(attemptLastWriteMs(roots))).toEqual({
      code: "setup.start_again_incomplete",
      reason: `check failed: EACCES ${documents}`,
    });
  } finally {
    await chmod(documents, 0o700);
  }
});
