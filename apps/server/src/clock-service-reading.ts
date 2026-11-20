import { boxHostClient, type BoxHostClient, type ClockServiceStatus } from "./box-host-client.js";
import { createTtlCache } from "./ttl-cache.js";

/** A read of the host's clock service, shared by every reader of it for a minute or until
 * `clear`: systemd starts the host program once per request. */
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

/** `clockStatus`'s answer; a host that throws answers as lost. */
export async function clockServiceAnswerOf(
  clockStatus: () => Promise<ClockServiceStatus>,
): Promise<ClockServiceStatus> {
  try {
    return await clockStatus();
  } catch {
    return { available: false, reason: "lost" };
  }
}

/** {@link answersSynchronised} of `status`'s answer; a host that does not answer, or throws,
 * counts as not synchronised. */
export async function clockServiceSynchronised(
  status: () => Promise<ClockServiceStatus>,
): Promise<boolean> {
  return answersSynchronised(await clockServiceAnswerOf(status));
}

/** The series check's reader of the box's time service: it asks `host` at every call, never
 * through {@link sharedClockServiceReading}. */
export function timeServiceReader(
  host: Pick<BoxHostClient, "clockStatus"> = boxHostClient(),
): () => Promise<boolean> {
  return () => clockServiceSynchronised(() => host.clockStatus());
}
