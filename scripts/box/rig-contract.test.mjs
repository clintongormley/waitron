import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RIG_CASES,
  createRun,
  loadLedger,
  parseRigArgs,
  planCleanup,
  runCleanup,
  withRecorded,
} from "./rig-contract.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const scratch = async () => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "b3-rig-")));
  roots.push(root);
  return root;
};
const refused = (reason) => expect.objectContaining({ code: "rig.refused", reason });

describe("parseRigArgs", () => {
  it("parses --case layout --run-dir <abs> in either order", () => {
    expect(parseRigArgs(["--case", "layout", "--run-dir", "/tmp/run-1"])).toEqual({
      caseName: "layout",
      runDir: "/tmp/run-1",
    });
    expect(parseRigArgs(["--run-dir", "/tmp/run-1", "--case", "layout"])).toEqual({
      caseName: "layout",
      runDir: "/tmp/run-1",
    });
  });

  it("accepts every listed case", () => {
    expect(RIG_CASES).toEqual([
      "layout",
      "seal-a",
      "seal-b",
      "seal-d",
      "seal-f",
      "seal-g",
      "seal-i",
      "preboot-local",
      "preboot-headless",
      "preboot-two-boxes",
      "preboot-tamper",
    ]);
    for (const caseName of RIG_CASES)
      expect(parseRigArgs(["--case", caseName, "--run-dir", "/tmp/r"]).caseName).toBe(caseName);
  });

  it.each([
    [
      "/dev/sdb as the run folder",
      ["--case", "layout", "--run-dir", "/dev/sdb"],
      "device-argument",
    ],
    [
      "an extra /dev/nvme0n1 argument",
      ["--case", "layout", "--run-dir", "/tmp/r", "/dev/nvme0n1"],
      "device-argument",
    ],
    ["a /dev/ argument before an unknown one", ["--bogus", "/dev/sda"], "device-argument"],
    [
      "an unknown option",
      ["--case", "layout", "--run-dir", "/tmp/r", "--force"],
      "argument-unknown",
    ],
    ["a bare value", ["layout"], "argument-unknown"],
    [
      "--case given twice",
      ["--case", "layout", "--case", "layout", "--run-dir", "/tmp/r"],
      "argument-repeated",
    ],
    [
      "--run-dir given twice",
      ["--run-dir", "/tmp/r", "--case", "layout", "--run-dir", "/tmp/r"],
      "argument-repeated",
    ],
    ["no arguments", [], "argument-missing"],
    ["--case missing", ["--run-dir", "/tmp/r"], "argument-missing"],
    ["--run-dir missing", ["--case", "layout"], "argument-missing"],
    ["--case without a value", ["--run-dir", "/tmp/r", "--case"], "argument-missing"],
    ["--run-dir without a value", ["--case", "layout", "--run-dir"], "argument-missing"],
    ["a case not listed", ["--case", "seal-c", "--run-dir", "/tmp/r"], "case-unknown"],
    ["a relative run folder", ["--case", "layout", "--run-dir", "tmp/r"], "run-dir-relative"],
    ["an empty run folder", ["--case", "layout", "--run-dir", ""], "run-dir-relative"],
    ['"/tmp/x/../y"', ["--case", "layout", "--run-dir", "/tmp/x/../y"], "run-dir-unsafe"],
    ["a trailing slash", ["--case", "layout", "--run-dir", "/tmp/r/"], "run-dir-unsafe"],
    ["a NUL", ["--case", "layout", "--run-dir", "/tmp/r\0x"], "run-dir-unsafe"],
    ["the root folder", ["--case", "layout", "--run-dir", "/"], "run-dir-unsafe"],
  ])("%s → refused", (_name, argv, reason) => {
    expect(() => parseRigArgs(argv)).toThrow(refused(reason));
  });
});

describe("createRun", () => {
  it("fresh path → a 0700 folder holding an empty ledger", async () => {
    const runDir = join(await scratch(), "run");
    const run = await createRun(runDir);
    const stat = await fs.lstat(runDir, { bigint: true });
    expect(run).toEqual({ runDir, rootId: `${stat.dev}:${stat.ino}` });
    expect(Number(stat.mode) & 0o777).toBe(0o700);
    expect(await fs.readFile(join(runDir, "ledger.json"), "utf8")).toBe(
      JSON.stringify({ version: 1, runDir, resources: [] }) + "\n",
    );
    expect((await fs.lstat(join(runDir, "ledger.json"))).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(runDir)).toEqual(["ledger.json"]);
  });

  it("existing empty folder → run-dir-exists, with its mode unchanged", async () => {
    const runDir = join(await scratch(), "run");
    await fs.mkdir(runDir, { mode: 0o755 });
    await fs.chmod(runDir, 0o755);
    await expect(createRun(runDir)).rejects.toThrow(refused("run-dir-exists"));
    expect((await fs.lstat(runDir)).mode & 0o777).toBe(0o755);
    expect(await fs.readdir(runDir)).toEqual([]);
  });

  it("existing non-empty folder → run-dir-exists, with its file unchanged", async () => {
    const runDir = join(await scratch(), "run");
    await fs.mkdir(runDir);
    await fs.writeFile(join(runDir, "ledger.json"), "kept");
    await expect(createRun(runDir)).rejects.toThrow(refused("run-dir-exists"));
    expect(await fs.readFile(join(runDir, "ledger.json"), "utf8")).toBe("kept");
    expect(await fs.readdir(runDir)).toEqual(["ledger.json"]);
  });

  it("missing parent → run-dir-parent-missing, and nothing created", async () => {
    const root = await scratch();
    await expect(createRun(join(root, "absent", "run"))).rejects.toThrow(
      refused("run-dir-parent-missing"),
    );
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("a parent that is a file → the file system's own error, nothing created", async () => {
    const root = await scratch();
    await fs.writeFile(join(root, "file"), "");
    await expect(createRun(join(root, "file", "run"))).rejects.toMatchObject({ code: "ENOTDIR" });
    expect(await fs.readdir(root)).toEqual(["file"]);
  });

  it.each([
    ["tmp/run", "run-dir-relative"],
    ["/tmp/x/../y", "run-dir-unsafe"],
    ["/", "run-dir-unsafe"],
  ])("%s → %s before any file call", async (runDir, reason) => {
    await expect(createRun(runDir)).rejects.toThrow(refused(reason));
  });
});

const ledgerText = (runDir, resources) => JSON.stringify({ version: 1, runDir, resources }) + "\n";
const readLedgerText = (runDir) => fs.readFile(join(runDir, "ledger.json"), "utf8");
const freshRun = async () => createRun(join(await scratch(), "run"));
const fakeAdapter = (failing = new Set()) => {
  const calls = [];
  const call = (name) => async (path) => {
    calls.push([name, path]);
    if (failing.has(path)) throw new Error("cleanup step failed");
  };
  return {
    calls,
    adapter: {
      stopVm: call("stopVm"),
      unmount: call("unmount"),
      detachLoops: call("detachLoops"),
      removeFile: call("removeFile"),
    },
  };
};

describe("withRecorded", () => {
  it("step sees its resource already in ledger.json on disk", async () => {
    const run = await freshRun();
    const image = { kind: "image", path: join(run.runDir, "disk.img") };
    const result = await withRecorded(run, image, async () => {
      expect(await readLedgerText(run.runDir)).toBe(ledgerText(run.runDir, [image]));
      return "made";
    });
    expect(result).toBe("made");
    expect(await fs.readdir(run.runDir)).toEqual(["ledger.json"]);
    expect((await fs.lstat(join(run.runDir, "ledger.json"))).mode & 0o777).toBe(0o600);
  });

  it("records every kind, keeping recording order", async () => {
    const run = await freshRun();
    const resources = [
      { kind: "image", path: join(run.runDir, "disk.img") },
      { kind: "loop", image: join(run.runDir, "disk.img") },
      { kind: "mount", target: join(run.runDir, "mnt") },
      { kind: "vm", pidFile: join(run.runDir, "vm", "qemu.pid") },
    ];
    for (const resource of resources) await withRecorded(run, resource, () => undefined);
    expect(await readLedgerText(run.runDir)).toBe(ledgerText(run.runDir, resources));
    expect(await loadLedger(run.runDir)).toEqual(resources);
  });

  it("two concurrent withRecorded calls → the ledger holds both resources", async () => {
    const run = await freshRun();
    const first = { kind: "image", path: join(run.runDir, "a.img") };
    const second = { kind: "image", path: join(run.runDir, "b.img") };
    await Promise.all([
      withRecorded(run, first, () => undefined),
      withRecorded(run, second, () => undefined),
    ]);
    expect(await loadLedger(run.runDir)).toEqual([first, second]);
  });

  it("a step may record its own sub-resources", async () => {
    const run = await freshRun();
    const image = { kind: "image", path: join(run.runDir, "disk.img") };
    const loop = { kind: "loop", image: image.path };
    await withRecorded(run, image, () => withRecorded(run, loop, () => undefined));
    expect(await loadLedger(run.runDir)).toEqual([image, loop]);
  });

  it("the ledger write fails (ledger.json.next pre-created as a folder) → step never called, ledger unchanged", async () => {
    const run = await freshRun();
    const before = await readLedgerText(run.runDir);
    await fs.mkdir(join(run.runDir, "ledger.json.next"));
    let called = false;
    const image = { kind: "image", path: join(run.runDir, "disk.img") };
    await expect(
      withRecorded(run, image, () => {
        called = true;
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(called).toBe(false);
    expect(await readLedgerText(run.runDir)).toBe(before);

    await fs.rmdir(join(run.runDir, "ledger.json.next"));
    await withRecorded(run, image, () => undefined);
    expect(await loadLedger(run.runDir)).toEqual([image]);
  });

  it.each([
    ["a path outside runDir", () => ({ kind: "image", path: "/tmp/elsewhere.img" })],
    ["/dev/loop0 as an image path", () => ({ kind: "image", path: "/dev/loop0" })],
    ["/dev/loop0 as a loop image", () => ({ kind: "loop", image: "/dev/loop0" })],
    ["a relative path", () => ({ kind: "mount", target: "run/mnt" })],
    ["a path not in normal form", (dir) => ({ kind: "image", path: `${dir}/a/../b.img` })],
    ["a trailing slash", (dir) => ({ kind: "mount", target: `${dir}/mnt/` })],
    ["a NUL", (dir) => ({ kind: "image", path: `${dir}/a\0b` })],
    ["runDir itself", (dir) => ({ kind: "mount", target: dir })],
    ["a sibling sharing the prefix", (dir) => ({ kind: "image", path: `${dir}-other/a.img` })],
    ["an escape through ..", (dir) => ({ kind: "vm", pidFile: `${dir}/../vm.pid` })],
    ["the ledger itself", (dir) => ({ kind: "image", path: `${dir}/ledger.json` })],
  ])("%s → rig.refused resource-outside-run", async (_name, make) => {
    const run = await freshRun();
    const before = await readLedgerText(run.runDir);
    let called = false;
    await expect(
      withRecorded(run, make(run.runDir), () => {
        called = true;
      }),
    ).rejects.toThrow(refused("resource-outside-run"));
    expect(called).toBe(false);
    expect(await readLedgerText(run.runDir)).toBe(before);
  });

  it("a run folder under /dev/ → resource-outside-run before any file call", async () => {
    const run = { runDir: "/dev/shm/run", rootId: "0:0" };
    await expect(
      withRecorded(run, { kind: "image", path: "/dev/shm/run/disk.img" }, () => undefined),
    ).rejects.toThrow(refused("resource-outside-run"));
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["an unknown kind", { kind: "disk", path: "/x" }],
    ["an inherited kind name", { kind: "toString", path: "/x" }],
    ["a missing kind", { path: "/x" }],
    ["the wrong key for its kind", { kind: "loop", path: "/x" }],
    ["an extra key", { kind: "image", path: "/x", size: 1 }],
    ["a path that is not text", { kind: "image", path: 1 }],
  ])("%s → rig.refused resource-invalid", async (_name, resource) => {
    const run = await freshRun();
    const before = await readLedgerText(run.runDir);
    await expect(withRecorded(run, resource, () => undefined)).rejects.toThrow(
      refused("resource-invalid"),
    );
    expect(await readLedgerText(run.runDir)).toBe(before);
  });
});

describe("loadLedger", () => {
  it.each([
    [
      "a ledger edited to name /etc/passwd",
      (dir) => ledgerText(dir, [{ kind: "image", path: "/etc/passwd" }]),
    ],
    ["a relative path", (dir) => ledgerText(dir, [{ kind: "image", path: "disk.img" }])],
    ["a path that is not text", (dir) => ledgerText(dir, [{ kind: "image", path: 7 }])],
    ["an unknown kind", (dir) => ledgerText(dir, [{ kind: "disk", path: `${dir}/a` }])],
    [
      "an extra resource key",
      (dir) => ledgerText(dir, [{ kind: "image", path: `${dir}/a`, note: "x" }]),
    ],
    ["another run's folder", (dir) => ledgerText(`${dir}-other`, [])],
    ["version 2", (dir) => JSON.stringify({ version: 2, runDir: dir, resources: [] }) + "\n"],
    [
      "an extra top-level key",
      (dir) => JSON.stringify({ version: 1, runDir: dir, resources: [], extra: 1 }) + "\n",
    ],
    [
      "resources that are not a list",
      (dir) => JSON.stringify({ version: 1, runDir: dir, resources: {} }) + "\n",
    ],
    ["null", () => "null\n"],
    ["bytes that are not JSON", () => "{\n"],
    ["no trailing newline", (dir) => ledgerText(dir, []).trimEnd()],
    [
      "pretty-printed bytes",
      (dir) => JSON.stringify({ version: 1, runDir: dir, resources: [] }, null, 2) + "\n",
    ],
    [
      "keys in another order",
      (dir) => JSON.stringify({ runDir: dir, version: 1, resources: [] }) + "\n",
    ],
    [
      "resource keys in another order",
      (dir) =>
        JSON.stringify({
          version: 1,
          runDir: dir,
          resources: [{ path: `${dir}/a`, kind: "image" }],
        }) + "\n",
    ],
  ])("refuses %s → ledger-invalid", async (_name, bytes) => {
    const run = await freshRun();
    await fs.writeFile(join(run.runDir, "ledger.json"), bytes(run.runDir));
    await expect(loadLedger(run.runDir)).rejects.toThrow(refused("ledger-invalid"));
  });
});

describe("planCleanup", () => {
  it("planCleanup reverses the order and maps each kind", () => {
    const resources = [
      { kind: "image", path: "/run/disk.img" },
      { kind: "loop", image: "/run/disk.img" },
      { kind: "mount", target: "/run/mnt" },
      { kind: "vm", pidFile: "/run/qemu.pid" },
    ];
    expect(planCleanup(resources)).toEqual([
      { action: "stop-vm", pidFile: "/run/qemu.pid" },
      { action: "unmount", target: "/run/mnt" },
      { action: "detach-loops", image: "/run/disk.img" },
      { action: "remove-file", path: "/run/disk.img" },
    ]);
    expect(resources[0]).toEqual({ kind: "image", path: "/run/disk.img" });
    expect(planCleanup([])).toEqual([]);
  });
});

describe("runCleanup", () => {
  const recordAll = async (run) => {
    const resources = [
      { kind: "image", path: join(run.runDir, "disk.img") },
      { kind: "loop", image: join(run.runDir, "disk.img") },
      { kind: "mount", target: join(run.runDir, "mnt") },
      { kind: "vm", pidFile: join(run.runDir, "qemu.pid") },
    ];
    for (const resource of resources) await withRecorded(run, resource, () => undefined);
    return resources;
  };

  it("runCleanup passes the adapter exactly the recorded paths, in plan order", async () => {
    const run = await freshRun();
    await recordAll(run);
    const { calls, adapter } = fakeAdapter();
    const result = await runCleanup(planCleanup(await loadLedger(run.runDir)), adapter);
    expect(calls).toEqual([
      ["stopVm", join(run.runDir, "qemu.pid")],
      ["unmount", join(run.runDir, "mnt")],
      ["detachLoops", join(run.runDir, "disk.img")],
      ["removeFile", join(run.runDir, "disk.img")],
    ]);
    expect(result).toEqual({ status: "clean", failed: [] });
  });

  it("an unlisted file in runDir is never passed to the adapter", async () => {
    const run = await freshRun();
    const image = { kind: "image", path: join(run.runDir, "disk.img") };
    await withRecorded(run, image, () => fs.writeFile(image.path, ""));
    await fs.writeFile(join(run.runDir, "stray.img"), "");
    const { calls, adapter } = fakeAdapter();
    await runCleanup(planCleanup(await loadLedger(run.runDir)), adapter);
    expect(calls).toEqual([["removeFile", image.path]]);
  });

  it("one failing step → later steps still run, status incomplete, failed names it", async () => {
    const run = await freshRun();
    await recordAll(run);
    const { calls, adapter } = fakeAdapter(new Set([join(run.runDir, "mnt")]));
    const result = await runCleanup(planCleanup(await loadLedger(run.runDir)), adapter);
    expect(calls.map(([name]) => name)).toEqual(["stopVm", "unmount", "detachLoops", "removeFile"]);
    expect(result).toEqual({
      status: "incomplete",
      failed: [{ action: "unmount", target: join(run.runDir, "mnt") }],
    });
  });

  it("all steps succeed → clean", async () => {
    const { adapter } = fakeAdapter();
    expect(await runCleanup([], adapter)).toEqual({ status: "clean", failed: [] });
    expect(await runCleanup([{ action: "remove-file", path: "/run/disk.img" }], adapter)).toEqual({
      status: "clean",
      failed: [],
    });
  });
});
