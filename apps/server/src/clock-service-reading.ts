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
