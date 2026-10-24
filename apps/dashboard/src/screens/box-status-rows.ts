import { formatBytes } from "@waitron/dashboard-kit";
import type { AlertView, BoxHealth } from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { ALERT_WORDS } from "../i18n/alert-messages.js";
import { alertMessage } from "../i18n/alerts.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

export type PartId = "sales" | "tax" | "bucket" | "printers" | "readers" | "clock" | "disk";
export type PartState = "ok" | "attention" | "stopped";
export interface PartRow {
  id: PartId;
  state: PartState;
  /** The row's headline, worded. */
  line: string;
  /** Facts under the headline, worded; empty when there are none. */
  details: string[];
  /** The bell's alerts on this row, in the bell's order. */
  alerts: AlertView[];
  /** The screen the row's action opens; null when the row has none. */
  screen: string | null;
}

type Notice = BoxHealth["notices"][number];

const PART_ORDER: readonly PartId[] = [
  "sales",
  "tax",
  "bucket",
  "printers",
  "readers",
  "clock",
  "disk",
];

const SCREENS: Readonly<Record<PartId, string | null>> = {
  sales: null,
  tax: null,
  bucket: "backup",
  printers: "printers",
  readers: "payments",
  clock: null,
  disk: null,
};

const NOTICE_PARTS: Readonly<Record<string, readonly PartId[]>> = {
  "storage.disk_full": ["sales", "disk"],
  "clock.unusable": ["sales", "clock"],
  "clock.behind_chain": ["sales", "clock"],
  "storage.space_low": ["disk"],
  "fiscal.records_unsent": ["tax"],
};

/** The words of a red notice, on every row it stops. */
const STOPPED_WORDS: Readonly<Record<string, StringKey>> = {
  "storage.disk_full": "box_status.notice.disk_full",
  "clock.unusable": "box_status.notice.clock_unusable",
  "clock.behind_chain": "box_status.notice.clock_behind_chain",
};

export function partOfAlert(alert: Pick<AlertView, "area" | "code">): PartId | null {
  if (alert.area === "printing") return "printers";
  if (alert.area === "card_reader") return "readers";
  if (alert.code.startsWith("backup.stream_")) return "bucket";
  if (alert.code === "fiscal.clock_drift" || alert.code.startsWith("clock.")) return "clock";
  if (alert.area === "fiscal") return "tax";
  if (alert.area === "box") return "disk";
  return null;
}

export function partsOfNotice(code: string): readonly PartId[] {
  return Object.hasOwn(NOTICE_PARTS, code) ? NOTICE_PARTS[code]! : [];
}

export function boxStatusRows(
  health: BoxHealth,
  alerts: readonly AlertView[],
): { rows: PartRow[]; other: number; checksUnavailable: boolean } {
  const parts = PART_ORDER.filter((id) => id !== "readers" || health.readers !== null);
  const noticesOn = new Map<PartId, Notice[]>(parts.map((id) => [id, []]));
  const alertsOn = new Map<PartId, AlertView[]>(parts.map((id) => [id, []]));
  let other = 0;
  for (const notice of health.notices) {
    const on = partsOfNotice(notice.code).filter((id) => noticesOn.has(id));
    if (on.length === 0) other += 1;
    for (const id of on) noticesOn.get(id)!.push(notice);
  }
  for (const alert of alerts) {
    const id = partOfAlert(alert);
    const list = id === null ? undefined : alertsOn.get(id);
    if (list === undefined) other += 1;
    else list.push(alert);
  }
  const rows = parts.map((id) => {
    const notices = noticesOn.get(id)!;
    const rowAlerts = alertsOn.get(id)!;
    const stopped = notices.filter((notice) => notice.severity === "error");
    const state: PartState =
      stopped.length > 0
        ? "stopped"
        : notices.length > 0 ||
            rowAlerts.length > 0 ||
            clockOff(id, health) ||
            clockAfterStop(id, health)
          ? "attention"
          : "ok";
    return {
      id,
      state,
      line: lineOf(id, health, notices, stopped, rowAlerts),
      details: detailsOf(id, health, notices),
      alerts: rowAlerts,
      screen: SCREENS[id],
    };
  });
  return { rows, other, checksUnavailable: health.noticesUnavailable.length > 0 };
}

/** The box's own read can see drift before the bell's slower alert read carries it. */
function clockOff(id: PartId, health: BoxHealth): boolean {
  return id === "clock" && health.clock.authority.state === "warning";
}

/** Payments go on, but on a clock a confirmation covers or nothing has confirmed yet. */
function clockAfterStop(id: PartId, health: BoxHealth): boolean {
  return (
    id === "clock" && (health.clockStop?.proof === "confirmed" || health.clockCheckWaiting !== null)
  );
}

function lineOf(
  id: PartId,
  health: BoxHealth,
  notices: readonly Notice[],
  stopped: readonly Notice[],
  alerts: readonly AlertView[],
): string {
  if (id === "sales") {
    // A full disk stops everything and a wrong clock every sale, so each wins over the payment stop.
    const reason =
      stopped.find((notice) => notice.code === "storage.disk_full") ??
      stopped.find((notice) => notice.code === "clock.unusable") ??
      stopped.find((notice) => notice.code === "clock.behind_chain");
    return reason === undefined ? t("box_status.sales.ok") : t(STOPPED_WORDS[reason.code]!);
  }
  const words = stopped.find((notice) => Object.hasOwn(STOPPED_WORDS, notice.code));
  if (words !== undefined) return t(STOPPED_WORDS[words.code]!);
  const first = alerts[0];
  if (notices.length === 0 && first !== undefined)
    return alertMessage(first.code, first.params, currentLocale());
  return factLine(id, health, notices);
}

function factLine(id: PartId, health: BoxHealth, notices: readonly Notice[]): string {
  switch (id) {
    case "tax":
      return taxLine(health, notices);
    case "bucket":
      return bucketLine(health.stream);
    case "printers":
      return health.printers.length === 0
        ? t("box_status.printers.none")
        : t("box_status.no_problems");
    case "readers":
      return health.readers!.length === 0
        ? t("box_status.readers.none")
        : t("box_status.no_problems");
    case "clock": {
      const authority = health.clock.authority;
      if (authority.state === "warning")
        return alertMessage(
          "fiscal.clock_drift",
          { seconds: Math.abs(authority.driftSeconds) },
          currentLocale(),
        );
      // The tax agency's last comparison can predate the stop, so it cannot vouch for the clock.
      if (health.clockCheckWaiting !== null) return t("box_status.clock.unconfirmed");
      return authority.state === "unknown"
        ? t("box_status.clock.unknown")
        : t("box_status.clock.ok");
    }
    default:
      return diskLine(health.disk);
  }
}

function taxLine(health: BoxHealth, notices: readonly Notice[]): string {
  if (!health.filing) return t("box_status.tax.not_filing");
  const unsent = notices.find((notice) => notice.code === "fiscal.records_unsent");
  if (unsent === undefined) return t("box_status.tax.ok");
  const { count, held } = unsent.params;
  // A held record waits for a person to resolve its filing case, so it is not retried.
  if (typeof held === "number" && held > 0)
    return count === 1
      ? t("box_status.tax.unsent_held_one")
      : fill("box_status.tax.unsent_held", { count: String(count) });
  return count === 1
    ? t("box_status.tax.unsent_one")
    : fill("box_status.tax.unsent", { count: String(count) });
}

function bucketLine(stream: BoxHealth["stream"]): string {
  switch (stream.state) {
    case "opening":
      return t("box_status.bucket.starting");
    case "streaming":
      return stream.lagMs >= 60_000
        ? fill("box_status.bucket.behind", { minutes: String(Math.floor(stream.lagMs / 60_000)) })
        : t("box_status.bucket.ok");
    case "off":
      // Plain off means no copy is set up; an off that carries a state time has settings stored.
      return "stateSince" in stream
        ? t("box_status.bucket.not_copying")
        : t("box_status.bucket.off");
    default:
      return t("box_status.bucket.not_copying");
  }
}

function diskLine(disk: BoxHealth["disk"]): string {
  if (disk.freeBytes === null || disk.totalBytes === null) return t("box_status.disk.unreadable");
  const locale = currentLocale();
  return fill("box_status.disk.free", {
    free: formatBytes(disk.freeBytes, locale),
    total: formatBytes(disk.totalBytes, locale),
  });
}

function detailsOf(id: PartId, health: BoxHealth, notices: readonly Notice[]): string[] {
  switch (id) {
    case "sales":
      return [
        health.sales.lastAt === null
          ? t("box_status.sales.none")
          : fill("box_status.sales.last", { time: formatIsoMinute(health.sales.lastAt) }),
      ];
    case "tax":
      if (health.outbox === null) return [];
      return [
        health.outbox.lastAcceptedAt === null
          ? t("box_status.tax.none_accepted")
          : fill("box_status.tax.last_accepted", {
              time: formatIsoMinute(health.outbox.lastAcceptedAt),
            }),
      ];
    case "bucket": {
      const last =
        "lastConfirmedUploadAt" in health.stream ? health.stream.lastConfirmedUploadAt : null;
      return last === null ? [] : [fill("box_status.bucket.last", { time: formatIsoMinute(last) })];
    }
    case "printers":
      return names(health.printers);
    case "readers":
      return names(health.readers!);
    case "clock":
      return [
        ...clockDetails(health.clock),
        ...(notices.some((notice) => notice.code === "clock.behind_chain")
          ? [t("box_status.clock.behind_chain_fix")]
          : []),
        ...clockStopDetails(health),
      ];
    case "disk":
      return diskDetails(health.disk);
    default:
      return [];
  }
}

function names(parts: readonly { name: string }[]): string[] {
  return parts.length === 0 ? [] : [parts.map((part) => part.name).join(", ")];
}

function clockDetails(clock: BoxHealth["clock"]): string[] {
  const details: string[] = [];
  if (clock.authority.state !== "unknown") {
    const drift = clock.authority.driftSeconds;
    // `driftSeconds` is the box's clock less the tax agency's.
    const key: StringKey =
      drift > 60
        ? "box_status.clock.compared_ahead"
        : drift < -60
          ? "box_status.clock.compared_behind"
          : "box_status.clock.compared";
    details.push(
      fill(key, {
        time: formatIsoMinute(clock.authority.measuredAt),
        seconds: String(Math.abs(drift)),
      }),
    );
  }
  if (clock.sync.source === "timedatectl")
    details.push(t(clock.sync.synced ? "box_status.clock.synced" : "box_status.clock.not_synced"));
  return details;
}

/** The agreeing witnesses' lines of a payment stop, and the disagreeing ones while they win. */
function clockStopProof(stop: NonNullable<BoxHealth["clockStop"]>): string[] {
  const details: string[] = [];
  const { authority, devices } = stop.agreeing;
  if (authority !== null)
    details.push(
      fill("box_status.clock.proof.authority", { time: formatIsoMinute(authority.boxAt) }),
    );
  if (devices.length > 0) {
    const latest = devices.reduce((a, b) => (b.witnessAt > a.witnessAt ? b : a));
    const time = formatIsoMinute(latest.witnessAt);
    details.push(
      devices.length === 1
        ? fill("box_status.clock.proof.device_one", { time })
        : fill("box_status.clock.proof.devices", { count: String(devices.length), time }),
    );
  }
  if (stop.proof !== "contrary") return details;
  const contrary = stop.contrary;
  if (contrary.authority !== null)
    details.push(
      fill("box_status.clock.contrary.authority", {
        time: formatIsoMinute(contrary.authority.boxAt),
      }),
    );
  for (const device of contrary.devices)
    details.push(
      fill("box_status.clock.contrary.device", {
        name: device.label ?? t("box_status.clock.contrary.unnamed_device"),
        time: formatIsoMinute(device.witnessAt),
      }),
    );
  return details;
}

function clockStopDetails(health: BoxHealth): string[] {
  const stop = health.clockStop;
  const waiting = health.clockCheckWaiting;
  const details = stop === null ? [] : clockStopProof(stop);
  // A check can wait while an older confirmation still covers the clock; the wait is the news.
  if (stop !== null && !(stop.proof === "confirmed" && waiting !== null))
    details.push(stopLine(stop));
  if (waiting !== null)
    details.push(fill("box_status.clock.check_waiting", { time: formatIsoMinute(waiting.since) }));
  return details;
}

function stopLine(stop: NonNullable<BoxHealth["clockStop"]>): string {
  if (stop.proof !== "confirmed") return t(`box_status.clock.stop.${stop.proof}`);
  // The seat says "confirmed" only when a confirmation covers the reading.
  const confirmation = stop.confirmation!;
  return fill("box_status.clock.stop.confirmed", {
    time: formatIsoMinute(confirmation.confirmedAt),
    who: confirmedBy(confirmation.source),
  });
}

/** The bell's words for what confirmed the clock. */
function confirmedBy(source: string): string {
  const list = ALERT_WORDS["clock_confirmed_by"]!;
  const words = Object.hasOwn(list.words, source) ? list.words[source]! : list.otherwise;
  return currentLocale() === "es" ? words.es : words.en;
}

function diskDetails(disk: BoxHealth["disk"]): string[] {
  const locale = currentLocale();
  const sizes: [StringKey, number | null][] = [
    ["box_status.disk.database", disk.databaseBytes],
    ["box_status.disk.backups", disk.backupsBytes],
    ["box_status.disk.logs", disk.logBytes],
    ["box_status.disk.other", disk.otherBytes],
  ];
  const parts = sizes.flatMap(([key, bytes]) =>
    bytes === null ? [] : [fill(key, { size: formatBytes(bytes, locale) })],
  );
  if (parts.length === 0) return [];
  const line = parts.join(" · ");
  return [line.charAt(0).toLocaleUpperCase(locale) + line.slice(1)];
}
