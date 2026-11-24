import { formatBytes } from "@waitron/dashboard-kit";
import type { AlertView, BoxHealth, BoxNetwork, SpareFollowView } from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { alertMessage } from "../i18n/alerts.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

export function ssidName(hex: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)),
  );
}

export function networkOutcome(network: Pick<BoxNetwork, "change" | "bootCopy">): string {
  const change = network.change;
  if (!change) return "";
  const verb = t(change.kind === "join" ? "box_status.network.join" : "box_status.network.forget");
  const state =
    change.state === "running"
      ? t("box_status.network.running")
      : change.state === "applied"
        ? t(
            change.kind === "join"
              ? "box_status.network.join_applied"
              : "box_status.network.forget_applied",
          )
        : t(
            change.reason === "password-rejected"
              ? "box_status.network.password_rejected"
              : change.reason === "network-not-found"
                ? "box_status.network.not_found"
                : change.reason === "timed-out"
                  ? "box_status.network.timed_out"
                  : change.kind === "join"
                    ? "box_status.network.join_failed"
                    : "box_status.network.forget_failed",
          );
  const copy = network.bootCopy;
  const copyWords = t(
    copy.state === "pending"
      ? "box_status.network.copy_pending"
      : copy.state === "current"
        ? "box_status.network.copy_current"
        : copy.state === "failed"
          ? "box_status.network.copy_failed"
          : "box_status.network.copy_absent",
  );
  const detail =
    copy.state === "absent" && copy.reason
      ? t(
          copy.reason === "cable-only"
            ? "box_status.network.copy_cable"
            : copy.reason.startsWith("password-")
              ? "box_status.network.copy_password"
              : "box_status.network.copy_security",
        )
      : copy.state === "failed"
        ? t(
            copy.failure === "io-failed"
              ? "box_status.network.copy_io"
              : copy.failure === "publication-unverified"
                ? "box_status.network.copy_unverified"
                : "box_status.network.copy_unsafe",
          )
        : "";
  return `${t("box_status.network.last_change")}: ${verb} · ${ssidName(change.ssidHex)}. ${state} ${copyWords} ${detail}`.trim();
}

export type PartId =
  "sales" | "tax" | "spare" | "bucket" | "printers" | "readers" | "clock" | "disk" | "upgrade";
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
  "spare",
  "printers",
  "readers",
  "clock",
  "disk",
  "upgrade",
];

const SCREENS: Readonly<Record<PartId, string | null>> = {
  sales: null,
  tax: null,
  bucket: "backup",
  spare: "servers",
  printers: "printers",
  readers: "payments",
  clock: null,
  disk: null,
  upgrade: null,
};

const NOTICE_PARTS: Readonly<Record<string, readonly PartId[]>> = {
  "storage.disk_full": ["sales", "disk"],
  "clock.unusable": ["sales", "clock"],
  "storage.space_low": ["disk"],
  "fiscal.records_unsent": ["tax"],
};

/** The words of a red notice, on every row it stops. */
const STOPPED_WORDS: Readonly<Record<string, StringKey>> = {
  "storage.disk_full": "box_status.notice.disk_full",
  "clock.unusable": "box_status.notice.clock_unusable",
};

/** The box's time is confirmed and a new fiscal installation still does not open. */
const IDENTITY_CHANGE_BLOCKED = "sif.identity_change_blocked";

export function identityChangeBlocked(alerts: readonly AlertView[]): AlertView | undefined {
  return alerts.find((alert) => alert.code === IDENTITY_CHANGE_BLOCKED);
}

export function partOfAlert(alert: Pick<AlertView, "area" | "code">): PartId | null {
  if (alert.area === "printing") return "printers";
  if (alert.area === "card_reader") return "readers";
  if (alert.code.startsWith("backup.stream_")) return "bucket";
  if (
    alert.code === "fiscal.clock_drift" ||
    alert.code === IDENTITY_CHANGE_BLOCKED ||
    alert.code.startsWith("clock.")
  )
    return "clock";
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
  const parts = PART_ORDER.filter(
    (id) =>
      (id !== "readers" || health.readers !== null) &&
      (id !== "upgrade" || health.lastOfferedUpgrade !== undefined) &&
      (id !== "spare" || health.spare != null) &&
      (id !== "bucket" || health.spare == null || health.stream.toSpare !== true),
  );
  const noticesOn = new Map<PartId, Notice[]>(parts.map((id) => [id, []]));
  const alertsOn = new Map<PartId, AlertView[]>(parts.map((id) => [id, []]));
  let other = 0;
  for (const notice of health.notices) {
    const on = partsOfNotice(notice.code).filter((id) => noticesOn.has(id));
    if (on.length === 0) other += 1;
    for (const id of on) noticesOn.get(id)!.push(notice);
  }
  for (const alert of alerts) {
    // The Clock row's line already says what the box waits for.
    if (alert.code === "clock.unconfirmed") continue;
    const part = partOfAlert(alert);
    const id =
      part === "bucket" && health.spare != null && health.stream.toSpare === true ? "spare" : part;
    const list = id === null ? undefined : alertsOn.get(id);
    if (list === undefined) other += 1;
    else list.push(alert);
  }
  const blocked = identityChangeBlocked(alerts);
  const rows = parts.map((id) => {
    const notices = noticesOn.get(id)!;
    const rowAlerts = alertsOn.get(id)!;
    const stopped = notices.filter((notice) => notice.severity === "error");
    const state: PartState =
      stopped.length > 0 || waitingOn(id, health)
        ? "stopped"
        : notices.length > 0 ||
            rowAlerts.length > 0 ||
            (id === "spare" && spareNeedsAttention(health.spare!)) ||
            clockOff(id, health)
          ? "attention"
          : "ok";
    return {
      id,
      state,
      line: lineOf(id, health, notices, stopped, rowAlerts, blocked),
      details: detailsOf(id, health, notices),
      alerts: rowAlerts,
      screen: SCREENS[id],
    };
  });
  return { rows, other, checksUnavailable: health.noticesUnavailable.length > 0 };
}

function waitingOn(id: PartId, health: BoxHealth): boolean {
  return (id === "clock" || id === "sales") && health.clock.waiting !== undefined;
}

/** The box's own read can see drift before the bell's slower alert read carries it. */
function clockOff(id: PartId, health: BoxHealth): boolean {
  return id === "clock" && health.clock.authority.state === "warning";
}

const WAITING_LINES: Readonly<Record<string, StringKey>> = {
  clock_jumped: "box_status.clock.waiting_jumped",
  future_date_refused: "box_status.clock.waiting_future_date",
  identity_change: "box_status.clock.waiting_identity_change",
};

function lineOf(
  id: PartId,
  health: BoxHealth,
  notices: readonly Notice[],
  stopped: readonly Notice[],
  alerts: readonly AlertView[],
  blocked: AlertView | undefined,
): string {
  if (id === "sales") {
    // A full disk stops everything, so it wins over a wrong clock.
    const reason =
      stopped.find((notice) => notice.code === "storage.disk_full") ??
      stopped.find((notice) => notice.code === "clock.unusable");
    if (reason !== undefined) return t(STOPPED_WORDS[reason.code]!);
    if (health.clock.waiting !== undefined)
      return blocked === undefined
        ? t("box_status.sales.clock_waiting")
        : alertMessage(blocked.code, blocked.params, currentLocale());
    return t("box_status.sales.ok");
  }
  const words = stopped.find((notice) => Object.hasOwn(STOPPED_WORDS, notice.code));
  if (words !== undefined) return t(STOPPED_WORDS[words.code]!);
  const waiting = id === "clock" ? health.clock.waiting : undefined;
  if (waiting !== undefined) {
    if (blocked !== undefined) return alertMessage(blocked.code, blocked.params, currentLocale());
    const key = WAITING_LINES[waiting.cause ?? "start"] ?? "box_status.clock.waiting";
    const line = fill(key, {
      agreed: String(waiting.agreed),
      boxAt: formatIsoMinute(waiting.boxAt),
    });
    if (waiting.hostAnswers) return line;
    // Only the start's wait happens at every start.
    const silent =
      key === "box_status.clock.waiting"
        ? "box_status.clock.waiting_host_silent"
        : "box_status.clock.waiting_host_silent_jumped";
    return `${line} ${t(silent)}`;
  }
  const first = alerts[0];
  if (notices.length === 0 && first !== undefined)
    return alertMessage(first.code, first.params, currentLocale());
  return factLine(id, health, notices);
}

function factLine(id: PartId, health: BoxHealth, notices: readonly Notice[]): string {
  switch (id) {
    case "tax":
      return taxLine(health, notices);
    case "spare":
      return spareLine(health.spare!);
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
      return authority.state === "unknown"
        ? t("box_status.clock.unknown")
        : t("box_status.clock.ok");
    }
    case "upgrade": {
      const { status, fromVersion, toVersion } = health.lastOfferedUpgrade!;
      return fill(
        status === "upgraded" ? "box_status.upgrade.upgraded" : "box_status.upgrade.rolled_back",
        { fromVersion, toVersion },
      );
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
    case "tax": {
      if (health.outbox === null) return [];
      const since = notices.find((notice) => notice.code === "fiscal.records_unsent")?.params.since;
      return [
        health.outbox.lastAcceptedAt === null
          ? t("box_status.tax.none_accepted")
          : fill("box_status.tax.last_accepted", {
              time: formatIsoMinute(health.outbox.lastAcceptedAt),
            }),
        ...(typeof since === "string"
          ? [fill("box_status.tax.unsent_since", { time: formatIsoMinute(since) })]
          : []),
      ];
    }
    case "spare":
      return spareDetails(health.spare!);
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
      return clockDetails(health.clock);
    case "disk":
      return diskDetails(health.disk);
    case "upgrade":
      return [formatIsoMinute(health.lastOfferedUpgrade!.finishedAt)];
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

export function spareNeedsAttention(spare: SpareFollowView): boolean {
  return spare.state !== "following" || spare.lagMs === null || spare.lagMs > 60000;
}
export function spareLine(spare: SpareFollowView): string {
  if (spare.state === "rebuilding") return t("box_status.spare.rebuilding");
  if (spare.state !== "following" || spare.lagMs === null) return t("box_status.spare.unknown");
  if (spare.lagMs === 0 && spare.appliedTXID !== spare.uploadedTXID)
    return t("box_status.spare.pending");
  return spare.lagMs === 0 && spare.appliedTXID === spare.uploadedTXID
    ? t("box_status.bucket.ok")
    : fill("box_status.spare.behind", { seconds: String(Math.ceil(spare.lagMs / 1000)) });
}
export function spareDetails(spare: SpareFollowView): string[] {
  return [
    t("box_status.spare.switch_copy"),
    ...(spare.lastAppliedAt === null
      ? []
      : [fill("box_status.spare.last", { time: formatIsoMinute(spare.lastAppliedAt) })]),
  ];
}
