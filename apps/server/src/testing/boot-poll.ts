import { setTimeout as delay } from "node:timers/promises";

export const POLL_TRIES = 200;
export const POLL_INTERVAL_MS = 50;

/**
 * Polls `predicate` for its first defined result, or `undefined` once `tries` are spent. A promise
 * it returns is awaited, so a promise cannot itself be the found value.
 */
export async function poll<T>(
  predicate: () => T | undefined | Promise<T | undefined>,
  tries: number = POLL_TRIES,
): Promise<T | undefined> {
  for (let i = 0; i < tries; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(POLL_INTERVAL_MS);
  }
  return undefined;
}
