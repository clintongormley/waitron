import { createHash } from "node:crypto";
import { AppError } from "@waitron/shared";
import "../errors.js";
import type { BucketOperation as Operation } from "../errors.js";
import type {
  ListedObject,
  ObjectStore,
  PutCondition,
  StoreCall,
  StoredObject,
} from "../object-store.js";

type Entry = { body: Uint8Array; etag: string; lastModified: Date };

export type Fault = {
  operation: Operation;
  /** Only a call on this key; any key when absent. */
  key?: string;
  error: Error;
  /** For a put: store the body FIRST, then fail — a write that landed and lost its answer. */
  landed?: boolean;
};

export interface MemoryObjectStore extends ObjectStore {
  /** A copy of what is held. */
  snapshot(): Map<string, Entry>;
  failNext(fault: Fault): void;
  /** `signal` only for a call that carried one; the store itself does not act on it. */
  readonly calls: {
    operation: Operation;
    key: string;
    condition?: PutCondition;
    signal?: AbortSignal;
  }[];
}

/**
 * An in-memory bucket with S3's conditional-write rules as the client documents them: "only if
 * absent" is refused when the key exists; "only if unchanged" is refused unless the version tag
 * matches. An "only if unchanged" against a missing object is refused here as a mismatch; what a
 * real store answers in that case is not established by anything in this package. Its `deleteMany`
 * runs its own single delete per key in turn, so it records one `delete` call per key, bypasses a
 * `delete` a test overrides by spreading the store, and stops at the first fault with the later
 * keys still held.
 */
export function createMemoryObjectStore(options: { now?: () => Date } = {}): MemoryObjectStore {
  const objects = new Map<string, Entry>();
  const faults: Fault[] = [];
  const calls: MemoryObjectStore["calls"] = [];
  const now = options.now ?? (() => new Date());

  function takeFault(operation: Operation, key: string): Fault | undefined {
    const index = faults.findIndex(
      (fault) => fault.operation === operation && (fault.key === undefined || fault.key === key),
    );
    return index === -1 ? undefined : faults.splice(index, 1)[0];
  }

  const signalOf = (call: StoreCall | undefined) =>
    call?.signal === undefined ? {} : { signal: call.signal };

  async function deleteOne(key: string, call?: StoreCall): Promise<void> {
    calls.push({ operation: "delete", key, ...signalOf(call) });
    const fault = takeFault("delete", key);
    if (fault) throw fault.error;
    objects.delete(key);
  }

  return {
    calls,
    snapshot: () =>
      new Map(
        [...objects].map(([key, entry]) => [
          key,
          { ...entry, body: entry.body.slice(), lastModified: new Date(entry.lastModified) },
        ]),
      ),
    failNext(fault) {
      faults.push(fault);
    },
    async get(key, call): Promise<StoredObject | null> {
      calls.push({ operation: "get", key, ...signalOf(call) });
      const fault = takeFault("get", key);
      if (fault) throw fault.error;
      const entry = objects.get(key);
      return entry ? { body: entry.body.slice(), etag: entry.etag } : null;
    },
    async put(key, body, condition, call) {
      calls.push({ operation: "put", key, condition, ...signalOf(call) });
      const fault = takeFault("put", key);
      if (fault && !fault.landed) throw fault.error;
      const existing = objects.get(key);
      const refused =
        condition !== undefined &&
        ("ifNoneMatch" in condition
          ? existing !== undefined
          : existing?.etag !== condition.ifMatch);
      if (refused) throw new AppError("backup.stream_precondition_failed", { key });
      // S3's tag for a PUT stored unencrypted or with SSE-S3 is the MD5 of the bytes (API_Object).
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      objects.set(key, { body: body.slice(), etag, lastModified: new Date(now()) });
      if (fault) throw fault.error;
      return { etag };
    },
    async list(prefix, call): Promise<ListedObject[]> {
      calls.push({ operation: "list", key: prefix, ...signalOf(call) });
      const fault = takeFault("list", prefix);
      if (fault) throw fault.error;
      return [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => ({ key, lastModified: new Date(entry.lastModified) }));
    },
    delete: deleteOne,
    async deleteMany(keys, call) {
      for (const key of keys) await deleteOne(key, call);
    },
  };
}
