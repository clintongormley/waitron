import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import * as provision from "./index.js";
import * as durable from "./durable-host-json.js";

vi.mock("./durable-host-json.js", { spy: true });

const directories: string[] = [];
afterEach(async () => {
  vi.mocked(durable.writeDurableHostJson).mockImplementation(
    (await vi.importActual<typeof durable>("./durable-host-json.js")).writeDurableHostJson,
  );
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

async function startAgain() {
  const { anchor } = await anchorFolders();
  await writeFile(join(anchor.stateDir, "first-setup.json"), "original state");
  await writeFile(join(anchor.venueDir, "first-setup-claim.json"), "original claim");
  const resolutionId = randomUUID(),
    workspaceId = randomUUID();
  const base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
  const next = {
    resolutionId,
    workspaceId,
    anchorStateDir: anchor.stateDir,
    anchorVenueDir: anchor.venueDir,
    stateDir: join(base, "state"),
    venueDir: join(base, "venue"),
    selectionGeneration: 1,
  };
  const options = {
    ...anchor,
    coordinator: provision.createFirstSetupCoordinator(),
    withVenueExclusion: async <T>(run: () => Promise<T>) => {
      const lock = await lockVenueDatabase(anchor.venueDir);
      try {
        return await run();
      } finally {
        lock.release();
      }
    },
  };
  const archive = provision.createFirstSetupResolutionStore(options);
  const prepared = await archive.prepare(
    {
      resolutionId,
      attemptId: randomUUID(),
      observedRevision: 1,
      observedOwnerGeneration: 1,
      database: "missing",
      authority: "original-password",
      register: { kind: "no-current-master", confirmed: true },
      action: "retire",
      nextWorkspace: next,
    },
    [
      { name: "state/first-setup.json", bytes: Buffer.from("original state") },
      { name: "venue/first-setup-claim.json", bytes: Buffer.from("original claim") },
      { name: "venue/venue.db", bytes: null },
    ],
  );
  const applied = await archive.apply(prepared);
  return {
    anchor,
    workspace: { stateDir: next.stateDir, venueDir: next.venueDir },
    select: () => provision.selectFirstSetupWorkspace(options, applied),
  };
}

it("a workspace's folders give the anchor", async () => {
  const f = await startAgain();
  await f.select();
  expect(await provision.boxFolders(f.workspace)).toEqual(f.anchor);
  expect(await provision.boxFolders(f.anchor)).toEqual(f.anchor);
});

it("an anchor whose Start again is half done is its own folders", async () => {
  const f = await startAgain();
  const actual = (await vi.importActual<typeof durable>("./durable-host-json.js"))
    .writeDurableHostJson;
  vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
    if (path.endsWith("first-setup-selection.json")) throw new Error("synthetic interruption");
    await actual(path, ...args);
  });
  await expect(f.select()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  await expect(stat(join(f.anchor.venueDir, "first-setup-retirement.json"))).resolves.toBeTruthy();
  for (const dir of Object.values(f.anchor))
    await expect(stat(join(dir, "first-setup-selection.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  expect(await provision.boxFolders(f.anchor)).toEqual(f.anchor);
});

it("an anchor folder paired with a workspace folder is refused", async () => {
  const f = await startAgain();
  await f.select();
  for (const roots of [
    { venueDir: f.anchor.venueDir, stateDir: f.workspace.stateDir },
    { venueDir: f.workspace.venueDir, stateDir: f.anchor.stateDir },
  ])
    await expect(provision.boxFolders(roots)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
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
