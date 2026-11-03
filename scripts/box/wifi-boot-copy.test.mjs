import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { TextEncoder, inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWifiBootCopyPublisher,
  publishWifiBootCopy,
  wifiBootCopyStatus,
} from "./wifi-boot-copy.mjs";
import { createWifiRecordReader, decideWifiBootCopy } from "./wifi-record.mjs";

// The fixed entry points' default io is not injectable, so their file calls are seen through the
// module's own `node:fs/promises`; with no hook set, writeFile is the real one.
const fsCalls = vi.hoisted(() => ({ log: [] }));
const fsHooks = vi.hoisted(() => ({ writeFile: undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal();
  const logged =
    (name, run = real[name]) =>
    (...args) => (fsCalls.log.push([name, args[0]]), run(...args));
  return {
    ...real,
    lstat: logged("lstat"),
    open: logged("open"),
    mkdir: logged("mkdir"),
    writeFile: logged("writeFile", (...args) => (fsHooks.writeFile ?? real.writeFile)(...args)),
    rename: logged("rename"),
    unlink: logged("unlink"),
  };
});

const SSID = "4361666520436f726e6572"; // "Cafe Corner"
const PASSWORD_A = "Bar-Àngels-2026";
const PASSWORD_B = "Crème-brûlée-2027";

/** @param {Record<string, unknown>} [overrides] */
const wifi = (overrides = {}) => ({
  kind: "wifi",
  ssidHex: SSID,
  keyMgmt: "wpa-psk",
  psk: "correct horse",
  hidden: false,
  ...overrides,
});

const writeA = decideWifiBootCopy(wifi({ keyMgmt: "sae", psk: PASSWORD_A }));
const writeB = decideWifiBootCopy(wifi({ keyMgmt: "sae", psk: PASSWORD_B }));
const removeCable = decideWifiBootCopy({ kind: "cable-only" });
const RECORDS = { A: writeA.bytes, B: writeB.bytes };

const FIRST_STATUS = { state: "pending", reason: null, failure: null };
const DEPS_INVALID = expect.objectContaining({
  code: "wifi_copy.deps_invalid",
  reason: "deps-invalid",
});
const DECISION_INVALID = expect.objectContaining({
  code: "wifi_copy.decision_invalid",
  reason: "decision-invalid",
});

const syncPath = async (path, flags) => {
  const handle = await fs.open(path, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const REAL_IO = {
  lstat: fs.lstat,
  open: fs.open,
  mkdir: fs.mkdir,
  writeFile: fs.writeFile,
  rename: fs.rename,
  unlink: fs.unlink,
  syncFile: (path) => syncPath(path, constants.O_RDONLY),
  syncDirectory: (path) => syncPath(path, constants.O_RDONLY | constants.O_DIRECTORY),
};
const IO_OPS = Object.keys(REAL_IO);

/**
 * A real io that logs every call's name and path (both paths for a rename), never the written
 * bytes; `overrides` replace single operations.
 */
function countingIo(overrides = {}) {
  const log = [];
  const io = Object.fromEntries(
    IO_OPS.map((name) => [
      name,
      (...args) => {
        log.push(name === "rename" ? [name, args[0], args[1]] : [name, args[0]]);
        return (overrides[name] ?? REAL_IO[name])(...args);
      },
    ]),
  );
  return { io, log };
}

const rootIdOf = async (path) => {
  const stats = await fs.lstat(path, { bigint: true });
  return `${stats.dev}:${stats.ino}`;
};

const parents = [];
let outputSpies = [];
beforeEach(() => {
  outputSpies = [
    ...["log", "info", "warn", "error", "debug", "trace"].map((name) => vi.spyOn(console, name)),
    vi.spyOn(process.stdout, "write"),
    vi.spyOn(process.stderr, "write"),
  ];
});
afterEach(async () => {
  try {
    for (const spy of outputSpies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of outputSpies) spy.mockRestore();
    fsCalls.log.length = 0;
    fsHooks.writeFile = undefined;
    for (const parent of parents.splice(0)) await fs.rm(parent, { recursive: true, force: true });
  }
});

/** @param {"A"|"B"|string} record */
const contentOf = (record) => RECORDS[record] ?? record;

async function fixture({ folder: withFolder = true, record = null, next = null } = {}) {
  const parent = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "b3-wifi-copy-")));
  parents.push(parent);
  const bootRoot = join(parent, "boot");
  await fs.mkdir(bootRoot);
  await fs.chmod(bootRoot, 0o755);
  const folder = join(bootRoot, "waitron-recovery");
  const recordPath = join(folder, "wifi.json");
  const nextPath = join(folder, "wifi.json.next");
  const put = async (path, content) => {
    await fs.writeFile(path, content);
    await fs.chmod(path, 0o600);
  };
  if (withFolder) {
    await fs.mkdir(folder);
    await fs.chmod(folder, 0o700);
    await put(join(folder, "recovery.crt"), "not wifi");
    if (record !== null) await put(recordPath, contentOf(record));
    if (next !== null) await put(nextPath, contentOf(next));
  }
  const answer = { bootRoot, rootId: await rootIdOf(bootRoot) };
  const inspectBootMount = vi.fn(async () => ({ ...answer }));
  const counting = countingIo();
  const make = (deps = {}) =>
    createWifiBootCopyPublisher({
      bootRoot,
      ownerUid: process.getuid(),
      inspectBootMount,
      io: counting.io,
      ...deps,
    });
  const reader = () =>
    createWifiRecordReader({ bootRoot, ownerUid: process.getuid(), inspectBootMount });
  return {
    parent,
    bootRoot,
    folder,
    recordPath,
    nextPath,
    answer,
    inspectBootMount,
    counting,
    make,
    reader,
  };
}

/** Every name under `root`, read with lstat only: no link is followed and no FIFO opened. */
async function snapshot(root) {
  const entries = [];
  const walk = async (path) => {
    const stats = await fs.lstat(path);
    const kind = stats.isSymbolicLink()
      ? "link"
      : stats.isDirectory()
        ? "dir"
        : stats.isFile()
          ? "file"
          : "other";
    let content = "";
    if (kind === "link") content = await fs.readlink(path);
    if (kind === "file") content = (await fs.readFile(path)).toString("hex");
    entries.push([relative(root, path), kind, stats.mode & 0o7777, stats.nlink, content]);
    if (kind === "dir") for (const name of await fs.readdir(path)) await walk(join(path, name));
  };
  await walk(root);
  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A password as written, in lowercase and uppercase hex, and in base64. @param {string} password */
const passwordForms = (password) => {
  const bytes = Buffer.from(password, "utf8");
  return [
    password,
    bytes.toString("hex"),
    bytes.toString("hex").toUpperCase(),
    bytes.toString("base64"),
  ];
};

/** @param {readonly string[]} texts @param {readonly string[]} forms */
const expectNoForm = (texts, forms) => {
  for (const text of texts) for (const form of forms) expect(text).not.toContain(form);
};

/** @param {unknown} error */
const errorTexts = (error) => [
  String(error),
  JSON.stringify({ .../** @type {object} */ (error) }),
  inspect(error, { depth: 10, showHidden: true }),
];

const WRITE_OPS = ["mkdir", "writeFile", "rename", "unlink"];
const FLUSH_OPS = ["syncFile", "syncDirectory"];

const mkfifo = (path) => execFileSync("mkfifo", ["-m", "600", path], { stdio: "ignore" });

/**
 * Settles `promise`, or, if it has not settled within `ms`, reports it hung and keeps opening each
 * FIFO in `fifos` for writing until it does: an open waiting for a writer never times out on its
 * own, and it would hold the test process open.
 */
async function settleOrRelease(promise, fifos, ms = 2000) {
  const outcome = promise.then(
    (value) => ({ fulfilled: true, value }),
    (error) => ({ error }),
  );
  let settled = false;
  void outcome.then(() => (settled = true));
  let timer;
  await Promise.race([outcome, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
  const hung = !settled;
  while (!settled) {
    for (const fifo of fifos) {
      await fs
        .open(fifo, constants.O_WRONLY | constants.O_NONBLOCK)
        .then((writer) => writer.close())
        .catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { hung, ...(await outcome) };
}

/** Wraps `fs.open` so each handle answers the named methods through `handleOverrides`. */
const openWith =
  (handleOverrides) =>
  async (...args) => {
    const handle = await fs.open(...args);
    return new Proxy(handle, {
      get(target, key) {
        if (Object.hasOwn(handleOverrides, key)) return handleOverrides[key](target);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

/** Stats that answer `overrides` for the named keys, everything else unchanged. */
const statsWith = (stats, overrides) =>
  new Proxy(stats, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key](target[key]);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
const foreignOwner = (stats) =>
  statsWith(stats, { uid: (uid) => (typeof uid === "bigint" ? uid + 1n : uid + 1) });

const lstatAt = (path, change) => async (target, options) => {
  if (target !== path) return fs.lstat(target, options);
  return change(await fs.lstat(target, options));
};

/** Like lstatAt, but only the `nth` lstat of `path` (counting from 1) goes through `change`. */
const nthLstatAt = (path, nth, change) => {
  let seen = 0;
  return async (target, options) => {
    if (target !== path || ++seen !== nth) return fs.lstat(target, options);
    return change(await fs.lstat(target, options));
  };
};

/** An lstat that throws `value` for `path`, without looking at it first. */
const lstatThrowingAt = (path, value) => async (target, options) => {
  if (target === path) throw value;
  return fs.lstat(target, options);
};

const ioError = (code) => Object.assign(new Error(`${code}: ${PASSWORD_A}`), { code });

/** @param {unknown} status @param {unknown} expected */
function expectStatus(status, expected) {
  expect(status).toEqual(expected);
  expect(Object.isFrozen(status)).toBe(true);
  expect(Object.keys(/** @type {object} */ (status)).sort()).toEqual([
    "failure",
    "reason",
    "state",
  ]);
}

const thrown = (run) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

describe("createWifiBootCopyPublisher refuses deps that are not exactly right", () => {
  const ioWithout = (f, name) => {
    const io = { ...f.counting.io };
    delete io[name];
    return io;
  };
  /** @type {Array<[string, (f: any) => Record<string, unknown>]>} */
  const cases = [
    ["a relative bootRoot", () => ({ bootRoot: "boot" })],
    ["a bootRoot that is not its own resolve", () => ({ bootRoot: "/tmp/x/../y" })],
    ["ownerUid -1", () => ({ ownerUid: -1 })],
    ["ownerUid 1.5", () => ({ ownerUid: 1.5 })],
    ["an extra key", () => ({ extra: 1 })],
    ...IO_OPS.map((name) => [`io without ${name}`, (f) => ({ io: ioWithout(f, name) })]),
    ["io whose rename is a string", (f) => ({ io: { ...f.counting.io, rename: "x" } })],
    ["io: undefined", () => ({ io: undefined })],
  ];

  it.each(cases)("%s → wifi_copy.deps_invalid, nothing called", async (_name, change) => {
    const f = await fixture();
    const { io, log } = countingIo();
    const deps = {
      bootRoot: f.bootRoot,
      ownerUid: process.getuid(),
      inspectBootMount: f.inspectBootMount,
      io,
      ...change({ counting: { io } }),
    };
    expect(thrown(() => createWifiBootCopyPublisher(/** @type {any} */ (deps)))).toEqual(
      DEPS_INVALID,
    );
    expect(f.inspectBootMount).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it("a missing inspectBootMount → wifi_copy.deps_invalid", async () => {
    const f = await fixture();
    const deps = { bootRoot: f.bootRoot, ownerUid: process.getuid(), io: f.counting.io };
    expect(thrown(() => createWifiBootCopyPublisher(/** @type {any} */ (deps)))).toEqual(
      DEPS_INVALID,
    );
    expect(f.counting.log).toEqual([]);
  });

  it("ownerUid 0 and no io are accepted", () => {
    expect(() =>
      createWifiBootCopyPublisher({ bootRoot: "/boot", ownerUid: 0, inspectBootMount: vi.fn() }),
    ).not.toThrow();
  });
});

describe("a new publisher's status", () => {
  it("is pending, with no reason and no failure, frozen", async () => {
    const f = await fixture();
    expectStatus(f.make().status(), FIRST_STATUS);
    expect(f.inspectBootMount).not.toHaveBeenCalled();
    expect(f.counting.log).toEqual([]);
  });

  it("is pending, with the called decision's reason, while a publication is unfinished", async () => {
    const f = await fixture();
    let release = () => {};
    const held = new Promise((resolve) => (release = resolve));
    const publisher = f.make({ inspectBootMount: () => held.then(() => null) });
    const publication = publisher.publish(removeCable);
    expectStatus(publisher.status(), { state: "pending", reason: "cable-only", failure: null });
    release();
    const expected = { state: "failed", reason: "cable-only", failure: "mount-unverified" };
    expectStatus(await publication, expected);
    expectStatus(publisher.status(), expected);
  });
});

const canaryBytes = new TextEncoder().encode(
  JSON.stringify({ version: 1, ssidHex: SSID, keyMgmt: "wpa-psk", psk: "CANARY1", hidden: false }) +
    "\n",
);
const throwing = () => {
  throw new Error("bytes unreadable: " + PASSWORD_A);
};

describe("publish refuses a decision that is not exactly a write or a remove", () => {
  /** @type {Array<[string, () => unknown]>} */
  const cases = [
    ["null", () => null],
    ["a write with no bytes", () => ({ kind: "write" })],
    ["a write whose bytes are an array", () => ({ kind: "write", bytes: [1, 2] })],
    ["a write whose bytes are a string", () => ({ kind: "write", bytes: "x" })],
    ["a write with an extra key", () => ({ ...writeA, extra: 1 })],
    ["a write whose bytes the reader refuses", () => ({ kind: "write", bytes: canaryBytes })],
    ["a remove with no reason", () => ({ kind: "remove" })],
    ["a remove with an unknown reason", () => ({ kind: "remove", reason: "other" })],
    ["a remove with a null reason", () => ({ kind: "remove", reason: null })],
    ["an unknown kind", () => ({ kind: "erase", reason: "cable-only" })],
    [
      "a write whose bytes getter throws",
      () => ({
        kind: "write",
        get bytes() {
          return throwing();
        },
      }),
    ],
    [
      "a write whose kind getter throws",
      () => ({
        get kind() {
          return throwing();
        },
        bytes: writeA.bytes,
      }),
    ],
    [
      "a proxy whose keys throw when listed",
      () =>
        new Proxy(
          { ...writeA },
          {
            ownKeys() {
              throw new Error("keys unreadable: " + PASSWORD_A);
            },
          },
        ),
    ],
  ];

  it.each(cases)("%s → wifi_copy.decision_invalid, nothing called", async (_name, build) => {
    const f = await fixture({ record: "A" });
    const publisher = f.make();
    const error = await publisher.publish(/** @type {any} */ (build())).then(
      () => {
        throw new Error("expected a rejection");
      },
      (reason) => reason,
    );
    expect(error).toEqual(DECISION_INVALID);
    expect(f.inspectBootMount).not.toHaveBeenCalled();
    expect(f.counting.log).toEqual([]);
    expectStatus(publisher.status(), FIRST_STATUS);
    expectNoForm(errorTexts(error), [...passwordForms("CANARY1"), ...passwordForms(PASSWORD_A)]);
  });
});

describe("publish refuses an unverified boot mount with no file call", () => {
  /** @type {Array<[string, (f: any) => () => Promise<unknown>]>} */
  const mounts = [
    [
      "the check throws",
      () => async () => {
        throw new Error("mount unreadable: " + PASSWORD_A);
      },
    ],
    ["the check answers null", () => async () => null],
    ["the check answers another bootRoot", (f) => async () => ({ ...f.answer, bootRoot: "/x" })],
    ["the check answers rootId x", (f) => async () => ({ ...f.answer, rootId: "x" })],
  ];
  const decisions = [
    ["a write", writeA, null],
    ["a cable-only remove", removeCable, "cable-only"],
  ];

  for (const [decisionName, decision, reason] of decisions) {
    it.each(mounts)(`${decisionName}, %s → failed, mount-unverified`, async (_name, mount) => {
      const f = await fixture({ record: "A" });
      const publisher = f.make({ inspectBootMount: mount(f) });
      const expected = { state: "failed", reason, failure: "mount-unverified" };
      expectStatus(await publisher.publish(decision), expected);
      expectStatus(publisher.status(), expected);
      expect(f.counting.log).toEqual([]);
    });
  }
});

describe("publish refuses the boot root after one lstat", () => {
  /** @type {Array<[string, string, (f: any) => Promise<object>]>} */
  const cases = [
    [
      "the boot root removed",
      "mount-unverified",
      async (f) => {
        await fs.rm(f.bootRoot, { recursive: true });
        return {};
      },
    ],
    [
      "a rootId for another folder",
      "root-changed",
      async (f) => {
        const rootId = await rootIdOf(f.parent);
        return { inspectBootMount: async () => ({ ...f.answer, rootId }) };
      },
    ],
    [
      "the boot root group-writable",
      "permissions-unsafe",
      async (f) => {
        await fs.chmod(f.bootRoot, 0o775);
        return {};
      },
    ],
  ];

  it.each(cases)("%s → failed, %s, no write", async (_name, failure, arrange) => {
    const f = await fixture({ record: "A" });
    const publisher = f.make(await arrange(f));
    const before = await snapshot(f.parent);
    f.counting.log.length = 0;
    expectStatus(await publisher.publish(writeA), { state: "failed", reason: null, failure });
    expect(f.counting.log).toEqual([["lstat", f.bootRoot]]);
    expect(await snapshot(f.parent)).toEqual(before);
  });

  it("a clean fixture passes these checks (the positive control)", async () => {
    const f = await fixture();
    const status = await f.make().publish(writeA);
    expect(["mount-unverified", "root-changed", "permissions-unsafe"]).not.toContain(
      status.failure,
    );
  });
});

// Each row: [name, failure, arrange(f) → io overrides, options]. Options: `fixture` (fixture
// arguments, over record A), `fifos(f)` (paths to release if the publication hangs), `lastCall(f)`
// (the log's last entry), `after(f)` (more checks).
/** @type {Array<[string, string, (f: any) => Promise<object|void>, any?]>} */
const unsafeFolderAndRecordRows = [
  [
    "the folder is a symlink to a real folder holding a valid record",
    "path-unsafe",
    async (f) => {
      const real = join(f.parent, "elsewhere");
      await fs.rename(f.folder, real);
      await fs.symlink(real, f.folder);
    },
  ],
  [
    "the folder is a regular file",
    "path-unsafe",
    async (f) => {
      await fs.rm(f.folder, { recursive: true });
      await fs.writeFile(f.folder, "not a folder");
    },
  ],
  ["the folder is 0o750", "permissions-unsafe", (f) => fs.chmod(f.folder, 0o750)],
  [
    "the folder's owner reads as another",
    "permissions-unsafe",
    async (f) => ({ lstat: lstatAt(f.folder, foreignOwner) }),
  ],
  [
    "wifi.json is a symlink to a valid record elsewhere",
    "path-unsafe",
    async (f) => {
      const real = join(f.parent, "elsewhere.json");
      await fs.rename(f.recordPath, real);
      await fs.symlink(real, f.recordPath);
    },
  ],
  [
    "wifi.json is a symlink to nothing",
    "path-unsafe",
    async (f) => {
      await fs.rm(f.recordPath);
      await fs.symlink(join(f.parent, "nothing.json"), f.recordPath);
    },
  ],
  [
    "wifi.json is a folder",
    "path-unsafe",
    async (f) => {
      await fs.rm(f.recordPath);
      await fs.mkdir(f.recordPath, { mode: 0o700 });
    },
  ],
  [
    "wifi.json is a FIFO",
    "path-unsafe",
    async (f) => {
      await fs.rm(f.recordPath);
      mkfifo(f.recordPath);
    },
    { fifos: (f) => [f.recordPath] },
  ],
  [
    "wifi.json has a second hard link",
    "path-unsafe",
    (f) => fs.link(f.recordPath, join(f.folder, "wifi.json.other")),
  ],
  ["wifi.json is 0o640", "permissions-unsafe", (f) => fs.chmod(f.recordPath, 0o640)],
  [
    "wifi.json's owner reads as another",
    "permissions-unsafe",
    async () => ({
      open: openWith({
        stat: (target) => async (options) => foreignOwner(await target.stat(options)),
      }),
    }),
  ],
];

/** The `.next` rows, on a fixture whose wifi.json is `record`. @param {"A"|null} record */
const unsafeNextRows = (record) => {
  const fixtureArgs = { record };
  /** @type {Array<[string, string, (f: any) => Promise<object|void>, any?]>} */
  const rows = [
    [
      "wifi.json.next is a symlink to a regular file",
      "path-unsafe",
      async (f) => {
        const target = join(f.parent, "target");
        await fs.writeFile(target, "target bytes");
        await fs.symlink(target, f.nextPath);
      },
      {
        after: async (f) =>
          expect(await fs.readFile(join(f.parent, "target"), "utf8")).toBe("target bytes"),
      },
    ],
    [
      "wifi.json.next is a symlink to nothing",
      "path-unsafe",
      (f) => fs.symlink(join(f.parent, "nothing"), f.nextPath),
      {
        after: async (f) =>
          await expect(fs.lstat(join(f.parent, "nothing"))).rejects.toMatchObject({
            code: "ENOENT",
          }),
      },
    ],
    ["wifi.json.next is a folder", "path-unsafe", (f) => fs.mkdir(f.nextPath, { mode: 0o700 })],
    [
      "wifi.json.next is a FIFO",
      "path-unsafe",
      async (f) => mkfifo(f.nextPath),
      { fifos: (f) => [f.nextPath] },
    ],
    [
      "wifi.json.next has a second hard link",
      "path-unsafe",
      async (f) => {
        await fs.writeFile(f.nextPath, writeA.bytes);
        await fs.chmod(f.nextPath, 0o600);
        await fs.link(f.nextPath, join(f.folder, "wifi.json.next.other"));
      },
    ],
    [
      "wifi.json.next is 0o640",
      "permissions-unsafe",
      async (f) => {
        await fs.writeFile(f.nextPath, writeA.bytes);
        await fs.chmod(f.nextPath, 0o640);
      },
    ],
    [
      "wifi.json.next's owner reads as another",
      "permissions-unsafe",
      async (f) => {
        await fs.writeFile(f.nextPath, writeA.bytes);
        await fs.chmod(f.nextPath, 0o600);
        return { lstat: lstatAt(f.nextPath, foreignOwner) };
      },
    ],
  ];
  return rows.map(([name, failure, arrange, options = {}]) => [
    record === null ? `${name}, with no wifi.json` : name,
    failure,
    arrange,
    { ...options, fixture: fixtureArgs },
  ]);
};

/** @type {Array<[string, string, (f: any) => Promise<object|void>, any?]>} */
const ioFailedRows = [
  [
    "the reader's open of wifi.json throws EACCES",
    "io-failed",
    async (f) => ({
      open: async (path, ...rest) => {
        if (path === f.recordPath) throw ioError("EACCES");
        return fs.open(path, ...rest);
      },
    }),
    { lastCall: (f) => ["open", f.recordPath] },
  ],
  [
    "the publisher's own lstat of the folder throws EIO",
    "io-failed",
    async (f) => ({
      lstat: nthLstatAt(f.folder, 2, () => {
        throw ioError("EIO");
      }),
    }),
    { lastCall: (f) => ["lstat", f.folder] },
  ],
  [
    "the lstat of wifi.json.next throws EIO",
    "io-failed",
    async (f) => ({
      lstat: lstatThrowingAt(f.nextPath, ioError("EIO")),
    }),
    { lastCall: (f) => ["lstat", f.nextPath] },
  ],
  [
    "the lstat of wifi.json.next throws an object shaped like a refusal",
    "io-failed",
    async (f) => ({
      lstat: lstatThrowingAt(f.nextPath, { state: "failed", failure: "path-unsafe" }),
    }),
    { lastCall: (f) => ["lstat", f.nextPath] },
  ],
  [
    "the lstat of wifi.json.next throws a plain string",
    "io-failed",
    async (f) => ({
      lstat: lstatThrowingAt(f.nextPath, `EIO: ${PASSWORD_A}`),
    }),
    { lastCall: (f) => ["lstat", f.nextPath] },
  ],
];

/** @type {Array<[string, string, (f: any) => Promise<object|void>, any?]>} */
const changedFolderRows = [
  [
    "the folder's owner reads as another at the publisher's own lstat",
    "permissions-unsafe",
    async (f) => ({ lstat: nthLstatAt(f.folder, 2, foreignOwner) }),
  ],
  [
    "the folder reads as a symlink at the publisher's own lstat",
    "path-unsafe",
    async (f) => ({
      lstat: nthLstatAt(f.folder, 2, (stats) =>
        statsWith(stats, { isSymbolicLink: () => () => true }),
      ),
    }),
  ],
];

describe("publish refuses an unsafe folder or fixed name with no write", () => {
  const rows = [
    ...unsafeFolderAndRecordRows,
    ...unsafeNextRows("A"),
    ...unsafeNextRows(null),
    ...ioFailedRows,
    ...changedFolderRows,
  ];
  const decisions = [
    ["writeB", writeB, null],
    ["removeCable", removeCable, "cable-only"],
  ];

  for (const [decisionName, decision, reason] of decisions) {
    it.each(rows)(
      `${decisionName}: %s → failed, %s`,
      async (_name, failure, arrange, options = {}) => {
        const f = await fixture({ record: "A", ...options.fixture });
        const counting = countingIo((await arrange(f)) ?? {});
        const publisher = f.make({ io: counting.io });
        const before = await snapshot(f.parent);
        const outcome = await settleOrRelease(
          publisher.publish(decision),
          options.fifos?.(f) ?? [],
        );
        expect(outcome.hung).toBe(false);
        expectStatus(outcome.value, { state: "failed", reason, failure });
        const names = counting.log.map(([name]) => name);
        for (const name of [...WRITE_OPS, ...FLUSH_OPS]) expect(names).not.toContain(name);
        expect(await snapshot(f.parent)).toEqual(before);
        if (options.lastCall) expect(counting.log.at(-1)).toEqual(options.lastCall(f));
        await options.after?.(f);
      },
    );
  }
});

describe("publish does not refuse a safe leftover or a damaged copy (the positive controls)", () => {
  const cases = [
    ["a regular 0o600 leftover wifi.json.next", { record: "A", next: "B" }],
    ["a wifi.json holding a corrupt record", { record: "{}\n" }],
    ["a wifi.json of 1025 bytes", { record: "x".repeat(1025) }],
    ["no waitron-recovery folder", { folder: false }],
  ];
  for (const decision of [writeB, removeCable]) {
    it.each(cases)(`${decision.kind}: %s`, async (_name, fixtureArgs) => {
      const f = await fixture(fixtureArgs);
      const status = await f.make().publish(decision);
      expect(["path-unsafe", "permissions-unsafe"]).not.toContain(status.failure);
    });
  }
});

describe("the fixed entry points", () => {
  it("refuse a valid decision as mount-unverified with no file call, and an invalid one", async () => {
    fsCalls.log.length = 0;
    const expected = { state: "failed", reason: null, failure: "mount-unverified" };
    expectStatus(await publishWifiBootCopy(writeA), expected);
    expectStatus(wifiBootCopyStatus(), expected);
    expect(fsCalls.log).toEqual([]);
    await expect(publishWifiBootCopy(/** @type {any} */ ({ kind: "write" }))).rejects.toEqual(
      DECISION_INVALID,
    );
    expect(fsCalls.log).toEqual([]);
  });
});
