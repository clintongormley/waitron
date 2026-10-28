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
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import type { Statfs } from "./free-bytes.js";

vi.mock("@waitron/provisioning", { spy: true });

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

async function discardedRecovery() {
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
  await workspace.abandon(ID);
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
  await resolveFirstSetupEntry(anchor, {}, undefined, log, { stateDir, statfs: freeIs(MiB) });
  expect(seen).toEqual([false]);
  expect(log).toHaveBeenCalledWith("warn", "storage.spare_released", { bytes: 4096 });
  expect(await isEmptiedTombstone(anchor, ID)).toBe(true);
});

it("a discarded recovery with 16 MiB or more free: the spare is kept", async () => {
  await discardedRecovery();
  plantSpare();
  const seen = await spareAtEmptying();
  await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), {
    stateDir,
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
  await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), { stateDir, statfs: freeIs(MiB) });
  expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
});

it("no recovery on a nearly full disk keeps the spare", async () => {
  plantSpare();
  await resolveFirstSetupEntry(anchor, {}, undefined, vi.fn(), { stateDir, statfs: freeIs(MiB) });
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
