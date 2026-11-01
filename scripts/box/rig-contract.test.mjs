import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { clearTimeout, setTimeout } from "node:timers";
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
  const failIfAsked = (name, path) => {
    const failure = hooks.fail?.(name, path);
    if (failure) throw failure;
  };
  const recorded =
    (name) =>
    async (path, ...rest) => {
      events.push([name, path, ...(name === "rename" ? [rest[0]] : [])]);
      failIfAsked(name, path);
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
      await hooks.beforeOpen?.(path, flags);
      failIfAsked("open", path);
      const handle = await real.open(path, flags, mode);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        events.push(["sync", path]);
        failIfAsked("sync", path);
        return sync();
      };
      return handle;
    },
  };
});

const roots = [];
afterEach(async () => {
  delete hooks.afterMkdir;
  delete hooks.beforeOpen;
  delete hooks.fail;
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
const mkfifo = (path) => execFileSync("mkfifo", ["-m", "600", path], { stdio: "ignore" });

/**
 * Settles `promise`, or, if it has not settled within `ms`, reports it hung and keeps opening the
 * FIFO for writing until it does: an open waiting for a writer never times out on its own, and it
 * would hold the test process open.
 */
async function settleOrRelease(promise, fifo, ms = 2000) {
  const outcome = promise.then(
    () => ({ fulfilled: true }),
    (error) => ({ error }),
  );
  let settled = false;
  void outcome.then(() => (settled = true));
  let timer;
  await Promise.race([outcome, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
  const hung = !settled;
  while (!settled) {
    await fs
      .open(fifo, constants.O_WRONLY | constants.O_NONBLOCK)
      .then((writer) => writer.close())
      .catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { hung, ...(await outcome) };
}

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
    expect(run).toEqual({
      runDir,
      rootId: `${stat.dev}:${stat.ino}`,
      runId: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(Number(stat.mode) & 0o777).toBe(0o700);
    expect(await fs.readFile(join(runDir, "ledger.json"), "utf8")).toBe(
      JSON.stringify({ version: 1, runDir, runId: run.runId, resources: [] }) + "\n",
    );
    expect((await fs.lstat(join(runDir, "ledger.json"))).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(runDir)).toEqual(["ledger.json"]);
  });

  it("two runs made at one path one after the other get different run ids", async () => {
    const runDir = join(await scratch(), "run");
    const first = await createRun(runDir);
    await fs.rm(runDir, { recursive: true });
    const second = await createRun(runDir);
    expect(second.runId).not.toBe(first.runId);
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

const ledgerText = (runDir, runId, resources) =>
  JSON.stringify({ version: 1, runDir, runId, resources }) + "\n";
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
      expect(await readLedgerText(run.runDir)).toBe(ledgerText(run.runDir, run.runId, [image]));
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
    expect(await readLedgerText(run.runDir)).toBe(ledgerText(run.runDir, run.runId, resources));
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

  it("the lock already taken (ledger.json.next present) → ledger-busy, step never called, ledger unchanged", async () => {
    const run = await freshRun();
    const before = await readLedgerText(run.runDir);
    await fs.mkdir(join(run.runDir, "ledger.json.next"));
    let called = false;
    const image = { kind: "image", path: join(run.runDir, "disk.img") };
    await expect(
      withRecorded(run, image, () => {
        called = true;
      }),
    ).rejects.toThrow(refused("ledger-busy"));
    expect(called).toBe(false);
    expect(await readLedgerText(run.runDir)).toBe(before);

    await fs.rmdir(join(run.runDir, "ledger.json.next"));
    await withRecorded(run, image, () => undefined);
    expect(await loadLedger(run)).toEqual([image]);
  });

  it("the staging file's flush fails → that error, step never called, ledger unchanged, no staging file left", async () => {
    const run = await freshRun();
    const before = await readLedgerText(run.runDir);
    const failure = Object.assign(new Error("EIO: sync"), { code: "EIO" });
    hooks.fail = (name, path) =>
      name === "sync" && path === join(run.runDir, "ledger.json.next") ? failure : undefined;
    let called = false;
    await expect(
      withRecorded(run, { kind: "image", path: join(run.runDir, "disk.img") }, () => {
        called = true;
      }),
    ).rejects.toBe(failure);
    expect(called).toBe(false);
    expect(await readLedgerText(run.runDir)).toBe(before);
    expect(await fs.readdir(run.runDir)).toEqual(["ledger.json"]);
  });

  it.each([
    ["the run folder's status", "lstat", (dir) => dir],
    ["a resource path's status", "lstat", (dir) => join(dir, "disk.img")],
    ["taking the staging file", "open", (dir) => join(dir, "ledger.json.next")],
    ["opening the ledger", "open", (dir) => join(dir, "ledger.json")],
    ["the final folder flush", "open", (dir) => dir],
  ])(
    "an unexpected error from %s → that same error, step never called",
    async (_name, call, at) => {
      const run = await freshRun();
      const failure = Object.assign(new Error("EACCES: test"), { code: "EACCES" });
      hooks.fail = (name, path) => (name === call && path === at(run.runDir) ? failure : undefined);
      let called = false;
      await expect(
        withRecorded(run, { kind: "image", path: join(run.runDir, "disk.img") }, () => {
          called = true;
        }),
      ).rejects.toBe(failure);
      expect(called).toBe(false);
    },
  );

  it("two concurrent calls through copies of one run record → the ledger holds both resources", async () => {
    const run = await freshRun();
    const first = { kind: "image", path: join(run.runDir, "a.img") };
    const second = { kind: "image", path: join(run.runDir, "b.img") };
    await Promise.all([
      withRecorded(run, first, () => undefined),
      withRecorded({ ...run }, second, () => undefined),
    ]);
    expect(await loadLedger(run)).toEqual([first, second]);
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
    ["the ledger in capitals", (dir) => ({ kind: "image", path: `${dir}/LEDGER.JSON` })],
    [
      "the ledger in capitals as a mount",
      (dir) => ({ kind: "mount", target: `${dir}/LEDGER.JSON` }),
    ],
    [
      "the staging file in mixed case",
      (dir) => ({ kind: "vm", pidFile: `${dir}/Ledger.Json.Next` }),
    ],
    [
      "a deeper part named like the ledger",
      (dir) => ({ kind: "image", path: `${dir}/a/Ledger.json` }),
    ],
  ])("%s → rig.refused resource-outside-run, before any file call", async (_name, make) => {
    const run = await freshRun();
    const before = await readLedgerText(run.runDir);
    let called = false;
    events.length = 0;
    await expect(
      withRecorded(run, make(run.runDir), () => {
        called = true;
      }),
    ).rejects.toThrow(refused("resource-outside-run"));
    expect(events).toEqual([]);
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
      ["open", ledger, noFollow | constants.O_NONBLOCK],
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
      expect(await before.readFile("utf8")).toBe(ledgerText(run.runDir, run.runId, []));
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
    const planted = ledgerText(run.runDir, run.runId, []);
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

  it("an older run's record over a newer run at the same path, with the folder id matching → run-dir-replaced, ledger unchanged", async () => {
    const runDir = join(await scratch(), "run");
    const stale = await createRun(runDir);
    await fs.rm(runDir, { recursive: true });
    const current = await createRun(runDir);
    const before = await readLedgerText(runDir);
    let called = false;
    await expect(
      withRecorded(
        { ...stale, rootId: current.rootId },
        { kind: "image", path: join(runDir, "a") },
        () => {
          called = true;
        },
      ),
    ).rejects.toThrow(refused("run-dir-replaced"));
    expect(called).toBe(false);
    expect(await readLedgerText(runDir)).toBe(before);
    expect(await fs.readdir(runDir)).toEqual(["ledger.json"]);
  });

  it("the run folder swapped for a symlink just before the lock is taken → run-dir-replaced at the final folder flush, step never called", async () => {
    const run = await freshRun();
    const elsewhere = join(await scratch(), "elsewhere");
    await fs.mkdir(elsewhere);
    await fs.copyFile(join(run.runDir, "ledger.json"), join(elsewhere, "ledger.json"));
    const image = { kind: "image", path: join(run.runDir, "disk.img") };
    hooks.beforeOpen = async (path) => {
      if (path !== join(run.runDir, "ledger.json.next")) return;
      delete hooks.beforeOpen;
      await fs.rename(run.runDir, `${run.runDir}-moved`);
      await fs.symlink(elsewhere, run.runDir);
    };
    let called = false;
    await expect(
      withRecorded(run, image, () => {
        called = true;
      }),
    ).rejects.toThrow(refused("run-dir-replaced"));
    expect(called).toBe(false);
    // The staging file and its rename went by path into the symlink's target.
    expect(await fs.readFile(join(elsewhere, "ledger.json"), "utf8")).toBe(
      ledgerText(run.runDir, run.runId, [image]),
    );
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

  it("a run folder that was removed → run-dir-replaced, step never called", async () => {
    const run = await freshRun();
    await fs.rm(run.runDir, { recursive: true });
    let called = false;
    await expect(
      withRecorded(run, { kind: "image", path: join(run.runDir, "a") }, () => {
        called = true;
      }),
    ).rejects.toThrow(refused("run-dir-replaced"));
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

  it("a parent that is a file → resource-through-symlink, step never called", async () => {
    const run = await freshRun();
    await fs.writeFile(join(run.runDir, "file"), "");
    let called = false;
    await expect(
      withRecorded(run, { kind: "image", path: join(run.runDir, "file", "x") }, () => {
        called = true;
      }),
    ).rejects.toThrow(refused("resource-through-symlink"));
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
    expect(results.reduce((sum, result) => sum + result.busy, 0)).toBeGreaterThan(0);
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
    ["an empty run folder", { runDir: "", rootId: "1:2", runId: "a" }, "run-dir-relative"],
    ["a relative run folder", { runDir: "tmp/r", rootId: "1:2", runId: "a" }, "run-dir-relative"],
    ["the root folder", { runDir: "/", rootId: "1:2", runId: "a" }, "run-dir-unsafe"],
    ["/dev", { runDir: "/dev", rootId: "1:2", runId: "a" }, "run-dir-unsafe"],
    [
      "a folder under /dev/",
      { runDir: "/dev/shm/run", rootId: "1:2", runId: "a" },
      "run-dir-unsafe",
    ],
    [
      "a folder not in normal form",
      { runDir: "/tmp/x/../r", rootId: "1:2", runId: "a" },
      "run-dir-unsafe",
    ],
    ["no run", undefined, "run-invalid"],
    ["a run folder that is not text", { runDir: 7, rootId: "1:2", runId: "a" }, "run-invalid"],
    ["a rootId that is not text", { runDir: "/tmp/r", rootId: 7, runId: "a" }, "run-invalid"],
    ["a runId that is not text", { runDir: "/tmp/r", rootId: "1:2", runId: 7 }, "run-invalid"],
    ["no runId", { runDir: "/tmp/r", rootId: "1:2" }, "run-invalid"],
    ["an extra key", { runDir: "/tmp/r", rootId: "1:2", runId: "a", extra: 1 }, "run-invalid"],
  ])("%s → refused", async (_case, run, reason) => {
    events.length = 0;
    await expect(call(run)).rejects.toThrow(refused(reason));
    expect(events).toEqual([]);
  });
});

describe("loadLedger", () => {
  it("a ledger.json that is a symlink to a well-formed ledger → ledger-invalid without reading it", async () => {
    const run = await freshRun();
    const elsewhere = join(await scratch(), "ledger.json");
    await fs.writeFile(elsewhere, ledgerText(run.runDir, run.runId, []));
    await fs.rm(join(run.runDir, "ledger.json"));
    await fs.symlink(elsewhere, join(run.runDir, "ledger.json"));
    await expect(loadLedger(run)).rejects.toThrow(refused("ledger-invalid"));
  });

  it("a ledger.json that is a FIFO → ledger-invalid, without waiting for a writer", async () => {
    const run = await freshRun();
    const ledger = join(run.runDir, "ledger.json");
    await fs.rm(ledger);
    mkfifo(ledger);
    const result = await settleOrRelease(loadLedger(run), ledger);
    expect(result).toEqual({ hung: false, error: refused("ledger-invalid") });
  });

  it("a ledger.json that is a folder → ledger-invalid", async () => {
    const run = await freshRun();
    await fs.rm(join(run.runDir, "ledger.json"));
    await fs.mkdir(join(run.runDir, "ledger.json"));
    await expect(loadLedger(run)).rejects.toThrow(refused("ledger-invalid"));
  });

  it("a missing ledger.json → ledger-invalid", async () => {
    const run = await freshRun();
    await fs.rm(join(run.runDir, "ledger.json"));
    await expect(loadLedger(run)).rejects.toThrow(refused("ledger-invalid"));
  });

  it("a run folder that was removed → run-dir-replaced", async () => {
    const run = await freshRun();
    await fs.rm(run.runDir, { recursive: true });
    await expect(loadLedger(run)).rejects.toThrow(refused("run-dir-replaced"));
  });

  it("a run folder replaced by a symlink to a folder holding a planted ledger → run-dir-replaced", async () => {
    const run = await freshRun();
    const elsewhere = join(await scratch(), "elsewhere");
    await fs.mkdir(elsewhere);
    await fs.writeFile(
      join(elsewhere, "ledger.json"),
      ledgerText(run.runDir, run.runId, [{ kind: "image", path: join(run.runDir, "a") }]),
    );
    await fs.rm(run.runDir, { recursive: true });
    await fs.symlink(elsewhere, run.runDir);
    await expect(loadLedger(run)).rejects.toThrow(refused("run-dir-replaced"));
  });

  it("an older run's record over a newer run at the same path, with the folder id matching → run-dir-replaced", async () => {
    const runDir = join(await scratch(), "run");
    const stale = await createRun(runDir);
    await fs.rm(runDir, { recursive: true });
    const current = await createRun(runDir);
    await expect(loadLedger({ ...stale, rootId: current.rootId })).rejects.toThrow(
      refused("run-dir-replaced"),
    );
  });

  it.each([
    [
      "a ledger edited to name /etc/passwd",
      (dir, id) => ledgerText(dir, id, [{ kind: "image", path: "/etc/passwd" }]),
    ],
    ["a relative path", (dir, id) => ledgerText(dir, id, [{ kind: "image", path: "disk.img" }])],
    ["a path that is not text", (dir, id) => ledgerText(dir, id, [{ kind: "image", path: 7 }])],
    ["an unknown kind", (dir, id) => ledgerText(dir, id, [{ kind: "disk", path: `${dir}/a` }])],
    [
      "an inherited kind name",
      (dir, id) => ledgerText(dir, id, [{ kind: "toString", path: `${dir}/a` }]),
    ],
    [
      "the ledger's staging file",
      (dir, id) => ledgerText(dir, id, [{ kind: "image", path: `${dir}/ledger.json.next` }]),
    ],
    [
      "the ledger in capitals",
      (dir, id) => ledgerText(dir, id, [{ kind: "image", path: `${dir}/LEDGER.JSON` }]),
    ],
    [
      "an extra resource key",
      (dir, id) => ledgerText(dir, id, [{ kind: "image", path: `${dir}/a`, note: "x" }]),
    ],
    ["another run's folder", (dir, id) => ledgerText(`${dir}-other`, id, [])],
    [
      "runDir missing",
      (_dir, id) => JSON.stringify({ version: 1, runId: id, resources: [] }) + "\n",
    ],
    ["runId missing", (dir) => JSON.stringify({ version: 1, runDir: dir, resources: [] }) + "\n"],
    ["a runId that is not text", (dir) => ledgerText(dir, 7, [])],
    [
      "version 1 as text",
      (dir, id) => JSON.stringify({ version: "1", runDir: dir, runId: id, resources: [] }) + "\n",
    ],
    [
      "version 2",
      (dir, id) => JSON.stringify({ version: 2, runDir: dir, runId: id, resources: [] }) + "\n",
    ],
    [
      "an extra top-level key",
      (dir, id) =>
        JSON.stringify({ version: 1, runDir: dir, runId: id, resources: [], extra: 1 }) + "\n",
    ],
    [
      "resources that are not a list",
      (dir, id) => JSON.stringify({ version: 1, runDir: dir, runId: id, resources: {} }) + "\n",
    ],
    ["null", () => "null\n"],
    ["bytes that are not JSON", () => "{\n"],
    ["no trailing newline", (dir, id) => ledgerText(dir, id, []).trimEnd()],
    [
      "pretty-printed bytes",
      (dir, id) =>
        JSON.stringify({ version: 1, runDir: dir, runId: id, resources: [] }, null, 2) + "\n",
    ],
    [
      "keys in another order",
      (dir, id) => JSON.stringify({ runId: id, runDir: dir, version: 1, resources: [] }) + "\n",
    ],
    [
      "resource keys in another order",
      (dir, id) =>
        JSON.stringify({
          version: 1,
          runDir: dir,
          runId: id,
          resources: [{ path: `${dir}/a`, kind: "image" }],
        }) + "\n",
    ],
  ])("refuses %s → ledger-invalid", async (_name, bytes) => {
    const run = await freshRun();
    await fs.writeFile(join(run.runDir, "ledger.json"), bytes(run.runDir, run.runId));
    await expect(loadLedger(run)).rejects.toThrow(refused("ledger-invalid"));
  });

  it("a ledger naming another run's id → run-dir-replaced", async () => {
    const run = await freshRun();
    await fs.writeFile(join(run.runDir, "ledger.json"), ledgerText(run.runDir, "0".repeat(32), []));
    await expect(loadLedger(run)).rejects.toThrow(refused("run-dir-replaced"));
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
      failed: [{ action: "unmount", target: join(run.runDir, "mnt"), reason: "adapter-failed" }],
    });
  });

  it("a staging file left beside the ledger → incomplete, named with ledger-busy and kept, every step still run", async () => {
    const run = await freshRun();
    await recordAll(run);
    const next = join(run.runDir, "ledger.json.next");
    await fs.writeFile(next, "partial");
    const { calls, adapter } = fakeAdapter();
    const result = await runCleanup(run, adapter);
    expect(calls).toHaveLength(4);
    expect(result).toEqual({
      status: "incomplete",
      failed: [{ action: "remove-file", path: next, reason: "ledger-busy" }],
    });
    expect(await fs.readFile(next, "utf8")).toBe("partial");
  });

  it("a staging file whose presence cannot be checked → reported like a left one", async () => {
    const run = await freshRun();
    const next = join(run.runDir, "ledger.json.next");
    const failure = Object.assign(new Error("EACCES: test"), { code: "EACCES" });
    hooks.fail = (name, path) => (name === "lstat" && path === next ? failure : undefined);
    expect(await runCleanup(run, fakeAdapter().adapter)).toEqual({
      status: "incomplete",
      failed: [{ action: "remove-file", path: next, reason: "ledger-busy" }],
    });
  });

  it("the ledger replaced by another run's during cleanup → every later step fails unrun with run-dir-replaced", async () => {
    const run = await freshRun();
    await recordAll(run);
    const { calls, adapter } = fakeAdapter();
    adapter.stopVm = async (path) => {
      calls.push(["stopVm", path]);
      const text = await readLedgerText(run.runDir);
      await fs.writeFile(join(run.runDir, "ledger.json"), text.replace(run.runId, "0".repeat(32)));
    };
    const result = await runCleanup(run, adapter);
    expect(calls).toEqual([["stopVm", join(run.runDir, "qemu.pid")]]);
    expect(result.status).toBe("incomplete");
    expect(result.failed.map((step) => [step.action, step.reason])).toEqual([
      ["unmount", "run-dir-replaced"],
      ["detach-loops", "run-dir-replaced"],
      ["remove-file", "run-dir-replaced"],
    ]);
  });

  it("a recorded image hard-linked to the ledger → resource-is-ledger, the ledger kept", async () => {
    const run = await freshRun();
    const image = { kind: "image", path: join(run.runDir, "disk.img") };
    await withRecorded(run, image, () => fs.link(join(run.runDir, "ledger.json"), image.path));
    const { calls, adapter } = fakeAdapter();
    adapter.removeFile = async (path) => {
      calls.push(["removeFile", path]);
      await fs.unlink(path);
    };
    expect(await runCleanup(run, adapter)).toEqual({
      status: "incomplete",
      failed: [{ action: "remove-file", path: image.path, reason: "resource-is-ledger" }],
    });
    expect(calls).toEqual([]);
    expect(await loadLedger(run)).toEqual([image]);
  });

  it("a recorded pid file hard-linked to a left staging file → resource-is-ledger, both kept", async () => {
    const run = await freshRun();
    const vm = { kind: "vm", pidFile: join(run.runDir, "qemu.pid") };
    await withRecorded(run, vm, () => {});
    const next = join(run.runDir, "ledger.json.next");
    await fs.writeFile(next, "partial");
    await fs.link(next, vm.pidFile);
    const { calls, adapter } = fakeAdapter();
    expect(await runCleanup(run, adapter)).toEqual({
      status: "incomplete",
      failed: [
        { action: "stop-vm", pidFile: vm.pidFile, reason: "resource-is-ledger" },
        { action: "remove-file", path: next, reason: "ledger-busy" },
      ],
    });
    expect(calls).toEqual([]);
    expect(await fs.readFile(next, "utf8")).toBe("partial");
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
      ledgerText(run.runDir, run.runId, [
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
      ledgerText(run.runDir, run.runId, [{ kind: "image", path: join(run.runDir, "a") }]),
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
      failed: [{ action: "stop-vm", pidFile: vm.pidFile, reason: "resource-through-symlink" }],
    });
  });

  it("a recorded path that became a symlink → that step fails unrun", async () => {
    const run = await freshRun();
    const mount = { kind: "mount", target: join(run.runDir, "mnt") };
    await withRecorded(run, mount, () => fs.symlink("/", mount.target));
    const { calls, adapter } = fakeAdapter();
    expect(await runCleanup(run, adapter)).toEqual({
      status: "incomplete",
      failed: [{ action: "unmount", target: mount.target, reason: "resource-through-symlink" }],
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
    expect(result.failed.map((step) => [step.action, step.reason])).toEqual([
      ["unmount", "run-dir-replaced"],
      ["detach-loops", "run-dir-replaced"],
      ["remove-file", "run-dir-replaced"],
    ]);
  });
});

const CHILD = `
const [moduleUrl, runDir, rootId, runId, tag, count] = process.argv.slice(1);
const { withRecorded } = await import(moduleUrl);
const run = { runDir, rootId, runId };
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
      if (error.reason !== "ledger-busy") throw error;
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
    [
      "--input-type=module",
      "-e",
      CHILD,
      moduleUrl,
      run.runDir,
      run.rootId,
      run.runId,
      `p${tag}`,
      `${count}`,
    ],
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
