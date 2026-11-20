import { isReceiptPrinter, printers, printJobs, type Transaction } from "@waitron/db";
import { and, eq, sql } from "drizzle-orm";
import { CLOCK_WITNESS_MARGIN_MS, type ClockWitness } from "@waitron/fiscal";
import { readPrinterRoles } from "@waitron/layouts";
import type {
  StaffNotice,
  StaffNoticeReadContext,
  StaffNoticeSource,
  WaitronModule,
} from "@waitron/module";
import type { ClockServiceStatus } from "./box-host-client.js";
import { clockServiceSynchronised } from "./clock-service-reading.js";
import type { StartClockWaiting } from "./clock-unconfirmed-alert.js";
import type { DiskFullState } from "./disk-full-state.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import { enabledStaffNoticeSources } from "./modules.js";
import { printersInTrouble, type PrinterInTrouble } from "./print-job-trouble.js";
import type { OwnedStaffNoticeSource } from "./staff-notices.js";
import { createTtlCache } from "./ttl-cache.js";
import { readUndeliveredInvoices } from "./alert-sources.js";
import type { PageTestPages } from "./page-test-pages.js";

/** Owner name of the notices the box itself gives; no module is named this. */
export const BOX_NOTICE_OWNER = "box";

const DISK_FULL: StaffNotice = {
  key: "storage.disk_full",
  code: "storage.disk_full",
  severity: "error",
  params: {},
};

const SPACE_LOW: StaffNotice = {
  key: "storage.space_low",
  code: "storage.space_low",
  severity: "warning",
  params: {},
};

/** `storage.disk_full` while the full-disk stop is noted and `full()`, the test a payment gets,
 * answers true; otherwise `storage.space_low` while the low-space warning is on. Found here, before
 * the read's write-lock turns, asking `full()`, which reads the disk, only while the stop is noted;
 * the source answers what was found then. A failed look fails the source's read, never this call. */
export async function boxStaffNoticeSource(deps: {
  disk: Pick<DiskFullState, "since" | "full">;
  space: Pick<FreeSpaceState, "current">;
}): Promise<StaffNoticeSource> {
  let notices: StaffNotice[];
  try {
    notices = await boxNotices(deps);
  } catch (error) {
    return { read: () => Promise.reject(error as Error) };
  }
  return { read: () => Promise.resolve(notices) };
}

async function boxNotices(
  deps: Parameters<typeof boxStaffNoticeSource>[0],
): Promise<StaffNotice[]> {
  if (deps.disk.since() !== null && (await deps.disk.full())) return [DISK_FULL];
  if (deps.space.current().lowSince !== null) return [SPACE_LOW];
  return [];
}

/** Owner name of the clock check's marker: apart from the box's, so a failing read of the clock
 * stop leaves the storage notices served. No module is named this. */
export const BOX_CLOCK_NOTICE_OWNER = "box-clock";

const CHECK_TIME: StaffNotice = {
  key: "clock.check_time",
  code: "clock.check_time",
  severity: "error",
  params: {},
};

type ClockCheck = (tx: Transaction, reading: StaffNoticeReadContext["reading"]) => Promise<boolean>;

type StartClockWaits = () => Pick<StartClockWaiting, "agreed" | "cause"> | null;

/** While `check` answers true at the read's reading: `clock.unconfirmed` with its count and cause
 * while `startClockWaits` answers them (the start check waits), otherwise `clock.check_time`. */
export function clockCheckNoticeSource(
  check: ClockCheck,
  startClockWaits?: StartClockWaits,
): StaffNoticeSource {
  return {
    read: async ({ tx, reading }) => {
      if (!(await check(tx, reading))) return [];
      const waiting = startClockWaits?.() ?? null;
      if (waiting === null) return [CHECK_TIME];
      return [
        {
          key: "clock.unconfirmed",
          code: "clock.unconfirmed",
          severity: "error",
          params: { agreed: waiting.agreed, cause: waiting.cause },
        },
      ];
    },
  };
}

/** Call the returned function once per read, before the read's write-lock turns. It answers the
 * box's source, the clock check's when given, then the modules', so the box's notices come first
 * among equal severities. Give it the enabled modules. */
export function deviceNoticeSources(
  box: Parameters<typeof boxStaffNoticeSource>[0] & {
    clockCheck?: ClockCheck;
    startClockWaits?: StartClockWaits;
  },
  modules: readonly WaitronModule[],
): () => Promise<readonly OwnedStaffNoticeSource[]> {
  const rest: readonly OwnedStaffNoticeSource[] = [
    ...(box.clockCheck === undefined
      ? []
      : [
          {
            owner: BOX_CLOCK_NOTICE_OWNER,
            source: clockCheckNoticeSource(box.clockCheck, box.startClockWaits),
          },
        ]),
    ...enabledStaffNoticeSources(modules),
  ];
  return async () => [
    { owner: BOX_NOTICE_OWNER, source: await boxStaffNoticeSource(box) },
    ...rest,
  ];
}

/** Owner name of the device's own clock notice; no module is named this. */
export const DEVICE_CLOCK_NOTICE_OWNER = "device-clock";

const DEVICE_WRONG: StaffNotice = {
  key: "clock.device_wrong",
  code: "clock.device_wrong",
  severity: "warning",
  params: {},
};

/** `clock.device_wrong` while the box's time service is synchronised and `deviceId`'s latest fresh
 * reading is more than a minute from the box's clock. The time service is asked here, before the
 * read's write-lock turns, and only for a device that is off; the source answers what was found
 * then. A failed look fails the source's read, never this call. */
export async function deviceClockNoticeSource(
  deps: {
    witness: (deviceId: string) => ClockWitness | undefined;
    status: () => Promise<ClockServiceStatus>;
  },
  deviceId: string,
): Promise<OwnedStaffNoticeSource> {
  let notices: StaffNotice[];
  try {
    notices = await deviceClockNotices(deps, deviceId);
  } catch (error) {
    return {
      owner: DEVICE_CLOCK_NOTICE_OWNER,
      source: { read: () => Promise.reject(error as Error) },
    };
  }
  return { owner: DEVICE_CLOCK_NOTICE_OWNER, source: { read: () => Promise.resolve(notices) } };
}

async function deviceClockNotices(
  deps: Parameters<typeof deviceClockNoticeSource>[0],
  deviceId: string,
): Promise<StaffNotice[]> {
  const mine = deps.witness(deviceId);
  if (mine === undefined) return [];
  const differenceMs = Date.parse(mine.witnessAt) - Date.parse(mine.boxAt);
  if (Math.abs(differenceMs) - mine.uncertaintyMs <= CLOCK_WITNESS_MARGIN_MS) return [];
  if (!(await clockServiceSynchronised(deps.status))) return [];
  return [DEVICE_WRONG];
}

/** Owner name of the printer notices; no module is named this. */
export const PRINTER_NOTICE_OWNER = "printers";
/** How long one read of the printers in trouble serves every device. */
export const PRINTER_NOTICE_CACHE_MS = 10_000;

const DOCUMENT_ROLES: ReadonlySet<string> = new Set(["receipt", "payment_slip", "invoice"]);

/** The printers the device's receipts, payment slips and full invoices resolve to. */
export async function documentPrintersOf(
  tx: Transaction,
  deviceId: string,
): Promise<ReadonlySet<string>> {
  const roles = await readPrinterRoles(tx, deviceId);
  return new Set(
    roles
      .filter((r) => DOCUMENT_ROLES.has(r.role) && r.resolvedId !== null)
      .map((r) => r.resolvedId!),
  );
}

/** A kitchen printer in trouble for any device; another only for a device in `documentPrinters`.
 * A stuck printer says it is not printing; one that has printed a later document since says so
 * only if it gave up on a ticket, asking for it to be reprinted: tickets still being tried show
 * nothing. */
export function printerStaffNoticeSource(deps: {
  deviceId: string;
  trouble: (tx: Transaction, now: Date) => Promise<readonly PrinterInTrouble[]>;
  documentPrinters?: (tx: Transaction, deviceId: string) => Promise<ReadonlySet<string>>;
}): StaffNoticeSource {
  const documentPrinters = deps.documentPrinters ?? documentPrintersOf;
  return {
    async read({ tx, reading }) {
      const rows = (await deps.trouble(tx, reading.instant)).filter(
        (r) => r.stuckSince !== null || r.givenUp,
      );
      if (rows.length === 0) return [];
      const mine = rows.every((r) => r.kitchen)
        ? new Set<string>()
        : await documentPrinters(tx, deps.deviceId);
      const since = (r: PrinterInTrouble) => Date.parse(r.stuckSince ?? r.oldest);
      return rows
        .filter((r) => r.kitchen || mine.has(r.id))
        .sort((x, y) => since(x) - since(y) || x.name.localeCompare(y.name))
        .map((r): StaffNotice =>
          r.stuckSince === null
            ? {
                key: `printer.ticket_failed:${r.id}`,
                code: "printer.ticket_failed",
                severity: "warning",
                params: { printer: r.name },
              }
            : {
                key: `printer.jobs_waiting:${r.id}`,
                code: "printer.jobs_waiting",
                severity: "warning",
                params: { printer: r.name, since: new Date(r.stuckSince).toISOString() },
              },
        );
    },
  };
}

export function devicePrinterNoticeSources(deps: {
  now: () => Date;
  testPages?: Pick<PageTestPages, "holdOn">;
  cacheMs?: number;
  trouble?: (tx: Transaction, now: Date) => Promise<readonly PrinterInTrouble[]>;
  documentPrinters?: (tx: Transaction, deviceId: string) => Promise<ReadonlySet<string>>;
}): (deviceId: string) => readonly OwnedStaffNoticeSource[] {
  const trouble = deps.trouble ?? printersInTrouble;
  const cache = createTtlCache<readonly PrinterInTrouble[]>({
    ttlMs: deps.cacheMs ?? PRINTER_NOTICE_CACHE_MS,
    now: deps.now,
  });
  const invoices = createTtlCache<Awaited<ReturnType<typeof readUndeliveredInvoices>>>({
    ttlMs: deps.cacheMs ?? PRINTER_NOTICE_CACHE_MS,
    now: deps.now,
  });
  const { testPages } = deps;
  const documentPrinters = deps.documentPrinters ?? documentPrintersOf;
  return (deviceId) => [
    {
      owner: PRINTER_NOTICE_OWNER,
      source: printerStaffNoticeSource({
        deviceId,
        trouble: (tx, at) => cache.get("all", () => trouble(tx, at)),
        documentPrinters: deps.documentPrinters,
      }),
    },
    ...(testPages === undefined
      ? []
      : [
          {
            owner: "office-invoices",
            source: {
              async read({ tx, reading }: StaffNoticeReadContext) {
                const rows = await invoices.get("all", () =>
                  readUndeliveredInvoices(tx, reading.instant, testPages),
                );
                if (!rows.some(({ officePrinter }) => officePrinter !== undefined)) return [];
                const mine = await documentPrinters(tx, deviceId);
                const notices = new Map<string, StaffNotice>();
                for (const { officePrinter, found } of rows) {
                  if (officePrinter === undefined || !mine.has(officePrinter.id)) continue;
                  const hold = "hold" in found ? found.hold : undefined;
                  const key = `${officePrinter.id}:${hold ?? found.kind}`;
                  notices.set(key, {
                    key,
                    code: "invoice_delivery.office_print",
                    severity: "warning",
                    params: {
                      printer: officePrinter.name,
                      reason: found.kind,
                      ...(hold === undefined ? {} : { hold }),
                    },
                  });
                }
                return [...notices.values()];
              },
            },
          },
        ]),
    {
      owner: "drawers",
      source: {
        async read({ tx }) {
          const printerId = (await readPrinterRoles(tx, deviceId)).find(
            (role) => role.role === "cash_drawer",
          )?.resolvedId;
          if (printerId == null) return [];
          const [latest] = await tx
            .select({ id: printJobs.id, status: printJobs.status, error: printJobs.lastError })
            .from(printJobs)
            .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
            .where(
              and(
                eq(printJobs.printerId, printerId),
                eq(printJobs.kind, "drawer"),
                eq(printers.active, true),
                eq(printers.hasCashDrawer, true),
              ),
            )
            // Ordering without clock time lets a new request clear the notice after a clock step.
            .orderBy(sql`${printJobs}.rowid desc`)
            .limit(1);
          return latest?.status === "failed" && latest.error === "print_job.drawer_expired"
            ? [
                {
                  key: `print_job.drawer_expired:${latest.id}`,
                  code: "print_job.drawer_expired",
                  severity: "warning" as const,
                  params: {},
                },
              ]
            : [];
        },
      },
    },
  ];
}
