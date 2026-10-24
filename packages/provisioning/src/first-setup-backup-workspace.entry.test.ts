import { mkdtemp, mkdir, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  createFirstSetupBackupWorkspace,
  resolveFirstSetupBackupWorkspace,
} from "./first-setup-backup-workspace.js";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(selected = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "backup-entry-reader-")));
  directories.push(root);
  const anchor = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(anchor)) await mkdir(path);
  const recoveryId = randomUUID(),
    base = join(anchor.stateDir, "first-setup-resolutions", "backup-recovery", recoveryId);
  const target = {
    anchor,
    source: anchor,
    target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
    recoveryId,
    generation: 1,
  };
  const store = createFirstSetupBackupWorkspace(anchor);
  const input = {
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
      action: "restore" as const,
      eventId: randomUUID(),
      sourceId: "c".repeat(64),
      targetNodeId: randomUUID(),
    },
    input: null,
    retainedEvidenceDigest: "d".repeat(64),
    phase: "prepared" as const,
  };
  await store.append(input);
  if (selected) {
    await store.append({ ...input, input: { checked: true } });
    await store.append({ ...input, input: { checked: true }, phase: "placement-started" });
    await store.select(
      await store.append({ ...input, input: { checked: true }, phase: "restored" }),
    );
  }
  const paths = Object.values(target.target).map((path) =>
    join(path, "first-setup-resolutions", "backup-recovery", "backlink.json"),
  );
  return { root, anchor, target, paths };
}
it.each([false, true])(
  "finds the original journal from the paired target (selected: %s)",
  async (selected) => {
    const f = await fixture(selected);
    expect(await resolveFirstSetupBackupWorkspace(f.target.target)).toEqual({
      kind: selected ? "selected" : "repair",
      target: f.target,
    });
  },
);
it.each([
  "version",
  "extra",
  "target",
  "generation",
  "anchor",
  "initial-digest",
  "unpaired",
  "missing",
])("refuses a target with %s backlink corruption", async (fault) => {
  const f = await fixture();
  const original = JSON.parse(await readFile(f.paths[0]!, "utf8"));
  const changed = structuredClone(original);
  if (fault === "version") changed.version = 1;
  if (fault === "extra") changed.extra = true;
  if (fault === "target") changed.target.target.venueDir = join(f.root, "other");
  if (fault === "generation") changed.target.generation = 2;
  if (fault === "anchor") changed.target.anchor.venueDir = join(f.root, "other");
  if (fault === "initial-digest") changed.initialRecordDigest = "f".repeat(64);
  if (fault === "unpaired") changed.initialRecordDigest = "e".repeat(64);
  if (fault === "missing") await unlink(f.paths[0]!);
  else
    for (const path of fault === "unpaired" ? [f.paths[0]!] : f.paths)
      await writeFile(path, JSON.stringify(changed));
  await expect(resolveFirstSetupBackupWorkspace(f.target.target)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
it("does not accept a target backlink whose anchor discovery was replaced", async () => {
  const f = await fixture();
  for (const root of Object.values(f.anchor))
    await writeFile(join(root, "first-setup-resolutions", "backup-recovery", "current.json"), "{}");
  await expect(resolveFirstSetupBackupWorkspace(f.target.target)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
