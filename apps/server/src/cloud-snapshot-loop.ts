import { setTimeout as delay } from "node:timers/promises";
export async function runCloudSnapshotLoop(options: {
  worker: { tick(signal: AbortSignal): Promise<void> };
  signal: AbortSignal;
  onError(error: unknown): void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  let backoff = 60000;
  while (!options.signal.aborted) {
    let wait = 60000;
    try {
      await options.worker.tick(options.signal);
      backoff = 60000;
    } catch (error) {
      if (options.signal.aborted) return;
      options.onError(error);
      wait = backoff;
      backoff = Math.min(900000, backoff * 2);
    }
    if (options.signal.aborted) return;
    try {
      await sleep(wait, options.signal);
    } catch (error) {
      if (!options.signal.aborted) throw error;
    }
  }
}
