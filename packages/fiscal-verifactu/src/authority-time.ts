import { randomUUID } from "node:crypto";
import type { AuthorityTimeSample } from "@waitron/fiscal";
import { QR_ENDPOINTS } from "@waitron/verifactu";
import { authenticatedHourHead } from "./hour-clock-internet.js";
import type { Entorno } from "./registro-row.js";

export const AUTHORITY_TIME_DEADLINE_MS = 5000;

interface AuthorityTimeDependencies {
  request?: (url: URL, signal: AbortSignal) => Promise<Response>;
  wall?: () => number;
  monotonic?: () => number;
  /** Tests only: production always asks the environment's QR validation host. */
  url?: string;
  deadlineMs?: number;
}

/**
 * AEAT's time, from the `Date` header of a HEAD to its public QR validation page over a verified
 * HTTPS connection; null on any failure. The response checks repeat those in
 * `observeInternetHourClock` (./hour-clock-internet.ts), which are not exported.
 */
export async function readAuthorityTime(
  environment: Entorno,
  deps: AuthorityTimeDependencies = {},
): Promise<AuthorityTimeSample | null> {
  const wall = deps.wall ?? Date.now;
  const monotonic = deps.monotonic ?? (() => performance.now());
  const request = deps.request ?? authenticatedHourHead;
  const deadlineMs = deps.deadlineMs ?? AUTHORITY_TIME_DEADLINE_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
      controller.abort();
    }, deadlineMs);
  });
  const read = async (): Promise<AuthorityTimeSample | null> => {
    const selected = deps.url ?? QR_ENDPOINTS[environment];
    if (selected === undefined) return null;
    let url = new URL(selected);
    const origin = url.origin;
    const nonce = randomUUID();
    const wallStartedMs = wall();
    const monotonicStartedMs = monotonic();
    for (let redirect = 0; redirect <= 2; redirect++) {
      url.searchParams.set("waitron_clock", nonce);
      const response = await request(url, controller.signal);
      void response.body?.cancel().catch(() => {});
      if (controller.signal.aborted) return null;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) return null;
        url = new URL(location, url);
        if (url.origin !== origin || url.username !== "" || url.password !== "") return null;
        continue;
      }
      const date = response.headers.get("date");
      const instant = date === null ? NaN : Date.parse(date);
      const age = response.headers.get("age");
      if (
        response.status < 200 ||
        response.status >= 500 ||
        date === null ||
        !Number.isFinite(instant) ||
        new Date(instant).toUTCString() !== date ||
        (age !== null && !/^0+$/.test(age)) ||
        /\bhit\b/i.test(response.headers.get("x-cache") ?? "") ||
        /\b11[01]\b/.test(response.headers.get("warning") ?? "") ||
        /(?:s-maxage|max-age)\s*=\s*"?0*[1-9]/i.test(response.headers.get("cache-control") ?? "")
      )
        return null;
      const wallFinishedMs = wall();
      const monotonicFinishedMs = monotonic();
      const duration = monotonicFinishedMs - monotonicStartedMs;
      if (
        duration < 0 ||
        duration > deadlineMs ||
        !Number.isFinite(duration) ||
        !Number.isFinite(wallStartedMs) ||
        !Number.isFinite(wallFinishedMs) ||
        Math.abs(wallFinishedMs - wallStartedMs - duration) > 1000
      )
        return null;
      // The header is truncated to its second, so the authority's time lies somewhere in the next
      // 1000 ms: its middle, give or take 500, plus half the round trip either side.
      return {
        authorityMs: instant + 500,
        uncertaintyMs: 500 + duration / 2,
        at: {
          wallMs: wallStartedMs + (wallFinishedMs - wallStartedMs) / 2,
          monoMs: monotonicStartedMs + duration / 2,
        },
      };
    }
    return null;
  };
  try {
    return await Promise.race([deadline, read().catch(() => null)]);
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}
