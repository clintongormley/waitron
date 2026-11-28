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

export const clockKinds = ["in", "break_start", "break_end", "out"] as const;
const key = (target: AttendanceChange["target"]) =>
  "entryId" in target ? target.entryId : target.missingKind;
const requested = ({ item }: ManagerDay) =>
  item?.direction === "worker_request" ? item.changes : (item?.workerVersion?.changes ?? []);

function recorded({ view }: ManagerDay, target: AttendanceChange["target"]) {
  return view.record.entries.find(({ entry }) => entry.entryId === key(target))?.entry;
}

export function managerDayRows(day: ManagerDay) {
  return dayEditorRows(day.view, requested(day));
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

export function managerDayField(
  day: ManagerDay,
  target: AttendanceChange["target"],
  date: string,
  time: string,
) {
  const previous = recorded(day, target);
  const request = requested(day).find((entry) => key(entry.target) === key(target));
  const byId = new Map(day.view.record.entries.map(({ entry }) => [entry.entryId, entry]));
  const root = previous && originalEntry(previous, byId);
  const kind =
    "missingKind" in target
      ? target.missingKind
      : (root?.extension?.missingEntryKind ?? root?.entryKind);
  const display = (at: string, offset: number) => {
    const wall = storedAttendanceTime(at, offset);
    return wall.slice(0, 10) === date ? wall.slice(11, 16) : wall.slice(0, 16).replace("T", " ");
  };
  const recordedTime = previous && display(previous.eventAt, previous.offsetMinutes);
  const before =
    recordedTime && (request || recordedTime !== time)
      ? fill(t("hours.recorded_time"), { time: recordedTime })
      : "";
  const asked =
    request &&
    fill(t("hours.requested_time"), {
      name: day.name,
      time: display(request.at, request.offsetMinutes),
    });
  const label =
    kind === "in" || kind === "out" || kind === "break_start" || kind === "break_end"
      ? t(`hours.entry_${kind}`)
      : t("attendance.time");
  return {
    kind,
    label,
    notes: [before, asked].filter(Boolean).join(" · "),
    requiredTarget: !!request && day.item?.direction === "worker_request",
  };
}
