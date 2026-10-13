import { AppError, type ErrorParams } from "@waitron/shared";
import type { ObjectStore, StoreCall } from "@waitron/stream";
// The registry of the code this file throws.
import "@waitron/stream";

type BucketOperation = ErrorParams["backup.stream_request_failed"]["operation"];

/** A bound on each bucket call a restore makes; a `list` is one call however many pages it reads. */
export const BUCKET_CALL_TIMEOUT_MS = 60_000;

/**
 * Refuses any call the bucket has not answered within `timeoutMs` as `backup.stream_request_failed`
 * with no status, the code a call that got no answer already carries, and cancels the call through
 * the store's signal. A caller's own `call.signal` reaches the store too, and its cancel answers with
 * the store's own error.
 */
export function boundObjectStore(
  store: ObjectStore,
  timeoutMs: number = BUCKET_CALL_TIMEOUT_MS,
): ObjectStore {
  const bounded = <T>(
    operation: BucketOperation,
    key: string,
    call: StoreCall | undefined,
    send: (call: StoreCall) => Promise<T>,
  ): Promise<T> => {
    const limit = new AbortController();
    const signal =
      call?.signal === undefined ? limit.signal : AbortSignal.any([call.signal, limit.signal]);
    const answer = send({ signal });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new AppError("backup.stream_request_failed", {
            operation,
            key,
            status: null,
            name: "TimedOut",
          }),
        );
        limit.abort();
      }, timeoutMs);
      answer.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };
  return {
    get: (key, call) => bounded("get", key, call, (c) => store.get(key, c)),
    put: (key, body, condition, call) =>
      bounded("put", key, call, (c) => store.put(key, body, condition, c)),
    list: (prefix, call) => bounded("list", prefix, call, (c) => store.list(prefix, c)),
    delete: (key, call) => bounded("delete", key, call, (c) => store.delete(key, c)),
    deleteMany: (keys, call) =>
      bounded("delete", keys[0] ?? "", call, (c) => store.deleteMany(keys, c)),
  };
}
