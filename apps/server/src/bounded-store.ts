import { AppError, type ErrorParams } from "@waitron/shared";
import type { ObjectStore } from "@waitron/stream";
// The registry of the code this file throws.
import "@waitron/stream";

type BucketOperation = ErrorParams["backup.stream_request_failed"]["operation"];

/** A bound on each bucket call a restore makes; a `list` is one call however many pages it reads.
 * `createS3ObjectStore` gives its client no timeout of its own. */
export const BUCKET_CALL_TIMEOUT_MS = 60_000;

/**
 * Refuses any call the bucket has not answered within `timeoutMs` as `backup.stream_request_failed`
 * with no status, the code a call that got no answer already carries. The request itself is
 * abandoned, not cancelled: the store interface takes no way to stop it.
 */
export function boundObjectStore(
  store: ObjectStore,
  timeoutMs: number = BUCKET_CALL_TIMEOUT_MS,
): ObjectStore {
  const bounded = <T>(operation: BucketOperation, key: string, call: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AppError("backup.stream_request_failed", {
              operation,
              key,
              status: null,
              name: "TimedOut",
            }),
          ),
        timeoutMs,
      );
    });
    return Promise.race([call, timedOut]).finally(() => clearTimeout(timer));
  };
  return {
    get: (key) => bounded("get", key, store.get(key)),
    put: (key, body, condition) => bounded("put", key, store.put(key, body, condition)),
    list: (prefix) => bounded("list", prefix, store.list(prefix)),
    delete: (key) => bounded("delete", key, store.delete(key)),
    deleteMany: (keys) => bounded("delete", keys[0] ?? "", store.deleteMany(keys)),
  };
}
