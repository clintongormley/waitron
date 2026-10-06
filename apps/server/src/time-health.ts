import type { Hono } from "hono";
import type { Database } from "@waitron/db";
import type { AlertSource } from "@waitron/module";
import { createErrorBoundary } from "@waitron/server-kit";
import { requireSession } from "./till-session.js";
import type { Logger } from "./logger.js";
import "./errors.js";
import { execFile } from "node:child_process";

/** Whether the system clock is NTP-synchronised. `source: "unavailable"` (never `warn: true`) on a host
 * without systemd's `timedatectl` — dev machines and macOS — so the probe never cries wolf where it
 * cannot know. Where systemd's `timedatectl` is present (the appliance), it reports the real sync
 * state. */
export type TimeHealth = { synced: boolean; source: "timedatectl" | "unavailable"; warn: boolean };

export type CommandRunner = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

// The real OS shell-out is environment-coupled and unreachable from a unit test.
/* v8 ignore start */
const defaultRun: CommandRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 2000 }, (error, stdout) => {
      // A non-zero EXIT (e.g. an unsynced state some builds signal by rc) still resolves with its
      // stdout, mapping to a real sync check below. Two failure shapes must instead reject so the
      // caller's catch maps them to "unavailable" (honest "can't determine", never a false warn):
      // a SPAWN failure (ENOENT — binary absent), where `error.code` is a string; and the `{ timeout }`
      // KILL of a hung probe, where `error.code` is `null` but `error.killed` is true (empty stdout
      // would otherwise read as "not synced" and cry wolf).
      const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      if (err && (typeof err.code === "string" || err.killed)) {
        reject(err);
        return;
      }
      resolve({ stdout });
    });
  });
/* v8 ignore stop */

export async function checkTimeHealth(deps: { run?: CommandRunner } = {}): Promise<TimeHealth> {
  const run = deps.run ?? defaultRun;
  try {
    const { stdout } = await run("timedatectl", ["show", "-p", "NTPSynchronized", "--value"]);
    const synced = stdout.trim() === "yes";
    return { synced, source: "timedatectl", warn: !synced };
  } catch {
    return { synced: false, source: "unavailable", warn: false };
  }
}

export type AuthorityClockStatus =
  | { state: "unknown" | "not-applicable" }
  | { state: "ok" | "warning"; driftSeconds: number; measuredAt: string };

export function createAuthorityClockStatus(): {
  observe(sample: { authorityTimestamp: string | null; sentAt: Date; receivedAt: Date }): void;
  read(): AuthorityClockStatus;
} {
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
      status = {
        state: warning ? "warning" : "ok",
        driftSeconds: Math.round(((sent + received) / 2 - authority) / 1000),
        measuredAt: receivedAt.toISOString(),
      };
    },
  };
}

export function authorityClockAlertSource(read: () => AuthorityClockStatus): AlertSource {
  return {
    area: "fiscal",
    permission: "fiscal.view",
    async read() {
      const status = read();
      return status.state !== "warning"
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

export function mountAuthorityClockApi(
  app: Hono,
  deps: { db: Database; read: () => AuthorityClockStatus },
  log: Logger,
): void {
  const run = createErrorBoundary(
    { "session.required": 401, "device.unauthorized": 401 },
    "clock.status_failed",
  );
  app.get("/api/clock-status", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(deps.read());
    }),
  );
}
