import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { fail } from "./contracts.mjs";

const magic = Buffer.from("a799-state-v1\n");
const fields = ["path", "kind", "mode", "bytes", "sha256"];
const sha256 = /^[a-f0-9]{64}$/;

export function checkPath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    /[\\:]/.test(path) ||
    Array.from(path).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    path.split("/").some((p) => !p || p === "." || p === ".." || /[. ]$/.test(p))
  )
    fail("archive.path", "relative canonical path required");
}
function shape(entry) {
  if (
    !entry ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    Object.keys(entry).length !== fields.length ||
    fields.some((f) => !Object.hasOwn(entry, f))
  )
    fail("archive.inventory", "entry shape");
  checkPath(entry.path);
  if (
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes < 0 ||
    (entry.kind === "file"
      ? entry.mode !== 384 || typeof entry.sha256 !== "string" || !sha256.test(entry.sha256)
      : entry.kind !== "directory" ||
        entry.mode !== 448 ||
        entry.bytes !== 0 ||
        entry.sha256 !== null)
  )
    fail("archive.inventory", "entry type, private mode or content identity");
}
export function validateInventory(inventory, limits) {
  for (const name of ["compressedBytes", "unpackedBytes", "entries", "perFileBytes"])
    if (!Number.isSafeInteger(limits?.[name]) || limits[name] <= 0)
      fail("archive.limit", "positive integer caps required");
  if (!Array.isArray(inventory) || !inventory.length)
    fail("archive.inventory", "external inventory required");
  if (inventory.length > limits.entries) fail("archive.limit", "entries");
  const seen = new Set();
  const directories = new Set();
  let bytes = 0;
  for (const entry of inventory) {
    shape(entry);
    const key = entry.path.normalize("NFC").toLowerCase();
    if (seen.has(key)) fail("archive.inventory", "duplicate or aliased path");
    seen.add(key);
    const slash = entry.path.lastIndexOf("/");
    if (slash >= 0 && !directories.has(entry.path.slice(0, slash)))
      fail("archive.inventory", "parent must precede child");
    if (entry.kind === "directory") directories.add(entry.path);
    if (entry.bytes > limits.perFileBytes) fail("archive.limit", "perFileBytes");
    bytes += entry.bytes;
    if (!Number.isSafeInteger(bytes) || bytes > limits.unpackedBytes)
      fail("archive.limit", "unpackedBytes");
  }
  return globalThis.structuredClone(inventory);
}
export function validateEntry(entry, inventory, limits) {
  const list = validateInventory(inventory, limits);
  if (!list.some((expected) => isDeepStrictEqual(expected, entry)))
    fail("archive.entry", "header differs from inventory");
}

// Headers contain only scalar values; inspecting each decoded key retains duplicate-key evidence.
export function parseHeader(bytes) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("archive.header", "UTF-8");
  }
  let i = 0;
  const space = () => {
    while (/\s/.test(source[i] ?? "") && i < source.length) i++;
  };
  const token = () => {
    space();
    const start = i;
    if (source[i] === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i++] === '"') break;
      }
    } else while (i < source.length && !/[\s,}]/.test(source[i])) i++;
    try {
      return JSON.parse(source.slice(start, i));
    } catch {
      fail("archive.header", "scalar JSON");
    }
  };
  const result = Object.create(null);
  space();
  if (source[i++] !== "{") fail("archive.header", "object required");
  for (;;) {
    const key = token();
    if (typeof key !== "string" || !fields.includes(key) || Object.hasOwn(result, key))
      fail("archive.header", "unknown or duplicate key");
    space();
    if (source[i++] !== ":") fail("archive.header", "colon required");
    const value = token();
    if (value !== null && !["string", "number"].includes(typeof value))
      fail("archive.header", "scalar required");
    result[key] = value;
    space();
    const separator = source[i++];
    if (separator === "}") break;
    if (separator !== ",") fail("archive.header", "separator required");
  }
  space();
  if (i !== source.length || Object.keys(result).length !== fields.length)
    fail("archive.header", "complete exact header required");
  try {
    return JSON.parse(source);
  } catch {
    fail("archive.header", "JSON syntax");
  }
}

export async function abortable(promise, signal, code) {
  if (signal?.aborted) {
    void Promise.resolve(promise).catch(() => {});
    fail(code, "aborted");
  }
  if (!signal) return promise;
  let listener;
  const stopped = new Promise((_, reject) => {
    listener = () => reject(new Error(`${code}: aborted`));
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([promise, stopped]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
function knownError(error) {
  return error instanceof Error && /^(archive\.|fetch\.)/.test(error.message);
}

export async function admitArchive(stream, inventory, limits, io) {
  const list = validateInventory(inventory, limits);
  const signal = io.signal;
  const hash = createHash("sha256");
  let compressed = 0;
  let unpacked = 0;
  async function* input() {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) fail("archive.format", "binary stream required");
      compressed += chunk.byteLength;
      if (compressed > limits.compressedBytes) fail("archive.limit", "compressedBytes");
      hash.update(chunk);
      yield chunk;
    }
  }
  const source = Readable.from(input());
  const gzip = createGunzip();
  source.on("error", (error) => gzip.destroy(error));
  source.pipe(gzip);
  const iterator = gzip[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  let ended = false;
  async function next() {
    const result = await abortable(iterator.next(), signal, "archive.cancelled");
    ended = result.done;
    if (ended) return;
    unpacked += result.value.length;
    if (unpacked > limits.unpackedBytes) fail("archive.limit", "unpackedBytes");
    buffer = result.value;
  }
  async function take(count) {
    const parts = [];
    let remaining = count;
    while (remaining) {
      if (!buffer.length && !ended) await next();
      if (!buffer.length) fail("archive.truncated", "incomplete frame");
      const size = Math.min(remaining, buffer.length);
      parts.push(buffer.subarray(0, size));
      buffer = buffer.subarray(size);
      remaining -= size;
    }
    return Buffer.concat(parts, count);
  }
  const identities = new Map();
  const used = new Set((io.sourceIdentities ?? []).map((s) => `${s.dev}:${s.ino}`));
  async function inspect(path, kind, mode) {
    const stat = await abortable(io.inspectEntry(path), signal, "archive.cancelled");
    if (
      !stat ||
      stat.kind !== kind ||
      stat.mode !== mode ||
      stat.ownerId !== io.ownerId ||
      !Number.isSafeInteger(stat.dev) ||
      !Number.isSafeInteger(stat.ino) ||
      stat.nlink < 1 ||
      (kind === "file" && stat.nlink !== 1)
    )
      fail("archive.placement", "type, ownership, mode or link count");
    const identity = `${stat.dev}:${stat.ino}`;
    if (identities.has(path) ? identities.get(path) !== identity : used.has(identity))
      fail("archive.placement", "inode changed or shared");
    identities.set(path, identity);
    used.add(identity);
    return stat;
  }
  async function parents(path) {
    await inspect("", "directory", 448);
    const parts = path.split("/");
    parts.pop();
    let parent = "";
    for (const part of parts) {
      parent = parent ? `${parent}/${part}` : part;
      await inspect(parent, "directory", 448);
    }
  }
  try {
    if (
      typeof io.root !== "string" ||
      !io.root.startsWith("/") ||
      typeof io.ownerId !== "string" ||
      !io.ownerId
    )
      fail("archive.placement", "owned root required");
    await inspect("", "directory", 448);
    if (!(await take(magic.length)).equals(magic)) fail("archive.format", "a799-state-v1 required");
    for (const expected of list) {
      const length = (await take(4)).readUInt32BE();
      if (!length || length > Buffer.byteLength(JSON.stringify(expected)) * 6)
        fail("archive.header", "bounded header length");
      const entry = parseHeader(await take(length));
      if (!isDeepStrictEqual(entry, expected))
        fail("archive.entry", "header differs from inventory");
      await parents(entry.path);
      if (entry.kind === "directory") {
        await abortable(io.createDirectory(entry), signal, "archive.cancelled");
        await inspect(entry.path, "directory", entry.mode);
      } else {
        const handle = await abortable(
          io.openExclusiveNoFollow(entry),
          signal,
          "archive.cancelled",
        );
        const opened = await inspect(entry.path, "file", entry.mode);
        if (
          !handle?.identity ||
          opened.dev !== handle.identity.dev ||
          opened.ino !== handle.identity.ino
        )
          fail("archive.placement", "opened inode differs");
        const contentHash = createHash("sha256");
        let remaining = entry.bytes;
        while (remaining) {
          const bytes = await take(Math.min(65536, remaining));
          remaining -= bytes.length;
          contentHash.update(bytes);
          await abortable(io.writeChunk(handle, bytes), signal, "archive.cancelled");
        }
        if (contentHash.digest("hex") !== entry.sha256) fail("archive.hash", "file checksum");
        await parents(entry.path);
        await inspect(entry.path, "file", entry.mode);
        await abortable(io.finishVerifiedFile(handle, entry), signal, "archive.cancelled");
        await inspect(entry.path, "file", entry.mode);
      }
    }
    if (!buffer.length && !ended) await next();
    if (buffer.length || !ended) fail("archive.trailing", "bytes after inventory");
    for (const entry of list) {
      await parents(entry.path);
      await inspect(entry.path, entry.kind, entry.mode);
    }
    return {
      root: io.root,
      ownerId: io.ownerId,
      inventory: list,
      archiveSha256: hash.digest("hex"),
    };
  } catch (error) {
    try {
      if (!Number.isSafeInteger(io.cleanupMs) || io.cleanupMs <= 0)
        fail("archive.cleanup", "explicit cleanup budget required");
      await abortable(
        Promise.resolve().then(() => io.removeOwnedPartial()),
        globalThis.AbortSignal.timeout(io.cleanupMs),
        "archive.cleanup",
      );
    } catch {
      fail("archive.cleanup", "owned partials unresolved");
    }
    if (knownError(error)) throw error;
    fail(
      error?.code?.startsWith("Z_") || error?.code === "ERR_STREAM_PREMATURE_CLOSE"
        ? "archive.gzip"
        : "archive.placement",
      "admission failed",
    );
  } finally {
    source.destroy();
    gzip.destroy();
  }
}
