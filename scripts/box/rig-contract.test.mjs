import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import {
  RIG_CASES,
  createRun,
  loadLedger,
  parseRigArgs,
  planCleanup,
  runCleanup,
  withRecorded,
} from "./rig-contract.mjs";

const { events, hooks } = vi.hoisted(() => ({ events: [], hooks: {} }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal();
  const recorded =
    (name) =>
    async (path, ...rest) => {
      events.push([name, path, ...(name === "rename" ? [rest[0]] : [])]);
      return real[name](path, ...rest);
    };
  return {
    ...real,
    lstat: recorded("lstat"),
    rename: recorded("rename"),
    unlink: recorded("unlink"),
    async mkdir(path, options) {
      events.push(["mkdir", path]);
      const made = await real.mkdir(path, options);
      await hooks.afterMkdir?.(path);
      return made;
    },
    async writeFile(path, data, options) {
      events.push(["writeFile", path, options?.flag]);
      return real.writeFile(path, data, options);
    },
    async open(path, flags, mode) {
      events.push(["open", path, flags]);
      const handle = await real.open(path, flags, mode);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        events.push(["sync", path]);
        return sync();
      };
      return handle;
    },
  };
});

const roots = [];
afterEach(async () => {
  delete hooks.afterMkdir;
  for (const root of roots.splice(0)) {
    await fs.chmod(root, 0o700).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});
const only = (...names) => events.filter(([name]) => names.includes(name));
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
    ["/dev itself", ["--case", "layout", "--run-dir", "/dev"], "run-dir-unsafe"],
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
    ["", "run-dir-relative"],
    ["/tmp/x/../y", "run-dir-unsafe"],
    ["/", "run-dir-unsafe"],
    ["/dev", "run-dir-unsafe"],
    ["/dev/shm/run", "run-dir-unsafe"],
  ])("%s → %s before any file call", async (runDir, reason) => {
    events.length = 0;
    await expect(createRun(runDir)).rejects.toThrow(refused(reason));
    expect(events).toEqual([]);
  });

  it("createRun calls flush on the ledger, then on the folder (proves the calls, not that the disk kept them)", async () => {
    const runDir = join(await scratch(), "run");
    events.length = 0;
    await createRun(runDir);
    const ledger = join(runDir, "ledger.json");
    expect(only("mkdir", "writeFile", "sync")).toEqual([
      ["mkdir", runDir],
      ["writeFile", ledger, "wx"],
      ["sync", ledger],
      ["sync", runDir],
    ]);
  });

  it("a ledger.json planted between making the folder and writing it → refused, the planted link's target unchanged", async () => {
    const root = await scratch();
    const runDir = join(root, "run");
    const target = join(root, "outside.txt");
    await fs.writeFile(target, "kept");
    hooks.afterMkdir = (path) => fs.symlink(target, join(path, "ledger.json"));
    await expect(createRun(runDir)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(target, "utf8")).toBe("kept");
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
    expect(await loadLedger(run)).toEqual(resources);
  });

  it("two concurrent withRecorded calls → the ledger holds both resources", async () => {
    const run = await freshRun();
    const first = { kind: "image", path: join(run.runDir, "a.img") };
    const second = { kind: "image", path: join(run.runDir, "b.img") };
    await Promise.all([
      withRecorded(run, first, () => undefined),
      withRecorded(run, second, () => undefined),
    ]);
    expect(await loadLedger(run)).toEqual([first, second]);
  });

  it("a step may record its own sub-resources", async () => {
    const run = await freshRun();
    const image = { kind: "image", path: join(run.runDir, "disk.img") };
    const loop = { kind: "loop", image: image.path };
    await withRecorded(run, image, () => withRecorded(run, loop, () => undefined));
    expect(await loadLedger(run)).toEqual([image, loop]);
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
    expect(await loadLedger(run)).toEqual([image]);
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
    ["the ledger's staging file", (dir) => ({ kind: "image", path: `${dir}/ledger.json.next` })],
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

  it("withRecorded takes the staging file before reading the ledger, and calls flush on it before the rename and on the folder after (proves the calls, not that the disk kept them)", async () => {
    const run = await freshRun();
    const ledger = join(run.runDir, "ledger.json");
    const next = join(run.runDir, "ledger.json.next");
    events.length = 0;
    await withRecorded(run, { kind: "image", path: join(run.runDir, "disk.img") }, () => {});
    const noFollow = constants.O_RDONLY | constants.O_NOFOLLOW;
    expect(only("open", "sync", "rename")).toEqual([
      ["open", next, "wx"],
      ["open", ledger, noFollow],
      ["sync", next],
      ["rename", next, ledger],
      ["open", run.runDir, noFollow],
      ["sync", run.runDir],
    ]);
  });

  it("withRecorded replaces ledger.json with a new file rather than writing into the old one", async () => {
    const run = await freshRun();
    const ledger = join(run.runDir, "ledger.json");
    const before = await fs.open(ledger, "r");
    try {
      await withRecorded(run, { kind: "image", path: join(run.runDir, "disk.img") }, () => {});
      expect(await before.readFile("utf8")).toBe(ledgerText(run.runDir, []));
      expect((await fs.lstat(ledger)).ino).not.toBe((await before.stat()).ino);
    } finally {
      await before.close();
    }
  });

  it("a ledger that no longer reads back → refused, step never called, the staging file removed", async () => {
    const run = await freshRun();
    await fs.writeFile(join(run.runDir, "ledger.json"), "{\n");
    let called = false;
    await expect(
      withRecorded(run, { kind: "image", path: join(run.runDir, "disk.img") }, () => {
        called = true;
      }),
    ).rejects.toThrow(refused("ledger-invalid"));
    expect(called).toBe(false);
    expect(await fs.readdir(run.runDir)).toEqual(["ledger.json"]);
  });

  it("a run folder replaced by a symlink to a folder holding a planted ledger → run-dir-replaced, nothing written there", async () => {
    const run = await freshRun();
    const elsewhere = join(await scratch(), "elsewhere");
    await fs.mkdir(elsewhere);
    const planted = ledgerText(run.runDir, []);
    await fs.writeFile(join(elsewhere, "ledger.json"), planted);
    await fs.rm(run.runDir, { recursive: true });
    await fs.symlink(elsewhere, run.runDir);
    let called = false;
    await expect(
      withRecorded(run, { kind: "image", path: join(run.runDir, "disk.img") }, () => {
        called = true;
      }),
    ).rejects.toThrow(refused("run-dir-replaced"));
    expect(called).toBe(false);
    expect(await fs.readdir(elsewhere)).toEqual(["ledger.json"]);
    expect(await fs.readFile(join(elsewhere, "ledger.json"), "utf8")).toBe(planted);
  });

  it("a run folder replaced by another real folder → run-dir-replaced", async () => {
    const run = await freshRun();
    await fs.rm(run.runDir, { recursive: true });
    await createRun(run.runDir);
    await expect(
      withRecorded(run, { kind: "image", path: join(run.runDir, "disk.img") }, () => {}),
    ).rejects.toThrow(refused("run-dir-replaced"));
  });

  it("a run whose rootId is empty → run-dir-replaced", async () => {
    const run = await freshRun();
    await expect(
      withRecorded(
        { ...run, rootId: "" },
        { kind: "image", path: join(run.runDir, "a") },
        () => {},
      ),
    ).rejects.toThrow(refused("run-dir-replaced"));
  });

  it("a run folder that was removed → the file system's own error, step never called", async () => {
    const run = await freshRun();
    await fs.rm(run.runDir, { recursive: true });
    let called = false;
    await expect(
      withRecorded(run, { kind: "image", path: join(run.runDir, "a") }, () => {
        called = true;
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(called).toBe(false);
  });

  it.each([
    ["a parent that is a symlink to outside", ["link"], (dir) => join(dir, "link", "passwd")],
    ["a symlink as the path itself", ["link"], (dir) => join(dir, "link")],
    ["a symlink two folders down", ["sub", "sub/link"], (dir) => join(dir, "sub", "link", "x")],
  ])("%s → resource-through-symlink, step never called", async (_name, made, path) => {
    const run = await freshRun();
    const outside = await scratch();
    for (const part of made)
      if (part.endsWith("link")) await fs.symlink(outside, join(run.runDir, part));
      else await fs.mkdir(join(run.runDir, part));
    const before = await readLedgerText(run.runDir);
    let called = false;
    await expect(
      withRecorded(run, { kind: "image", path: path(run.runDir) }, () => {
        called = true;
      }),
    ).rejects.toThrow(refused("resource-through-symlink"));
    expect(called).toBe(false);
    expect(await readLedgerText(run.runDir)).toBe(before);
  });

  it("a parent that is a file → the file system's own error, step never called", async () => {
    const run = await freshRun();
    await fs.writeFile(join(run.runDir, "file"), "");
    let called = false;
    await expect(
      withRecorded(run, { kind: "image", path: join(run.runDir, "file", "x") }, () => {
        called = true;
      }),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
    expect(called).toBe(false);
  });

  it("existing real folders on the way are accepted", async () => {
    const run = await freshRun();
    await fs.mkdir(join(run.runDir, "vm"));
    await fs.writeFile(join(run.runDir, "vm", "qemu.pid"), "1");
    const vm = { kind: "vm", pidFile: join(run.runDir, "vm", "qemu.pid") };
    await withRecorded(run, vm, () => {});
    expect(await loadLedger(run)).toEqual([vm]);
  });

  it("two processes recording into one run folder → every resource whose step ran is in the ledger", async () => {
    const run = await freshRun();
    const children = [0, 1, 2].map((tag) => recordingChild(run, tag, 40));
    await Promise.all(children.map((child) => child.ready));
    for (const child of children) child.process.stdin.end("go\n");
    const results = await Promise.all(children.map((child) => child.done));
    const ran = results.flatMap((result) => result.ran);
    for (const result of results) expect(result.ran.length).toBeGreaterThan(0);
    const recorded = new Set((await loadLedger(run)).map((resource) => resource.path));
    expect(ran.filter((path) => !recorded.has(path))).toEqual([]);
    expect(recorded.size).toBe(ran.length);
  }, 60_000);

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

describe.each([
  ["withRecorded", (run) => withRecorded(run, { kind: "image", path: "/tmp/r/a" }, () => {})],
  ["loadLedger", (run) => loadLedger(run)],
  ["runCleanup", (run) => runCleanup(run, fakeAdapter().adapter)],
])("%s checks the run before any file call", (_name, call) => {
  it.each([
    ["an empty run folder", { runDir: "", rootId: "1:2" }, "run-dir-relative"],
    ["a relative run folder", { runDir: "tmp/r", rootId: "1:2" }, "run-dir-relative"],
    ["the root folder", { runDir: "/", rootId: "1:2" }, "run-dir-unsafe"],
    ["/dev", { runDir: "/dev", rootId: "1:2" }, "run-dir-unsafe"],
    ["a folder under /dev/", { runDir: "/dev/shm/run", rootId: "1:2" }, "run-dir-unsafe"],
    ["a folder not in normal form", { runDir: "/tmp/x/../r", rootId: "1:2" }, "run-dir-unsafe"],
    ["no run", undefined, "run-invalid"],
    ["a run folder that is not text", { runDir: 7, rootId: "1:2" }, "run-invalid"],
    ["a rootId that is not text", { runDir: "/tmp/r", rootId: 7 }, "run-invalid"],
    ["an extra key", { runDir: "/tmp/r", rootId: "1:2", extra: 1 }, "run-invalid"],
  ])("%s → refused", async (_case, run, reason) => {
    events.length = 0;
    await expect(call(run)).rejects.toThrow(refused(reason));
    expect(events).toEqual([]);
  });
});

describe("loadLedger", () => {
  it("a ledger.json that is a symlink to a well-formed ledger → refused without reading it", async () => {
    const run = await freshRun();
    const elsewhere = join(await scratch(), "ledger.json");
    await fs.writeFile(elsewhere, ledgerText(run.runDir, []));
    await fs.rm(join(run.runDir, "ledger.json"));
    await fs.symlink(elsewhere, join(run.runDir, "ledger.json"));
    await expect(loadLedger(run)).rejects.toMatchObject({ code: "ELOOP" });
  });

  it("a run folder replaced by a symlink to a folder holding a planted ledger → run-dir-replaced", async () => {
    const run = await freshRun();
    const elsewhere = join(await scratch(), "elsewhere");
    await fs.mkdir(elsewhere);
    await fs.writeFile(
      join(elsewhere, "ledger.json"),
      ledgerText(run.runDir, [{ kind: "image", path: join(run.runDir, "a") }]),
    );
    await fs.rm(run.runDir, { recursive: true });
    await fs.symlink(elsewhere, run.runDir);
    await expect(loadLedger(run)).rejects.toThrow(refused("run-dir-replaced"));
  });

  it.each([
    [
      "a ledger edited to name /etc/passwd",
      (dir) => ledgerText(dir, [{ kind: "image", path: "/etc/passwd" }]),
    ],
    ["a relative path", (dir) => ledgerText(dir, [{ kind: "image", path: "disk.img" }])],
    ["a path that is not text", (dir) => ledgerText(dir, [{ kind: "image", path: 7 }])],
    ["an unknown kind", (dir) => ledgerText(dir, [{ kind: "disk", path: `${dir}/a` }])],
    ["an inherited kind name", (dir) => ledgerText(dir, [{ kind: "toString", path: `${dir}/a` }])],
    [
      "the ledger's staging file",
      (dir) => ledgerText(dir, [{ kind: "image", path: `${dir}/ledger.json.next` }]),
    ],
    [
      "an extra resource key",
      (dir) => ledgerText(dir, [{ kind: "image", path: `${dir}/a`, note: "x" }]),
    ],
    ["another run's folder", (dir) => ledgerText(`${dir}-other`, [])],
    ["runDir missing", () => JSON.stringify({ version: 1, resources: [] }) + "\n"],
    [
      "version 1 as text",
      (dir) => JSON.stringify({ version: "1", runDir: dir, resources: [] }) + "\n",
    ],
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
    await expect(loadLedger(run)).rejects.toThrow(refused("ledger-invalid"));
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

  it.each([
    ["an inherited kind name", { kind: "toString", path: "/run/a" }],
    ["an unknown kind", { kind: "disk", path: "/run/a" }],
    ["the wrong key for its kind", { kind: "mount", path: "/run/a" }],
  ])("%s → resource-invalid", (_name, resource) => {
    expect(() => planCleanup([resource])).toThrow(refused("resource-invalid"));
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
    const result = await runCleanup(run, adapter);
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
    await runCleanup(run, adapter);
    expect(calls).toEqual([["removeFile", image.path]]);
  });

  it("one failing step → later steps still run, status incomplete, failed names it", async () => {
    const run = await freshRun();
    await recordAll(run);
    const { calls, adapter } = fakeAdapter(new Set([join(run.runDir, "mnt")]));
    const result = await runCleanup(run, adapter);
    expect(calls.map(([name]) => name)).toEqual(["stopVm", "unmount", "detachLoops", "removeFile"]);
    expect(result).toEqual({
      status: "incomplete",
      failed: [{ action: "unmount", target: join(run.runDir, "mnt") }],
    });
  });

  it("an empty ledger → clean, no adapter calls", async () => {
    const run = await freshRun();
    const { calls, adapter } = fakeAdapter();
    expect(await runCleanup(run, adapter)).toEqual({ status: "clean", failed: [] });
    expect(calls).toEqual([]);
  });

  it("a ledger edited to name /etc/passwd and / → ledger-invalid, no adapter calls", async () => {
    const run = await freshRun();
    await fs.writeFile(
      join(run.runDir, "ledger.json"),
      ledgerText(run.runDir, [
        { kind: "image", path: "/etc/passwd" },
        { kind: "mount", target: "/" },
      ]),
    );
    const { calls, adapter } = fakeAdapter();
    await expect(runCleanup(run, adapter)).rejects.toThrow(refused("ledger-invalid"));
    expect(calls).toEqual([]);
  });

  it("a run folder replaced by a symlink to a folder holding a planted ledger → run-dir-replaced, no adapter calls", async () => {
    const run = await freshRun();
    const elsewhere = join(await scratch(), "elsewhere");
    await fs.mkdir(elsewhere);
    await fs.writeFile(
      join(elsewhere, "ledger.json"),
      ledgerText(run.runDir, [{ kind: "image", path: join(run.runDir, "a") }]),
    );
    await fs.rm(run.runDir, { recursive: true });
    await fs.symlink(elsewhere, run.runDir);
    const { calls, adapter } = fakeAdapter();
    await expect(runCleanup(run, adapter)).rejects.toThrow(refused("run-dir-replaced"));
    expect(calls).toEqual([]);
  });

  it("a recorded path whose parent became a symlink to outside → that step fails unrun, the rest run", async () => {
    const run = await freshRun();
    const resources = await recordAll(run);
    const outside = await scratch();
    await fs.writeFile(join(outside, "qemu.pid"), "1");
    await fs.mkdir(join(run.runDir, "vmdir"));
    const vm = { kind: "vm", pidFile: join(run.runDir, "vmdir", "qemu.pid") };
    await withRecorded(run, vm, () => {});
    await fs.rmdir(join(run.runDir, "vmdir"));
    await fs.symlink(outside, join(run.runDir, "vmdir"));
    const { calls, adapter } = fakeAdapter();
    const result = await runCleanup(run, adapter);
    expect(calls.map(([, path]) => path)).toEqual(
      planCleanup(resources).map((step) => Object.values(step)[1]),
    );
    expect(result).toEqual({
      status: "incomplete",
      failed: [{ action: "stop-vm", pidFile: vm.pidFile }],
    });
  });

  it("a recorded path that became a symlink → that step fails unrun", async () => {
    const run = await freshRun();
    const mount = { kind: "mount", target: join(run.runDir, "mnt") };
    await withRecorded(run, mount, () => fs.symlink("/", mount.target));
    const { calls, adapter } = fakeAdapter();
    expect(await runCleanup(run, adapter)).toEqual({
      status: "incomplete",
      failed: [{ action: "unmount", target: mount.target }],
    });
    expect(calls).toEqual([]);
  });

  it("the run folder swapped during cleanup → every later step fails unrun", async () => {
    const run = await freshRun();
    await recordAll(run);
    const elsewhere = join(await scratch(), "elsewhere");
    await fs.mkdir(elsewhere);
    const { calls, adapter } = fakeAdapter();
    adapter.stopVm = async (path) => {
      calls.push(["stopVm", path]);
      await fs.rename(run.runDir, `${run.runDir}-moved`);
      await fs.symlink(elsewhere, run.runDir);
    };
    const result = await runCleanup(run, adapter);
    expect(calls).toEqual([["stopVm", join(run.runDir, "qemu.pid")]]);
    expect(result.status).toBe("incomplete");
    expect(result.failed.map((step) => step.action)).toEqual([
      "unmount",
      "detach-loops",
      "remove-file",
    ]);
  });
});

const CHILD = `
const [moduleUrl, runDir, rootId, tag, count] = process.argv.slice(1);
const { withRecorded } = await import(moduleUrl);
const run = { runDir, rootId };
const ran = [];
let busy = 0;
process.stdout.write("ready\\n");
await new Promise((resolve) => process.stdin.once("data", resolve));
for (let index = 0; index < Number(count); index += 1) {
  const path = runDir + "/" + tag + "-" + index + ".img";
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    try {
      await withRecorded(run, { kind: "image", path }, () => { ran.push(path); });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      busy += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
}
process.stdout.write(JSON.stringify({ ran, busy }) + "\\n");
`;

function recordingChild(run, tag, count) {
  const moduleUrl = new URL("./rig-contract.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", CHILD, moduleUrl, run.runDir, run.rootId, `p${tag}`, `${count}`],
    { stdio: ["pipe", "pipe", "inherit"], timeout: 45_000 },
  );
  let output = "";
  let markReady;
  const ready = new Promise((resolve) => (markReady = resolve));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.startsWith("ready\n")) markReady();
  });
  const done = new Promise((resolve, reject) =>
    child.on("close", (code) => {
      markReady();
      if (code !== 0) reject(new Error(`recording child ${tag} exited ${code}`));
      else resolve(JSON.parse(output.slice("ready\n".length)));
    }),
  );
  return { process: child, ready, done };
}
