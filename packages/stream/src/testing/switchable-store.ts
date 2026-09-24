import { AppError } from "@waitron/shared";
import "../errors.js";
import type { BucketOperation } from "../errors.js";
import type { ListedObject, ObjectStore, PutCondition, StoredObject } from "../object-store.js";
import { createMemoryObjectStore, type Fault, type MemoryObjectStore } from "./memory-store.js";

/**
 * `createMemoryObjectStore` behind a switch that fails every call at once, where the memory store
 * faults one call at a time. It stamps `lastModified` from the clock it is given, and records this
 * package's answered writes and Litestream's uploads in one event log a `FakeLitestream` can share,
 * so a test can assert the order of bucket writes and child starts. A failed call throws the S3
 * store's error code with the status it reports: none for no answer, 403 for a refusal.
 */
export class SwitchableStore implements ObjectStore {
  /** `put <key>` for each of this package's writes answered as stored, `upload <key>` for Litestream's, in order. */
  readonly events: string[];
  /** Every call waits forever: a bucket that never answers. */
  hang = false;
  /** Every call fails with no answer (a refused connection): unreachable, not unusable. */
  down = false;
  /** Every call is refused 403: the bucket's key was revoked, or the bucket deleted. */
  denied = false;
  /** False makes a conditional write succeed anyway, as a store without conditional writes would. */
  honoursConditions = true;
  readonly #inner: MemoryObjectStore;
  #uploadedAt: Date | undefined;

  constructor(clock: () => Date, events: string[] = []) {
    this.#inner = createMemoryObjectStore({ now: () => this.#uploadedAt ?? clock() });
    this.events = events;
  }

  async get(key: string): Promise<StoredObject | null> {
    await this.#gate("get", key);
    return this.#inner.get(key);
  }

  async put(key: string, body: Uint8Array, cond?: PutCondition): Promise<{ etag: string }> {
    await this.#gate("put", key);
    const answer = await this.#inner.put(key, body, this.honoursConditions ? cond : undefined);
    this.events.push(`put ${key}`);
    return answer;
  }

  async list(prefix: string): Promise<ListedObject[]> {
    await this.#gate("list", prefix);
    return this.#inner.list(prefix);
  }

  async delete(key: string): Promise<void> {
    await this.#gate("delete", key);
    await this.#inner.delete(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.#gate("delete", keys[0]!);
    await this.#inner.deleteMany(keys);
  }

  /** Litestream's side of the bucket: a file written with no condition, last modified at `at`. */
  upload(key: string, at?: Date): void {
    this.#uploadedAt = at;
    // The memory store's put stores before its first await, so the object is there on return.
    void this.#inner.put(key, new Uint8Array());
    this.#uploadedAt = undefined;
    this.events.push(`upload ${key}`);
  }

  has(key: string): boolean {
    return this.#inner.snapshot().has(key);
  }

  /** The memory store's one-call fault, behind the switch. Name the key: an upload is a put too. */
  failNext(fault: Fault): void {
    this.#inner.failNext(fault);
  }

  async #gate(operation: BucketOperation, key: string): Promise<void> {
    if (this.hang) await new Promise<never>(() => {});
    if (this.down) {
      throw new AppError("backup.stream_request_failed", {
        operation,
        key,
        status: null,
        name: "ECONNREFUSED",
      });
    }
    if (this.denied) {
      throw new AppError("backup.stream_request_failed", {
        operation,
        key,
        status: 403,
        name: "AccessDenied",
      });
    }
  }
}
