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
  WIFI_COPY_FAILURES,
  WIFI_COPY_STATES,
  createWifiBootCopyPublisher,
  publishWifiBootCopy,
  wifiBootCopyStatus,
} from "./wifi-boot-copy.mjs";
import {
  WIFI_NO_COPY_REASONS,
  createWifiRecordReader,
  decideWifiBootCopy,
  formatWifiRecord,
} from "./wifi-record.mjs";

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
const removeOpen = decideWifiBootCopy(wifi({ keyMgmt: null, psk: null }));
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

/** Every status a case passed to expectStatus, as the publisher answered it. */
const observedStatuses = [];

/** @param {unknown} status @param {unknown} expected */
function expectStatus(status, expected) {
  observedStatuses.push(status);
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

describe("the copy's states and failures", () => {
  it("lists the four states and the six failures, frozen", () => {
    expect(WIFI_COPY_STATES).toEqual(["pending", "current", "absent", "failed"]);
    expect(WIFI_COPY_FAILURES).toEqual([
      "mount-unverified",
      "root-changed",
      "path-unsafe",
      "permissions-unsafe",
      "io-failed",
      "publication-unverified",
    ]);
    expect(Object.isFrozen(WIFI_COPY_STATES)).toBe(true);
    expect(Object.isFrozen(WIFI_COPY_FAILURES)).toBe(true);
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

/** @type {Array<[string, () => unknown]>} */
const invalidDecisions = [
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

describe("publish refuses a decision that is not exactly a write or a remove", () => {
  it.each(invalidDecisions)(
    "%s → wifi_copy.decision_invalid, nothing called",
    async (_name, build) => {
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
    },
  );
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

describe("publish writes a copy through wifi.json.next and reads it back", () => {
  const path = (f, name) => join(f.folder, name);
  const readerCalls = (f) => [
    ["lstat", f.bootRoot],
    ["lstat", f.folder],
    ["open", f.recordPath],
  ];
  const writeTail = (f) => [
    ["writeFile", f.nextPath],
    ["syncFile", f.nextPath],
    ["rename", f.nextPath, f.recordPath],
    ["syncDirectory", f.folder],
    ...readerCalls(f),
  ];
  const CURRENT = { state: "current", reason: null, failure: null };
  const expectLoaded = async (f, settings) => {
    const decision = decideWifiBootCopy(settings);
    const found = await f.reader().read();
    expect(found.kind).toBe("loaded");
    expect(formatWifiRecord(found.network)).toEqual(decision.bytes);
  };
  const expectHolds = async (f, bytes) => {
    const stats = await fs.lstat(f.recordPath);
    expect(stats.isFile()).toBe(true);
    expect(stats.mode & 0o7777).toBe(0o600);
    expect(stats.nlink).toBe(1);
    expect(new Uint8Array(await fs.readFile(f.recordPath))).toEqual(bytes);
    await expect(fs.lstat(f.nextPath)).rejects.toMatchObject({ code: "ENOENT" });
  };

  it("a new folder: made 0o700, flushed, written, renamed, flushed, read back", async () => {
    const f = await fixture({ folder: false });
    expectStatus(await f.make().publish(writeB), CURRENT);
    expect(f.counting.log).toEqual([
      ["lstat", f.bootRoot],
      ["lstat", f.folder],
      ["lstat", f.folder],
      ["mkdir", f.folder],
      ["lstat", f.folder],
      ["syncDirectory", f.bootRoot],
      ...writeTail(f),
    ]);
    expect((await fs.lstat(f.folder)).mode & 0o7777).toBe(0o700);
    await expectHolds(f, writeB.bytes);
    await expectLoaded(f, wifi({ keyMgmt: "sae", psk: PASSWORD_B }));
  });

  it("a clean folder with no wifi.json → current", async () => {
    const f = await fixture();
    expectStatus(await f.make().publish(writeA), CURRENT);
    await expectHolds(f, writeA.bytes);
  });

  it("replacing A with B: the other recovery file is untouched", async () => {
    const f = await fixture({ record: "A" });
    const crt = path(f, "recovery.crt");
    const crtBefore = await fs.readFile(crt);
    expectStatus(await f.make().publish(writeB), CURRENT);
    expect(f.counting.log).toEqual([
      ...readerCalls(f),
      ["lstat", f.folder],
      ["lstat", f.nextPath],
      ["syncDirectory", f.bootRoot],
      ...writeTail(f),
    ]);
    await expectHolds(f, writeB.bytes);
    expect(await fs.readFile(crt)).toEqual(crtBefore);
    expect((await fs.lstat(crt)).mode & 0o7777).toBe(0o600);
  });

  it("a leftover wifi.json.next is removed after the boot flush and before the write", async () => {
    const f = await fixture({
      record: "A",
      next: Buffer.from(writeA.bytes).subarray(0, writeA.bytes.length >> 1),
    });
    expectStatus(await f.make().publish(writeB), CURRENT);
    expect(f.counting.log).toEqual([
      ...readerCalls(f),
      ["lstat", f.folder],
      ["lstat", f.nextPath],
      ["syncDirectory", f.bootRoot],
      ["unlink", f.nextPath],
      ...writeTail(f),
    ]);
    await expectHolds(f, writeB.bytes);
  });

  it.each([
    ["{}\\n", "{}\n"],
    ["1025 bytes of a", "a".repeat(1025)],
  ])("a damaged copy (%s) is replaced by B", async (_name, record) => {
    const f = await fixture({ record });
    expectStatus(await f.make().publish(writeB), CURRENT);
    await expectHolds(f, writeB.bytes);
  });

  it("already right: nothing is written, only the two folders are flushed", async () => {
    const f = await fixture({ record: "B" });
    const before = await fs.lstat(f.recordPath);
    expectStatus(await f.make().publish(writeB), CURRENT);
    expect(f.counting.log).toEqual([
      ...readerCalls(f),
      ["lstat", f.folder],
      ["lstat", f.nextPath],
      ["syncDirectory", f.bootRoot],
      ["syncDirectory", f.folder],
    ]);
    const names = f.counting.log.map(([name]) => name);
    for (const name of [...WRITE_OPS, "syncFile"]) expect(names).not.toContain(name);
    const after = await fs.lstat(f.recordPath);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await expectHolds(f, writeB.bytes);
  });

  it("already right with a leftover wifi.json.next: the full write runs", async () => {
    const f = await fixture({ record: "B", next: "A" });
    expectStatus(await f.make().publish(writeB), CURRENT);
    const names = f.counting.log.map(([name]) => name);
    expect(names).toContain("unlink");
    expect(names).toContain("writeFile");
    expect(names).toContain("rename");
    await expectHolds(f, writeB.bytes);
  });

  it.each([
    ["a WPA2 network", wifi()],
    [
      "a hidden WPA3 network with a non-ASCII password",
      wifi({ keyMgmt: "sae", psk: "Crème brûlée Àngels", hidden: true }),
    ],
    ["a 64-hex-digit WPA2 password", wifi({ psk: "0123456789abcdef".repeat(4) })],
  ])("the written file is what the reader loads: %s", async (_name, settings) => {
    const f = await fixture({ record: "A" });
    expectStatus(await f.make().publish(decideWifiBootCopy(settings)), CURRENT);
    await expectLoaded(f, settings);
  });

  it("a folder this publication made that comes out group-readable → permissions-unsafe", async () => {
    const f = await fixture({ folder: false });
    const counting = countingIo({
      mkdir: async (target) => {
        await fs.mkdir(target);
        await fs.chmod(target, 0o755);
      },
    });
    const status = await f.make({ io: counting.io }).publish(writeB);
    expectStatus(status, { state: "failed", reason: null, failure: "permissions-unsafe" });
    expect(counting.log.map(([name]) => name)).not.toContain("writeFile");
    expect((await fs.lstat(f.folder)).isDirectory()).toBe(true);
  });

  it("a read-back that loads a different record → publication-unverified", async () => {
    const f = await fixture({ record: "A" });
    const elsewhere = path(f, "elsewhere.json");
    await fs.writeFile(elsewhere, writeA.bytes);
    await fs.chmod(elsewhere, 0o600);
    let opens = 0;
    const counting = countingIo({
      open: (target, ...rest) =>
        fs.open(target === f.recordPath && ++opens === 2 ? elsewhere : target, ...rest),
    });
    const status = await f.make({ io: counting.io }).publish(writeB);
    expectStatus(status, { state: "failed", reason: null, failure: "publication-unverified" });
    expect(
      counting.log.filter(([name, at]) => name === "open" && at === f.recordPath),
    ).toHaveLength(2);
  });
});

describe("publish removes wifi.json and wifi.json.next on every no-copy answer", () => {
  const readerCalls = (f) => [
    ["lstat", f.bootRoot],
    ["lstat", f.folder],
    ["open", f.recordPath],
  ];
  const checks = (f) => [...readerCalls(f), ["lstat", f.folder], ["lstat", f.nextPath]];
  const verification = (f) => [...readerCalls(f), ["lstat", f.nextPath]];
  const absent = (reason) => ({ state: "absent", reason, failure: null });
  const expectGone = async (path) =>
    expect(fs.lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  const names = (log) => log.map(([name]) => name);

  it("cable-only over A: unlinked, the folder flushed, then checked absent", async () => {
    const f = await fixture({ record: "A" });
    const crt = join(f.folder, "recovery.crt");
    const crtBefore = await fs.readFile(crt);
    expectStatus(await f.make().publish(removeCable), absent("cable-only"));
    expect(f.counting.log).toEqual([
      ...checks(f),
      ["unlink", f.recordPath],
      ["syncDirectory", f.folder],
      ...verification(f),
    ]);
    await expectGone(f.recordPath);
    await expectGone(f.nextPath);
    expect((await fs.lstat(f.folder)).isDirectory()).toBe(true);
    expect((await fs.lstat(f.folder)).mode & 0o7777).toBe(0o700);
    expect(await fs.readFile(crt)).toEqual(crtBefore);
    expect((await fs.lstat(crt)).mode & 0o7777).toBe(0o600);
    expect((await f.reader().read()).kind).toBe("absent");
  });

  it.each(WIFI_NO_COPY_REASONS.map((reason) => [reason]))(
    "a remove for %s removes the copy",
    async (reason) => {
      const f = await fixture({ record: "A" });
      expectStatus(await f.make().publish({ kind: "remove", reason }), absent(reason));
      await expectGone(f.recordPath);
    },
  );

  it("A with a leftover wifi.json.next: wifi.json first, then the leftover, then the flush", async () => {
    const f = await fixture({ record: "A", next: "B" });
    expectStatus(await f.make().publish(removeCable), absent("cable-only"));
    expect(f.counting.log).toEqual([
      ...checks(f),
      ["unlink", f.recordPath],
      ["unlink", f.nextPath],
      ["syncDirectory", f.folder],
      ...verification(f),
    ]);
    await expectGone(f.recordPath);
    await expectGone(f.nextPath);
  });

  it("only a leftover wifi.json.next: it is removed, then the folder flushed", async () => {
    const f = await fixture({ next: "A" });
    expectStatus(await f.make().publish(removeCable), absent("cable-only"));
    expect(f.counting.log).toEqual([
      ...checks(f),
      ["unlink", f.nextPath],
      ["syncDirectory", f.folder],
      ...verification(f),
    ]);
    await expectGone(f.nextPath);
  });

  it("a damaged copy is removed", async () => {
    const f = await fixture({ record: "{}\n" });
    expectStatus(await f.make().publish(removeCable), absent("cable-only"));
    await expectGone(f.recordPath);
  });

  it("nothing there, the folder present: no write, the folder flushed once", async () => {
    const f = await fixture();
    expectStatus(await f.make().publish(removeCable), absent("cable-only"));
    for (const name of WRITE_OPS) expect(names(f.counting.log)).not.toContain(name);
    expect(f.counting.log.filter(([name]) => name === "syncDirectory")).toEqual([
      ["syncDirectory", f.folder],
    ]);
  });

  it("no folder: no write and no flush, and the folder is never made", async () => {
    const f = await fixture({ folder: false });
    expectStatus(await f.make().publish(removeCable), absent("cable-only"));
    for (const name of [...WRITE_OPS, ...FLUSH_OPS]) {
      expect(names(f.counting.log)).not.toContain(name);
    }
    await expectGone(f.folder);
  });

  it.each([
    ["wifi.json", { record: "A" }, (f) => f.recordPath],
    ["wifi.json.next", { next: "A" }, (f) => f.nextPath],
  ])(
    "an unlink of %s that reports success but leaves it → publication-unverified",
    async (_name, fixtureArgs, target) => {
      const f = await fixture(fixtureArgs);
      const counting = countingIo({
        unlink: async (path) => (path === target(f) ? undefined : fs.unlink(path)),
      });
      const status = await f.make({ io: counting.io }).publish(removeCable);
      expectStatus(status, {
        state: "failed",
        reason: "cable-only",
        failure: "publication-unverified",
      });
      expect(counting.log).toContainEqual(["unlink", target(f)]);
      expect((await fs.lstat(target(f))).isFile()).toBe(true);
    },
  );

  it("remove, then write, on one publisher: absent, then current with B", async () => {
    const f = await fixture({ record: "A" });
    const publisher = f.make();
    expectStatus(await publisher.publish(removeCable), absent("cable-only"));
    await expectGone(f.recordPath);
    expectStatus(await publisher.publish(writeB), {
      state: "current",
      reason: null,
      failure: null,
    });
    expect(new Uint8Array(await fs.readFile(f.recordPath))).toEqual(writeB.bytes);
  });
});

const INJECTED = `EIO: ${PASSWORD_A} → ${PASSWORD_B}`;

/**
 * An override for operation `name` that throws an EIO error holding both passwords on its `nth`
 * call (counting only calls for `path`, when given) and calls the real operation otherwise.
 */
const failAt = (name, nth = 1, message = INJECTED, path = undefined) => {
  let seen = 0;
  return async (...args) => {
    if ((path === undefined || args[0] === path) && ++seen === nth) {
      throw Object.assign(new Error(message), { code: "EIO" });
    }
    return REAL_IO[name](...args);
  };
};

const leftoverHalfA = Buffer.from(writeA.bytes).subarray(0, writeA.bytes.length >> 1);
const readerCallsOf = (f) => [
  ["lstat", f.bootRoot],
  ["lstat", f.folder],
  ["open", f.recordPath],
];
const IO_FAILED_WRITE = { state: "failed", reason: null, failure: "io-failed" };
const IO_FAILED_CABLE = { state: "failed", reason: "cable-only", failure: "io-failed" };

/** Runs `decision` over a fixture with `overrides(f)` replacing operations. */
async function runWith(fixtureArgs, decision, overrides) {
  const f = await fixture(fixtureArgs);
  const counting = countingIo(overrides(f));
  const status = await f.make({ io: counting.io }).publish(decision);
  return { f, log: counting.log, status };
}

const expectBytes = async (path, bytes) =>
  expect(new Uint8Array(await fs.readFile(path))).toEqual(new Uint8Array(bytes));
const expectMissing = async (path) =>
  expect(fs.lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
const expectReaderLoads = async (f, bytes) => {
  const found = await f.reader().read();
  expect(found.kind).toBe("loaded");
  expect(formatWifiRecord(found.network)).toEqual(bytes);
};

// [label, operation, nth, index of the failing call in the full log, wifi.json, wifi.json.next, reader]
/** @type {Array<[string, string, number, number, "A"|"B", "leftover"|"none"|"B", "A"|"B"]>} */
const writeFailureRows = [
  ["syncDirectory of the boot root", "syncDirectory", 1, 5, "A", "leftover", "A"],
  ["unlink of the leftover", "unlink", 1, 6, "A", "leftover", "A"],
  ["writeFile", "writeFile", 1, 7, "A", "none", "A"],
  ["syncFile", "syncFile", 1, 8, "A", "B", "A"],
  ["rename", "rename", 1, 9, "A", "B", "A"],
  ["syncDirectory of the folder", "syncDirectory", 2, 10, "B", "none", "B"],
];
const runWriteFailure = (op, nth) =>
  runWith({ record: "A", next: leftoverHalfA }, writeB, () => ({ [op]: failAt(op, nth) }));

// [label, overrides(f), index of the failing call in the full log]
/** @type {Array<[string, (f: any) => object, number]>} */
const newFolderFailureRows = [
  ["mkdir", () => ({ mkdir: failAt("mkdir") }), 3],
  [
    "the publisher's lstat of the folder after the mkdir",
    (f) => ({ lstat: failAt("lstat", 3, INJECTED, f.folder) }),
    4,
  ],
];
const runNewFolderFailure = (overrides) => runWith({ folder: false }, writeB, overrides);

// [label, operation, nth, index of the failing call in the full log, wifi.json left, .next left]
/** @type {Array<[string, string, number, number, boolean, boolean]>} */
const removeFailureRows = [
  ["the first unlink (wifi.json)", "unlink", 1, 5, true, true],
  ["the second unlink (wifi.json.next)", "unlink", 2, 6, false, true],
  ["syncDirectory of the folder", "syncDirectory", 1, 7, false, false],
];
const runRemoveFailure = (op, nth) =>
  runWith({ record: "A", next: "B" }, removeCable, () => ({ [op]: failAt(op, nth) }));

// [label, decision, overrides(f), last call(f), whole log(f)]
/** @type {Array<[string, any, (f: any) => object, (f: any) => unknown[], (f: any) => unknown[]]>} */
const checkFailureRows = [
  [
    "the read-back's open of wifi.json",
    writeB,
    () => ({ open: failAt("open", 2) }),
    (f) => ["open", f.recordPath],
    (f) => [
      ...readerCallsOf(f),
      ["lstat", f.folder],
      ["lstat", f.nextPath],
      ["syncDirectory", f.bootRoot],
      ["writeFile", f.nextPath],
      ["syncFile", f.nextPath],
      ["rename", f.nextPath, f.recordPath],
      ["syncDirectory", f.folder],
      ...readerCallsOf(f),
    ],
  ],
  [
    "the removal check's reader open of wifi.json",
    removeCable,
    () => ({ open: failAt("open", 2) }),
    (f) => ["open", f.recordPath],
    (f) => [
      ...readerCallsOf(f),
      ["lstat", f.folder],
      ["lstat", f.nextPath],
      ["unlink", f.recordPath],
      ["syncDirectory", f.folder],
      ...readerCallsOf(f),
    ],
  ],
  [
    "the removal check's own lstat of wifi.json.next",
    removeCable,
    (f) => ({ lstat: failAt("lstat", 2, INJECTED, f.nextPath) }),
    (f) => ["lstat", f.nextPath],
    (f) => [
      ...readerCallsOf(f),
      ["lstat", f.folder],
      ["lstat", f.nextPath],
      ["unlink", f.recordPath],
      ["syncDirectory", f.folder],
      ...readerCallsOf(f),
      ["lstat", f.nextPath],
    ],
  ],
];
const runCheckFailure = (decision, overrides) => runWith({ record: "A" }, decision, overrides);

const runPlainStringRejection = () =>
  runWith({ record: "A" }, writeB, () => ({
    writeFile: () => Promise.reject("boom " + PASSWORD_B),
  }));

/** A publisher with no io key, so disk-key.mjs's hostFileIo runs over the mocked fs. */
const defaultPublisher = (f) =>
  createWifiBootCopyPublisher({
    bootRoot: f.bootRoot,
    ownerUid: process.getuid(),
    inspectBootMount: f.inspectBootMount,
  });

// Cleared once the publication settles, so a later run in the same case writes for real.
const clearHook = () => (fsHooks.writeFile = undefined);

async function runDefaultSymlinkHook() {
  const f = await fixture({ record: "A" });
  const target = join(f.parent, "target.json");
  await fs.writeFile(target, "target bytes");
  fsHooks.writeFile = async (path) => fs.symlink(target, path);
  const status = await defaultPublisher(f).publish(writeB).finally(clearHook);
  return { f, status, target };
}

async function runDefaultFifoHook() {
  const f = await fixture({ record: "A" });
  fsHooks.writeFile = async (path) => mkfifo(path);
  const outcome = await settleOrRelease(defaultPublisher(f).publish(writeB).finally(clearHook), [
    f.nextPath,
    f.recordPath,
  ]);
  return { f, outcome, status: outcome.value };
}

describe("a failed step stops the publication there", () => {
  const fullWriteLog = (f) => [
    ...readerCallsOf(f),
    ["lstat", f.folder],
    ["lstat", f.nextPath],
    ["syncDirectory", f.bootRoot],
    ["unlink", f.nextPath],
    ["writeFile", f.nextPath],
    ["syncFile", f.nextPath],
    ["rename", f.nextPath, f.recordPath],
    ["syncDirectory", f.folder],
    ...readerCallsOf(f),
  ];

  it.each(writeFailureRows)(
    "A → B with a leftover, %s fails → io-failed, and the log ends there",
    async (_label, op, nth, at, record, next, loaded) => {
      const { f, log, status } = await runWriteFailure(op, nth);
      expectStatus(status, IO_FAILED_WRITE);
      expect(log).toEqual(fullWriteLog(f).slice(0, at + 1));
      expect(log.at(-1)[0]).toBe(op);
      await expectBytes(f.recordPath, RECORDS[record]);
      if (next === "none") await expectMissing(f.nextPath);
      else await expectBytes(f.nextPath, next === "B" ? writeB.bytes : leftoverHalfA);
      await expectReaderLoads(f, RECORDS[loaded]);

      expectStatus(await f.make().publish(writeB), {
        state: "current",
        reason: null,
        failure: null,
      });
      await expectBytes(f.recordPath, writeB.bytes);
      await expectMissing(f.nextPath);
    },
  );

  it.each(newFolderFailureRows)(
    "a new folder, %s fails → io-failed, no wifi.json, and the log ends there",
    async (_label, overrides, at) => {
      const { f, log, status } = await runNewFolderFailure(overrides);
      expectStatus(status, IO_FAILED_WRITE);
      expect(log).toEqual(
        [
          ["lstat", f.bootRoot],
          ["lstat", f.folder],
          ["lstat", f.folder],
          ["mkdir", f.folder],
          ["lstat", f.folder],
        ].slice(0, at + 1),
      );
      expect(log.map(([name]) => name)).not.toContain("writeFile");
      expectNoForm(
        [JSON.stringify(status), inspect(status, { depth: null })],
        [...passwordForms(PASSWORD_A), ...passwordForms(PASSWORD_B)],
      );
      await expectMissing(f.recordPath);
      expect((await f.reader().read()).kind).toBe("absent");

      expectStatus(await f.make().publish(writeB), {
        state: "current",
        reason: null,
        failure: null,
      });
      await expectBytes(f.recordPath, writeB.bytes);
    },
  );

  it.each(removeFailureRows)(
    "a remove over A with a leftover, %s fails → io-failed, and the log ends there",
    async (_label, op, nth, at, recordLeft, nextLeft) => {
      const { f, log, status } = await runRemoveFailure(op, nth);
      expectStatus(status, IO_FAILED_CABLE);
      expect(log).toEqual(
        [
          ...readerCallsOf(f),
          ["lstat", f.folder],
          ["lstat", f.nextPath],
          ["unlink", f.recordPath],
          ["unlink", f.nextPath],
          ["syncDirectory", f.folder],
        ].slice(0, at + 1),
      );
      if (recordLeft) await expectBytes(f.recordPath, writeA.bytes);
      else await expectMissing(f.recordPath);
      if (nextLeft) await expectBytes(f.nextPath, writeB.bytes);
      else await expectMissing(f.nextPath);

      expectStatus(await f.make().publish(removeCable), {
        state: "absent",
        reason: "cable-only",
        failure: null,
      });
      await expectMissing(f.recordPath);
      await expectMissing(f.nextPath);
    },
  );

  it.each(checkFailureRows)(
    "%s throws → publication-unverified, and the log ends there",
    async (_label, decision, overrides, lastCall, wholeLog) => {
      const { f, log, status } = await runCheckFailure(decision, overrides);
      const reason = decision.kind === "remove" ? decision.reason : null;
      expectStatus(status, { state: "failed", reason, failure: "publication-unverified" });
      expect(log.at(-1)).toEqual(lastCall(f));
      expect(log).toEqual(wholeLog(f));
    },
  );

  it("a writeFile that rejects with a plain string → io-failed; publish resolves", async () => {
    const { f, log, status } = await runPlainStringRejection();
    expectStatus(status, IO_FAILED_WRITE);
    expect(log.at(-1)).toEqual(["writeFile", f.nextPath]);
    expectNoForm(
      [JSON.stringify(status), String(status), inspect(status)],
      passwordForms(PASSWORD_B),
    );
    await expectBytes(f.recordPath, writeA.bytes);
  });
});

describe("the default file operations", () => {
  it("write B on a clean fixture → current, through the real fs (the log's positive control)", async () => {
    const f = await fixture();
    const publisher = defaultPublisher(f);
    fsCalls.log.length = 0;
    expectStatus(await publisher.publish(writeB), {
      state: "current",
      reason: null,
      failure: null,
    });
    expect(fsCalls.log.length).toBeGreaterThan(0);
    expect(fsCalls.log.map(([name]) => name)).toContain("rename");
    await expectBytes(f.recordPath, writeB.bytes);
    await expectMissing(f.nextPath);
  });

  it("a symlink where the staging file should be → io-failed (the flush does not follow it)", async () => {
    const { f, status, target } = await runDefaultSymlinkHook();
    expectStatus(status, IO_FAILED_WRITE);
    await expectBytes(f.recordPath, writeA.bytes);
    expect(await fs.readFile(target, "utf8")).toBe("target bytes");
  });

  it("a FIFO where the staging file should be → io-failed without waiting for a writer", async () => {
    const { f, outcome, status } = await runDefaultFifoHook();
    expect(outcome.hung).toBe(false);
    expectStatus(status, IO_FAILED_WRITE);
    await expectBytes(f.recordPath, writeA.bytes);
  });
});

describe("no status or error holds the password", () => {
  it("every failure and every refused decision, in String, JSON and inspect", async () => {
    const entries = [];
    for (const [, op, nth] of writeFailureRows)
      entries.push((await runWriteFailure(op, nth)).status);
    for (const [, overrides] of newFolderFailureRows) {
      entries.push((await runNewFolderFailure(overrides)).status);
    }
    for (const [, op, nth] of removeFailureRows) {
      entries.push((await runRemoveFailure(op, nth)).status);
    }
    for (const [, decision, overrides] of checkFailureRows) {
      entries.push((await runCheckFailure(decision, overrides)).status);
    }
    entries.push((await runPlainStringRejection()).status);
    entries.push((await runDefaultSymlinkHook()).status);
    entries.push((await runDefaultFifoHook()).status);
    const f = await fixture({ record: "A" });
    const publisher = f.make();
    for (const [, build] of invalidDecisions) {
      entries.push(await publisher.publish(/** @type {any} */ (build())).catch((error) => error));
    }

    expect(entries).toHaveLength(30);
    expect(entries.filter((entry) => entry instanceof Error)).toHaveLength(13);
    expect(invalidDecisions).toHaveLength(13);
    const forms = [...passwordForms(PASSWORD_A), ...passwordForms(PASSWORD_B)];
    for (const entry of entries) {
      expectNoForm(
        [
          JSON.stringify(entry instanceof Error ? { ...entry } : entry),
          String(entry),
          inspect(entry, { depth: null, showHidden: true }),
        ],
        forms,
      );
    }

    // The positive control: the bytes a current publication wrote do hold the password.
    const written = await fixture();
    await written.make().publish(writeB);
    expect((await fs.readFile(written.recordPath)).toString("utf8")).toContain(PASSWORD_B);
  });
});

/**
 * An override for operation `name` whose `nth` call waits until `release()` and then calls the real
 * operation; `reached` settles when that call starts.
 */
const gate = (name, nth = 1) => {
  let seen = 0;
  let open = () => {};
  let arrive = () => {};
  const held = new Promise((resolve) => (open = resolve));
  const reached = new Promise((resolve) => (arrive = resolve));
  const op = async (...args) => {
    if (++seen === nth) {
      arrive();
      await held;
    }
    return REAL_IO[name](...args);
  };
  return { op, reached, release: () => open() };
};

/** A fixture's publisher whose io waits at operation `name`'s `nth` call. */
async function gatedPublisher(fixtureArgs, name, nth = 1) {
  const f = await fixture(fixtureArgs);
  const held = gate(name, nth);
  const counting = countingIo({ [name]: held.op });
  return { f, held, log: counting.log, publisher: f.make({ io: counting.io }) };
}

const CURRENT = { state: "current", reason: null, failure: null };
const writeLogOver = (f) => [
  ...readerCallsOf(f),
  ["lstat", f.folder],
  ["lstat", f.nextPath],
  ["syncDirectory", f.bootRoot],
  ["writeFile", f.nextPath],
  ["syncFile", f.nextPath],
  ["rename", f.nextPath, f.recordPath],
  ["syncDirectory", f.folder],
  ...readerCallsOf(f),
];

describe("one publication at a time, and the status while one runs", () => {
  it("is pending while a later publication runs, then that publication's outcome", async () => {
    const f = await fixture();
    const publisher = f.make();
    expectStatus(await publisher.publish(writeA), CURRENT);
    expectStatus(publisher.status(), CURRENT);
    const publication = publisher.publish(writeB);
    expectStatus(publisher.status(), FIRST_STATUS);
    expectStatus(await publication, CURRENT);
    expectStatus(publisher.status(), CURRENT);
  });

  it("stays pending until the last queued publication finishes, not at the first's outcome", async () => {
    const { f, held, publisher } = await gatedPublisher({}, "unlink");
    const first = publisher.publish(writeA);
    const second = publisher.publish(removeCable);
    expectStatus(await first, CURRENT);
    const pending = { state: "pending", reason: "cable-only", failure: null };
    expectStatus(publisher.status(), pending);
    await held.reached;
    expectStatus(publisher.status(), pending);
    held.release();
    const absent = { state: "absent", reason: "cable-only", failure: null };
    expectStatus(await second, absent);
    expectStatus(publisher.status(), absent);
    await expectMissing(f.recordPath);
  });

  it("carries a running remove's reason while it is pending", async () => {
    const { held, publisher } = await gatedPublisher({}, "unlink");
    expectStatus(await publisher.publish(writeB), CURRENT);
    const removal = publisher.publish(removeOpen);
    await held.reached;
    expectStatus(publisher.status(), { state: "pending", reason: "open", failure: null });
    held.release();
    expectStatus(await removal, { state: "absent", reason: "open", failure: null });
  });

  it("runs publications in call order: none of B's calls while A waits at its rename", async () => {
    const { f, held, log, publisher } = await gatedPublisher({}, "rename");
    const first = publisher.publish(writeA);
    const second = publisher.publish(writeB);
    await held.reached;
    // Turns of the event loop in which B could start if it were not queued.
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toEqual(writeLogOver(f).slice(0, 9));
    expect(log.filter(([name, path]) => name === "lstat" && path === f.bootRoot)).toHaveLength(1);
    held.release();
    expectStatus(await first, CURRENT);
    const last = await second;
    expectStatus(last, CURRENT);
    expect(log).toEqual([...writeLogOver(f), ...writeLogOver(f)]);
    await expectBytes(f.recordPath, writeB.bytes);
    await expectReaderLoads(f, writeB.bytes);
    expectStatus(publisher.status(), last);
  });

  it("leaves the copy as the last call says, whatever was queued before it", async () => {
    const f = await fixture({ record: "B" });
    const publisher = f.make();
    const answers = await Promise.all([
      publisher.publish(writeB),
      publisher.publish(removeCable),
      publisher.publish(writeA),
    ]);
    expectStatus(answers[0], CURRENT);
    expectStatus(answers[1], { state: "absent", reason: "cable-only", failure: null });
    expectStatus(answers[2], CURRENT);
    await expectBytes(f.recordPath, writeA.bytes);
    await expectMissing(f.nextPath);
    expectStatus(publisher.status(), CURRENT);
  });

  it("reports a failure, then the next publication's success", async () => {
    const f = await fixture({ record: "A" });
    const counting = countingIo({ rename: failAt("rename") });
    const publisher = f.make({ io: counting.io });
    expectStatus(await publisher.publish(writeB), IO_FAILED_WRITE);
    expectStatus(publisher.status(), IO_FAILED_WRITE);
    expectStatus(await publisher.publish(writeB), CURRENT);
    expectStatus(publisher.status(), CURRENT);
    await expectBytes(f.recordPath, writeB.bytes);
    await expectMissing(f.nextPath);
  });

  it.each([
    ["a Uint8Array, filled with spaces", () => Uint8Array.from(writeB.bytes), (bytes) => bytes],
    [
      "a Buffer view whose source is filled with spaces",
      () => {
        const source = Buffer.from(writeB.bytes);
        return Object.assign(source.subarray(0), { source });
      },
      (bytes) => bytes.source,
    ],
  ])("takes the bytes at the call: %s while it waits", async (_label, build, toFill) => {
    const { f, held, publisher } = await gatedPublisher({}, "rename");
    const first = publisher.publish(writeA);
    await held.reached;
    const bytes = build();
    const second = publisher.publish({ kind: "write", bytes });
    toFill(bytes).fill(0x20);
    held.release();
    expectStatus(await first, CURRENT);
    expectStatus(await second, CURRENT);
    await expectBytes(f.recordPath, writeB.bytes);
  });

  it("refuses an invalid decision at once without disturbing the queue", async () => {
    const { f, held, publisher } = await gatedPublisher({}, "rename");
    const publication = publisher.publish(writeA);
    await held.reached;
    await expect(publisher.publish(/** @type {any} */ ({ kind: "write" }))).rejects.toEqual(
      DECISION_INVALID,
    );
    expectStatus(publisher.status(), FIRST_STATUS);
    held.release();
    expectStatus(await publication, CURRENT);
    expectStatus(publisher.status(), CURRENT);
    await expectBytes(f.recordPath, writeA.bytes);
  });

  it("answers every status frozen, with exactly state, reason and failure, and no connectivity", async () => {
    const { f, held, publisher } = await gatedPublisher({ record: "A" }, "unlink");
    const statuses = [publisher.status()];
    const removal = publisher.publish(removeCable);
    await held.reached;
    statuses.push(publisher.status());
    held.release();
    statuses.push(await removal, publisher.status());
    statuses.push(await publisher.publish(writeB), publisher.status());
    const failing = f.make({ io: countingIo({ rename: failAt("rename") }).io });
    statuses.push(await failing.publish(writeA), failing.status());
    expect(statuses.map(({ state }) => state)).toEqual([
      "pending",
      "pending",
      "absent",
      "absent",
      "current",
      "current",
      "failed",
      "failed",
    ]);
    for (const status of statuses) {
      expect(Object.isFrozen(status)).toBe(true);
      expect(Reflect.ownKeys(status).sort()).toEqual(["failure", "reason", "state"]);
      for (const key of ["connected", "online", "reachable", "joined"]) {
        expect(key in status).toBe(false);
      }
    }
  });
});

const SWEPT_OPS = [...WRITE_OPS, ...FLUSH_OPS];

/**
 * Overrides for every write and flush operation: the `k`-th such call (counting from 0) throws, as
 * a stopped process makes no further call. In "half" mode a writeFile first writes the first half
 * of its bytes with the caller's own options.
 * @param {number} k @param {"before"|"half"} mode
 */
function stopAt(k, mode) {
  let seen = 0;
  return Object.fromEntries(
    SWEPT_OPS.map((name) => [
      name,
      async (...args) => {
        if (seen++ !== k) return REAL_IO[name](...args);
        if (mode === "half" && name === "writeFile") {
          const [path, bytes, options] = args;
          await REAL_IO.writeFile(path, bytes.subarray(0, bytes.length >> 1), options);
        }
        throw Object.assign(new Error(`stopped at ${name}`), { code: "EIO" });
      },
    ]),
  );
}

/** The write and flush operations of a log, by name. */
const sweptOf = (log) => log.map(([name]) => name).filter((name) => SWEPT_OPS.includes(name));

/**
 * A clean run of `decision` from `start` in a fresh fixture: its write and flush operations, and
 * what the reader answers before and after.
 */
async function steps(start, decision) {
  const f = await fixture(start);
  const before = await f.reader().read();
  await f.make().publish(decision);
  return { ops: sweptOf(f.counting.log), before, after: await f.reader().read() };
}

/** The bytes of every regular file directly in `folder`, by name; empty when it is missing. */
async function allFileBytes(folder) {
  const names = await fs.readdir(folder).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = {};
  for (const name of names.sort()) {
    const path = join(folder, name);
    if ((await fs.lstat(path)).isFile()) files[name] = new Uint8Array(await fs.readFile(path));
  }
  return files;
}

const fileOrNull = (path) =>
  fs.readFile(path).then(
    (bytes) => new Uint8Array(bytes),
    (error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );

const ALLOWED_UNDER_BOOT = new Set([
  "",
  "waitron-recovery",
  join("waitron-recovery", "wifi.json"),
  join("waitron-recovery", "wifi.json.next"),
  join("waitron-recovery", "recovery.crt"),
]);
const expectOnlyKnownNames = async (f, label) => {
  const names = (await snapshot(f.bootRoot)).map(([name]) => name);
  expect(
    names.filter((name) => !ALLOWED_UNDER_BOOT.has(name)),
    label,
  ).toEqual([]);
};

const halfB = Buffer.from(writeB.bytes).subarray(0, writeB.bytes.length >> 1);
/** @type {Array<[string, Record<string, unknown>]>} */
const SWEEP_STARTS = [
  ["no folder", { folder: false }],
  ["an empty folder", {}],
  ["A", { record: "A" }],
  ["A with half of B left in wifi.json.next", { record: "A", next: halfB }],
  ["a corrupt wifi.json", { record: "{}\n" }],
  ["B", { record: "B" }],
];
const SWEEP_DECISIONS = [
  ["writeB", writeB, [writeB, removeCable]],
  ["removeCable", removeCable, [removeCable, writeA]],
  ["removeOpen", removeOpen, [removeOpen, writeA]],
];
const PASSWORD_OF = new Map([
  [writeA, PASSWORD_A],
  [writeB, PASSWORD_B],
]);

/** The repair's checks, over a fixture just stopped; `crt` is recovery.crt's bytes at the start. */
async function expectRepairedBy(f, later, crt, label) {
  const publisher = createWifiBootCopyPublisher({
    bootRoot: f.bootRoot,
    ownerUid: process.getuid(),
    inspectBootMount: f.inspectBootMount,
    io: countingIo().io,
  });
  const status = await publisher.publish(later);
  expect(status.state, label).toBe(later.kind === "write" ? "current" : "absent");
  expect(await fileOrNull(f.recordPath), label).toEqual(
    later.kind === "write" ? new Uint8Array(later.bytes) : null,
  );
  expect(await fileOrNull(f.nextPath), label).toBeNull();
  const texts = Object.values(await allFileBytes(f.folder)).map((bytes) =>
    Buffer.from(bytes).toString("utf8"),
  );
  const own = PASSWORD_OF.get(later);
  if (own !== undefined) expect(texts.join("\n"), label).toContain(own);
  for (const password of [PASSWORD_A, PASSWORD_B]) {
    if (password === own) continue;
    for (const text of texts) {
      for (const form of passwordForms(password)) expect(text, label).not.toContain(form);
    }
  }
  expect(await fileOrNull(join(f.folder, "recovery.crt")), label).toEqual(crt);
  await expectOnlyKnownNames(f, `${label}, after the repair`);

  const again = countingIo();
  await createWifiBootCopyPublisher({
    bootRoot: f.bootRoot,
    ownerUid: process.getuid(),
    inspectBootMount: f.inspectBootMount,
    io: again.io,
  }).publish(later);
  expect(
    again.log.filter(([name]) => WRITE_OPS.includes(name)),
    `${label}, published again`,
  ).toEqual([]);
}

describe("a publication stopped after any step, and the next start", () => {
  const pairs = SWEEP_STARTS.flatMap(([startName, start]) =>
    SWEEP_DECISIONS.map(([decisionName, decision, laters]) => [
      startName,
      decisionName,
      start,
      decision,
      laters,
    ]),
  );

  it.each(pairs)(
    "from %s, %s: preboot sees the old or the new answer, and the next start repairs it",
    async (startName, decisionName, start, decision, laters) => {
      const clean = await steps(start, decision);
      const stops = clean.ops.flatMap((op, k) =>
        op === "writeFile"
          ? [
              [k, "before"],
              [k, "half"],
            ]
          : [[k, "before"]],
      );
      // A run with no step to stop (a removal with no folder) still gets the repair checks.
      if (stops.length === 0) {
        expect(clean.after).toEqual(clean.before);
        stops.push([null, "no step"]);
      }
      for (const [k, mode] of stops) {
        for (const later of laters) {
          const label = `${startName}, ${decisionName}, stopped at ${k} (${clean.ops[k]}, ${mode})`;
          const f = await fixture(start);
          const crt = await fileOrNull(join(f.folder, "recovery.crt"));
          if (k !== null) {
            const stopped = countingIo(stopAt(k, mode));
            const status = await f.make({ io: stopped.io }).publish(decision);
            expect(status.state, label).toBe("failed");
            expect(status.failure, label).toBe("io-failed");
            expect(sweptOf(stopped.log), label).toEqual(clean.ops.slice(0, k + 1));
          }
          const seen = await f.reader().read();
          expect([clean.before, clean.after], label).toContainEqual(seen);
          await expectOnlyKnownNames(f, `${label}, after the stop`);
          await expectRepairedBy(f, later, crt, label);
        }
      }
    },
  );

  it("does not follow a link planted at wifi.json.next before the write", async () => {
    const f = await fixture({ record: "A" });
    const outside = join(f.parent, "outside.txt");
    const writeFile = async (...args) => {
      await fs.symlink(outside, f.nextPath);
      return REAL_IO.writeFile(...args);
    };
    const status = await f.make({ io: countingIo({ writeFile }).io }).publish(writeB);
    await expectMissing(outside);
    await expectBytes(f.recordPath, writeA.bytes);
    expectStatus(status, IO_FAILED_WRITE);
  });
});

/** @param {import("vitest").RunnerTestSuite | import("vitest").RunnerTestFile} suite */
const testsIn = (suite) =>
  suite.tasks.flatMap((task) => (task.type === "suite" ? testsIn(task) : [task]));

// Last in the file, as it reads the statuses every case above observed.
describe("the copy's states and failures match what the cases observe", () => {
  it("in both directions", (context) => {
    const others = testsIn(context.task.file).filter((test) => test !== context.task);
    context.skip(
      others.some((test) => test.mode !== "run"),
      "needs every other case in the file to have run",
    );
    const states = new Set(observedStatuses.map(({ state }) => state));
    const failures = new Set(observedStatuses.map(({ failure }) => failure));
    failures.delete(null);
    for (const state of states) expect(WIFI_COPY_STATES).toContain(state);
    for (const failure of failures) expect(WIFI_COPY_FAILURES).toContain(failure);
    for (const state of WIFI_COPY_STATES) expect(states.has(state)).toBe(true);
    for (const failure of WIFI_COPY_FAILURES) expect(failures.has(failure)).toBe(true);
  });
});
