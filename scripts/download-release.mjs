/**
 * Downloads a pinned release asset's bytes, retrying the transient failures GitHub's release
 * downloads give anonymous callers: a 5xx answer or a network error, three attempts in all. A 4xx
 * answer fails at once. `GITHUB_TOKEN`, when set and not empty, is sent as a bearer token.
 */
import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";

const { AbortSignal } = globalThis;
const ATTEMPTS = 3;

/**
 * @param {string} url
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(ms: number) => Promise<unknown>} [options.sleep]
 * @param {(line: string) => void} [options.log] told of each failed attempt that will be retried
 * @param {number} [options.firstWaitMs] the wait before the second attempt; it doubles after that
 * @param {number} [options.attemptMs] each attempt's limit, reading the body included
 * @returns {Promise<Buffer>}
 */
export async function downloadRelease(
  url,
  {
    fetch = globalThis.fetch,
    env = process.env,
    sleep = delay,
    log = (line) => console.error(line),
    firstWaitMs = 2000,
    attemptMs = 30_000,
  } = {},
) {
  const token = env.GITHUB_TOKEN;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let failure = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    if (attempt > 1) await sleep(firstWaitMs * 2 ** (attempt - 2));
    const counted = `after ${attempt} attempt${attempt === 1 ? "" : "s"}`;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(attemptMs) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      failure = `${url} answered ${response.status} ${response.statusText} ${counted}`;
      // Close a refused connection even when its server never finishes the body.
      await response.body?.cancel().catch(() => {});
      if (response.status < 500) break;
    } catch (error) {
      failure = `${url} failed ${counted}: ${error}`;
    }
    if (attempt < ATTEMPTS) log(`${failure}; trying again`);
  }
  throw new Error(failure);
}
