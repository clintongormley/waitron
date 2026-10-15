// The server's ongoing-alert sources: one factory per live "keep asking" check the dashboard bell
// polls. The registry stamps each returned alert's `kind` and `area`; a source only supplies the
// per-alert facts.

import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  min,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { readSuggestionRun } from "@waitron/catalogue";
import { formatInvoiceNumber } from "@waitron/core";
import {
  type A4HoldCode,
  invoiceDeliveries,
  invoiceSeries,
  pagePrinters,
  printAgents,
  printJobs,
  printers,
  sales,
  type Transaction,
} from "@waitron/db";
import type { AlertSource, OngoingAlert } from "@waitron/module";
import {
  type CardProviderContribution,
  cardProviderById,
  DEMO_READER_ID,
  type CardProviderRuntimeDeps,
  cardReaders,
} from "@waitron/payments";
import { PRINTER_UNPAIRED } from "@waitron/printing";
import type { StreamView } from "@waitron/stream";
import type { BackupStatus } from "./backup-status.js";
import { type InvoiceDeliveryStatus, readInvoiceDeliveriesFor } from "./invoice-delivery-status.js";
import type { PageTestPages } from "./page-test-pages.js";
import type { AwaitingCertStatus } from "./pass.js";
import type { SealedStateStatus } from "./sealed-state.js";
import { printJobInTrouble } from "./print-job-trouble.js";
import {
  passScreensDark,
  stationPrintersDown,
  stationScreensDark,
  stationsWithWaitingDishes,
} from "./station-outputs-down.js";
import { FIRST_START_PENDING } from "./stream-host.js";
import type { TillConfig } from "./till-config.js";
import type { TtlCache } from "./ttl-cache.js";
import "./errors.js";

/** The dashboard screen a backup alert links to. */
export const BACKUP_SCREEN = "backup";

/** How long a change may wait for the bucket before `backup.stream_behind`. */
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

export interface BackupOutcomeHolder {
  /** An entry means that destination's most recent backup attempt failed. In memory only: empty
   * after a restart until the next sweep tick. */
  failed: Map<string, { at: string }>;
  /** Set while the most recent backup run stopped before any destination call; `code` is the error
   * code it stopped on. In memory only, like `failed`. */
  runStopped?: { code: string; at: string };
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
        if (status.loadErrorCode !== undefined) {
          alerts.push({
            key: "backup.archive_settings_unusable",
            code: "backup.archive_settings_unusable",
            params: {},
            severity: "error",
            since: null,
            screen: BACKUP_SCREEN,
          });
        } else if (!streamCurrent) {
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
      const stopped = deps.outcomes.runStopped;
      if (stopped) {
        alerts.push({
          key: "backup.run_stopped",
          code: "backup.run_stopped",
          params: { errorCode: stopped.code },
          severity: "error",
          since: stopped.at,
          screen: BACKUP_SCREEN,
        });
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

/** Raised for the rest of this start when it found an append-only trigger missing and put it back. */
export function appendOnlyRestoredAlertSource(holder: { restoredAt: string | null }): AlertSource {
  return {
    area: "fiscal",
    permission: "fiscal.view",
    async read(): Promise<readonly OngoingAlert[]> {
      if (holder.restoredAt === null) return [];
      return [
        {
          key: "append_only.triggers_restored",
          code: "append_only.triggers_restored",
          params: {},
          severity: "warning",
          since: holder.restoredAt,
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
            printJobInTrouble(now),
            // Ended on purpose by an Unpair, not a fault to fix.
            or(isNull(printJobs.lastError), ne(printJobs.lastError, PRINTER_UNPAIRED)),
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

/** An A4 attempt still queued this long after it was due has been taken by no agent. */
export const A4_UNCLAIMED_AFTER_MS = 2 * 60_000;

/** Why a full invoice's original has not reached its customer. */
export type UndeliveredInvoice = { since: string } & (
  | { kind: "failed" | "uncertain" }
  | { kind: "office_printer_unclaimed" | "uncertain_held"; printer: string }
  | { kind: "held" | "queued_behind_hold"; printer: string; hold: A4HoldCode }
);

/** What {@link undeliveredInvoice} needs beyond a sale's delivery status, read once per poll. */
export interface UndeliveredContext {
  /** Each A4 attempt's office printer, by delivery id. */
  officePrinters: ReadonlyMap<string, { id: string; name: string }>;
  /** What an office printer is holding a job it is sending for, by page printer id. */
  sendingHolds: ReadonlyMap<string, A4HoldCode>;
  /** The page printers with an A4 being sent, held or not: their agent is taking their jobs. */
  sendingPrinters: ReadonlySet<string>;
  testPages: Pick<PageTestPages, "holdOn">;
}

/**
 * Applies the same rules as the till's delivery status (`readInvoiceDeliveries`) about whether a
 * full invoice's original is still owed, and says why.
 */
export function undeliveredInvoice(
  status: InvoiceDeliveryStatus,
  now: Date,
  context: UndeliveredContext,
): UndeliveredInvoice | null {
  const current = status.current;
  if (status.originalCompleted || current === null) return null;
  const officePrinter = () => context.officePrinters.get(current.id!)!;
  if (current.status === "failed" || current.status === "unknown") {
    const since = current.at ?? current.requestedAt;
    if (current.status === "failed") return { kind: "failed", since };
    // `rowAttempt` keeps a hold on A4 rows only.
    return current.printerHold === null
      ? { kind: "uncertain", since }
      : { kind: "uncertain_held", since, printer: officePrinter().name };
  }
  if (current.status === "sending" && current.printerHold !== null) {
    // `at` moves with every renewal, so the alert dates from the request.
    return {
      kind: "held",
      since: current.requestedAt,
      printer: officePrinter().name,
      hold: current.printerHold,
    };
  }
  if (current.medium !== "a4" || current.status !== "queued") return null;
  // A queued row's time is its `next_attempt_at`, which is never null.
  const due = current.at!;
  if (now.getTime() - Date.parse(due) < A4_UNCLAIMED_AFTER_MS) return null;
  const printer = officePrinter();
  const hold = context.sendingHolds.get(printer.id) ?? context.testPages.holdOn(printer.id);
  if (hold !== null) return { kind: "queued_behind_hold", since: due, printer: printer.name, hold };
  if (context.sendingPrinters.has(printer.id)) return null;
  return { kind: "office_printer_unclaimed", since: due, printer: printer.name };
}

async function readUndeliveredContext(
  tx: Transaction,
  saleIds: readonly string[],
  testPages: Pick<PageTestPages, "holdOn">,
): Promise<UndeliveredContext> {
  const attempts = await tx
    .select({ id: invoiceDeliveries.id, printerId: pagePrinters.id, name: pagePrinters.name })
    .from(invoiceDeliveries)
    .innerJoin(pagePrinters, eq(pagePrinters.id, invoiceDeliveries.pagePrinterId))
    .where(inArray(invoiceDeliveries.saleId, [...saleIds]));
  const sending = await tx
    .select({ printerId: invoiceDeliveries.pagePrinterId, hold: invoiceDeliveries.printerHold })
    .from(invoiceDeliveries)
    .where(
      and(eq(invoiceDeliveries.status, "sending"), isNotNull(invoiceDeliveries.pagePrinterId)),
    );
  const holds = sending.filter((row) => row.hold !== null);
  return {
    officePrinters: new Map(attempts.map((a) => [a.id, { id: a.printerId, name: a.name }])),
    sendingHolds: new Map(holds.map((h) => [h.printerId!, h.hold!])),
    sendingPrinters: new Set(sending.map((row) => row.printerId!)),
    testPages,
  };
}

const originalSent = alias(invoiceDeliveries, "undelivered_original_sent");
const originalPrinted = alias(printJobs, "undelivered_original_printed");
const originalPrinter = alias(printers, "undelivered_original_printer");
const anyDelivery = alias(invoiceDeliveries, "undelivered_any_delivery");

/** The `completed original` rule of `readInvoiceDeliveries` (and of `readOriginalReceiptPrint`,
 * whose receipt jobs are read with their printer), as a filter on `sales`. */
function noCompletedOriginal(tx: Transaction) {
  return and(
    notExists(
      tx
        .select({ one: sql`1` })
        .from(originalSent)
        .where(
          and(
            eq(originalSent.saleId, sales.id),
            eq(originalSent.designation, "original"),
            eq(originalSent.status, "sent"),
          ),
        ),
    ),
    notExists(
      tx
        .select({ one: sql`1` })
        .from(originalPrinted)
        .innerJoin(originalPrinter, eq(originalPrinter.id, originalPrinted.printerId))
        .where(
          and(
            eq(originalPrinted.saleId, sales.id),
            eq(originalPrinted.kind, "document"),
            eq(originalPrinted.receiptCopy, false),
            eq(originalPrinted.status, "done"),
          ),
        ),
    ),
  );
}

/**
 * The full invoices whose current attempt could be one this source raises for. A narrowing only:
 * {@link undeliveredInvoice} decides.
 */
async function undeliveredCandidates(tx: Transaction) {
  const invoice = { id: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber };
  const tracked = await tx
    .selectDistinct(invoice)
    .from(invoiceDeliveries)
    .innerJoin(sales, eq(sales.id, invoiceDeliveries.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(
      and(
        or(
          inArray(invoiceDeliveries.status, ["failed", "unknown"]),
          and(eq(invoiceDeliveries.status, "queued"), eq(invoiceDeliveries.medium, "a4")),
          and(eq(invoiceDeliveries.status, "sending"), isNotNull(invoiceDeliveries.printerHold)),
        ),
        isNotNull(sales.counterpartyTaxId),
        noCompletedOriginal(tx),
      ),
    );
  // A receipt original no delivery row tracks is the current attempt only while the sale has none.
  const untracked = await tx
    .selectDistinct(invoice)
    .from(printers)
    .innerJoin(printJobs, eq(printJobs.printerId, printers.id))
    .innerJoin(sales, eq(sales.id, printJobs.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(
      and(
        eq(printJobs.status, "failed"),
        eq(printJobs.kind, "document"),
        eq(printJobs.receiptCopy, false),
        isNotNull(sales.counterpartyTaxId),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(anyDelivery)
            .where(eq(anyDelivery.saleId, sales.id)),
        ),
        noCompletedOriginal(tx),
      ),
    );
  return [...tracked, ...untracked];
}

/**
 * One alert per full invoice whose original has not reached its customer. Its params name the
 * invoice by number and never its customer.
 */
export function invoiceDeliveryAlertSource(deps: {
  testPages: Pick<PageTestPages, "holdOn">;
}): AlertSource {
  return {
    area: "invoice_delivery",
    permission: "report.view",
    async read({ tx, now }): Promise<readonly OngoingAlert[]> {
      const alerts: OngoingAlert[] = [];
      const candidates = await undeliveredCandidates(tx);
      const ids = candidates.map((sale) => sale.id);
      // An alert reads no offered action.
      const statuses = await readInvoiceDeliveriesFor(tx, ids, { emailAvailable: false });
      const context = await readUndeliveredContext(tx, ids, deps.testPages);
      for (const sale of candidates) {
        // Null only for a sale with no counterparty, which no candidate is.
        const found = undeliveredInvoice(statuses.get(sale.id)!, now, context);
        if (found === null) continue;
        const invoice = formatInvoiceNumber(sale.code, sale.number);
        const alert = {
          key: `invoice_delivery.undelivered:${sale.id}`,
          severity: "error",
          since: found.since,
          screen: "orders",
        } as const;
        switch (found.kind) {
          case "failed":
            alerts.push({ ...alert, code: "invoice_delivery.failed", params: { invoice } });
            break;
          case "uncertain":
            alerts.push({ ...alert, code: "invoice_delivery.uncertain", params: { invoice } });
            break;
          case "office_printer_unclaimed":
            alerts.push({
              ...alert,
              code: "invoice_delivery.office_printer_unclaimed",
              params: { invoice, printer: found.printer },
            });
            break;
          case "uncertain_held":
            alerts.push({
              ...alert,
              code: "invoice_delivery.uncertain_held",
              params: { invoice, printer: found.printer },
            });
            break;
          case "held":
            alerts.push({
              ...alert,
              code: "invoice_delivery.held",
              params: { invoice, printer: found.printer, hold: found.hold },
            });
            break;
          case "queued_behind_hold":
            alerts.push({
              ...alert,
              code: "invoice_delivery.queued_behind_hold",
              params: { invoice, printer: found.printer, hold: found.hold },
            });
            break;
        }
      }
      return alerts;
    },
  };
}

export function stationOutputAlertSource(deps: {
  locationId: string;
  stationStates: (
    tx: Transaction,
    at: Date,
  ) => Promise<
    ReadonlyMap<string, { open: boolean; isDefault: boolean; active: boolean; name: string }>
  >;
}): AlertSource {
  return {
    area: "kitchen",
    permission: "venue_service.manage",
    async read({ tx, now }): Promise<readonly OngoingAlert[]> {
      const printersDown = await stationPrintersDown(tx, deps.locationId, now);
      const screensDark = await stationScreensDark(tx, deps.locationId, now);
      const states = await deps.stationStates(tx, now);
      const closed = printersDown
        .filter((p) => !states.get(p.stationId)?.open)
        .map((p) => p.stationId);
      const waiting = await stationsWithWaitingDishes(tx, deps.locationId, now, closed);
      const alerts: OngoingAlert[] = [];
      for (const p of printersDown) {
        if (!states.get(p.stationId)?.open && !waiting.has(p.stationId)) continue;
        alerts.push({
          key: `station.printer_down:${p.stationId}:${p.printerId}`,
          ...(states.get(p.stationId)?.isDefault
            ? { code: "station.default_printer_down" }
            : { code: "station.printer_down" }),
          params: { station: p.stationName, printer: p.printerName },
          severity: "error",
          since: p.since,
          screen: "prep-stations",
        });
      }
      for (const s of screensDark) {
        alerts.push({
          key: `station.screens_dark:${s.stationId}`,
          ...(states.get(s.stationId)?.isDefault
            ? { code: "station.default_screens_dark" }
            : { code: "station.screens_dark" }),
          params: { station: s.stationName },
          severity: "warning",
          since: s.lastSeenAt ?? now.toISOString(),
          screen: "prep-stations",
        });
      }
      return alerts;
    },
  };
}

export function passScreenAlertSource(deps: { cfg: TillConfig }): AlertSource {
  return {
    area: "kitchen",
    permission: "venue_service.manage",
    async read({ tx, now }): Promise<readonly OngoingAlert[]> {
      return (await passScreensDark(tx, deps.cfg, now)).map((p) => ({
        key: `kitchen_screen.pass_dark:${p.deviceId}`,
        ...(p.kind === "pass"
          ? { code: "kitchen_screen.pass_dark" }
          : { code: "kitchen_screen.pass_monitor_dark" }),
        params: { device: p.deviceName },
        severity: "warning",
        since: p.lastSeenAt ?? now.toISOString(),
        screen: "devices",
      }));
    },
  };
}

/** A reader at or below this whole-percent battery reading raises a warning. */
export const BATTERY_WARN = 20;
/** At or below this it is an error — the reader is close to dying at the till. */
export const BATTERY_ERROR = 10;
/** Above SumUp's two sequential 20-second status calls; a stalled provider cannot hold alerts open. */
const BATTERY_CHECK_LIMIT_MS = 45_000;

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
    readOutsideTransaction: true,
    async read({ tx, now }): Promise<readonly OngoingAlert[]> {
      const readers = await tx
        .select({
          id: cardReaders.id,
          provider: cardReaders.provider,
          ref: cardReaders.providerRef,
          name: cardReaders.name,
        })
        .from(cardReaders)
        .where(and(eq(cardReaders.active, true), ne(cardReaders.id, DEMO_READER_ID)));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, BATTERY_CHECK_LIMIT_MS);
      });
      let results: ({ kind: "reading"; percent: number | null } | { kind: "unavailable" })[];
      try {
        // One deadline bounds the whole batch while each reader retains its own result.
        const pending = readers.map((r) => {
          const seat = cardProviderById(deps.providers, r.provider);
          return Promise.race([
            deps.cache
              .get(r.id, async () => {
                const status = await seat.readers.status(deps.runtimeDeps(), r.ref);
                return status.batteryPercent ?? null;
              })
              .then(
                (percent) => ({ kind: "reading" as const, percent }),
                () => ({ kind: "unavailable" as const }),
              ),
            deadline.then(() => ({ kind: "unavailable" as const })),
          ]);
        });
        results = await Promise.all(pending);
      } finally {
        clearTimeout(timer);
      }
      const alerts: OngoingAlert[] = [];
      readers.forEach((r, i) => {
        const result = results[i]!;
        if (result.kind === "unavailable") {
          alerts.push({
            key: `reader.status_unavailable:${r.id}`,
            code: "reader.status_unavailable",
            params: { reader: r.name },
            severity: "warning",
            since: null,
            screen: "payments",
          });
          return;
        }
        const percent = result.percent;
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
      if (readers.length > 0 && results.every((result) => result.kind === "unavailable")) {
        alerts.push({
          key: "alert.source_unavailable:card_reader",
          code: "alert.source_unavailable",
          params: { area: "card_reader" },
          severity: "error",
          since: now.toISOString(),
        });
      }
      return alerts;
    },
  };
}

/** The Translate all notice: open while a finished run's suggestions wait, until someone opens the
 * translations dialog. */
export function contentSuggestionsAlertSource(): AlertSource {
  return {
    area: "content",
    permission: "catalogue.manage",
    async read({ tx }): Promise<readonly OngoingAlert[]> {
      const run = await readSuggestionRun(tx);
      if (
        run === null ||
        run.opened ||
        run.waiting === 0 ||
        (run.state !== "done" && run.state !== "partly_done")
      )
        return [];
      const params = { count: run.waiting, failed: run.failed };
      const shared = {
        key: "content.suggestions_ready",
        params,
        severity: "notice",
        since: run.finishedAt,
        screen: "content-languages",
      } as const;
      return [
        run.failed === 0
          ? { ...shared, code: "content.suggestions_ready" }
          : { ...shared, code: "content.suggestions_ready_partly" },
      ];
    },
  };
}
