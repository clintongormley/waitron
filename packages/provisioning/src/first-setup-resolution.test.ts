import { mkdtemp, rm, readFile, readdir, writeFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as resolution from "./index.js";
import * as durable from "./durable-host-json.js";
vi.mock("./durable-host-json.js", { spy: true });

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(durable.writeDurableHostJson).mockImplementation(
    (await vi.importActual<typeof durable>("./durable-host-json.js")).writeDurableHostJson,
  );
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "setup-retirement-"));
  dirs.push(root);
  const roots = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  const coordinator = resolution.createFirstSetupCoordinator();
  const store = resolution.createFirstSetupResolutionStore({ ...roots, coordinator });
  const input = {
    resolutionId: randomUUID(),
    attemptId: randomUUID(),
    observedRevision: 4,
    observedOwnerGeneration: 2,
    database: "empty-preactivation" as const,
    authority: "original-password" as const,
    register: {
      kind: "current-master" as const,
      status: "Consumed" as const,
      custodian: "Elena",
      reference: "b".repeat(64),
      consultedAt: "2026-10-16T02:00:00.000Z",
    },
    action: "retire" as const,
    nextWorkspace: null,
  };
  const originals = [
    { name: "first-setup.json", bytes: Buffer.from('{"consumptionIntent":true}') },
    { name: "first-setup-claim.json", bytes: Buffer.from("malformed original") },
    { name: "venue.db", bytes: null },
  ];
  return { root, roots, store, input, originals, coordinator };
}
it.each(["Consumed", "Not consumed", "Unknown"] as const)(
  "retains %s separately from the unchanged consumption evidence across restart",
  async (status) => {
    const f = await fixture();
    const input = { ...f.input, register: { ...f.input.register, status } };
    const prepared = await f.store.prepare(input, f.originals);
    const applied = await f.store.apply(prepared);
    const restarted = resolution.createFirstSetupResolutionStore({
      ...f.roots,
      coordinator: f.coordinator,
    });
    expect(await restarted.read(f.input.resolutionId)).toEqual([prepared, applied]);
    expect(prepared.register).toEqual(input.register);
    expect(applied.previousRecordDigest).toBe(
      createHash("sha256").update(JSON.stringify(prepared)).digest("hex"),
    );
    expect(applied.phase).toBe("applied");
    expect(applied.sequence).toBe(2);
    expect(await restarted.readOriginals(f.input.resolutionId)).toEqual(f.originals);
    expect(
      JSON.parse((await restarted.readOriginals(f.input.resolutionId))[0]!.bytes!.toString()),
    ).toEqual({ consumptionIntent: true });
    expect(await f.store.apply(prepared)).toEqual(applied);
  },
);
it("retains large binary originals in bounded chunks and private files", async () => {
  const f = await fixture();
  const bytes = Buffer.alloc(160000, 139);
  const prepared = await f.store.prepare(f.input, [{ name: "venue.db", bytes }]);
  expect(prepared.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(await f.store.readOriginals(f.input.resolutionId)).toEqual([{ name: "venue.db", bytes }]);
  const folder = join(f.roots.stateDir, "first-setup-resolutions", f.input.resolutionId);
  expect((await stat(folder)).mode & 0o777).toBe(0o700);
  for (const name of await readdir(folder)) {
    expect((await stat(join(folder, name))).mode & 0o777).toBe(0o600);
    expect((await stat(join(folder, name))).size).toBeLessThan(65536);
  }
});
it("refuses changed or truncated originals and missing records rather than dropping history", async () => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  const folder = join(f.roots.stateDir, "first-setup-resolutions", f.input.resolutionId);
  const chunk = (await readdir(folder)).find((name) => name.startsWith("original-"))!;
  await writeFile(join(folder, chunk), '{"bytes":"YWx0ZXJlZA=="}');
  await expect(f.store.readOriginals(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(f.store.read(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});
it("cannot rewrite a prepared answer or replace its snapshot on duplicate submission", async () => {
  const f = await fixture();
  const prepared = await f.store.prepare(f.input, f.originals);
  const path = join(
    f.roots.stateDir,
    "first-setup-resolutions",
    f.input.resolutionId,
    "000001.json",
  );
  const before = await readFile(path);
  await expect(
    f.store.prepare(
      { ...f.input, register: { ...f.input.register, status: "Not consumed" } },
      f.originals,
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(
    f.store.apply({ ...prepared, evidenceDigest: "c".repeat(64) }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(path)).toEqual(before);
});
it.each(["../escape", "", "not-a-uuid"])(
  "refuses unsafe resolution ID %j",
  async (resolutionId) => {
    const f = await fixture();
    await expect(f.store.prepare({ ...f.input, resolutionId }, f.originals)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  },
);
it("rejects unknown fields, private input, incomplete answers and impossible authority", async () => {
  const f = await fixture();
  for (const input of [
    { ...f.input, password: "must-not-persist" },
    { ...f.input, register: { ...f.input.register, reference: "" } },
    { ...f.input, register: { ...f.input.register, consultedAt: "yesterday" } },
    { ...f.input, authority: "local-empty-no-custodian", register: f.input.register },
    {
      ...f.input,
      database: "missing",
      authority: "local-empty-no-custodian",
      register: { kind: "no-current-master", confirmed: true },
    },
  ])
    await expect(f.store.prepare(input, f.originals)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
});
it("refuses an evidence directory symlink without writing to its target", async () => {
  const f = await fixture();
  const target = await mkdtemp(join(tmpdir(), "setup-outside-"));
  dirs.push(target);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(f.roots.stateDir);
  await symlink(target, join(f.roots.stateDir, "first-setup-resolutions"));
  await expect(f.store.prepare(f.input, f.originals)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readdir(target)).toEqual([]);
});

it.each(["original-0-0.json", "manifest.json", "000001.json", "000002.json"] as const)(
  "interruption before or after %s cannot report applied without its complete predecessor",
  async (point) => {
    for (const after of [false, true]) {
      const f = await fixture();
      const actual = (await vi.importActual<typeof durable>("./durable-host-json.js"))
        .writeDurableHostJson;
      const before = point === "000002.json" ? await f.store.prepare(f.input, f.originals) : null;
      let failed = false;
      vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
        if (after) await actual(path, ...args);
        if (path.endsWith(point) && !failed) {
          failed = true;
          throw new Error("synthetic durable interruption");
        }
        if (!after) await actual(path, ...args);
      });
      await expect(
        before === null ? f.store.prepare(f.input, f.originals) : f.store.apply(before),
      ).rejects.toThrow("synthetic durable interruption");
      expect(failed).toBe(true);
      vi.mocked(durable.writeDurableHostJson).mockImplementation(actual);
      const prepared = await f.store.prepare(f.input, f.originals),
        applied = await f.store.apply(prepared);
      expect(await f.store.read(f.input.resolutionId)).toEqual([prepared, applied]);
      expect(await f.store.readOriginals(f.input.resolutionId)).toEqual(f.originals);
    }
  },
);

it("links separate actions and retains each action's original evidence across restart", async () => {
  const f = await fixture();
  const prepared = await f.store.prepare(f.input, f.originals);
  const retired = await f.store.apply(prepared);
  const selection = { ...f.input, action: "select-workspace" as const };
  const observed = [{ name: "selection-check", bytes: Buffer.from("fresh observation") }];
  const selecting = await f.store.prepare(selection, observed);
  expect(selecting).toMatchObject({
    sequence: 3,
    action: "select-workspace",
    phase: "prepared",
    previousRecordDigest: createHash("sha256").update(JSON.stringify(retired)).digest("hex"),
  });
  const selected = await f.store.apply(selecting);
  const restarted = resolution.createFirstSetupResolutionStore({
    ...f.roots,
    coordinator: resolution.createFirstSetupCoordinator(),
  });
  expect(await restarted.read(f.input.resolutionId)).toEqual([
    prepared,
    retired,
    selecting,
    selected,
  ]);
  expect(await restarted.readOriginals(f.input.resolutionId)).toEqual(f.originals);
  expect(await restarted.readOriginals(f.input.resolutionId, 3)).toEqual(observed);
  expect(await restarted.apply(prepared)).toEqual(retired);
  expect(await restarted.prepare(selection, observed)).toEqual(selecting);
  expect(await restarted.apply(selecting)).toEqual(selected);
  expect(selected).toMatchObject({ sequence: 4, phase: "applied" });
});

it("does not begin a different action while the preceding action remains prepared", async () => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  await expect(
    f.store.prepare({ ...f.input, action: "select-workspace" }, f.originals),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.store.read(f.input.resolutionId)).map((record) => record.phase)).toEqual([
    "prepared",
  ]);
});

it("refuses a prepared later action's wrong predecessor before an applied successor exists", async () => {
  const f = await fixture();
  await f.store.apply(await f.store.prepare(f.input, f.originals));
  await f.store.prepare({ ...f.input, action: "select-workspace" }, f.originals);
  const path = join(
    f.roots.stateDir,
    "first-setup-resolutions",
    f.input.resolutionId,
    "000003.json",
  );
  const value = JSON.parse(await readFile(path, "utf8"));
  value.previousRecordDigest = "a".repeat(64);
  await writeFile(path, JSON.stringify(value));
  await expect(f.store.read(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it.each(["missing predecessor", "wrong predecessor", "changed original"])(
  "refuses a later action's %s instead of returning its applied result",
  async (fault) => {
    const f = await fixture();
    await f.store.apply(await f.store.prepare(f.input, f.originals));
    const next = await f.store.prepare({ ...f.input, action: "select-workspace" }, f.originals);
    await f.store.apply(next);
    const folder = join(f.roots.stateDir, "first-setup-resolutions", f.input.resolutionId);
    if (fault === "missing predecessor") await rm(join(folder, "000002.json"));
    else if (fault === "wrong predecessor") {
      const value = JSON.parse(await readFile(join(folder, "000003.json"), "utf8"));
      value.previousRecordDigest = "a".repeat(64);
      await writeFile(join(folder, "000003.json"), JSON.stringify(value));
    } else {
      await writeFile(join(folder, "step-000003", "original-0-0.json"), '{"bytes":"YWx0ZXJlZA=="}');
    }
    await expect(f.store.read(f.input.resolutionId)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
    await expect(f.store.apply(next)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  },
);

it.each(["000003.json", "000004.json"])(
  "resumes an interrupted later action at %s without duplicating earlier actions",
  async (point) => {
    for (const after of [false, true]) {
      const f = await fixture();
      const first = await f.store.prepare(f.input, f.originals);
      const applied = await f.store.apply(first);
      const input = { ...f.input, action: "select-workspace" as const };
      const actual = (await vi.importActual<typeof durable>("./durable-host-json.js"))
        .writeDurableHostJson;
      const before = point === "000004.json" ? await f.store.prepare(input, f.originals) : null;
      let failed = false;
      vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...args) => {
        if (after) await actual(path, ...args);
        if (path.endsWith(point) && !failed) {
          failed = true;
          throw new Error("later action interruption");
        }
        if (!after) await actual(path, ...args);
      });
      await expect(
        before === null ? f.store.prepare(input, f.originals) : f.store.apply(before),
      ).rejects.toThrow("later action interruption");
      expect(failed).toBe(true);
      vi.mocked(durable.writeDurableHostJson).mockImplementation(actual);
      const prepared = await f.store.prepare(input, f.originals);
      const selected = await f.store.apply(prepared);
      expect(await f.store.read(f.input.resolutionId)).toEqual([
        first,
        applied,
        prepared,
        selected,
      ]);
    }
  },
);
