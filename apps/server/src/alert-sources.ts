// The server's ongoing-alert sources: one factory per live "keep asking" check the dashboard bell
// polls. The registry stamps each returned alert's `kind` and `area`; a source only supplies the
// per-alert facts.

import { and, count, eq, gte, inArray, lt, min, or } from "drizzle-orm";
import { printAgents, printJobs, printers } from "@waitron/db";
import type { AlertSource, OngoingAlert } from "@waitron/module";
import {
  type CardProviderContribution,
  cardProviderById,
  type CardProviderRuntimeDeps,
  cardReaders,
} from "@waitron/payments";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import type { StreamView } from "@waitron/stream";
import type { BackupStatus } from "./backup-status.js";
import type { AwaitingCertStatus } from "./pass.js";
import type { SealedStateStatus } from "./sealed-state.js";
import { FIRST_START_PENDING } from "./stream-host.js";
import type { TtlCache } from "./ttl-cache.js";
import "./errors.js";

/** The dashboard screen a backup alert links to. */
export const BACKUP_SCREEN = "backup";

/** How long a change may wait for the bucket before `backup.stream_behind` (slice 2 spec §4.5). */
export const STREAM_BEHIND_AFTER_MS = 15 * 60_000;

/** A supervisor that is off for one of these stopped by itself, not because it was told to. */
const STOPPED_BY_ITSELF: ReadonlySet<string | null> = new Set([
  "supervisor_failed",
  "litestream_unavailable",
]);

/** `scripts/ongoing-alert-codes.test.ts` finds each code by a `code: "..."` literal, so every call
 * site spells its code out. */
function streamAlert(alert: Pick<OngoingAlert, "code" | "params" | "since">): OngoingAlert {
  const { code, params, since } = alert;
  return { key: code, code, params, severity: "error", since, screen: BACKUP_SCREEN };
}

function streamAlerts(stream: StreamView, now: Date): OngoingAlert[] {
  if (!("reason" in stream)) return [];
  // A failed first start raises its own alert ({@link firstStartAlertSource}); a deferred one raises
  // none.
  if (stream.reason === FIRST_START_PENDING) return [];
  const stopped = streamAlert({
    code: "backup.stream_stopped",
    params: { reason: stream.reason },
    since: stream.stateSince,
  });
  if (!("lagMs" in stream)) return [stopped];
  const refused = stream.state === "refused";
  let explained: OngoingAlert | undefined;
  if (refused && (stream.reason === "pointer_changed" || stream.reason === "pointer_newer_term")) {
    explained = streamAlert({
      code: "backup.stream_refused",
      params: {},
      since: stream.stateSince,
    });
  } else if (refused && stream.reason === "config_unsafe") {
    explained = streamAlert({
      code: "backup.stream_settings_unusable",
      params: {},
      since: stream.stateSince,
    });
  } else if (refused || (stream.state === "off" && STOPPED_BY_ITSELF.has(stream.reason))) {
    explained = stopped;
  }
  const alerts: OngoingAlert[] = [];
  if (explained === undefined && stream.lagMs >= STREAM_BEHIND_AFTER_MS) {
    alerts.push(
      streamAlert({
        code: "backup.stream_behind",
        params: { minutes: Math.floor(stream.lagMs / 60_000) },
        since: new Date(now.getTime() - stream.lagMs).toISOString(),
      }),
    );
  }
  if (stream.state === "paused") {
    alerts.push(
      streamAlert({ code: "backup.stream_paused", params: {}, since: stream.stateSince }),
    );
  }
  if (explained !== undefined) alerts.push(explained);
  if (stream.bucketProblem !== null) {
    alerts.push(
      streamAlert({
        code: "backup.stream_bucket_unusable",
        params: {},
        since: stream.bucketProblem.since,
      }),
    );
  }
  return alerts;
}

/** An entry means that destination's most recent backup attempt failed. In memory only: empty after
 * a restart until the next sweep tick. */
export interface BackupOutcomeHolder {
  failed: Map<string, { at: string }>;
}

export function recordBackupOutcome(
  h: BackupOutcomeHolder,
  dest: string,
  ok: boolean,
  at: string,
): void {
  if (ok) h.failed.delete(dest);
  else h.failed.set(dest, { at });
}

/**
 * The backups alert source. A fresh destination can still carry a failed last attempt, so overdue
 * and failed are both reported.
 */
export function backupAlertSource(deps: {
  listStatus: () => Promise<BackupStatus>;
  outcomes: BackupOutcomeHolder;
  now: () => Date;
  readStream: () => StreamView;
}): AlertSource {
  return {
    area: "backup",
    permission: "system.manage",
    async read(): Promise<readonly OngoingAlert[]> {
      const status = await deps.listStatus();
      const stream = deps.readStream();
      const alerts = streamAlerts(stream, deps.now());
      const streamCurrent =
        "lagMs" in stream && stream.state === "streaming" && stream.lagMs < STREAM_BEHIND_AFTER_MS;
      if (!status.configured) {
        if (!streamCurrent) {
          alerts.push({
            key: "backup.disabled",
            code: "backup.disabled",
            params: {},
            severity: "warning",
            since: null,
            screen: BACKUP_SCREEN,
          });
        }
        return alerts;
      }
      for (const d of status.destinations) {
        if (d.stale) {
          alerts.push({
            key: `backup.destination_overdue:${d.id}`,
            code: "backup.destination_overdue",
            params: { destination: d.id },
            severity: "error",
            since: d.lastBackupAt,
            screen: BACKUP_SCREEN,
          });
        }
        const failed = deps.outcomes.failed.get(d.id);
        if (failed) {
          alerts.push({
            key: `backup.destination_failed:${d.id}`,
            code: "backup.destination_failed",
            params: { destination: d.id },
            severity: "warning",
            since: failed.at,
            screen: BACKUP_SCREEN,
          });
        }
      }
      return alerts;
    },
  };
}

/**
 * The sealed-state alert source: raised while this node's last attempt to rewrite its sealed state
 * row failed (`holder` is the refresher's own, `sealed-state.ts`), so a box rebuilt from the bucket
 * would come back with an out-of-date row, or none.
 */
export function sealedStateAlertSource(holder: SealedStateStatus): AlertSource {
  return {
    area: "backup",
    permission: "system.manage",
    async read(): Promise<readonly OngoingAlert[]> {
      if (holder.failedSince === null) return [];
      return [
        {
          key: "backup.sealed_state_failed",
          code: "backup.sealed_state_failed",
          params: {},
          severity: "error",
          since: holder.failedSince,
          screen: BACKUP_SCREEN,
        },
      ];
    },
  };
}

/**
 * Raised while this start's attempt at a restored box's first start (`rebuild-first-start.ts`)
 * failed: the box sells but holds its bucket copy until a later start finishes.
 */
export function firstStartAlertSource(holder: { failedSince: string | null }): AlertSource {
  return {
    area: "backup",
    permission: "system.manage",
    async read(): Promise<readonly OngoingAlert[]> {
      if (holder.failedSince === null) return [];
      return [
        {
          key: "restore.first_start_failed",
          code: "restore.first_start_failed",
          params: {},
          severity: "warning",
          since: holder.failedSince,
          screen: BACKUP_SCREEN,
        },
      ];
    },
  };
}

/**
 * `holder` is the in-memory cell the fiscal pass flips (`apps/server/src/pass.ts`) when a drain pass
 * is skipped for a missing AEAT certificate.
 */
export function awaitingCertAlertSource(holder: AwaitingCertStatus): AlertSource {
  return {
    area: "fiscal",
    permission: "fiscal.view",
    async read(): Promise<readonly OngoingAlert[]> {
      if (!holder.current) return [];
      return [
        {
          key: "fiscal.awaiting_certificate",
          code: "fiscal.awaiting_certificate",
          params: {},
          severity: "error",
          since: null,
        },
      ];
    },
  };
}

/** An agent quiet for longer than this has stopped checking in; printing may be stalled. */
export const AGENT_SILENT_MS = 5 * 60 * 1000;
/** A document job older than this that has not printed is stuck at its printer. */
export const JOBS_WAITING_MS = 2 * 60 * 1000;

/** The printing alert source. A drawer pulse never counts — only document jobs surface here. */
export function printingAlertSource(): AlertSource {
  return {
    area: "printing",
    permission: "printer.manage",
    async read({ tx, now }): Promise<readonly OngoingAlert[]> {
      const alerts: OngoingAlert[] = [];

      const silentBefore = new Date(now.getTime() - AGENT_SILENT_MS).toISOString();
      const agents = await tx
        .select({ id: printAgents.id, name: printAgents.name, seen: printAgents.lastSeenAt })
        .from(printAgents)
        .where(
          and(
            eq(printAgents.active, true),
            // A NULL `last_seen_at` (an agent never seen) is UNKNOWN under `lt`, so it is excluded and
            // `seen` below is always a real timestamp.
            lt(printAgents.lastSeenAt, silentBefore),
          ),
        );
      for (const a of agents) {
        // Keyed by id: an agent's display name is not unique.
        alerts.push({
          key: `agent.silent:${a.id}`,
          code: "agent.silent",
          params: { agent: a.name },
          severity: "warning",
          since: new Date(a.seen!).toISOString(),
          screen: "printers",
        });
      }

      const stuckBefore = new Date(now.getTime() - JOBS_WAITING_MS).toISOString();
      const rows = await tx
        .select({
          id: printers.id,
          printer: printers.name,
          n: count(),
          oldest: min(printJobs.createdAt),
        })
        .from(printers)
        .innerJoin(printJobs, eq(printJobs.printerId, printers.id))
        .where(
          and(
            eq(printers.active, true),
            eq(printJobs.kind, "document"),
            or(
              // Waiting too long in a non-terminal state…
              and(
                inArray(printJobs.status, ["queued", "printing", "failed"]),
                lt(printJobs.createdAt, stuckBefore),
              ),
              // …or failed with no attempts left, however recent.
              and(eq(printJobs.status, "failed"), gte(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
            ),
          ),
        )
        .groupBy(printers.id, printers.name);
      for (const r of rows) {
        // A group only forms when a job matched, and `created_at` is notNull, so `oldest` is present.
        alerts.push({
          key: `printer.jobs_waiting:${r.id}`,
          code: "printer.jobs_waiting",
          params: { printer: r.printer, count: Number(r.n) },
          severity: "error",
          since: new Date(r.oldest!).toISOString(),
          screen: "printers",
        });
      }
      return alerts;
    },
  };
}

/** A reader at or below this whole-percent battery reading raises a warning. */
export const BATTERY_WARN = 20;
/** At or below this it is an error — the reader is close to dying at the till. */
export const BATTERY_ERROR = 10;

/**
 * The card-reader battery alert source. A reader whose provider reports no battery raises nothing.
 * Readings are cached per reader id so a polling dashboard does not call the provider every time.
 */
export function batteryAlertSource(deps: {
  providers: readonly CardProviderContribution[];
  runtimeDeps: () => CardProviderRuntimeDeps;
  cache: TtlCache<number | null>;
}): AlertSource {
  return {
    area: "card_reader",
    permission: "payments.manage",
    async read({ tx }): Promise<readonly OngoingAlert[]> {
      const readers = await tx
        .select({
          id: cardReaders.id,
          provider: cardReaders.provider,
          ref: cardReaders.providerRef,
          name: cardReaders.name,
        })
        .from(cardReaders)
        .where(eq(cardReaders.active, true));
      // Provider calls, not queries on `tx`, so they may run concurrently.
      const percents = await Promise.all(
        readers.map((r) =>
          deps.cache.get(r.id, async () => {
            // An unknown provider throws, failing the whole source rather than dropping the reader.
            const seat = cardProviderById(deps.providers, r.provider);
            const status = await seat.readers.status(deps.runtimeDeps(), r.ref);
            return status.batteryPercent ?? null;
          }),
        ),
      );
      const alerts: OngoingAlert[] = [];
      readers.forEach((r, i) => {
        const percent = percents[i]!;
        if (percent === null || percent > BATTERY_WARN) return;
        alerts.push({
          key: `reader.battery_low:${r.id}`,
          code: "reader.battery_low",
          params: { reader: r.name, percent },
          severity: percent <= BATTERY_ERROR ? "error" : "warning",
          since: null,
          screen: "payments",
        });
      });
      return alerts;
    },
  };
}
