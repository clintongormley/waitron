import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {object} HostStateIdentity  what the mount check saw
 * @property {string} hostRoot
 * @property {string} diskUuid  the opened container's LUKS UUID
 * @property {string} rootId  "<dev>:<ino>" of hostRoot
 *
 * @typedef {object} DiskRecoveryIo
 * @property {typeof fs.lstat} lstat
 * @property {typeof fs.open} open
 * @property {typeof fs.mkdir} mkdir
 * @property {typeof fs.writeFile} writeFile
 * @property {typeof fs.rename} rename
 * @property {typeof fs.unlink} unlink
 * @property {typeof fs.readdir} readdir
 *
 * @typedef {object} DiskRecoveryDeps
 * @property {string} hostRoot  absolute, realpath-equal
 * @property {number} ownerUid  0 in production; tests pass process.getuid()
 * @property {() => Promise<HostStateIdentity>} inspectHostState
 * @property {DiskRecoveryIo} [io]  test-only override of the file operations
 *
 * @typedef {object} DiskRecoveryStore
 * @property {(input:{diskUuid:string}, consume:(key:Uint8Array)=>Promise<void>) => Promise<void>} withKey
 */

export const HOST_ROOT = "/var/lib/waitron-host";

const CODE = "disk_recovery.refused";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_HEX = /^[0-9a-f]{64}$/;
const MAX_RECORD_BYTES = 1024;
const FOLDER = "disk-recovery";

/** @type {DiskRecoveryIo} */
const defaultIo = {
  lstat: fs.lstat,
  open: fs.open,
  mkdir: fs.mkdir,
  writeFile: fs.writeFile,
  rename: fs.rename,
  unlink: fs.unlink,
  readdir: fs.readdir,
};

/** @param {string} reason */
function refusal(reason) {
  return Object.assign(new Error(CODE), { code: CODE, reason });
}

/** @param {unknown} error */
function isRefusal(error) {
  return error instanceof Error && /** @type {{code?:unknown}} */ (error).code === CODE;
}

/** @param {unknown} value */
function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

/** @param {unknown} value @param {string[]} keys */
function exactRecord(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** @param {string} hex */
function allZero(hex) {
  return /^0+$/.test(hex);
}

/** @param {unknown} error */
function errnoCode(error) {
  return /** @type {{code?:unknown}} */ (error)?.code;
}

/**
 * @param {string} text
 * @param {string} diskUuid  the UUID the record's file name carries
 * @returns {string} the key as 64 lowercase hex characters
 */
function parseRecord(text, diskUuid) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw refusal("record-corrupt");
  }
  if (
    !exactRecord(value, ["version", "diskUuid", "key"]) ||
    value.version !== 1 ||
    !isUuid(value.diskUuid) ||
    typeof value.key !== "string" ||
    !KEY_HEX.test(value.key) ||
    allZero(value.key) ||
    JSON.stringify({ version: 1, diskUuid: value.diskUuid, key: value.key }) + "\n" !== text
  )
    throw refusal("record-corrupt");
  if (value.diskUuid !== diskUuid) throw refusal("record-mismatch");
  return value.key;
}

/** @param {string} hex */
function decodeKey(hex) {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return key;
}

/**
 * Test seam and the future host service's constructor; callers never take hostRoot from a request.
 * @param {DiskRecoveryDeps} deps
 * @returns {DiskRecoveryStore}
 */
export function createDiskRecoveryStore(deps) {
  const { hostRoot, ownerUid, inspectHostState, io = defaultIo } = deps;
  let tail = Promise.resolve();

  /** @template T @param {() => Promise<T>} run @returns {Promise<T>} */
  function inTurn(run) {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** @param {{uid:number|bigint, mode:number|bigint}} stats */
  function ownedSafely(stats) {
    return Number(stats.uid) === ownerUid && (Number(stats.mode) & 0o077) === 0;
  }

  /** @param {string} diskUuid */
  async function checkMount(diskUuid) {
    let seen;
    try {
      seen = await inspectHostState();
    } catch {
      throw refusal("mount-unverified");
    }
    if (
      !exactRecord(seen, ["hostRoot", "diskUuid", "rootId"]) ||
      !isUuid(seen.diskUuid) ||
      typeof seen.rootId !== "string" ||
      !/^\d+:\d+$/.test(seen.rootId) ||
      seen.hostRoot !== hostRoot
    )
      throw refusal("mount-unverified");
    if (seen.diskUuid !== diskUuid) throw refusal("disk-mismatch");

    let root;
    try {
      root = await io.lstat(hostRoot, { bigint: true });
    } catch (error) {
      if (errnoCode(error) === "ENOENT") throw refusal("mount-unverified");
      throw error;
    }
    if (`${root.dev}:${root.ino}` !== seen.rootId) throw refusal("root-changed");
    if (root.isSymbolicLink() || !root.isDirectory()) throw refusal("path-unsafe");
    if (!ownedSafely(root)) throw refusal("permissions-unsafe");
  }

  /** @param {string} diskUuid @returns {Promise<string>} the key's hex */
  async function readRecord(diskUuid) {
    await checkMount(diskUuid);
    const folder = join(hostRoot, FOLDER);
    let stats;
    try {
      stats = await io.lstat(folder, { bigint: true });
    } catch (error) {
      if (errnoCode(error) === "ENOENT") throw refusal("record-missing");
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw refusal("path-unsafe");
    if (!ownedSafely(stats)) throw refusal("permissions-unsafe");

    // Only root can write in root-only parents, so only root could swap a folder between these
    // checks and the open below, and root is already trusted (spec §7.5).
    let handle;
    try {
      handle = await io.open(
        join(folder, `${diskUuid}.json`),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (errnoCode(error) === "ENOENT") throw refusal("record-missing");
      if (errnoCode(error) === "ELOOP") throw refusal("path-unsafe");
      throw error;
    }
    try {
      const record = await handle.stat();
      if (!record.isFile()) throw refusal("path-unsafe");
      if (!ownedSafely(record)) throw refusal("permissions-unsafe");
      if (record.size > MAX_RECORD_BYTES) throw refusal("record-corrupt");
      return parseRecord(await handle.readFile("utf8"), diskUuid);
    } finally {
      await handle.close();
    }
  }

  return {
    async withKey(input, consume) {
      const diskUuid = input?.diskUuid;
      if (!isUuid(diskUuid)) throw refusal("input-invalid");
      let hex;
      try {
        hex = await inTurn(() => readRecord(diskUuid));
      } catch (error) {
        throw isRefusal(error) ? error : refusal("io-failed");
      }
      const key = decodeKey(hex);
      try {
        await consume(key);
      } finally {
        key.fill(0);
      }
    },
  };
}

const fixedStore = createDiskRecoveryStore({
  hostRoot: HOST_ROOT,
  ownerUid: 0,
  inspectHostState: async () => {
    throw refusal("mount-unverified");
  },
});

/**
 * Fixed production entry point. No inspectHostState adapter exists until the Linux rig, so it
 * refuses "mount-unverified" before any file call.
 * @param {{diskUuid:string}} input
 * @param {(key:Uint8Array)=>Promise<void>} consume
 */
export async function withDiskRecovery(input, consume) {
  return fixedStore.withKey(input, consume);
}
