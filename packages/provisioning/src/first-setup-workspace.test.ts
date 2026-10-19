import {
  mkdtemp,
  rm,
  mkdir,
  realpath,
  readFile,
  writeFile,
  unlink,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as provision from "./index.js";
import * as durable from "./durable-host-json.js";
import * as filesystem from "node:fs/promises";
import { assertFirstSetupVenueTarget } from "./first-setup-workspace.js";
vi.mock("node:fs/promises", { spy: true });
vi.mock("./durable-host-json.js", { spy: true });
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(durable.writeDurableHostJson).mockImplementation(
    (await vi.importActual<typeof durable>("./durable-host-json.js")).writeDurableHostJson,
  );
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(
  sharedRoots = false,
  insideOutside = false,
  outsideName = "outside-history.json",
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "setup-workspace-")));
  dirs.push(root);
  const anchor = {
    venueDir: join(root, "venue"),
    stateDir: join(root, sharedRoots ? "venue" : "state"),
  };
  await mkdir(anchor.venueDir);
  if (!sharedRoots) await mkdir(anchor.stateDir);
  await writeFile(join(anchor.stateDir, "first-setup.json"), "unchanged original state");
  await writeFile(join(anchor.venueDir, "first-setup-claim.json"), "unchanged original marker");
  const outsidePath = join(insideOutside ? anchor.stateDir : root, outsideName);
  await writeFile(outsidePath, "independently configured public history");
  const receiptDir = join(root, "receipts");
  await mkdir(receiptDir);
  await writeFile(join(receiptDir, "one.json"), "first outside receipt");
  const resolutionId = randomUUID(),
    workspaceId = randomUUID();
  const base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding: provision.WorkspaceBinding = {
    workspaceId,
    resolutionId,
    anchorVenueDir: anchor.venueDir,
    anchorStateDir: anchor.stateDir,
    venueDir: join(base, "venue"),
    stateDir: join(base, "state"),
    selectionGeneration: 1,
  };
  const store = provision.createFirstSetupResolutionStore({
    ...anchor,
    coordinator: provision.createFirstSetupCoordinator(),
  });
  const prepared = await store.prepare(
    {
      resolutionId,
      attemptId: randomUUID(),
      observedRevision: 4,
      observedOwnerGeneration: 2,
      database: "missing",
      authority: "original-password",
      register: {
        kind: "current-master",
        status: "Unknown",
        custodian: "Elena",
        reference: "c".repeat(64),
        consultedAt: "2026-10-16T02:00:00.000Z",
      },
      action: "retire",
      nextWorkspace: binding,
    },
    [
      { name: "state/first-setup.json", bytes: Buffer.from("unchanged original state") },
      { name: "venue/first-setup-claim.json", bytes: Buffer.from("unchanged original marker") },
      { name: "venue/venue.db", bytes: null },
      { name: "directory:state/first-fiscal-documents", bytes: null },
      {
        name: `outside-file:${outsidePath}`,
        bytes: Buffer.from("independently configured public history"),
      },
      { name: `directory:outside:${receiptDir}`, bytes: Buffer.from('["one.json"]') },
      {
        name: `outside-file:${join(receiptDir, "one.json")}`,
        bytes: Buffer.from("first outside receipt"),
      },
    ],
  );
  const applied = await store.apply(prepared);
  return { root, anchor, binding, store, prepared, applied, outsidePath };
}
it("selects an empty isolated workspace while preserving the old missing database and original bytes", async () => {
  const f = await fixture();
  expect(await provision.selectFirstSetupWorkspace(f.anchor, f.applied)).toEqual(f.binding);
  expect(await provision.resolveFirstSetupWorkspace(f.anchor)).toEqual({
    venueDir: f.binding.venueDir,
    stateDir: f.binding.stateDir,
    binding: f.binding,
  });
  await provision.assertFirstSetupBootTarget({
    venueDir: f.binding.venueDir,
    stateDir: f.binding.stateDir,
  });
  await expect(provision.assertFirstSetupBootTarget(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(await readFile(join(f.anchor.stateDir, "first-setup.json"), "utf8")).toBe(
    "unchanged original state",
  );
  expect(await readFile(join(f.anchor.venueDir, "first-setup-claim.json"), "utf8")).toBe(
    "unchanged original marker",
  );
  for (const path of [
    join(f.anchor.venueDir, "venue.db"),
    join(f.binding.venueDir, "venue.db"),
    join(f.binding.stateDir, "first-setup.json"),
  ])
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await provision.selectFirstSetupWorkspace(f.anchor, f.applied)).toEqual(f.binding);
});
it("ordinary roots with no resolution retain their normal target without creating files", async () => {
  const f = await fixture();
  expect(await provision.resolveFirstSetupWorkspace(f.anchor)).toEqual({
    ...f.anchor,
    binding: null,
  });
  await provision.assertFirstSetupBootTarget(f.anchor);
});
it("records selection separately from retirement and replays without adding another action", async () => {
  const f = await fixture();
  await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).resolves.toEqual(
    f.binding,
  );
  const records = await f.store.read(f.binding.resolutionId);
  expect(records.map(({ sequence, action, phase }) => ({ sequence, action, phase }))).toEqual([
    { sequence: 1, action: "retire", phase: "prepared" },
    { sequence: 2, action: "retire", phase: "applied" },
    { sequence: 3, action: "select-workspace", phase: "prepared" },
    { sequence: 4, action: "select-workspace", phase: "applied" },
  ]);
  expect(records[2]?.nextWorkspace).toEqual(f.binding);
  expect(await f.store.readOriginals(f.binding.resolutionId, 3)).toEqual(
    await f.store.readOriginals(f.binding.resolutionId),
  );
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  expect(await f.store.read(f.binding.resolutionId)).toEqual(records);
  expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
});

it.each(["first-setup-workspace.json", "first-setup-selection.json", "000004.json"])(
  "rediscovers the exact pending selection after interruption at %s without selecting it",
  async (point) => {
    const f = await fixture();
    const actual = (await vi.importActual<typeof durable>("./durable-host-json.js"))
      .writeDurableHostJson;
    let failed = false;
    vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
      if (path.endsWith(point) && !failed) {
        failed = true;
        throw new Error("pending selection interruption");
      }
      await actual(path, ...args);
    });
    await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(failed).toBe(true);
    vi.mocked(durable.writeDurableHostJson).mockImplementation(actual);
    const inspected = await provision.inspectFirstSetupWorkspaceSelection(f.anchor);
    expect(inspected).toMatchObject({
      inspectionId: expect.stringMatching(/^[a-f0-9]{64}$/),
      record: f.applied,
      retired: f.anchor,
      binding: f.binding,
    });
    expect(await provision.inspectFirstSetupWorkspaceSelection(f.anchor)).toEqual(inspected);
    await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    await provision.selectFirstSetupWorkspace(f.anchor, inspected!.record);
    expect(await provision.inspectFirstSetupWorkspaceSelection(f.anchor)).toBeNull();
    expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
  },
);

it.each(["prepared selection", "applied selection"])(
  "keeps boot closed after interruption writing the %s until the selection operation resumes",
  async (point) => {
    for (const after of [false, true]) {
      const f = await fixture();
      const actual = (await vi.importActual<typeof durable>("./durable-host-json.js"))
        .writeDurableHostJson;
      const filename = point === "prepared selection" ? "000003.json" : "000004.json";
      let failed = false;
      vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
        if (after) await actual(path, ...args);
        if (path.endsWith(filename) && !failed) {
          failed = true;
          throw new Error("selection audit interruption");
        }
        if (!after) await actual(path, ...args);
      });
      await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
        code: "setup.attempt_uncertain",
      });
      expect(failed).toBe(true);
      vi.mocked(durable.writeDurableHostJson).mockImplementation(actual);
      if (point === "applied selection" && after) {
        expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
      } else if (point === "prepared selection") {
        expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toBeNull();
      } else {
        await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
          code: "setup.attempt_uncertain",
        });
      }
      await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
      expect((await f.store.read(f.binding.resolutionId)).map((record) => record.phase)).toEqual([
        "prepared",
        "applied",
        "prepared",
        "applied",
      ]);
      expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
    }
  },
);
it.each(["venue-witness", "state-witness", "backlink", "applied-record"] as const)(
  "losing %s refuses the selected target and never falls back",
  async (which) => {
    const f = await fixture();
    await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
    const paths = {
      "venue-witness": join(f.anchor.venueDir, "first-setup-selection.json"),
      "state-witness": join(f.anchor.stateDir, "first-setup-selection.json"),
      backlink: join(f.binding.venueDir, "first-setup-workspace.json"),
      "applied-record": join(
        f.anchor.stateDir,
        "first-setup-resolutions",
        f.applied.resolutionId,
        "000002.json",
      ),
    };
    await unlink(paths[which]);
    await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    await expect(
      provision.assertFirstSetupBootTarget({
        venueDir: f.binding.venueDir,
        stateDir: f.binding.stateDir,
      }),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  },
);
it.each(["state", "marker", "database"] as const)(
  "restoring the old %s refuses before a target is returned",
  async (which) => {
    const f = await fixture();
    await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
    const paths = {
      state: join(f.anchor.stateDir, "first-setup.json"),
      marker: join(f.anchor.venueDir, "first-setup-claim.json"),
      database: join(f.anchor.venueDir, "venue.db"),
    };
    await writeFile(paths[which], "restored different bytes");
    await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  },
);
it("a substituted backlink, root or generation is not selected", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const path = join(f.binding.venueDir, "first-setup-workspace.json");
  const original = JSON.parse(await readFile(path, "utf8"));
  for (const binding of [
    { ...f.binding, anchorStateDir: f.root },
    { ...f.binding, selectionGeneration: 2 },
    { ...f.binding, workspaceId: randomUUID() },
  ]) {
    await writeFile(path, JSON.stringify({ ...original, binding }));
    await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  }
});
it("cannot select prepared-only retirement, alter its target or reuse an occupied directory", async () => {
  const f = await fixture();
  await expect(provision.selectFirstSetupWorkspace(f.anchor, f.prepared)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(
    provision.selectFirstSetupWorkspace(f.anchor, {
      ...f.applied,
      nextWorkspace: { ...f.binding, venueDir: f.anchor.venueDir },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  await mkdir(f.binding.venueDir, { recursive: true });
  await writeFile(join(f.binding.venueDir, "business-file"), "must never be adopted");
  await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
it("refuses a target directory symlink", async () => {
  const f = await fixture();
  await mkdir(join(f.anchor.stateDir, "first-setup-workspaces"));
  await symlink(
    f.anchor.venueDir,
    join(f.anchor.stateDir, "first-setup-workspaces", f.binding.workspaceId),
  );
  await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(stat(join(f.anchor.venueDir, "first-setup-workspace.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it.each([
  "first-setup-retirement.json",
  "first-setup-workspace.json",
  "state-selection",
  "venue-selection",
])(
  "interruption at %s leaves retirement unavailable for raw boot and requires authorisation to retry",
  async (point) => {
    const f = await fixture();
    const actual = (await vi.importActual<typeof durable>("./durable-host-json.js"))
      .writeDurableHostJson;
    let failed = false;
    vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
      await actual(path, ...args);
      const selected =
        point === "state-selection"
          ? path === join(f.anchor.stateDir, "first-setup-selection.json")
          : point === "venue-selection"
            ? path === join(f.anchor.venueDir, "first-setup-selection.json")
            : path.endsWith(point);
      if (selected && !failed) {
        failed = true;
        throw new Error("synthetic power loss");
      }
    });
    await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(failed).toBe(true);
    await expect(provision.assertFirstSetupBootTarget(f.anchor)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    vi.mocked(durable.writeDurableHostJson).mockImplementation(actual);
    expect(await provision.selectFirstSetupWorkspace(f.anchor, f.applied)).toEqual(f.binding);
    expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
  },
);

it.each(["document-directory", "configured-history"] as const)(
  "changed %s evidence refuses installation of a workspace selection",
  async (which) => {
    const f = await fixture();
    if (which === "document-directory")
      await mkdir(join(f.anchor.stateDir, "first-fiscal-documents"));
    else await writeFile(join(f.root, "outside-history.json"), "restored older public history");
    await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  },
);

it("a failure syncing a new workspace directory prevents publication of any selection", async () => {
  const f = await fixture();
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  let reached = false;
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    if (String(args[0]) === join(f.anchor.stateDir, "first-setup-workspaces")) {
      reached = true;
      throw new Error("synthetic new directory sync refusal");
    }
    return actual.open(...args);
  });
  try {
    await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(reached).toBe(true);
    await expect(stat(join(f.anchor.venueDir, "first-setup-selection.json"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  } finally {
    vi.mocked(filesystem.open).mockImplementation(actual.open);
  }
  expect(await provision.selectFirstSetupWorkspace(f.anchor, f.applied)).toEqual(f.binding);
});

it("an installation sharing its original state and venue directory can select an isolated workspace", async () => {
  const f = await fixture(true);
  expect(await provision.selectFirstSetupWorkspace(f.anchor, f.applied)).toEqual(f.binding);
  expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
  await provision.assertFirstSetupBootTarget({
    venueDir: f.binding.venueDir,
    stateDir: f.binding.stateDir,
  });
});

async function successor(
  f: Awaited<ReturnType<typeof fixture>>,
  prior: provision.WorkspaceBinding,
) {
  const resolutionId = randomUUID(),
    workspaceId = randomUUID();
  const base = join(f.anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding = {
    ...prior,
    resolutionId,
    workspaceId,
    venueDir: join(base, "venue"),
    stateDir: join(base, "state"),
    selectionGeneration: prior.selectionGeneration + 1,
  };
  const before = await readFile(join(prior.venueDir, "first-setup-workspace.json"));
  const prepared = await f.store.prepare(
    {
      resolutionId,
      attemptId: randomUUID(),
      observedRevision: 3,
      observedOwnerGeneration: 2,
      database: "missing",
      authority: "original-password",
      register: {
        kind: "current-master",
        status: "Unknown",
        custodian: "Elena",
        reference: "d".repeat(64),
        consultedAt: "2026-10-16T03:00:00.000Z",
      },
      action: "retire",
      nextWorkspace: binding,
    },
    [
      { name: "workspace:predecessor", bytes: before },
      { name: "state/first-setup.json", bytes: null },
      { name: "venue/first-setup-claim.json", bytes: null },
      { name: "venue/venue.db", bytes: null },
    ],
  );
  return { binding, applied: await f.store.apply(prepared) };
}
it("discovers a later interrupted selection through its predecessor without reviving that retired workspace", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const next = await successor(f, f.binding);
  const actual = (await vi.importActual<typeof durable>("./durable-host-json.js"))
    .writeDurableHostJson;
  let failed = false;
  vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
    if (path === join(next.binding.venueDir, "first-setup-workspace.json") && !failed) {
      failed = true;
      throw new Error("second selection interruption");
    }
    await actual(path, ...args);
  });
  await expect(provision.selectFirstSetupWorkspace(f.anchor, next.applied)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(failed).toBe(true);
  vi.mocked(durable.writeDurableHostJson).mockImplementation(actual);
  const pending = await provision.inspectFirstSetupWorkspaceSelection(f.anchor);
  expect(pending).toMatchObject({
    record: next.applied,
    retired: f.binding,
    binding: next.binding,
  });
  await expect(provision.assertFirstSetupBootTarget(f.binding)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await provision.selectFirstSetupWorkspace(f.anchor, pending!.record);
  expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(next.binding);
  expect(await provision.inspectFirstSetupWorkspaceSelection(f.anchor)).toBeNull();
});
it("repeated retirement keeps the original discovery anchor and refuses every retired generation", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const next = await successor(f, f.binding);
  expect(await provision.selectFirstSetupWorkspace(f.anchor, next.applied)).toEqual(next.binding);
  expect(await provision.resolveFirstSetupWorkspace(f.anchor)).toEqual({
    venueDir: next.binding.venueDir,
    stateDir: next.binding.stateDir,
    binding: next.binding,
  });
  await provision.assertFirstSetupBootTarget(next.binding);
  await expect(provision.assertFirstSetupBootTarget(f.binding)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(provision.assertFirstSetupBootTarget(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  const third = await successor(f, next.binding);
  expect(await provision.selectFirstSetupWorkspace(f.anchor, third.applied)).toEqual(third.binding);
  expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(third.binding);
  await provision.assertFirstSetupBootTarget(third.binding);
  await expect(provision.assertFirstSetupBootTarget(next.binding)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(await readFile(join(f.anchor.stateDir, "first-setup.json"), "utf8")).toBe(
    "unchanged original state",
  );
});
it("a successor cannot skip a generation or select an unrelated predecessor", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const next = await successor(f, { ...f.binding, selectionGeneration: 8 });
  await expect(provision.selectFirstSetupWorkspace(f.anchor, next.applied)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
});

it("an entry configured with selected roots rediscovers the original fixed anchor", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  expect(await provision.resolveFirstSetupWorkspace(f.binding)).toEqual({
    venueDir: f.binding.venueDir,
    stateDir: f.binding.stateDir,
    binding: f.binding,
  });
  expect(await provision.firstSetupAnchorFor(f.binding)).toEqual(f.anchor);
});

it("interrupted later retirement returns resolution instead of the now-retired previous selection", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const next = await successor(f, f.binding);
  const actual = (await vi.importActual<typeof durable>("./durable-host-json.js"))
    .writeDurableHostJson;
  let failed = false;
  vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
    await actual(path, ...args);
    if (path === join(f.binding.venueDir, "first-setup-retirement.json") && !failed) {
      failed = true;
      throw new Error("synthetic later retirement interruption");
    }
  });
  await expect(provision.selectFirstSetupWorkspace(f.anchor, next.applied)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(failed).toBe(true);
  await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  vi.mocked(durable.writeDurableHostJson).mockImplementation(actual);
  expect(await provision.selectFirstSetupWorkspace(f.anchor, next.applied)).toEqual(next.binding);
});
it("restoring an earlier ancestor is refused after a later workspace was selected", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const next = await successor(f, f.binding);
  await provision.selectFirstSetupWorkspace(f.anchor, next.applied);
  await writeFile(join(f.anchor.stateDir, "first-setup.json"), "restored original ancestor");
  await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(provision.assertFirstSetupBootTarget(next.binding)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it("a selected workspace retains archived evidence while independently configured public history advances", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  await writeFile(join(f.root, "outside-history.json"), "newer independent public history");
  expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
  await provision.assertFirstSetupBootTarget(f.binding);
  const archived = await f.store.readOriginals(f.applied.resolutionId);
  expect(archived.find((entry) => entry.name.startsWith("outside-file:"))?.bytes?.toString()).toBe(
    "independently configured public history",
  );
});

it("missing live outside history does not erase archived retirement evidence or select old roots", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  await unlink(join(f.root, "outside-history.json"));
  expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
  await expect(provision.assertFirstSetupBootTarget(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(
    (await f.store.readOriginals(f.applied.resolutionId))
      .find((entry) => entry.name.startsWith("outside-file:"))
      ?.bytes?.toString(),
  ).toBe("independently configured public history");
});

it("altering an archived outside original still refuses the selected workspace", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const path = join(
    f.anchor.stateDir,
    "first-setup-resolutions",
    f.applied.resolutionId,
    "original-4-0.json",
  );
  await writeFile(
    path,
    JSON.stringify({ bytes: Buffer.from("different archived public history").toString("base64") }),
  );
  await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it("configured public evidence inside a retired root remains frozen", async () => {
  const f = await fixture(false, true);
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  await writeFile(f.outsidePath, "changed inside retired state");
  await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it("dot-prefixed configured evidence inside a retired root cannot escape local preservation", async () => {
  const f = await fixture(false, true, "..history.json");
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  await writeFile(f.outsidePath, "changed inside retired state");
  await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it.each(["append", "replace", "remove"])(
  "independent receipt directories may %s after selection without rewriting archived originals",
  async (change) => {
    const f = await fixture();
    await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
    const receipt = join(f.root, "receipts", "one.json");
    if (change === "append")
      await writeFile(join(f.root, "receipts", "two.json"), "second outside receipt");
    else if (change === "replace") await writeFile(receipt, "new current outside receipt");
    else await rm(join(f.root, "receipts"), { recursive: true });
    expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
    await provision.assertFirstSetupBootTarget(f.binding);
    const originals = await f.store.readOriginals(f.applied.resolutionId);
    expect(
      originals.find((entry) => entry.name === `outside-file:${receipt}`)?.bytes?.toString(),
    ).toBe("first outside receipt");
    expect(
      originals
        .find((entry) => entry.name === `directory:outside:${join(f.root, "receipts")}`)
        ?.bytes?.toString(),
    ).toBe('["one.json"]');
  },
);

it("replaying an already published selection after outside history advances returns its unchanged binding", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const paths = [
    join(f.anchor.stateDir, "first-setup-selection.json"),
    join(f.anchor.venueDir, "first-setup-selection.json"),
  ];
  const before = await Promise.all(paths.map((path) => readFile(path)));
  await writeFile(f.outsidePath, "advanced independent current history");
  expect(await provision.selectFirstSetupWorkspace(f.anchor, f.applied)).toEqual(f.binding);
  expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before);
});

it("creating a document directory in retired local state still refuses an already selected workspace", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  await mkdir(join(f.anchor.stateDir, "first-fiscal-documents"));
  await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it.each(["retirement", "backlink", "state-selection", "venue-selection", "applied-selection"])(
  "does not acknowledge selection while a renamed %s directory still refuses sync",
  async (point) => {
    const f = await fixture();
    const paths = {
      retirement: join(f.anchor.venueDir, "first-setup-retirement.json"),
      backlink: join(f.binding.venueDir, "first-setup-workspace.json"),
      "state-selection": join(f.anchor.stateDir, "first-setup-selection.json"),
      "venue-selection": join(f.anchor.venueDir, "first-setup-selection.json"),
      "applied-selection": join(
        f.anchor.stateDir,
        "first-setup-resolutions",
        f.binding.resolutionId,
        "000004.json",
      ),
    };
    const path = paths[point as keyof typeof paths];
    const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
    let renamed = false;
    let refusals = 0;
    vi.mocked(filesystem.rename).mockImplementation(async (from, to) => {
      await actual.rename(from, to);
      if (String(to) === path) renamed = true;
    });
    vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (renamed && String(args[0]) === dirname(path)) {
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          refusals++;
          throw new Error("selection directory still refuses sync");
        });
      }
      return handle;
    });
    await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(refusals).toBeGreaterThan(0);
    const original = await filesystem.readFile(path);
    const beforeReplay = refusals;
    await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(refusals).toBeGreaterThan(beforeReplay);
    vi.mocked(filesystem.open).mockImplementation(actual.open);
    vi.mocked(filesystem.rename).mockImplementation(actual.rename);
    await expect(provision.selectFirstSetupWorkspace(f.anchor, f.applied)).resolves.toEqual(
      f.binding,
    );
    expect(await filesystem.readFile(path)).toEqual(original);
    expect((await f.store.read(f.binding.resolutionId)).map((record) => record.phase)).toEqual([
      "prepared",
      "applied",
      "prepared",
      "applied",
    ]);
    expect(await provision.resolveFirstSetupWorkspace(f.anchor)).toEqual({
      venueDir: f.binding.venueDir,
      stateDir: f.binding.stateDir,
      binding: f.binding,
    });
  },
);

it.each([
  "wrong-anchor",
  "conflicting-witness",
  "same-generation",
  "wrong-backlink",
  "wrong-resolution-digest",
  "extra-field",
  "unsupported-version",
])("interrupted selection inspection refuses %s rather than proposing repair", async (fault) => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  const retirement = join(f.anchor.venueDir, "first-setup-retirement.json");
  const backlink = join(f.binding.venueDir, "first-setup-workspace.json");
  const stateSelection = join(f.anchor.stateDir, "first-setup-selection.json");
  const original = await readFile(retirement, "utf8");
  const changed = JSON.parse(original);
  await unlink(backlink);
  let path = retirement;
  if (fault === "wrong-anchor") changed.binding.anchorVenueDir = join(f.root, "other");
  else if (fault === "conflicting-witness") {
    path = stateSelection;
    changed.evidenceDigest = "a".repeat(64);
  } else if (fault === "same-generation") {
    path = stateSelection;
    changed.binding.resolutionId = randomUUID();
  } else if (fault === "wrong-backlink") {
    path = backlink;
    changed.resolutionDigest = "a".repeat(64);
  } else if (fault === "wrong-resolution-digest") {
    changed.resolutionDigest = "a".repeat(64);
    for (const name of ["first-setup-selection.json"]) {
      await writeFile(join(f.anchor.stateDir, name), JSON.stringify(changed));
      await writeFile(join(f.anchor.venueDir, name), JSON.stringify(changed));
    }
  } else if (fault === "extra-field") changed.extra = true;
  else if (fault === "unsupported-version") changed.version = 2;
  await writeFile(path, JSON.stringify(changed));
  const before = await readFile(retirement);
  await expect(provision.inspectFirstSetupWorkspaceSelection(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(await readFile(retirement)).toEqual(before);
  await expect(stat(join(f.binding.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("a selected workspace is not an interrupted repair and its direct roots resolve to the same binding", async () => {
  const f = await fixture();
  await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
  expect(await provision.inspectFirstSetupWorkspaceSelection(f.anchor)).toBeNull();
  expect(await provision.resolveFirstSetupWorkspace(f.binding)).toEqual({
    venueDir: f.binding.venueDir,
    stateDir: f.binding.stateDir,
    binding: f.binding,
  });
  await assertFirstSetupVenueTarget(f.binding.venueDir);
  await expect(assertFirstSetupVenueTarget(f.anchor.venueDir)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it("damaged discovery without a retirement witness cannot invent an interrupted selection", async () => {
  const f = await fixture();
  await writeFile(join(f.anchor.venueDir, "first-setup-workspace.json"), "{}");
  await expect(provision.inspectFirstSetupWorkspaceSelection(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it("an orphan workspace cannot boot through either root resolver or venue-only admission", async () => {
  const f = await fixture();
  await mkdir(f.binding.venueDir, { recursive: true });
  await mkdir(f.binding.stateDir);
  await expect(provision.resolveFirstSetupWorkspace(f.binding)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(assertFirstSetupVenueTarget(f.binding.venueDir)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(provision.assertFirstSetupBootTarget(f.binding)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await assertFirstSetupVenueTarget(f.anchor.venueDir);
});

async function customRetirement(
  f: Awaited<ReturnType<typeof fixture>>,
  originals: { name: string; bytes: Uint8Array | null }[],
) {
  const resolutionId = randomUUID();
  const workspaceId = randomUUID();
  const base = join(f.anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding = {
    ...f.binding,
    resolutionId,
    workspaceId,
    venueDir: join(base, "venue"),
    stateDir: join(base, "state"),
  };
  const prepared = await f.store.prepare(
    {
      resolutionId,
      attemptId: f.prepared.attemptId,
      observedRevision: f.prepared.observedRevision,
      observedOwnerGeneration: f.prepared.observedOwnerGeneration,
      database: f.prepared.database,
      authority: f.prepared.authority,
      register: f.prepared.register,
      action: "retire",
      nextWorkspace: binding,
    },
    originals,
  );
  return { binding, applied: await f.store.apply(prepared) };
}

it.each(["state/first-setup.json", "venue/first-setup-claim.json", "venue/venue.db"])(
  "cannot select a workspace whose archived evidence omits %s",
  async (missing) => {
    const f = await fixture();
    const originals = await f.store.readOriginals(f.binding.resolutionId);
    const next = await customRetirement(
      f,
      originals.filter((original) => original.name !== missing),
    );
    await expect(provision.selectFirstSetupWorkspace(f.anchor, next.applied)).rejects.toMatchObject(
      {
        code: "setup.attempt_uncertain",
      },
    );
    await expect(stat(next.binding.venueDir)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([
  "unscoped-file",
  "state/../escape",
  "state//empty",
  "venue/./file",
  "venue/back\\slash",
  "outside-file:relative/file",
])("cannot select using an unsafe archived path %s", async (name) => {
  const f = await fixture();
  const next = await customRetirement(f, [
    ...(await f.store.readOriginals(f.binding.resolutionId)),
    { name, bytes: null },
  ]);
  await expect(provision.selectFirstSetupWorkspace(f.anchor, next.applied)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(stat(next.binding.venueDir)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  "changed listing",
  "missing expected directory",
  "directory replacing file",
  "changed size",
])("refuses %s in retired local evidence before selecting the new workspace", async (fault) => {
  const f = await fixture();
  const path = join(f.anchor.stateDir, "retained-evidence");
  const directory = fault === "changed listing" || fault === "missing expected directory";
  if (directory) {
    await mkdir(path);
    await writeFile(join(path, "one.json"), "original");
  } else await writeFile(path, "original");
  const next = await customRetirement(f, [
    ...(await f.store.readOriginals(f.binding.resolutionId)),
    {
      name: `${directory ? "directory:" : ""}state/retained-evidence`,
      bytes: Buffer.from(directory ? '["one.json"]' : "original"),
    },
  ]);
  if (fault === "changed listing") await writeFile(join(path, "two.json"), "additional");
  else if (fault === "missing expected directory") await rm(path, { recursive: true });
  else if (fault === "directory replacing file") {
    await unlink(path);
    await mkdir(path);
  } else await writeFile(path, "changed and longer");
  await expect(provision.selectFirstSetupWorkspace(f.anchor, next.applied)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(stat(next.binding.venueDir)).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps a present archived directory listing when selecting and resolving the new workspace", async () => {
  const f = await fixture();
  const path = join(f.anchor.stateDir, "retained-evidence");
  await mkdir(path);
  await writeFile(join(path, "one.json"), "unchanged");
  const next = await customRetirement(f, [
    ...(await f.store.readOriginals(f.binding.resolutionId)),
    { name: "directory:state/retained-evidence", bytes: Buffer.from('["one.json"]') },
  ]);
  expect(await provision.selectFirstSetupWorkspace(f.anchor, next.applied)).toEqual(next.binding);
  expect((await provision.resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(next.binding);
  expect(await readFile(join(path, "one.json"), "utf8")).toBe("unchanged");
});
