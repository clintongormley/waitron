import type { Transaction } from "@waitron/db";
import { readPrinterRoles } from "@waitron/layouts";
import type {
  StaffNotice,
  StaffNoticeReadContext,
  StaffNoticeSource,
  WaitronModule,
} from "@waitron/module";
import type { DiskFullState } from "./disk-full-state.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import { enabledStaffNoticeSources } from "./modules.js";
import { printersInTrouble, type PrinterInTrouble } from "./print-job-trouble.js";
import type { OwnedStaffNoticeSource } from "./staff-notices.js";
import { createTtlCache } from "./ttl-cache.js";

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

/** `storage.disk_full` while the full-disk stop is noted, otherwise `storage.space_low` while the
 * low-space warning is on. Reads no disk. */
export function boxStaffNoticeSource(deps: {
  disk: Pick<DiskFullState, "since">;
  space: Pick<FreeSpaceState, "current">;
}): StaffNoticeSource {
  return {
    read: () => {
      if (deps.disk.since() !== null) return Promise.resolve([DISK_FULL]);
      if (deps.space.current().lowSince !== null) return Promise.resolve([SPACE_LOW]);
      return Promise.resolve([]);
    },
  };
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

/** `clock.check_time` while `check` answers true at the read's reading. */
export function clockCheckNoticeSource(check: ClockCheck): StaffNoticeSource {
  return {
    read: async ({ tx, reading }) => ((await check(tx, reading)) ? [CHECK_TIME] : []),
  };
}

/** The box's source, the clock check's when given, then the modules', so the box's notices come
 * first among equal severities. Give it the enabled modules. */
export function deviceNoticeSources(
  box: Parameters<typeof boxStaffNoticeSource>[0] & { clockCheck?: ClockCheck },
  modules: readonly WaitronModule[],
): readonly OwnedStaffNoticeSource[] {
  return [
    { owner: BOX_NOTICE_OWNER, source: boxStaffNoticeSource(box) },
    ...(box.clockCheck === undefined
      ? []
      : [{ owner: BOX_CLOCK_NOTICE_OWNER, source: clockCheckNoticeSource(box.clockCheck) }]),
    ...enabledStaffNoticeSources(modules),
  ];
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

/** A stuck kitchen printer for any device; another stuck printer only for a device in
 * `documentPrinters`. */
export function printerStaffNoticeSource(deps: {
  deviceId: string;
  trouble: (tx: Transaction, now: Date) => Promise<readonly PrinterInTrouble[]>;
  documentPrinters?: (tx: Transaction, deviceId: string) => Promise<ReadonlySet<string>>;
}): StaffNoticeSource {
  const documentPrinters = deps.documentPrinters ?? documentPrintersOf;
  return {
    async read({ tx, reading }) {
      const rows = (await deps.trouble(tx, reading.instant)).filter((r) => r.stuckSince !== null);
      if (rows.length === 0) return [];
      const mine = rows.every((r) => r.kitchen)
        ? new Set<string>()
        : await documentPrinters(tx, deps.deviceId);
      return rows
        .filter((r) => r.kitchen || mine.has(r.id))
        .sort(
          (x, y) =>
            Date.parse(x.stuckSince!) - Date.parse(y.stuckSince!) || x.name.localeCompare(y.name),
        )
        .map((r): StaffNotice => ({
          key: `printer.jobs_waiting:${r.id}`,
          code: "printer.jobs_waiting",
          severity: "warning",
          params: { printer: r.name, since: new Date(r.stuckSince!).toISOString() },
        }));
    },
  };
}

/** One source per device, all reading the box location's printers in trouble through one cache. */
export function devicePrinterNoticeSources(deps: {
  now: () => Date;
  locationId: string;
  cacheMs?: number;
  trouble?: (
    tx: Transaction,
    now: Date,
    options: { locationId: string },
  ) => Promise<readonly PrinterInTrouble[]>;
  documentPrinters?: (tx: Transaction, deviceId: string) => Promise<ReadonlySet<string>>;
}): (deviceId: string) => readonly OwnedStaffNoticeSource[] {
  const trouble = deps.trouble ?? printersInTrouble;
  const cache = createTtlCache<readonly PrinterInTrouble[]>({
    ttlMs: deps.cacheMs ?? PRINTER_NOTICE_CACHE_MS,
    now: deps.now,
  });
  return (deviceId) => [
    {
      owner: PRINTER_NOTICE_OWNER,
      source: printerStaffNoticeSource({
        deviceId,
        trouble: (tx, at) =>
          cache.get("all", () => trouble(tx, at, { locationId: deps.locationId })),
        documentPrinters: deps.documentPrinters,
      }),
    },
  ];
}
