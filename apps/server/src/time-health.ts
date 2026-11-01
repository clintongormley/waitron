import type { Transaction } from "@waitron/db";
import type { AlertSource } from "@waitron/module";
import "./errors.js";
import type { ClockServiceStatus } from "./box-host-client.js";
import type { AuthorityTimeSample } from "./clock-witnesses.js";

/** Whether the system clock is NTP-synchronised, as the box's clock service reads it from the
 * host's `timedatectl`. `source: "unavailable"` (never `warn: true`) where that service does not
 * answer — dev machines, Docker Desktop, a host without systemd — so the probe never cries wolf
 * where it cannot know. */
export type TimeHealth = { synced: boolean; source: "timedatectl" | "unavailable"; warn: boolean };

export async function checkTimeHealth(deps: {
  status: () => Promise<ClockServiceStatus>;
}): Promise<TimeHealth> {
  const status = await deps.status();
  if (!status.available) return { synced: false, source: "unavailable", warn: false };
  return { synced: status.synchronised, source: "timedatectl", warn: !status.synchronised };
}

export type AuthorityClockStatus =
  { state: "unknown" } | { state: "ok" | "warning"; driftSeconds: number; measuredAt: string };

const HALF_SECOND_MS = 500;

export function createAuthorityClockStatus(
  deps: { onSample?: (sample: AuthorityTimeSample) => void; monotonic?: () => number } = {},
): {
  observe(sample: { authorityTimestamp: string | null; sentAt: Date; receivedAt: Date }): void;
  read(): AuthorityClockStatus;
} {
  const monotonic = deps.monotonic ?? (() => performance.now());
  let status: AuthorityClockStatus = { state: "unknown" };
  return {
    read: () => status,
    observe({ authorityTimestamp, sentAt, receivedAt }) {
      status = { state: "unknown" };
      if (authorityTimestamp === null) return;
      const parts =
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(
          authorityTimestamp,
        );
      if (parts === null) return;
      const [, year, month, day, hour, minute, second, zone] = parts;
      if (
        Number(month) < 1 ||
        Number(month) > 12 ||
        Number(day) < 1 ||
        Number(day) > new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate() ||
        Number(hour) > 23 ||
        Number(minute) > 59 ||
        Number(second) > 59 ||
        (zone !== "Z" &&
          (Number(zone!.slice(1, 3)) > 14 ||
            Number(zone!.slice(4)) > 59 ||
            (Number(zone!.slice(1, 3)) === 14 && Number(zone!.slice(4)) !== 0)))
      )
        return;
      const authority = Date.parse(authorityTimestamp);
      const sent = sentAt.getTime();
      const received = receivedAt.getTime();
      if (
        !Number.isFinite(authority) ||
        !Number.isFinite(sent) ||
        !Number.isFinite(received) ||
        sent > received
      )
        return;
      const low = sent - authority;
      const high = received - authority;
      // Use the whole request interval so a slow reply alone cannot produce a drift warning.
      const warning = low > 60_000 || high < -60_000;
      if (!warning && (low < -60_000 || high > 60_000)) return;
      const midpoint = (sent + received) / 2;
      status = {
        state: warning ? "warning" : "ok",
        driftSeconds: Math.round((midpoint - authority) / 1000),
        measuredAt: receivedAt.toISOString(),
      };
      deps.onSample?.({
        authorityMs: authority + HALF_SECOND_MS,
        uncertaintyMs: (received - sent) / 2 + HALF_SECOND_MS,
        at: { wallMs: midpoint, monoMs: monotonic() - (received - midpoint) },
      });
    },
  };
}

/** `stopped` answers whether payments are stopped for the clock; while they are, the drift alert's
 * "you can continue selling" would be false, so it is left out whoever is looking. */
export function authorityClockAlertSource(
  read: () => AuthorityClockStatus,
  stopped?: (tx: Transaction, now: Date) => Promise<boolean>,
): AlertSource {
  return {
    area: "fiscal",
    permission: "fiscal.view",
    async read({ tx, now }) {
      const status = read();
      return status.state !== "warning" || (await stopped?.(tx, now)) === true
        ? []
        : [
            {
              key: "fiscal.clock_drift",
              code: "fiscal.clock_drift",
              params: { seconds: Math.abs(status.driftSeconds) },
              severity: "warning",
              since: status.measuredAt,
            },
          ];
    },
  };
}
