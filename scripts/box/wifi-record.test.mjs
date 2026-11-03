import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { TextEncoder, inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_ROOT,
  WIFI_RECORD_MAX_BYTES,
  createWifiRecordReader,
  parseWifiRecord,
  readActiveWifiRecord,
} from "./wifi-record.mjs";

const SSID = "4361666520436f726e6572"; // "Cafe Corner"
const SSID_32 = "ff".repeat(32);
const HEX_64 = "0123456789abcdef".repeat(4);

/** @param {Record<string, unknown>} [fields] */
const wifiFields = (fields = {}) => ({
  version: 1,
  ssidHex: SSID,
  keyMgmt: "wpa-psk",
  psk: "correct horse",
  hidden: false,
  ...fields,
});

/** The canonical form: the given keys in the given order, one final newline. @param {Record<string, unknown>} [fields] */
const recordBytes = (fields) => new TextEncoder().encode(JSON.stringify(wifiFields(fields)) + "\n");

/** @param {string} text */
const textBytes = (text) => new TextEncoder().encode(text);

/** @param {Uint8Array} bytes */
function expectLoaded(bytes) {
  const result = parseWifiRecord(bytes);
  expect(Object.isFrozen(result)).toBe(true);
  expect(result.kind).toBe("loaded");
  expect(Object.isFrozen(/** @type {any} */ (result).network)).toBe(true);
  return result;
}

/** @param {Record<string, unknown>} fields */
function expectLoadsAs(fields) {
  const { ssidHex, keyMgmt, psk, hidden } = wifiFields(fields);
  const network = { ssidHex, keyMgmt, psk, hidden };
  expect(expectLoaded(recordBytes(fields))).toEqual({ kind: "loaded", network });
}

/** @param {Uint8Array} bytes @param {string} reason */
function expectRefused(bytes, reason) {
  const result = parseWifiRecord(bytes);
  expect(result).toEqual({ kind: "refused", reason });
  expect(Object.isFrozen(result)).toBe(true);
}

describe("parseWifiRecord loads version 1", () => {
  it("WIFI_RECORD_MAX_BYTES is 1024", () => {
    expect(WIFI_RECORD_MAX_BYTES).toBe(1024);
  });

  it.each([
    ["a WPA2 record", {}],
    ["a WPA3 record with a non-ASCII password", { keyMgmt: "sae", psk: "Crème brûlée Àngels" }],
    ["a 32-byte network name", { ssidHex: SSID_32 }],
    ["an 8-character password", { psk: "12345678" }],
    ["a 63-character password", { psk: "~ ".repeat(31) + "!" }],
    ["a 64-hex-digit password in lower case", { psk: HEX_64 }],
    ["a 64-hex-digit password in upper case", { psk: HEX_64.toUpperCase() }],
    ["a hidden network", { hidden: true }],
  ])("%s", (_name, fields) => {
    expectLoadsAs(fields);
  });

  it("the 63-character password really is 63 characters", () => {
    expect(("~ ".repeat(31) + "!").length).toBe(63);
  });

  it("the largest valid record — a 32-byte name and a 256-byte WPA3 password of '\"' characters, which JSON doubles — is under 1024 bytes and loads", () => {
    const fields = { ssidHex: SSID_32, keyMgmt: "sae", psk: '"'.repeat(256), hidden: false };
    const bytes = recordBytes(fields);
    expect(bytes.length).toBe(643);
    expect(bytes.length).toBeLessThan(WIFI_RECORD_MAX_BYTES);
    expectLoadsAs(fields);
  });
});

describe("parseWifiRecord refuses an oversized record", () => {
  /** @param {number} size */
  const padded = (size) => {
    const record = recordBytes();
    const bytes = new Uint8Array(size).fill(0x20);
    bytes.set(record);
    return bytes;
  };

  it("1025 bytes → record-oversized, even when they begin with a valid record", () => {
    expectRefused(padded(1025), "record-oversized");
  });

  it("1025 bytes of 0xFF → record-oversized, not corrupt", () => {
    expectRefused(new Uint8Array(1025).fill(0xff), "record-oversized");
  });

  it("a version 2 record padded to 1025 bytes → record-oversized, not unsupported", () => {
    const bytes = new Uint8Array(1025).fill(0x20);
    bytes.set(recordBytes({ version: 2 }));
    expectRefused(bytes, "record-oversized");
  });

  it("1024 bytes of the same shape → record-corrupt, not oversized", () => {
    expectRefused(padded(1024), "record-corrupt");
  });
});

describe("parseWifiRecord refuses a damaged record", () => {
  const canonical = JSON.stringify(wifiFields()) + "\n";

  /** @param {Record<string, unknown>} value */
  const rawRecord = (value) => textBytes(JSON.stringify(value) + "\n");

  /** A sae record whose password's middle byte is 0xFF. */
  const saeWithByteFF = () => {
    const bytes = recordBytes({ keyMgmt: "sae", psk: "abcXdef" });
    const at = bytes.indexOf("X".charCodeAt(0));
    bytes[at] = 0xff;
    return bytes;
  };

  /** @type {Array<[string, () => Uint8Array]>} */
  const cases = [
    ["invalid JSON", () => textBytes('{"version":1,\n')],
    ["a JSON array", () => textBytes("[1]\n")],
    ["JSON null", () => textBytes("null\n")],
    ["extra spaces", () => textBytes(JSON.stringify(wifiFields(), null, 1) + "\n")],
    [
      "keys in another order",
      () => {
        const { version, ...rest } = wifiFields();
        return rawRecord({ ...rest, version });
      },
    ],
    ["no final newline", () => textBytes(canonical.slice(0, -1))],
    ["an extra key", () => recordBytes({ band: "5GHz" })],
    [
      "a missing key",
      () => {
        const { version, ssidHex, keyMgmt, psk } = wifiFields();
        return rawRecord({ version, ssidHex, keyMgmt, psk });
      },
    ],
    ["ssidHex of odd length", () => recordBytes({ ssidHex: "abc" })],
    ["ssidHex in upper case", () => recordBytes({ ssidHex: SSID.toUpperCase() })],
    ["ssidHex empty", () => recordBytes({ ssidHex: "" })],
    ["ssidHex of 33 bytes", () => recordBytes({ ssidHex: "ab".repeat(33) })],
    ["ssidHex not a string", () => recordBytes({ ssidHex: 7 })],
    ['ssidHex an array, ["ab"]', () => recordBytes({ ssidHex: ["ab"] })],
    ["a WPA2 password of 7 characters", () => recordBytes({ psk: "1234567" })],
    ["a WPA2 password of 64 non-hex characters", () => recordBytes({ psk: "g".repeat(64) })],
    ["a WPA2 password of 65 characters", () => recordBytes({ psk: "a".repeat(65) })],
    ["a WPA2 password not a string", () => recordBytes({ psk: 12345678 })],
    [
      "a WPA2 password of 4 emoji (8 UTF-16 units, 4 characters)",
      () => recordBytes({ psk: "😀".repeat(4) }),
    ],
    ["a WPA3 password empty", () => recordBytes({ keyMgmt: "sae", psk: "" })],
    ["a WPA3 password of 257 bytes", () => recordBytes({ keyMgmt: "sae", psk: "a".repeat(257) })],
    [
      "a WPA3 password of 257 bytes made of 2-byte characters",
      () => recordBytes({ keyMgmt: "sae", psk: "a" + "ñ".repeat(128) }),
    ],
    ["a WPA3 password holding U+0000", () => recordBytes({ keyMgmt: "sae", psk: "abc\u0000def" })],
    ["a WPA3 password holding U+001F", () => recordBytes({ keyMgmt: "sae", psk: "abc\u001fdef" })],
    ["a WPA3 password holding U+007F", () => recordBytes({ keyMgmt: "sae", psk: "abc\u007fdef" })],
    ['a WPA3 password written as "\\ud800"', () => recordBytes({ keyMgmt: "sae", psk: "\ud800" })],
    ["a WPA3 password not a string", () => recordBytes({ keyMgmt: "sae", psk: null })],
    ['hidden: "false"', () => recordBytes({ hidden: "false" })],
    ["a 0xFF byte inside a sae record's password", saeWithByteFF],
    ["a byte-order mark before the record", () => textBytes("\ufeff" + canonical)],
    ['version: "1"', () => recordBytes({ version: "1" })],
    ["version: 1.5", () => recordBytes({ version: 1.5 })],
    ["keyMgmt: 7", () => recordBytes({ keyMgmt: 7 })],
  ];

  it.each(cases)("%s → record-corrupt", (_name, bytes) => {
    expectRefused(bytes(), "record-corrupt");
  });

  it("the sae 257-byte cases really are 257 bytes", () => {
    expect(textBytes("a".repeat(257)).length).toBe(257);
    expect(textBytes("a" + "ñ".repeat(128)).length).toBe(257);
  });

  it("the 256-byte WPA3 password of 2-byte characters loads", () => {
    expectLoadsAs({ keyMgmt: "sae", psk: "ñ".repeat(128) });
  });

  it("the 0xFF case changes one byte of a sae record that loads", () => {
    expectLoadsAs({ keyMgmt: "sae", psk: "abcXdef" });
    expect(saeWithByteFF().length).toBe(recordBytes({ keyMgmt: "sae", psk: "abcXdef" }).length);
  });
});

describe("parseWifiRecord refuses a record it does not support", () => {
  /** @type {Array<[string, () => Uint8Array]>} */
  const cases = [
    ["a WPA2 password holding a tab", () => recordBytes({ psk: "pass\tword" })],
    ["a WPA2 password holding ñ", () => recordBytes({ psk: "piñata-party" })],
    [
      "a WPA2 password of 32 emoji (64 UTF-16 units, 32 characters)",
      () => recordBytes({ psk: "😀".repeat(32) }),
    ],
    ["version: 2 with otherwise valid fields", () => recordBytes({ version: 2 })],
    ["version: 2 with extra keys", () => recordBytes({ version: 2, band: "5GHz", extra: true })],
    ["version: 0", () => recordBytes({ version: 0 })],
    ['keyMgmt "none"', () => recordBytes({ keyMgmt: "none" })],
    ['keyMgmt "wpa-eap"', () => recordBytes({ keyMgmt: "wpa-eap" })],
    ['keyMgmt "owe"', () => recordBytes({ keyMgmt: "owe" })],
    ['keyMgmt "WPA-PSK"', () => recordBytes({ keyMgmt: "WPA-PSK" })],
  ];

  it.each(cases)("%s → record-unsupported", (_name, bytes) => {
    expectRefused(bytes(), "record-unsupported");
  });
});

describe("parseWifiRecord refuses input that is not bytes", () => {
  it.each([
    ["a string", JSON.stringify(wifiFields()) + "\n"],
    ["an Array", Array.from(recordBytes())],
    ["null", null],
  ])("%s → throws wifi_record.input_invalid", (_name, value) => {
    expect(() => parseWifiRecord(/** @type {any} */ (value))).toThrow(
      expect.objectContaining({ code: "wifi_record.input_invalid", reason: "input-invalid" }),
    );
  });
});

// The module's default io is not injectable, so the fixed entry point's file calls are seen through
// the module's own `node:fs/promises`.
const fsCalls = vi.hoisted(() => ({ log: [] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    lstat: (...args) => (fsCalls.log.push(["lstat", args[0]]), real.lstat(...args)),
    open: (...args) => (fsCalls.log.push(["open", args[0]]), real.open(...args)),
  };
});

const PASSWORD = "Bar-Àngels-2026";
/** @param {Record<string, unknown>} [fields] */
const wifiText = (fields = {}) =>
  JSON.stringify(wifiFields({ keyMgmt: "sae", psk: PASSWORD, ...fields })) + "\n";
const LOADED = {
  kind: "loaded",
  network: { ssidHex: SSID, keyMgmt: "sae", psk: PASSWORD, hidden: false },
};
const refusedWith = (reason) => ({ kind: "refused", reason });
const DEPS_INVALID = expect.objectContaining({
  code: "wifi_record.deps_invalid",
  reason: "deps-invalid",
});

const parents = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const parent of parents.splice(0)) await fs.rm(parent, { recursive: true, force: true });
});

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

const rootIdOf = async (path) => {
  const stats = await fs.lstat(path, { bigint: true });
  return { dev: stats.dev, ino: stats.ino, rootId: `${stats.dev}:${stats.ino}` };
};

/** Handles opened and closed through every countingIo; a test resets it before it reads. */
const handles = { opened: 0, closed: 0 };

/**
 * A real io that logs every call's name and path, and counts in `handles` each handle it opens and
 * each close of one; `overrides` replace single operations.
 */
function countingIo(overrides = {}) {
  const log = [];
  const lstat = overrides.lstat ?? fs.lstat;
  const open = overrides.open ?? fs.open;
  const io = {
    lstat: (...args) => {
      log.push(["lstat", args[0]]);
      return lstat(...args);
    },
    open: async (...args) => {
      log.push(["open", args[0]]);
      const handle = await open(...args);
      handles.opened++;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "close") {
            return async () => {
              await target.close();
              handles.closed++;
            };
          }
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  return { io, log };
}

const errnoError = (code, message = code) => Object.assign(new Error(message), { code });

async function fixture({ folder: withFolder = true, record = wifiText() } = {}) {
  const parent = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "b3-wifi-record-")));
  parents.push(parent);
  const bootRoot = join(parent, "boot");
  await fs.mkdir(bootRoot);
  await fs.chmod(bootRoot, 0o755);
  const folder = join(bootRoot, "waitron-recovery");
  if (withFolder) {
    await fs.mkdir(folder);
    await fs.chmod(folder, 0o700);
  }
  const writeFile = async (name, text, dir = folder) => {
    const path = join(dir, name);
    await fs.writeFile(path, text);
    await fs.chmod(path, 0o600);
    return path;
  };
  const recordPath = join(folder, "wifi.json");
  if (withFolder && record !== null) await writeFile("wifi.json", record);
  const { rootId } = await rootIdOf(bootRoot);
  const answer = { bootRoot, rootId };
  const inspectBootMount = vi.fn(async () => ({ ...answer }));
  const counting = countingIo();
  const make = (deps = {}) =>
    createWifiRecordReader({
      bootRoot,
      ownerUid: process.getuid(),
      inspectBootMount,
      io: counting.io,
      ...deps,
    });
  const read = (deps) => make(deps).read();
  return {
    parent,
    bootRoot,
    folder,
    recordPath,
    writeFile,
    answer,
    inspectBootMount,
    counting,
    make,
    read,
  };
}

const opened = (f) => f.counting.log.filter(([name]) => name === "open").map(([, path]) => path);
const touched = (f) => f.counting.log.map(([, path]) => path);

async function replaceRootWithLink(f) {
  const copy = join(f.parent, "copy");
  await fs.rename(f.bootRoot, copy);
  await fs.symlink(copy, f.bootRoot);
}

const lstatAt = (path, change) => async (target, options) => {
  if (target !== path) return fs.lstat(target, options);
  return change(await fs.lstat(target, options));
};

/**
 * Every case that answers refused or absent, each run on a fixture whose files hold PASSWORD.
 * Each `run` returns the reader's result.
 */
const nonLoadedCases = [
  [
    "no waitron-recovery folder",
    async () => (await fixture({ folder: false })).read(),
    { kind: "absent" },
  ],
  ["no wifi.json", async () => (await fixture({ record: null })).read(), { kind: "absent" }],
  [
    "only a valid wifi.json.next",
    async () => {
      const f = await fixture({ record: null });
      await f.writeFile("wifi.json.next", wifiText());
      return f.read();
    },
    { kind: "absent" },
  ],
  [
    "a corrupt wifi.json beside a valid wifi.json.next",
    async () => {
      const f = await fixture({ record: wifiText().trimEnd() });
      await f.writeFile("wifi.json.next", wifiText());
      return f.read();
    },
    refusedWith("record-corrupt"),
  ],
  [
    "wifi.json is a symlink to a valid record",
    async () => {
      const f = await fixture({ record: null });
      const target = await f.writeFile("elsewhere.json", wifiText());
      await fs.symlink(target, f.recordPath);
      return f.read();
    },
    refusedWith("path-unsafe"),
  ],
  [
    "waitron-recovery is a symlink to a folder holding a valid record",
    async () => {
      const f = await fixture({ folder: false });
      const real = join(f.parent, "real-folder");
      await fs.mkdir(real);
      await fs.chmod(real, 0o700);
      await f.writeFile("wifi.json", wifiText(), real);
      await fs.symlink(real, f.folder);
      return f.read();
    },
    refusedWith("path-unsafe"),
  ],
  [
    "waitron-recovery is a regular file",
    async () => {
      const f = await fixture({ folder: false });
      await f.writeFile("waitron-recovery", wifiText(), f.bootRoot);
      return f.read();
    },
    refusedWith("path-unsafe"),
  ],
  [
    "wifi.json is a folder",
    async () => {
      const f = await fixture({ record: null });
      await fs.mkdir(f.recordPath);
      await fs.chmod(f.recordPath, 0o700);
      return f.read();
    },
    refusedWith("path-unsafe"),
  ],
  [
    "wifi.json has a second hard link",
    async () => {
      const f = await fixture();
      await fs.link(f.recordPath, join(f.folder, "second-name"));
      return f.read();
    },
    refusedWith("path-unsafe"),
  ],
  [
    "wifi.json is a FIFO",
    async () => {
      const f = await fixture({ record: null });
      mkfifo(f.recordPath);
      const outcome = await settleOrRelease(f.read(), [f.recordPath]);
      expect(outcome.hung).toBe(false);
      return outcome.value;
    },
    refusedWith("path-unsafe"),
  ],
  [
    "stat reports 100 bytes but the file holds 2000",
    async () => {
      const f = await fixture({ record: wifiText() + " ".repeat(2000) });
      const result = await f.read({
        io: countingIo({
          open: openWith({
            stat: (target) => async (options) =>
              statsWith(await target.stat(options), { size: () => 100 }),
          }),
        }).io,
      });
      return result;
    },
    refusedWith("record-oversized"),
  ],
  [
    "a 1025-byte file",
    async () => (await fixture({ record: wifiText() + " ".repeat(1025) })).read(),
    refusedWith("record-oversized"),
  ],
  [
    "the stand-in throws",
    async () => {
      const f = await fixture();
      return f.read({
        inspectBootMount: async () => {
          throw new Error(`mount check failed near ${PASSWORD}`);
        },
      });
    },
    refusedWith("mount-unverified"),
  ],
  [
    "bootRoot removed",
    async () => {
      const f = await fixture();
      await fs.rm(f.bootRoot, { recursive: true });
      return f.read();
    },
    refusedWith("mount-unverified"),
  ],
  [
    "bootRoot replaced by a symlink",
    async () => {
      const f = await fixture();
      await replaceRootWithLink(f);
      return f.read();
    },
    refusedWith("root-changed"),
  ],
  [
    "bootRoot replaced by a symlink the stand-in reports by the link's own identity",
    async () => {
      const f = await fixture();
      await replaceRootWithLink(f);
      const { rootId } = await rootIdOf(f.bootRoot);
      return f.read({ inspectBootMount: async () => ({ ...f.answer, rootId }) });
    },
    refusedWith("path-unsafe"),
  ],
  [
    "bootRoot is a regular file the stand-in reports",
    async () => {
      const f = await fixture();
      await fs.rm(f.bootRoot, { recursive: true });
      await fs.writeFile(f.bootRoot, wifiText());
      const { rootId } = await rootIdOf(f.bootRoot);
      return f.read({ inspectBootMount: async () => ({ ...f.answer, rootId }) });
    },
    refusedWith("path-unsafe"),
  ],
  [
    "bootRoot mode 0775",
    async () => {
      const f = await fixture();
      await fs.chmod(f.bootRoot, 0o775);
      return f.read();
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "bootRoot mode 0757",
    async () => {
      const f = await fixture();
      await fs.chmod(f.bootRoot, 0o757);
      return f.read();
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "waitron-recovery mode 0750",
    async () => {
      const f = await fixture();
      await fs.chmod(f.folder, 0o750);
      return f.read();
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "waitron-recovery mode 0701",
    async () => {
      const f = await fixture();
      await fs.chmod(f.folder, 0o701);
      return f.read();
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "wifi.json mode 0640",
    async () => {
      const f = await fixture();
      await fs.chmod(f.recordPath, 0o640);
      return f.read();
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "wifi.json mode 0604",
    async () => {
      const f = await fixture();
      await fs.chmod(f.recordPath, 0o604);
      return f.read();
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "bootRoot owner wrong",
    async () => {
      const f = await fixture();
      return f.read({ io: countingIo({ lstat: lstatAt(f.bootRoot, foreignOwner) }).io });
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "waitron-recovery owner wrong",
    async () => {
      const f = await fixture();
      return f.read({ io: countingIo({ lstat: lstatAt(f.folder, foreignOwner) }).io });
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "wifi.json owner wrong",
    async () => {
      const f = await fixture();
      const open = openWith({
        stat: (target) => async (options) => foreignOwner(await target.stat(options)),
      });
      return f.read({ io: countingIo({ open }).io });
    },
    refusedWith("permissions-unsafe"),
  ],
  [
    "io.open throws an EIO error",
    async () => {
      const f = await fixture();
      const open = async () => {
        throw errnoError("EIO");
      };
      return f.read({ io: countingIo({ open }).io });
    },
    refusedWith("io-failed"),
  ],
  [
    "lstat of bootRoot fails other than ENOENT",
    async () => {
      const f = await fixture();
      const lstat = lstatAt(f.bootRoot, () => {
        throw errnoError("EACCES");
      });
      return f.read({ io: countingIo({ lstat }).io });
    },
    refusedWith("io-failed"),
  ],
  [
    "lstat of waitron-recovery fails other than ENOENT",
    async () => {
      const f = await fixture();
      const lstat = lstatAt(f.folder, () => {
        throw errnoError("EACCES");
      });
      return f.read({ io: countingIo({ lstat }).io });
    },
    refusedWith("io-failed"),
  ],
  [
    "a file operation that throws something other than an Error",
    async () => {
      const f = await fixture();
      const open = async () => {
        throw null;
      };
      return f.read({ io: countingIo({ open }).io });
    },
    refusedWith("io-failed"),
  ],
  [
    "a corrupt record holding the password",
    async () => (await fixture({ record: wifiText({ hidden: "no" }) })).read(),
    refusedWith("record-corrupt"),
  ],
  [
    "an io.open whose error message and properties hold the password",
    async () => {
      const f = await fixture();
      const open = async () => {
        throw Object.assign(new Error(`cannot open: ${PASSWORD}`), {
          code: "EIO",
          psk: PASSWORD,
          cause: new Error(PASSWORD),
        });
      };
      return f.read({ io: countingIo({ open }).io });
    },
    refusedWith("io-failed"),
  ],
  [
    "a handle whose stat throws an error holding the password",
    async () => {
      const f = await fixture();
      const open = openWith({
        stat: () => async () => {
          throw Object.assign(new Error(`stat failed: ${PASSWORD}`), { psk: PASSWORD });
        },
      });
      return f.read({ io: countingIo({ open }).io });
    },
    refusedWith("io-failed"),
  ],
  [
    "a handle whose read throws an error holding the password",
    async () => {
      const f = await fixture();
      const open = openWith({
        read: () => async () => {
          throw new Error(`read failed: ${PASSWORD}`);
        },
      });
      return f.read({ io: countingIo({ open }).io });
    },
    refusedWith("io-failed"),
  ],
];

const mountAnswers = [
  ["answers with an extra key", (a) => ({ ...a, extra: true })],
  ["answers without rootId", ({ bootRoot }) => ({ bootRoot })],
  ['answers rootId "x"', (a) => ({ ...a, rootId: "x" })],
  ["answers a numeric rootId", (a) => ({ ...a, rootId: 12 })],
  ["answers another bootRoot", (a) => ({ ...a, bootRoot: `${a.bootRoot}-other` })],
  ["answers null", () => null],
  [
    "answers a rootId that throws, holding the password, when read",
    (a) => ({
      bootRoot: a.bootRoot,
      get rootId() {
        throw new Error(`rootId unreadable: ${PASSWORD}`);
      },
    }),
  ],
  [
    "answers a Proxy whose keys throw when listed",
    () =>
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error(PASSWORD);
          },
        },
      ),
  ],
];

describe("createWifiRecordReader reads the one fixed record", () => {
  it("a valid record → loaded, frozen, and the one path opened is …/waitron-recovery/wifi.json", async () => {
    const f = await fixture();
    handles.opened = handles.closed = 0;
    const result = await f.read();
    expect(result).toEqual(LOADED);
    expect(Object.isFrozen(result)).toBe(true);
    expect(handles).toEqual({ opened: 1, closed: 1 });
    expect(opened(f)).toEqual([f.recordPath]);
    expect(f.counting.log).toEqual([
      ["lstat", f.bootRoot],
      ["lstat", f.folder],
      ["open", f.recordPath],
    ]);
  });

  it("opens the record read-only, without following a link and without waiting on a FIFO", async () => {
    const f = await fixture();
    const open = vi.fn(fs.open);
    await f.read({ io: { lstat: fs.lstat, open } });
    expect(open).toHaveBeenCalledWith(
      f.recordPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  });

  it("the default io reads the record", async () => {
    const f = await fixture();
    const reader = createWifiRecordReader({
      bootRoot: f.bootRoot,
      ownerUid: process.getuid(),
      inspectBootMount: f.inspectBootMount,
    });
    expect(await reader.read()).toEqual(LOADED);
  });

  it("bootRoot 0755 with the folder 0700 and the record 0600 → loaded (the positive control)", async () => {
    const f = await fixture();
    expect((await fs.lstat(f.bootRoot)).mode & 0o777).toBe(0o755);
    expect(await f.read()).toEqual(LOADED);
  });

  it("ca.key, server.key and recovery.key beside wifi.json → loaded, and none was opened or lstat'd", async () => {
    const f = await fixture();
    for (const name of ["ca.key", "server.key", "recovery.key"])
      await f.writeFile(name, "secret\n");
    expect(await f.read()).toEqual(LOADED);
    expect(touched(f)).toEqual([f.bootRoot, f.folder, f.recordPath]);
  });

  it("an io that throws on any property besides lstat and open → loaded", async () => {
    const f = await fixture();
    const io = new Proxy(
      { lstat: fs.lstat, open: fs.open },
      {
        get(target, key) {
          if (key === "lstat" || key === "open") return target[key];
          throw new Error(`the reader asked io for ${String(key)}`);
        },
      },
    );
    expect(await f.read({ io })).toEqual(LOADED);
  });
});

describe("createWifiRecordReader answers absent or refused", () => {
  it.each(nonLoadedCases)("%s, and every handle opened is closed", async (_name, run, expected) => {
    handles.opened = handles.closed = 0;
    const result = await run();
    expect(result).toEqual(expected);
    expect(Object.isFrozen(result)).toBe(true);
    expect(handles.closed).toBe(handles.opened);
  });

  it("the cases that open the record open more than five handles between them, so the close check above can fail", async () => {
    handles.opened = handles.closed = 0;
    for (const [, run] of nonLoadedCases) await run();
    expect(handles.opened).toBeGreaterThan(5);
  });

  it("only a valid wifi.json.next → absent, and .next was never opened or lstat'd", async () => {
    const f = await fixture({ record: null });
    await f.writeFile("wifi.json.next", wifiText());
    expect(await f.read()).toEqual({ kind: "absent" });
    expect(touched(f)).toEqual([f.bootRoot, f.folder, f.recordPath]);
  });

  it("a corrupt wifi.json beside a valid wifi.json.next → record-corrupt, .next never opened", async () => {
    const f = await fixture({ record: "{}\n" });
    await f.writeFile("wifi.json.next", wifiText());
    expect(await f.read()).toEqual(refusedWith("record-corrupt"));
    expect(opened(f)).toEqual([f.recordPath]);
  });

  it("no waitron-recovery folder → absent, and nothing inside it was opened", async () => {
    const f = await fixture({ folder: false });
    expect(await f.read()).toEqual({ kind: "absent" });
    expect(touched(f)).toEqual([f.bootRoot, f.folder]);
  });

  it("stat reports 100 bytes but the file holds 2000 → record-oversized, after reading at most 1025 bytes through the handle", async () => {
    const f = await fixture({ record: wifiText() + " ".repeat(2000) });
    let bytesRead = 0;
    const whole = vi.fn();
    const open = openWith({
      stat: (target) => async (options) =>
        statsWith(await target.stat(options), { size: () => 100 }),
      read:
        (target) =>
        async (...args) => {
          const answer = await target.read(...args);
          bytesRead += answer.bytesRead;
          return answer;
        },
      readFile:
        (target) =>
        (...args) => (whole(), target.readFile(...args)),
    });
    expect(await f.read({ io: { lstat: fs.lstat, open } })).toEqual(
      refusedWith("record-oversized"),
    );
    expect(whole).not.toHaveBeenCalled();
    expect(bytesRead).toBe(1025);
  });

  it("a 1025-byte file → record-oversized, and the handle read no bytes", async () => {
    const record = wifiText() + " ".repeat(1025 - Buffer.byteLength(wifiText()));
    const f = await fixture({ record });
    expect((await fs.stat(f.recordPath)).size).toBe(1025);
    const reads = vi.fn();
    const open = openWith({
      read:
        (target) =>
        (...args) => (reads(), target.read(...args)),
      readFile:
        (target) =>
        (...args) => (reads(), target.readFile(...args)),
    });
    expect(await f.read({ io: { lstat: fs.lstat, open } })).toEqual(
      refusedWith("record-oversized"),
    );
    expect(reads).not.toHaveBeenCalled();
  });

  it("a 1024-byte file reaches the parser, which refuses its padding as record-corrupt", async () => {
    const f = await fixture({
      record: wifiText() + " ".repeat(1024 - Buffer.byteLength(wifiText())),
    });
    expect((await fs.stat(f.recordPath)).size).toBe(1024);
    expect(await f.read()).toEqual(refusedWith("record-corrupt"));
  });
});

describe("createWifiRecordReader checks the boot mount first", () => {
  it("the stand-in throws → mount-unverified, zero io calls", async () => {
    const f = await fixture();
    const result = await f.read({
      inspectBootMount: async () => {
        throw new Error("no mount");
      },
    });
    expect(result).toEqual(refusedWith("mount-unverified"));
    expect(f.counting.log).toEqual([]);
  });

  it.each(mountAnswers)(
    "the stand-in %s → mount-unverified, zero io calls",
    async (_name, change) => {
      const f = await fixture();
      const result = await f.read({ inspectBootMount: async () => change(f.answer) });
      expect(result).toEqual(refusedWith("mount-unverified"));
      expect(f.counting.log).toEqual([]);
    },
  );

  it("bootRoot removed → mount-unverified after one lstat", async () => {
    const f = await fixture();
    await fs.rm(f.bootRoot, { recursive: true });
    expect(await f.read()).toEqual(refusedWith("mount-unverified"));
    expect(f.counting.log).toEqual([["lstat", f.bootRoot]]);
  });

  it("rootId with the right inode but another device → root-changed", async () => {
    const f = await fixture();
    const { dev, ino } = await rootIdOf(f.bootRoot);
    const result = await f.read({
      inspectBootMount: async () => ({ ...f.answer, rootId: `${dev + 1n}:${ino}` }),
    });
    expect(result).toEqual(refusedWith("root-changed"));
  });

  it("rootId with the right device but another inode → root-changed", async () => {
    const f = await fixture();
    const { dev, ino } = await rootIdOf(f.bootRoot);
    const result = await f.read({
      inspectBootMount: async () => ({ ...f.answer, rootId: `${dev}:${ino + 1n}` }),
    });
    expect(result).toEqual(refusedWith("root-changed"));
  });

  it("the stand-in is called once per read, with no arguments", async () => {
    const f = await fixture();
    const reader = f.make();
    await reader.read();
    await reader.read();
    expect(f.inspectBootMount).toHaveBeenCalledTimes(2);
    expect(f.inspectBootMount.mock.calls).toEqual([[], []]);
  });
});

describe("the fixed production entry point", () => {
  it("BOOT_ROOT is /boot", () => {
    expect(BOOT_ROOT).toBe("/boot");
  });

  it("readActiveWifiRecord() → refused mount-unverified, frozen, with no file call", async () => {
    fsCalls.log.length = 0;
    const result = await readActiveWifiRecord();
    expect(result).toEqual(refusedWith("mount-unverified"));
    expect(Object.isFrozen(result)).toBe(true);
    expect(fsCalls.log).toEqual([]);
  });
});

describe("createWifiRecordReader refuses bad deps at construction", () => {
  it.each([
    ["a relative bootRoot", { bootRoot: "boot" }],
    ['"/tmp/x/../y"', { bootRoot: "/tmp/x/../y" }],
    ["a trailing slash", { bootRoot: "/boot/" }],
    ["an empty bootRoot", { bootRoot: "" }],
    ["a non-string bootRoot", { bootRoot: 7 }],
    ["ownerUid -1", { ownerUid: -1 }],
    ["ownerUid 1.5", { ownerUid: 1.5 }],
    ['ownerUid "0"', { ownerUid: "0" }],
    ["inspectBootMount missing", { inspectBootMount: undefined }],
    ["io without open", { io: { lstat: vi.fn() } }],
    ["io without lstat", { io: { open: vi.fn() } }],
    ["io null", { io: null }],
    ["io a function", { io: Object.assign(() => {}, { lstat: vi.fn(), open: vi.fn() }) }],
    ["an extra key", { extra: true }],
  ])("%s → throws wifi_record.deps_invalid, with zero io and seam calls", async (_name, change) => {
    const f = await fixture();
    const deps = {
      bootRoot: f.bootRoot,
      ownerUid: process.getuid(),
      inspectBootMount: f.inspectBootMount,
      io: f.counting.io,
      ...change,
    };
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete deps[key];
    expect(() => createWifiRecordReader(deps)).toThrow(DEPS_INVALID);
    expect(f.counting.log).toEqual([]);
    expect(f.inspectBootMount).not.toHaveBeenCalled();
    for (const value of Object.values(change)) {
      for (const fn of [value?.lstat, value?.open]) if (fn) expect(fn).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an array", []],
  ])("deps %s → throws wifi_record.deps_invalid", (_name, deps) => {
    expect(() => createWifiRecordReader(/** @type {any} */ (deps))).toThrow(DEPS_INVALID);
  });

  it("ownerUid 0 and no io are accepted", async () => {
    const f = await fixture();
    expect(() =>
      createWifiRecordReader({ bootRoot: f.bootRoot, ownerUid: 0, inspectBootMount: vi.fn() }),
    ).not.toThrow();
  });
});

describe("the Wi-Fi password never leaves in a refusal, an absence or output", () => {
  const forms = [
    PASSWORD,
    Buffer.from(PASSWORD, "utf8").toString("hex"),
    Buffer.from(PASSWORD, "utf8").toString("hex").toUpperCase(),
    Buffer.from(PASSWORD, "utf8").toString("base64"),
  ];
  const texts = (result) => [
    JSON.stringify(result),
    inspect(result, { depth: null, showHidden: true }),
  ];

  it("every refusal and absence holds no form of the password, and console.*, process.stdout.write and process.stderr.write were not called", async () => {
    const spies = [
      ...["log", "info", "warn", "error", "debug", "trace"].map((name) => vi.spyOn(console, name)),
      vi.spyOn(process.stdout, "write"),
      vi.spyOn(process.stderr, "write"),
    ];
    const results = [];
    for (const [, run] of nonLoadedCases) results.push(await run());
    for (const [, change] of mountAnswers) {
      const f = await fixture();
      results.push(await f.read({ inspectBootMount: async () => change(f.answer) }));
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(results.length).toBe(nonLoadedCases.length + mountAnswers.length);
    for (const result of results) {
      expect(result.kind).not.toBe("loaded");
      for (const text of texts(result)) for (const form of forms) expect(text).not.toContain(form);
    }
  });

  it("the loaded result does hold it (the positive control)", async () => {
    const result = await (await fixture()).read();
    expect(texts(result).every((text) => text.includes(PASSWORD))).toBe(true);
  });
});
