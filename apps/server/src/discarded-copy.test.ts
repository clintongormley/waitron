import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import {
  createFirstSetupBackupWorkspace,
  emptyAbandonedBackupRecovery,
} from "@waitron/provisioning";
import { afterEach, beforeEach, expect, it } from "vitest";
import { discardedCopyBytes } from "./discarded-copy.js";

const ID = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
const MiB = 1024 * 1024;

let root: string;
let stateDir: string;
let anchor: { stateDir: string; venueDir: string };
let base: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "wt-discarded-copy-")));
  stateDir = join(root, "state");
  anchor = { stateDir, venueDir: join(stateDir, "venue") };
  base = join(stateDir, "first-setup-resolutions", "backup-recovery", ID);
  await mkdir(anchor.venueDir, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A backup recovery whose placement began and then stopped. */
async function stoppedRecovery() {
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

it("answers null when there is no backup recovery", async () => {
  expect(await discardedCopyBytes(anchor)).toBeNull();
});

it("answers null for a stopped recovery that was not discarded", async () => {
  await stoppedRecovery();
  expect(await discardedCopyBytes(anchor)).toBeNull();
});

it("answers the bytes a discarded recovery's copy still holds", async () => {
  await (await stoppedRecovery()).abandon(ID);
  const before = await discardedCopyBytes(anchor);
  expect(before).toBeGreaterThanOrEqual(4096);
  writeFileSync(join(base, "target", "venue", "venue.db-wal"), Buffer.alloc(MiB, 1));
  expect(await discardedCopyBytes(anchor)).toBe(before! + MiB);
});

it("refuses a copy holding a link, which the start's emptying refuses too", async () => {
  await (await stoppedRecovery()).abandon(ID);
  const outside = join(root, "outside");
  await mkdir(outside);
  writeFileSync(join(outside, "big"), Buffer.alloc(MiB, 1));
  await symlink(join(outside, "big"), join(base, "target", "venue", "linked-file"));
  await expect(discardedCopyBytes(anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(emptyAbandonedBackupRecovery(anchor, ID)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it("answers null once the discarded copy has been emptied", async () => {
  await (await stoppedRecovery()).abandon(ID);
  await emptyAbandonedBackupRecovery(anchor, ID);
  expect(await discardedCopyBytes(anchor)).toBeNull();
});
