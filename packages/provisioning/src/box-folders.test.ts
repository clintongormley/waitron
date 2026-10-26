import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import * as provision from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function anchorFolders() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "box-folders-")));
  directories.push(root);
  const anchor = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  await mkdir(anchor.venueDir);
  await mkdir(anchor.stateDir);
  return { root, anchor };
}
const NAMESPACE = join("first-setup-resolutions", "backup-recovery");

async function repairTarget() {
  const { anchor } = await anchorFolders();
  await writeFile(join(anchor.stateDir, "first-setup.json"), "opaque original");
  const recoveryId = randomUUID();
  const base = join(anchor.stateDir, NAMESPACE, recoveryId);
  const target = {
    recoveryId,
    anchor,
    source: anchor,
    target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
    generation: 1,
  };
  const store = provision.createFirstSetupBackupWorkspace(anchor);
  await store.append({
    target,
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
      eventId: randomUUID(),
      sourceId: "c".repeat(64),
      targetNodeId: randomUUID(),
    },
    input: null,
    retainedEvidenceDigest: "d".repeat(64),
    phase: "prepared",
  });
  return { anchor, target: target.target };
}

it("plain folders are their own", async () => {
  const { root, anchor } = await anchorFolders();
  const link = join(root, "link");
  await symlink(root, link);
  expect(
    await provision.boxFolders({
      venueDir: join(link, "venue"),
      stateDir: join(link, "state", "..", "state"),
    }),
  ).toEqual(anchor);
});

it.each([
  ["a workspace", join("first-setup-workspaces", "w1")],
  ["an A731 target", join("first-setup-resolutions", "backup-recovery", "id1", "target")],
])("folders shaped like %s without its link file are refused", async (_name, path) => {
  const { anchor } = await anchorFolders();
  const base = join(anchor.stateDir, path);
  const shaped = { venueDir: join(base, "venue"), stateDir: join(base, "state") };
  for (const dir of Object.values(shaped)) await mkdir(dir, { recursive: true });
  for (const roots of [shaped, { ...anchor, stateDir: shaped.stateDir }])
    await expect(provision.boxFolders(roots)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
});

it("A731's target gives the anchor", async () => {
  const f = await repairTarget();
  expect(await provision.boxFolders(f.target)).toEqual(f.anchor);
  expect(await provision.boxFolders(f.anchor)).toEqual(f.anchor);
});

it("a target whose discovery file disagrees is refused", async () => {
  const f = await repairTarget();
  const path = join(f.target.venueDir, NAMESPACE, "backlink.json");
  const backlink = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...backlink, initialRecordDigest: "e".repeat(64) }));
  await expect(provision.boxFolders(f.target)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
