import { setTimeout as delay } from "node:timers/promises";
import type { AppError } from "@waitron/shared";
import type { BucketOperation } from "./errors.js";
import { requestFailed } from "./s3-client.js";

export function callCancelled(operation: BucketOperation, key: string): AppError {
  return requestFailed(operation, key, null, "AbortError");
}

export function throwIfCancelled(
  signal: AbortSignal | undefined,
  operation: BucketOperation,
  key: string,
): void {
  if (signal?.aborted) throw callCancelled(operation, key);
}

/** A sleep that ends early, and quietly, when `signal` aborts. */
export async function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
}

/**
 * Starts `send` unless `signal` is already cancelled, then answers its outcome, or the cancellation
 * as soon as `signal` aborts, whichever comes first.
 * The client's own wait between attempts may outlive a cancelled call; it sends nothing more
 * (`s3-store.cancel.test.ts`).
 */
export function sendUnlessCancelled<T>(
  send: () => Promise<T>,
  signal: AbortSignal | undefined,
  operation: BucketOperation,
  key: string,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(callCancelled(operation, key));
  const work = send();
  if (signal === undefined) return work;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(callCancelled(operation, key));
    signal.addEventListener("abort", stop, { once: true });
    // Also settles a call already answered as cancelled, so its later failure is not unhandled.
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/**
 * Stops starting work at the first failure or once the signal is cancelled, and answers only once
 * the work in flight has settled. A cancellation alone does not reject: the caller checks the signal.
 */
export async function eachUntilFailure<T>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && !signal?.aborted && next < items.length) {
      const item = items[next]!;
      next += 1;
      try {
        await work(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  const outcomes = await Promise.allSettled(workers);
  const refusal = outcomes.find((outcome) => outcome.status === "rejected");
  if (refusal !== undefined) throw refusal.reason;
}
