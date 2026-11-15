import type { BoxHostClient, ClockServiceStatus } from "./box-host-client.js";
import { createTtlCache } from "./ttl-cache.js";

/** One read of the host's clock service a minute, shared by every reader of it: systemd starts
 * the host program once per request. */
export function sharedClockServiceReading(
  host: Pick<BoxHostClient, "clockStatus">,
  now: () => Date,
): { read: () => Promise<ClockServiceStatus>; clear: () => void } {
  const cache = createTtlCache<ClockServiceStatus>({ ttlMs: 60_000, now });
  return {
    read: () => cache.get("status", () => host.clockStatus()),
    clear: () => cache.clear(),
  };
}

/** Whether the host's answer says the box's clock is synchronised, whatever it reports of the
 * service: the host refuses a clock set on that flag alone. */
export function answersSynchronised(answer: ClockServiceStatus): boolean {
  return answer.available && answer.synchronised;
}

/** {@link answersSynchronised} of `status`'s answer; a host that does not answer, or throws,
 * counts as not synchronised. */
export async function clockServiceSynchronised(
  status: () => Promise<ClockServiceStatus>,
): Promise<boolean> {
  try {
    return answersSynchronised(await status());
  } catch {
    return false;
  }
}
