// The server's ongoing-alert sources: one factory per live "keep asking" check the dashboard bell
// polls. The registry stamps each returned alert's `kind` and `area`; a source only supplies the
// per-alert facts. Later tasks append more factories to this file, so keep each one self-contained.

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
import type { BackupStatus } from "./backup-status.js";
import type { AwaitingCertStatus } from "./pass.js";
import type { TtlCache } from "./ttl-cache.js";
import "./errors.js";

/** The dashboard screen a backup alert links to. */
export const BACKUP_SCREEN = "backup";

/**
 * The last backup outcome per destination, in memory. A destination with an entry here failed its
 * most recent attempt; a successful attempt removes it. The sweep fills this holder as it runs
 * (`recordBackupOutcome`) and {@link backupAlertSource} reads it — a live process fact that is not in
 * the database, so it lives only as long as the process and is empty after a restart until the next
 * sweep tick.
 */
export interface BackupOutcomeHolder {
  failed: Map<string, { at: string }>;
}

/** Record one destination's latest sweep outcome: a failure is remembered with its time, a success
 * forgets any earlier failure. Kept beside the holder type so the sweep and the source share it. */
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
 * The backups alert source. Surfaces three states, each needing an operator's attention:
 * backups not configured at all (`backup.disabled`), a destination whose newest good backup is older
 * than allowed (`backup.destination_overdue`, `since` = that last good backup), and a destination
 * whose most recent attempt failed (`backup.destination_failed`, `since` = when it failed). Overdue
 * reads the per-request freshness listing; failed reads the in-process outcome holder — a fresh
 * destination can still carry a failed last attempt, so both are reported.
 */
export function backupAlertSource(deps: {
  listStatus: () => Promise<BackupStatus>;
  outcomes: BackupOutcomeHolder;
  now: () => Date;
}): AlertSource {
  return {
    area: "backup",
    permission: "system.manage",
    async read(): Promise<readonly OngoingAlert[]> {
      const status = await deps.listStatus();
      if (!status.configured) {
        return [
          {
            key: "backup.disabled",
            code: "backup.disabled",
            params: {},
            severity: "warning",
            since: null,
            screen: BACKUP_SCREEN,
          },
        ];
      }
      const alerts: OngoingAlert[] = [];
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
 * The awaiting-certificate alert source. `holder` is the same in-memory cell the fiscal pass flips
 * (`AwaitingCertStatus`, `apps/server/src/pass.ts`) when a drain pass is skipped for a missing AEAT
 * certificate — no database read. Shares the `fiscal` area with the module's own submission source
 * (`packages/fiscal-verifactu/src/submission-alerts.ts`); Task 1's relaxed registry is what lets two
 * sources own the same area.
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

/**
 * The printing alert source. Two ongoing checks an operator can act on from the Impresoras page:
 * a print agent that has gone quiet (`agent.silent`, one per active agent whose `last_seen_at` is
 * older than {@link AGENT_SILENT_MS}), and print jobs stuck at a printer (`printer.jobs_waiting`, one
 * per active printer holding a `document` job that has waited past {@link JOBS_WAITING_MS} or a
 * `failed` job that has exhausted its delivery attempts). A drawer pulse never counts — only document
 * jobs surface here. Reads the `@waitron/db` tables directly rather than the printing package, which
 * owns no reader for this shape.
 */
export function printingAlertSource(): AlertSource {
  return {
    area: "printing",
    permission: "printer.manage",
    async read({ tx, now }): Promise<readonly OngoingAlert[]> {
      const alerts: OngoingAlert[] = [];

      // `last_seen_at` and `created_at` are drizzle mode:"string" columns, so the thresholds are ISO
      // strings, never Date objects (a Date would not typecheck against a string column).
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
        // Key on the agent id, not the display name: each active agent needs its own distinct alert
        // key, and the display name is not unique across agents. The human name still travels in
        // params for the wording.
        alerts.push({
          key: `agent.silent:${a.id}`,
          code: "agent.silent",
          params: { agent: a.name },
          severity: "warning",
          since: new Date(a.seen!).toISOString(),
          screen: "printers",
        });
      }

      // One row per active printer with at least one waiting document job.
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
 * The card-reader battery alert source. One `reader.battery_low` per ACTIVE reader whose provider
 * reports a battery at or below {@link BATTERY_WARN} (warning) or {@link BATTERY_ERROR} (error). A
 * reader whose provider reports no battery (Stripe, and any SumUp reader that does not send one)
 * raises nothing. Each reader's reading comes through `cache` keyed on the reader id, so an open
 * dashboard asking every minute does not hammer the provider — a reading is reused for the cache's
 * TTL (five minutes at boot). Reads `card_readers` directly, the same table the payments API owns.
 * This server-owned source reads a payments-module table, and on a node without that module it
 * degrades gracefully: the `payments.manage` permission gates it, and a missing table surfaces as a
 * single `alert.source_unavailable:card_reader` via the per-source savepoint — the same shape as the
 * printing source.
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
      // Each reader's reading is an independent EXTERNAL provider call (via `runtimeDeps`, not a query
      // on this transaction), so they run CONCURRENTLY — the "await queries on one transaction in turn"
      // rule governs tx queries, which these are not. Any one call throwing rejects `Promise.all` and
      // collapses the whole source to one `alert.source_unavailable:card_reader`, the same source-level
      // failure model as the first throw would give when read sequentially.
      const percents = await Promise.all(
        readers.map((r) =>
          deps.cache.get(r.id, async () => {
            // `cardProviderById` THROWS `payment.provider_unknown` on an unrecognised provider id (it
            // never returns undefined), and a seat whose `status` throws propagates out of `read` too.
            // Either way the registry collapses this whole source to one
            // `alert.source_unavailable:card_reader` — the spec's source-level failure model — so a
            // misconfigured reader is surfaced as a broken check, not silently dropped. That is why
            // there is no null-check here.
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
