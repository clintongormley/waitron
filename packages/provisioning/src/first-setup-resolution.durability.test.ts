import * as filesystem from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createFirstSetupCoordinator, createFirstSetupResolutionStore } from "./index.js";
import * as durable from "./durable-host-json.js";

vi.mock("node:fs/promises", { spy: true });
vi.mock("./durable-host-json.js", { spy: true });
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.mocked(filesystem.open).mockImplementation(actual.open);
  vi.mocked(filesystem.rename).mockImplementation(actual.rename);
  vi.mocked(durable.writeDurableHostJson).mockImplementation(
    (await vi.importActual<typeof durable>("./durable-host-json.js")).writeDurableHostJson,
  );
  await Promise.all(
    directories.splice(0).map((directory) => filesystem.rm(directory, { recursive: true })),
  );
});
async function fixture() {
  const root = await filesystem.realpath(
    await filesystem.mkdtemp(join(tmpdir(), "setup-resolution-durability-")),
  );
  directories.push(root);
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const store = () =>
    createFirstSetupResolutionStore({ ...roots, coordinator: createFirstSetupCoordinator() });
  const input = {
    resolutionId: randomUUID(),
    attemptId: randomUUID(),
    observedRevision: 4,
    observedOwnerGeneration: 2,
    database: "missing" as const,
    authority: "original-password" as const,
    register: {
      kind: "current-master" as const,
      status: "Unknown" as const,
      custodian: "Elena",
      reference: "b".repeat(64),
      consultedAt: "2026-10-16T02:00:00.000Z",
    },
    action: "retire" as const,
    nextWorkspace: null,
  };
  const originals = [
    { name: "state/first-setup.json", bytes: Buffer.from("retained malformed state") },
    { name: "venue/venue.db", bytes: null },
  ];
  const folder = join(roots.stateDir, "first-setup-resolutions", input.resolutionId);
  return { root, roots, store, input, originals, folder };
}

it("does not acknowledge a renamed applied record while its directory still refuses sync", async () => {
  const f = await fixture();
  const prepared = await f.store().prepare(f.input, f.originals);
  const path = join(f.folder, "000002.json");
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  let renamed = false;
  let refused = 0;
  vi.mocked(filesystem.rename).mockImplementation(async (from, to) => {
    await actual.rename(from, to);
    if (String(to) === path) renamed = true;
  });
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (renamed && String(args[0]) === f.folder) {
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        refused++;
        throw new Error("applied directory sync refused");
      });
    }
    return handle;
  });
  await expect(f.store().apply(prepared)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(refused).toBe(1);
  const retained = await filesystem.readFile(path);
  await expect(f.store().apply(prepared)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(refused).toBe(2);
  vi.restoreAllMocks();
  vi.mocked(filesystem.open).mockImplementation(actual.open);
  vi.mocked(filesystem.rename).mockImplementation(actual.rename);
  await expect(f.store().apply(prepared)).resolves.toMatchObject({ sequence: 2, phase: "applied" });
  expect(await filesystem.readFile(path)).toEqual(retained);
  expect((await f.store().read(f.input.resolutionId)).map((record) => record.phase)).toEqual([
    "prepared",
    "applied",
  ]);
  expect(await f.store().readOriginals(f.input.resolutionId)).toEqual(f.originals);
});

const boundaries = ["write", "file-sync", "rename", "directory-sync"] as const;
const stages = ["original", "manifest", "prepared", "applied"] as const;
it.each(
  [false, true].flatMap((later) =>
    stages.flatMap((stage) => boundaries.map((boundary) => ({ later, stage, boundary }))),
  ),
)(
  "resumes $stage at $boundary (later action: $later) without changing retained actions",
  async ({ later, stage, boundary }) => {
    const f = await fixture();
    const first = later
      ? await f.store().apply(await f.store().prepare(f.input, f.originals))
      : null;
    const retainedFirst = later
      ? await Promise.all(
          ["000001.json", "000002.json"].map((name) => filesystem.readFile(join(f.folder, name))),
        )
      : [];
    const input = later ? { ...f.input, action: "select-workspace" as const } : f.input;
    const sequence = later ? 3 : 1;
    const evidence = later ? join(f.folder, "step-000003") : f.folder;
    const path =
      stage === "original"
        ? join(evidence, "original-0-0.json")
        : stage === "manifest"
          ? join(evidence, "manifest.json")
          : join(f.folder, `00000${stage === "prepared" ? sequence : sequence + 1}.json`);
    const prepared = stage === "applied" ? await f.store().prepare(input, f.originals) : null;
    const actualFs = await vi.importActual<typeof filesystem>("node:fs/promises");
    const actualWrite = (await vi.importActual<typeof durable>("./durable-host-json.js"))
      .writeDurableHostJson;
    let active = false;
    let faults = 0;
    const fail = () => {
      faults++;
      throw new Error("interrupted resolution write");
    };
    vi.mocked(durable.writeDurableHostJson).mockImplementation(async (target, ...args) => {
      active = target === path;
      try {
        await actualWrite(target, ...args);
      } finally {
        active = false;
      }
    });
    vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (active) {
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
    vi.mocked(filesystem.rename).mockImplementation(async (from, to) => {
      if (active && boundary === "rename") fail();
      await actualFs.rename(from, to);
    });
    await expect(
      prepared === null ? f.store().prepare(input, f.originals) : f.store().apply(prepared),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(faults).toBe(1);
    vi.restoreAllMocks();
    vi.mocked(durable.writeDurableHostJson).mockImplementation(actualWrite);
    const resumed = await f.store().prepare(input, f.originals);
    const applied = await f.store().apply(resumed);
    expect(
      (await f.store().read(f.input.resolutionId)).map(({ sequence, action, phase }) => ({
        sequence,
        action,
        phase,
      })),
    ).toEqual(
      later
        ? [
            { sequence: 1, action: "retire", phase: "prepared" },
            { sequence: 2, action: "retire", phase: "applied" },
            { sequence: 3, action: "select-workspace", phase: "prepared" },
            { sequence: 4, action: "select-workspace", phase: "applied" },
          ]
        : [
            { sequence: 1, action: "retire", phase: "prepared" },
            { sequence: 2, action: "retire", phase: "applied" },
          ],
    );
    expect(applied.sequence).toBe(later ? 4 : 2);
    expect(await f.store().readOriginals(f.input.resolutionId, sequence)).toEqual(f.originals);
    if (first !== null) {
      expect((await f.store().read(f.input.resolutionId))[1]).toEqual(first);
      expect(
        await Promise.all(
          ["000001.json", "000002.json"].map((name) => filesystem.readFile(join(f.folder, name))),
        ),
      ).toEqual(retainedFirst);
    }
  },
);
