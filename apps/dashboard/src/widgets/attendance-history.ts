import { html, nothing } from "lit";
import type { AttendanceInbox, CorrectionItem } from "@waitron/dashboard-modules";
import { currentLocale, t } from "../i18n/t.js";
import { dateTimeFormat } from "@waitron/dashboard-kit";
import { hoursTime } from "../hours-format.js";
import type { StringKey } from "../i18n/strings.js";

export function storedAttendanceTime(at: string, offset: number): string {
  const wall = new Date(Date.parse(at) + offset * 60_000).toISOString();
  const absolute = Math.abs(offset);
  const zone = `${offset < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${wall.slice(0, 10)} ${wall.slice(11, 16)} ${zone}`;
}

export function attendanceHistory(
  entry: AttendancePrompt["history"][number],
  time = storedAttendanceTime(entry.eventAt, entry.offsetMinutes),
) {
  const author = entry.extension?.authorKind ?? "worker";
  const label =
    entry.entryKind === "confirmation" || entry.extension?.respondsToEntryId
      ? t("attendance.response")
      : entry.entryKind === "correction"
        ? t("attendance.proposed")
        : t("attendance.original");
  return html`<li>
    <span>${label}: </span><time datetime=${entry.eventAt}>${time}</time>
    <span> · ${t(`attendance.author_${author}`)}</span>
    ${entry.correctionReason ? html`<p>${entry.correctionReason}</p>` : nothing}
  </li>`;
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

export function managerAttendanceHistory(
  entry: AttendancePrompt["history"][number],
  person: (id: string) => string,
  timeZone?: string,
  periodStart?: string,
) {
  const author = entry.extension?.authorKind ?? "worker";
  const label =
    entry.extension?.respondsToEntryId || entry.entryKind === "confirmation"
      ? t("attendance.response")
      : entry.entryKind === "correction"
        ? t("attendance.proposed")
        : t("attendance.original");
  const kind = entry.extension?.missingEntryKind ?? entry.entryKind;
  const time = timeZone
    ? hoursTime(entry.eventAt, entry.offsetMinutes, timeZone, undefined, periodStart)
    : storedAttendanceTime(entry.eventAt, entry.offsetMinutes);
  const recordedAt = timeZone
    ? dateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short", timeZone }).format(
        new Date(entry.recordedAt),
      )
    : entry.recordedAt;
  return html`<li>
    <span data-entry-kind
      >${kind === "in" || kind === "out" || kind === "break_start" || kind === "break_end" ? t(`clock.${kind}`) : nothing}</span
    >
    <span> · ${label}: </span><time datetime=${entry.eventAt}>${time}</time>
    <p>
      ${author === "automatic" ? t("attendance.author_automatic") : person(entry.recordedByPersonId ?? entry.personId)}
      · ${t("attendance.recorded")}: <time datetime=${entry.recordedAt}>${recordedAt}</time>
    </p>
    ${entry.correctionReason ? html`<p>${entry.correctionReason}</p>` : nothing}
    ${entry.extension?.selfApproved ? html`<p>${t("attendance.self_approved")}</p>` : nothing}
  </li>`;
}

type AttendancePrompt = AttendanceInbox["prompts"][number];
