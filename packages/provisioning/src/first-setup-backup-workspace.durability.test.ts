import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import * as durable from "./durable-host-json.js";
import { createFirstSetupBackupWorkspace, resolveFirstSetupBackupWorkspace } from "./index.js";
vi.mock("node:fs/promises", { spy: true });
vi.mock("./durable-host-json.js", { spy: true });
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.open).mockImplementation(actual.open);
  vi.mocked(fs.rename).mockImplementation(actual.rename);
  vi.mocked(durable.writeDurableHostJson).mockImplementation(
    (await vi.importActual<typeof durable>("./durable-host-json.js")).writeDurableHostJson,
  );
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "backup-durability-")));
  directories.push(root);
  const anchor = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  for (const path of Object.values(anchor)) await fs.mkdir(path);
  await fs.writeFile(join(anchor.stateDir, "first-setup.json"), "original malformed state");
  const recoveryId = "cb94ed24-d7dd-43e2-993d-2e126cf5c596";
  const base = join(anchor.stateDir, "first-setup-resolutions", "backup-recovery", recoveryId);
  const target = {
    recoveryId,
    anchor,
    source: anchor,
    target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
    generation: 1,
  };
  const store = () => createFirstSetupBackupWorkspace(anchor);
  const input = {
    target,
    observation: {
      inspectionId: "a".repeat(64),
      revision: null,
      ownerGeneration: null,
      originalsDigest: await store().inspect(recoveryId),
    },
    sourceId: "b".repeat(64),
    activationSourceId: "c".repeat(64),
    binding: {
      module: "synthetic",
      action: "restore",
      eventId: "7497a199-692a-44bc-b180-ef7d993ffdc7",
      sourceId: "c".repeat(64),
      targetNodeId: "2ad5d730-b81f-460b-a55f-e04f8254c5df",
    },
    input: { checked: true },
    retainedEvidenceDigest: "d".repeat(64),
    phase: "prepared" as const,
  };
  return { anchor, target, base, store, input };
}
const boundaries = ["write", "file-sync", "rename", "directory-sync"] as const;
const stages = [
  "state-discovery",
  "venue-discovery",
  "manifest",
  "evidence",
  "prepared",
  "venue-backlink",
  "state-backlink",
  "placement-started",
  "restored",
  "selected",
] as const;
it.each(stages.flatMap((stage) => boundaries.map((boundary) => ({ stage, boundary }))))(
  "resumes $stage after $boundary without replacing the event or originals",
  async ({ stage, boundary }) => {
    const f = await fixture();
    const phases = ["prepared", "placement-started", "restored"] as const;
    const stageIndex = phases.indexOf(stage as (typeof phases)[number]);
    const before = stage === "selected" ? 3 : stageIndex > 0 ? stageIndex : 0;
    for (const phase of phases.slice(0, before)) await f.store().append({ ...f.input, phase });
    const restored = stage === "selected" ? (await f.store().read()).at(-1)! : null;
    const namespace = "first-setup-resolutions/backup-recovery";
    const path =
      stage === "state-discovery"
        ? join(f.anchor.stateDir, namespace, "current.json")
        : stage === "venue-discovery"
          ? join(f.anchor.venueDir, namespace, "current.json")
          : stage === "venue-backlink"
            ? join(f.target.target.venueDir, namespace, "backlink.json")
            : stage === "state-backlink"
              ? join(f.target.target.stateDir, namespace, "backlink.json")
              : join(
                  f.base,
                  stage === "evidence"
                    ? "evidence/0.bin"
                    : stage === "manifest"
                      ? "originals.json"
                      : stage === "prepared"
                        ? "000001.json"
                        : stage === "placement-started"
                          ? "000002.json"
                          : stage === "restored"
                            ? "000003.json"
                            : "000004.json",
                );
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    const actualWrite = (await vi.importActual<typeof durable>("./durable-host-json.js"))
      .writeDurableHostJson;
    let active = false,
      faults = 0;
    const fail = () => {
      faults++;
      throw new Error("injected interrupted durable write");
    };
    vi.mocked(durable.writeDurableHostJson).mockImplementation(async (destination, ...args) => {
      active = destination === path;
      try {
        await actualWrite(destination, ...args);
      } finally {
        active = false;
      }
    });
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (
        active ||
        (stage === "evidence" && String(args[0]).startsWith(join(f.base, "evidence")))
      ) {
        const directory = String(args[0]) === dirname(path);
        if (!directory && boundary === "write")
          vi.spyOn(handle, "writeFile").mockImplementation(fail);
        if (
          (!directory && boundary === "file-sync") ||
          (directory && boundary === "directory-sync")
        )
          vi.spyOn(handle, "sync").mockImplementation(fail);
      }
      return handle;
    });
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if ((active || stage === "evidence") && String(to) === path && boundary === "rename") fail();
      await actual.rename(from, to);
    });
    const run = () =>
      restored === null
        ? f.store().append({ ...f.input, phase: stageIndex > 0 ? phases[stageIndex]! : "prepared" })
        : f.store().select(restored);
    await expect(run()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(faults).toBe(1);
    const oldRecord = await actual.readFile(path).catch(() => null);
    vi.restoreAllMocks();
    vi.mocked(fs.open).mockImplementation(actual.open);
    vi.mocked(fs.rename).mockImplementation(actual.rename);
    vi.mocked(durable.writeDurableHostJson).mockImplementation(actualWrite);
    await run();
    if (oldRecord !== null) expect(await fs.readFile(path)).toEqual(oldRecord);
    const records = await f.store().read();
    expect(records[0]).toMatchObject({
      target: f.target,
      binding: f.input.binding,
      observation: f.input.observation,
    });
    expect(await fs.readFile(join(f.anchor.stateDir, "first-setup.json"), "utf8")).toBe(
      "original malformed state",
    );
    expect(await resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({
      kind: stage === "selected" ? "selected" : "repair",
      target: f.target,
    });
  },
);

it("streams a database larger than the old snapshot budget and keeps its last byte bound", async () => {
  const f = await fixture(),
    path = join(f.anchor.venueDir, "venue.db");
  const file = await fs.open(path, "w");
  try {
    await file.truncate(128 * 1024 * 1024 + 1);
    await file.write(Buffer.from([17]), 0, 1, 128 * 1024 * 1024);
  } finally {
    await file.close();
  }
  f.input.observation.originalsDigest = await f.store().inspect(f.target.recoveryId);
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (String(args[0]) === path)
      vi.spyOn(handle, "readFile").mockImplementation(() => {
        throw new Error("database must be streamed");
      });
    return handle;
  });
  await expect(f.store().append(f.input)).resolves.toMatchObject({ phase: "prepared" });
  const change = await actual.open(path, "r+");
  try {
    await change.write(Buffer.from([18]), 0, 1, 128 * 1024 * 1024);
  } finally {
    await change.close();
  }
  await expect(f.store().append({ ...f.input, phase: "placement-started" })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
});
it("serializes competing selections across independent store handles", async () => {
  const f = await fixture();
  const second = {
    ...f.input,
    binding: { ...f.input.binding, eventId: "4cc6a357-e31c-4c2e-9b40-023c9963bec8" },
  };
  const results = await Promise.allSettled([f.store().append(f.input), f.store().append(second)]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(results[1]).toMatchObject({ reason: { code: "setup.attempt_conflict" } });
  expect((await f.store().read()).map((record) => record.binding.eventId)).toEqual([
    "7497a199-692a-44bc-b180-ef7d993ffdc7",
  ]);
});

it.each(["replace-during-open", "change-during-read", "file-disappears", "snapshot-diff"])(
  "rejects %s while deriving original evidence",
  async (fault) => {
    const f = await fixture(),
      path = join(f.anchor.stateDir, "first-setup.json");
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    let touched = false;
    if (fault === "snapshot-diff") {
      let scans = 0;
      vi.spyOn(fs, "readdir").mockImplementation(async (...args) => {
        if (String(args[0]) === f.anchor.stateDir && ++scans === 2)
          await actual.writeFile(join(f.anchor.stateDir, "new.json"), "different source");
        return actual.readdir(...args);
      });
    } else
      vi.mocked(fs.open).mockImplementation(async (...args) => {
        if (String(args[0]) === path && !touched) {
          touched = true;
          if (fault === "replace-during-open") {
            await actual.rename(path, path + ".retained");
            await actual.writeFile(path, "new inode");
          }
          if (fault === "file-disappears") await actual.unlink(path);
          const handle = await actual.open(...args);
          if (fault === "change-during-read") {
            const originalRead = handle.read.bind(handle);
            vi.spyOn(handle, "read").mockImplementation(async (...readArgs) => {
              await actual.writeFile(path, "changed original while reading");
              return originalRead(...readArgs);
            });
          }
          return handle;
        }
        return actual.open(...args);
      });
    if (fault === "file-disappears")
      await expect(f.store().inspect(f.target.recoveryId)).rejects.toMatchObject({
        code: "ENOENT",
      });
    else
      await expect(f.store().inspect(f.target.recoveryId)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
  },
);
it("refuses a different event when resuming a durable intent whose first journal write was interrupted", async () => {
  const f = await fixture(),
    actualWrite = (await vi.importActual<typeof durable>("./durable-host-json.js"))
      .writeDurableHostJson;
  vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
    if (path === join(f.base, "000001.json")) throw new Error("interrupted journal");
    await actualWrite(path, ...args);
  });
  await expect(f.store().append(f.input)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  vi.mocked(durable.writeDurableHostJson).mockImplementation(actualWrite);
  await expect(
    f.store().append({
      ...f.input,
      binding: { ...f.input.binding, eventId: "4cc6a357-e31c-4c2e-9b40-023c9963bec8" },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(f.store().append(f.input)).resolves.toMatchObject({ binding: f.input.binding });
});

it.each(["changed-copy", "directory-source"])(
  "refuses %s after discovery and before evidence is committed",
  async (fault) => {
    const f = await fixture(),
      actual = await vi.importActual<typeof fs>("node:fs/promises");
    const actualWrite = (await vi.importActual<typeof durable>("./durable-host-json.js"))
      .writeDurableHostJson;
    let changed = false;
    vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
      await actualWrite(path, ...args);
      if (path.endsWith("current.json") && !changed) {
        changed = true;
        const original = join(f.anchor.stateDir, "first-setup.json");
        if (fault === "changed-copy")
          await actual.writeFile(original, "changed source during capture");
        else {
          await actual.rename(original, original + ".retained");
          await actual.mkdir(original);
        }
      }
    });
    await expect(f.store().append(f.input)).rejects.toMatchObject({
      code: fault === "changed-copy" ? "setup.attempt_conflict" : "setup.attempt_invalid",
    });
    expect(changed).toBe(true);
  },
);
it.each(["corrupt-evidence", "directory-evidence"])(
  "preserves %s and refuses a fresh append over it",
  async (fault) => {
    const f = await fixture(),
      actualWrite = (await vi.importActual<typeof durable>("./durable-host-json.js"))
        .writeDurableHostJson;
    vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
      if (path.endsWith("originals.json"))
        throw new Error("manifest interrupted after evidence sync");
      await actualWrite(path, ...args);
    });
    await expect(f.store().append(f.input)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
    vi.mocked(durable.writeDurableHostJson).mockImplementation(actualWrite);
    const evidence = join(f.base, "evidence", "0.bin");
    await fs.unlink(evidence);
    if (fault === "corrupt-evidence") await fs.writeFile(evidence, "corrupt retained evidence");
    else await fs.mkdir(evidence);
    await expect(f.store().append(f.input)).rejects.toMatchObject({
      code: fault === "corrupt-evidence" ? "setup.attempt_conflict" : "setup.attempt_invalid",
    });
    if (fault === "corrupt-evidence")
      expect(await fs.readFile(evidence, "utf8")).toBe("corrupt retained evidence");
  },
);
it("does not overwrite a mismatched existing target backlink", async () => {
  const f = await fixture();
  await f.store().append(f.input);
  const path = join(
    f.target.target.venueDir,
    "first-setup-resolutions",
    "backup-recovery",
    "backlink.json",
  );
  await fs.writeFile(path, '{"unrecognised":"retain"}');
  await expect(f.store().append(f.input)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await fs.readFile(path, "utf8")).toBe('{"unrecognised":"retain"}');
});

it.each(["target-venue", "target-state", "discovery-parent"])(
  "resumes an interrupted %s directory sync",
  async (location) => {
    const f = await fixture(),
      actual = await vi.importActual<typeof fs>("node:fs/promises");
    const path =
      location === "target-venue"
        ? f.target.target.venueDir
        : location === "target-state"
          ? f.target.target.stateDir
          : join(f.anchor.stateDir, "first-setup-resolutions");
    let faults = 0;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (String(args[0]) === path)
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          faults++;
          throw new Error("directory refuses sync");
        });
      return handle;
    });
    await expect(f.store().append(f.input)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
    expect(faults).toBeGreaterThan(0);
    vi.restoreAllMocks();
    vi.mocked(fs.open).mockImplementation(actual.open);
    await expect(f.store().append(f.input)).resolves.toMatchObject({
      phase: "prepared",
      sequence: 1,
    });
  },
);
it("does not acknowledge an exact selection retry while the renamed record's folder still refuses sync", async () => {
  const f = await fixture();
  for (const phase of ["prepared", "placement-started", "restored"] as const)
    await f.store().append({ ...f.input, phase });
  const restored = (await f.store().read()).at(-1)!;
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  let renamed = false,
    faults = 0;
  vi.mocked(fs.rename).mockImplementation(async (from, to) => {
    await actual.rename(from, to);
    if (String(to) === join(f.base, "000004.json")) renamed = true;
  });
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (renamed && String(args[0]) === f.base)
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        faults++;
        throw new Error("selection directory sync refused");
      });
    return handle;
  });
  await expect(f.store().select(restored)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const retained = await fs.readFile(join(f.base, "000004.json"));
  await expect(f.store().select(restored)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(faults).toBe(2);
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockImplementation(actual.open);
  vi.mocked(fs.rename).mockImplementation(actual.rename);
  await expect(f.store().select(restored)).resolves.toEqual(f.target);
  expect(await fs.readFile(join(f.base, "000004.json"))).toEqual(retained);
});
