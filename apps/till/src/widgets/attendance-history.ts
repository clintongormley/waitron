import { html, nothing } from "lit";
import { localTimeOccurrences } from "@waitron/venue-service/hours-occurrences";
import type { AttendancePrompt, CorrectionItem } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

export function storedAttendanceTime(at: string, offset: number): string {
  const wall = new Date(Date.parse(at) + offset * 60_000).toISOString();
  const absolute = Math.abs(offset);
  const zone = `${offset < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${wall.slice(0, 10)} ${wall.slice(11, 16)} ${zone}`;
}

type AttendanceEntry = AttendancePrompt["history"][number];

function historyLabel(entry: AttendanceEntry) {
  return entry.entryKind === "confirmation" || entry.extension?.respondsToEntryId
    ? "attendance.response"
    : entry.entryKind === "correction"
      ? "attendance.proposed"
      : "attendance.original";
}

export function attendanceHistory(entry: AttendanceEntry) {
  const author = entry.extension?.authorKind ?? "worker";
  return html`<li>
    <span>${t(historyLabel(entry))}: </span
    ><time datetime=${entry.eventAt}
      >${storedAttendanceTime(entry.eventAt, entry.offsetMinutes)}</time
    >
    <span> · ${t(`attendance.author_${author}`)}</span>
    ${entry.correctionReason ? html`<p>${entry.correctionReason}</p>` : nothing}
  </li>`;
}

export function attendanceDateInWords(day: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(day));
}

function repeatedLocalTime(date: string, time: string, timeZone: string): boolean {
  try {
    return localTimeOccurrences(date, time, timeZone).length > 1;
  } catch {
    return false;
  }
}

function questionTime(at: string, minutes: number, day: string | null, zone: string) {
  const stored = storedAttendanceTime(at, minutes);
  const date = stored.slice(0, 10);
  const time = stored.slice(11, 16);
  const clock = repeatedLocalTime(date, time, zone) ? stored.slice(11) : time;
  return html`<time class="short-time" datetime=${at}>${clock}</time>${
      date === day ? nothing : `, ${attendanceDateInWords(date)}`
    }`;
}

export function questionAttendanceHistory({ history, businessDay, timeZone }: AttendancePrompt) {
  const show = (entry: AttendanceEntry) =>
    questionTime(entry.eventAt, entry.offsetMinutes, businessDay, timeZone);
  return history.map((entry, index) => {
    const author = entry.extension?.authorKind ?? "worker";
    const next = history[index + 1];
    if (entry.entryKind === "break_start" && next?.entryKind === "break_end") {
      return html`<li>
        ${t("attendance.break")} ${show(entry)} ${t("attendance.break_to")} ${show(next)}
      </li>`;
    }
    if (entry.entryKind === "break_end" && history[index - 1]?.entryKind === "break_start")
      return nothing;
    if (
      entry.entryKind === "correction" &&
      entry.extension?.direction === "worker_request" &&
      entry.correctionStatus === "requested"
    ) {
      return html`<li>
        ${t("attendance.you_changed")} ${show(entry)}: ${entry.correctionReason}
      </li>`;
    }
    const label =
      entry.entryKind === "in"
        ? "attendance.clocked_in"
        : entry.entryKind === "out"
          ? "attendance.clocked_out"
          : entry.entryKind === "break_start"
            ? "attendance.break_started"
            : entry.entryKind === "break_end"
              ? "attendance.break_ended"
              : entry.entryKind === "confirmation" && author === "worker"
                ? "attendance.you_answered"
                : historyLabel(entry);
    const note =
      author === "manager"
        ? "attendance.added_by_manager"
        : author === "automatic"
          ? "attendance.added_automatically"
          : null;
    return html`<li>
      ${t(label)}
      ${show(entry)}${note ? html`<span class="muted"> · ${t(note)}</span>` : nothing}${
        entry.correctionReason ? html`: ${entry.correctionReason}` : nothing
      }
    </li>`;
  });
}

export function questionAttendanceProposal(item: CorrectionItem, timeZone: string) {
  return item.changes.map(({ target, at, offsetMinutes }, index) => {
    const original =
      "entryId" in target && item.history.find((entry) => entry.entryId === target.entryId);
    const day = storedAttendanceTime(at, offsetMinutes).slice(0, 10);
    return html`<li>
      ${attendanceDateInWords(day)}. ${t("attendance.manager_proposed")}
      ${questionTime(at, offsetMinutes, day, timeZone)}
      ${
        original
          ? html` ${t("attendance.instead_of")}
            ${questionTime(original.eventAt, original.offsetMinutes, day, timeZone)}`
          : nothing
      }${index === item.changes.length - 1 && item.reason ? html`: ${item.reason}` : nothing}
    </li>`;
  });
}

export function attendanceStatus(status: CorrectionItem["status"]): string {
  const keys: Record<CorrectionItem["status"], StringKey> = {
    "waiting-manager": "attendance.waiting_manager",
    "waiting-worker": "attendance.waiting_worker",
    approved: "attendance.approved",
    declined: "attendance.declined",
    disputed: "attendance.disputed",
    overtaken: "attendance.overtaken",
  };
  return t(keys[status]);
}
