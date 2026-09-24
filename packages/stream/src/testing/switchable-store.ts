import { AppError } from "@waitron/shared";
import "../errors.js";
import type { BucketOperation } from "../errors.js";
import type { ListedObject, ObjectStore, PutCondition, StoredObject } from "../object-store.js";

interface Stored {
  body: Uint8Array;
  etag: string;
  lastModified: Date;
}

/**
 * An in-memory bucket switched whole, where `createMemoryObjectStore` faults one call at a time. It
 * honours both conditional writes, stamps `lastModified` from the clock it is given, and records
 * this package's writes and Litestream's uploads in one event log a `FakeLitestream` can share, so a
 * test can assert the order of bucket writes and child starts. The errors are the shapes the S3
 * store throws, so `probeBucket` reads them as it reads the real ones.
 */
export class SwitchableStore implements ObjectStore {
  readonly objects = new Map<string, Stored>();
  /** `put <key>` for this package's writes, `upload <key>` for Litestream's, in order. */
  readonly events: string[];
  /** Every call waits forever: a bucket that never answers. */
  hang = false;
  /** Every call fails with no answer (a refused connection): unreachable, not unusable. */
  down = false;
  /** Every call is refused 403: the bucket's key was revoked, or the bucket deleted. */
  denied = false;
  /** False makes a conditional write succeed anyway, as a store without conditional writes would. */
  honoursConditions = true;
  /** A put whose key this matches is STORED, and then its answer is lost (it throws). Cleared after one use. */
  loseAnswerTo: ((key: string) => boolean) | undefined;
  readonly #clock: () => Date;
  #version = 0;

  constructor(clock: () => Date, events: string[] = []) {
    this.#clock = clock;
    this.events = events;
  }

  async get(key: string): Promise<StoredObject | null> {
    await this.#gate("get", key);
    const stored = this.objects.get(key);
    return stored === undefined ? null : { body: stored.body, etag: stored.etag };
  }

  async put(key: string, body: Uint8Array, cond?: PutCondition): Promise<{ etag: string }> {
    await this.#gate("put", key);
    const existing = this.objects.get(key);
    if (this.honoursConditions && cond !== undefined) {
      const refused =
        "ifNoneMatch" in cond ? existing !== undefined : existing?.etag !== cond.ifMatch;
      if (refused) throw new AppError("backup.stream_precondition_failed", { key });
    }
    const etag = this.#write(key, body, "put");
    if (this.loseAnswerTo?.(key) === true) {
      this.loseAnswerTo = undefined;
      throw new Error("connection reset after the write");
    }
    return { etag };
  }

  async list(prefix: string): Promise<ListedObject[]> {
    await this.#gate("list", prefix);
    return [...this.objects]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, stored]) => ({ key, lastModified: stored.lastModified }));
  }

  async delete(key: string): Promise<void> {
    await this.#gate("delete", key);
    this.objects.delete(key);
  }

  /** Litestream's side of the bucket: a file written with no condition. */
  upload(key: string): void {
    this.#write(key, new Uint8Array(), "upload");
  }

  #write(key: string, body: Uint8Array, kind: "put" | "upload"): string {
    this.#version += 1;
    const etag = `"${this.#version}"`;
    this.objects.set(key, { body, etag, lastModified: this.#clock() });
    this.events.push(`${kind} ${key}`);
    return etag;
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
