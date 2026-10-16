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
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as provision from "./index.js";
import * as durable from "./durable-host-json.js";
import * as filesystem from "node:fs/promises";
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
async function fixture(sharedRoots = false) {
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
  await writeFile(join(root, "outside-history.json"), "independently configured public history");
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
        name: `outside-file:${join(root, "outside-history.json")}`,
        bytes: Buffer.from("independently configured public history"),
      },
    ],
  );
  const applied = await store.apply(prepared);
  return { root, anchor, binding, store, prepared, applied };
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
  "changed %s evidence refuses a selected workspace",
  async (which) => {
    const f = await fixture();
    await provision.selectFirstSetupWorkspace(f.anchor, f.applied);
    if (which === "document-directory")
      await mkdir(join(f.anchor.stateDir, "first-fiscal-documents"));
    else await writeFile(join(f.root, "outside-history.json"), "restored older public history");
    await expect(provision.resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
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
