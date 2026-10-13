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

/** `wait(ms)`, ended early, without error, when the signal is cancelled. */
export function cancellableWait(
  wait: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal === undefined) return wait(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const stop = () => resolve();
    signal.addEventListener("abort", stop, { once: true });
    wait(ms)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
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
