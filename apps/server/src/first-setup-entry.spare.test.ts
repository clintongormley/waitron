import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import * as provisioning from "@waitron/provisioning";
import {
  SPARE_SPACE_FILE,
  createFirstSetupBackupWorkspace,
  emptyAbandonedBackupRecovery,
  isEmptiedTombstone,
} from "@waitron/provisioning";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as backupEntry from "./first-setup-backup-entry.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import type { Statfs } from "./free-bytes.js";
import * as resolutionApi from "./setup-first-fiscal-api.js";

vi.mock("@waitron/provisioning", { spy: true });
vi.mock("./first-setup-backup-entry.js", { spy: true });
vi.mock("./setup-first-fiscal-api.js", { spy: true });

const ID = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
const MiB = 1024 * 1024;

let root: string;
let stateDir: string;
let anchor: { stateDir: string; venueDir: string };

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "wt-entry-spare-")));
  stateDir = join(root, "state");
  anchor = { stateDir, venueDir: join(stateDir, "venue") };
  await mkdir(anchor.venueDir, { recursive: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const freeIs =
  (bytes: number): Statfs =>
  () =>
    Promise.resolve({ bavail: bytes, frsize: 1 });

/** A backup recovery whose placement began and then stopped: Start again would discard it. */
async function stoppedRecovery() {
  const base = join(stateDir, "first-setup-resolutions", "backup-recovery", ID);
  const target = {
    recoveryId: ID,
    anchor,
    source: anchor,
    target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
    generation: 1,
  };
  const workspace = createFirstSetupBackupWorkspace(anchor);
  const input = {
    target,
    observation: {
      inspectionId: "a".repeat(64),
      revision: null,
      ownerGeneration: null,
      originalsDigest: await workspace.inspect(ID),
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
    phase: "prepared" as const,
  };
  await workspace.append(input);
  await workspace.append({ ...input, input: { accepted: true }, phase: "placement-started" });
  (await lockVenueDatabase(target.target.venueDir)).release();
  writeFileSync(join(target.target.venueDir, "venue.db"), Buffer.alloc(4096, 68));
  return workspace;
}

async function discardedRecovery() {
  await (await stoppedRecovery()).abandon(ID);
}

/** Records, at each emptying, whether the spare was still there. */
async function spareAtEmptying(): Promise<boolean[]> {
  const seen: boolean[] = [];
  const { emptyAbandonedBackupRecovery: real } =
    await vi.importActual<typeof provisioning>("@waitron/provisioning");
  vi.mocked(provisioning.emptyAbandonedBackupRecovery).mockImplementation(async (...args) => {
    seen.push(existsSync(join(stateDir, SPARE_SPACE_FILE)));
    return real(...args);
  });
  return seen;
}

const plantSpare = () => writeFileSync(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));

it("a discarded recovery on a nearly full disk: the spare is gone before the emptying begins", async () => {
  await discardedRecovery();
  plantSpare();
  const seen = await spareAtEmptying();
  const log = vi.fn();
  await resolveFirstSetupEntry(anchor, {}, undefined, log, {
    ...spareOption(),
    statfs: freeIs(MiB),
  });
  expect(seen).toEqual([false]);
  expect(log).toHaveBeenCalledWith("warn", "storage.spare_released", { bytes: 4096 });
  expect(await isEmptiedTombstone(anchor, ID)).toBe(true);
});

it("a discarded recovery with 16 MiB or more free: the spare is kept", async () => {
  await discardedRecovery();
  plantSpare();
  const seen = await spareAtEmptying();
  await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), {
    ...spareOption(),
    statfs: freeIs(16 * MiB),
  });
  expect(seen).toEqual([true]);
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
  expect(await isEmptiedTombstone(anchor, ID)).toBe(true);
});

it("an emptied tombstone on a nearly full disk keeps the spare", async () => {
  await discardedRecovery();
  await emptyAbandonedBackupRecovery(anchor, ID);
  plantSpare();
  await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), {
    ...spareOption(),
    statfs: freeIs(MiB),
  });
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
});

it("no recovery on a nearly full disk keeps the spare", async () => {
  plantSpare();
  await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), {
    ...spareOption(),
    statfs: freeIs(MiB),
  });
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
});

it("with no spare option given, nothing is released", async () => {
  await discardedRecovery();
  plantSpare();
  const seen = await spareAtEmptying();
  await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn());
  expect(seen).toEqual([true]);
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
});

const INSPECTION = "/setup-api/first-setup/resolution";

const spareOption = (logDir = join(stateDir, "logs")) => ({
  stateDir,
  venueDir: anchor.venueDir,
  logDir,
});

/** The repair app's answer to "does the next start delete old logs", as its routes ask it. */
async function restartDeletesLogsIn(logDir?: string) {
  const entry = await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), spareOption(logDir));
  if (entry.kind !== "resolution") throw new Error(`expected the repair app, got ${entry.kind}`);
  const options = vi.mocked(resolutionApi.mountFirstSetupResolutionApi).mock.lastCall?.[3];
  const ask = () => options!.restartDeletesLogs!();
  return { ask, dispose: entry.dispose };
}

it("the repair app says a restart deletes logs when the log folder is outside the state and venue folders", async () => {
  await stoppedRecovery();
  const repair = await restartDeletesLogsIn(join(root, "logs"));
  expect(await repair.ask()).toBe(true);
  await repair.dispose();
});

it("…says it does not at a repair stage whose log folder is inside the state folder", async () => {
  await stoppedRecovery();
  const repair = await restartDeletesLogsIn();
  expect(await repair.ask()).toBe(false);
  await repair.dispose();
});

it("…says it does on a box with no backup recovery, whatever the log folder", async () => {
  writeFileSync(join(stateDir, "first-setup.json"), "opaque retained attempt");
  const repair = await restartDeletesLogsIn();
  expect(await repair.ask()).toBe(true);
  await repair.dispose();
});

it("…cannot say when the recovery's stage cannot be read", async () => {
  await stoppedRecovery();
  const repair = await restartDeletesLogsIn();
  vi.mocked(backupEntry.resolveFirstSetupBackupEntry).mockRejectedValueOnce(new Error("EIO"));
  expect(await repair.ask()).toBeUndefined();
  await repair.dispose();
});

it("the repair app releases the spare on its inspection read when a stopped recovery fills the disk", async () => {
  await stoppedRecovery();
  plantSpare();
  const log = vi.fn();
  const entry = await resolveFirstSetupEntry(anchor, {}, undefined, log, {
    ...spareOption(),
    statfs: freeIs(MiB),
  });
  if (entry.kind !== "resolution") throw new Error(`expected the repair app, got ${entry.kind}`);
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
  await entry.app.request(INSPECTION);
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(false);
  expect(log).toHaveBeenCalledWith("warn", "storage.spare_released", { bytes: 4096 });
  await entry.dispose();
});

it("…and so does the repair app of a box that started with no recovery folder", async () => {
  writeFileSync(join(stateDir, "first-setup.json"), "opaque retained attempt");
  plantSpare();
  const entry = await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), {
    ...spareOption(),
    statfs: freeIs(MiB),
  });
  if (entry.kind !== "resolution") throw new Error(`expected the repair app, got ${entry.kind}`);
  await stoppedRecovery();
  await entry.app.request(INSPECTION);
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(false);
  await entry.dispose();
});

it("the repair app with room keeps the spare", async () => {
  await stoppedRecovery();
  plantSpare();
  const entry = await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), {
    ...spareOption(),
    statfs: freeIs(16 * MiB),
  });
  if (entry.kind !== "resolution") throw new Error(`expected the repair app, got ${entry.kind}`);
  await entry.app.request(INSPECTION);
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
  await entry.dispose();
});

it("the release runs before the fence", async () => {
  await stoppedRecovery();
  plantSpare();
  const atFence: boolean[] = [];
  const { firstSetupBackupRecoveryFor: real } = await vi.importActual<typeof backupEntry>(
    "./first-setup-backup-entry.js",
  );
  vi.mocked(backupEntry.firstSetupBackupRecoveryFor).mockImplementation((...args) => {
    const service = real(...args);
    const holds = service.holdsInMemory.bind(service);
    // The fence's first step on every write; it seals a lapsed session only after it.
    service.holdsInMemory = () => {
      atFence.push(existsSync(join(stateDir, SPARE_SPACE_FILE)));
      return holds();
    };
    return service;
  });
  const entry = await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), {
    ...spareOption(),
    statfs: freeIs(MiB),
  });
  if (entry.kind !== "resolution") throw new Error(`expected the repair app, got ${entry.kind}`);
  atFence.length = 0;
  await entry.app.request(`${INSPECTION}/start-again`, { method: "POST" });
  expect(atFence.length).toBeGreaterThan(0);
  expect(atFence).toEqual(atFence.map(() => false));
  await entry.dispose();
});
