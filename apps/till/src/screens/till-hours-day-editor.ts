import type {
  AttendanceChange,
  AttendanceDayView,
  CorrectionItem,
} from "@waitron/workforce/attendance-contract";
import { dayEditorRows, originalEntry } from "@waitron/workforce/attendance-day-edit";
import { fill, t } from "../i18n/t.js";
import { storedAttendanceTime } from "../widgets/attendance-history.js";

export interface ManagerDay {
  view: AttendanceDayView;
  item?: CorrectionItem;
  name: string;
}

const clockKinds = ["in", "break_start", "break_end", "out"] as const;
export type ClockKind = (typeof clockKinds)[number];
const key = (target: AttendanceChange["target"]) =>
  "entryId" in target ? target.entryId : target.missingKind;
const requested = ({ item }: ManagerDay) =>
  item?.direction === "worker_request" ? item.changes : (item?.workerVersion?.changes ?? []);

function recorded({ view }: ManagerDay, target: AttendanceChange["target"]) {
  return view.record.entries.find(({ entry }) => entry.entryId === key(target))?.entry;
}

export function recordedDate(
  day: ManagerDay,
  target: AttendanceChange["target"],
): string | undefined {
  const entry = recorded(day, target);
  return entry && storedAttendanceTime(entry.eventAt, entry.offsetMinutes).slice(0, 10);
}

function clockKind(day: ManagerDay, change: AttendanceChange): ClockKind | undefined {
  if ("missingKind" in change.target) return change.target.missingKind;
  const previous = recorded(day, change.target);
  const byId = new Map(day.view.record.entries.map(({ entry }) => [entry.entryId, entry]));
  const root = previous && originalEntry(previous, byId);
  const kind = root?.extension?.missingEntryKind ?? root?.entryKind;
  return clockKinds.find((value) => value === kind);
}

export function managerDayRows(day: ManagerDay) {
  const asked = requested(day);
  const requestedTargets = new Set(asked.map(({ target }) => key(target)));
  const recordedAt = (change: AttendanceChange) =>
    recorded(day, change.target)?.eventAt ?? change.at;
  const ordered = dayEditorRows(day.view, asked).sort(
    (a, b) => Date.parse(recordedAt(a)) - Date.parse(recordedAt(b)),
  );
  let shift = -1;
  let openOnWorkDate = false;
  return ordered.flatMap((change) => {
    const kind = clockKind(day, change);
    if (kind === "in") {
      shift++;
      const startDate =
        recordedDate(day, change.target) ??
        storedAttendanceTime(change.at, change.offsetMinutes).slice(0, 10);
      openOnWorkDate = !!day.item && startDate === day.view.date;
    }
    const at = recordedAt(change);
    const shown =
      openOnWorkDate ||
      requestedTargets.has(key(change.target)) ||
      day.view.record.sessions.some(({ startedAt, endedAt }) => at >= startedAt && at <= endedAt);
    if (kind === "out") openOnWorkDate = false;
    return shown ? [{ change, kind, shift }] : [];
  });
}

export function managerDayEdits(day: ManagerDay, changes: AttendanceChange[]) {
  return changes.filter((change) => {
    const previous = recorded(day, change.target);
    return (
      change.at !== previous?.eventAt ||
      change.offsetMinutes !== previous.offsetMinutes ||
      (day.item?.direction === "worker_request" &&
        requested(day).some(({ target }) => key(target) === key(change.target)))
    );
  });
}

export function dayOffsetSuffix(date: string, shiftDate: string): string {
  const days =
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${shiftDate}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) && days !== 0 ? ` (${days > 0 ? "+" : ""}${days})` : "";
}

export function managerDayField(
  day: ManagerDay,
  original: AttendanceChange,
  kind: ClockKind | undefined,
  date: string,
  time: string,
  shiftDate: string,
) {
  const { target } = original;
  const previous = recorded(day, target);
  const request = requested(day).find(
    (entry) =>
      key(entry.target) === key(target) && ("entryId" in target || entry.at === original.at),
  );
  const display = (at: string, offset: number) => {
    const wall = storedAttendanceTime(at, offset);
    return (
      wall.slice(11, 16) + dayOffsetSuffix(wall.slice(0, 10), shiftDate).replace(" ", "\u00a0")
    );
  };
  const recordedTime = previous && display(previous.eventAt, previous.offsetMinutes);
  const recordedWall = previous && storedAttendanceTime(previous.eventAt, previous.offsetMinutes);
  const before =
    recordedTime && (request || recordedWall?.slice(0, 16) !== `${date} ${time}`)
      ? fill(t("hours.recorded_time"), { time: recordedTime })
      : "";
  const asked =
    request &&
    fill(t("hours.requested_time"), {
      name: day.name,
      time: display(request.at, request.offsetMinutes),
    });
  return {
    label: kind ? t(`hours.entry_${kind}`) : t("attendance.time"),
    notes: [before, asked].filter(Boolean).join(" · "),
    requested: !!request,
  };
}
