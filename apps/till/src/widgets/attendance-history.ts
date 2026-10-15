import { html, nothing } from "lit";
import type { AttendancePrompt, CorrectionItem } from "../api/client.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

export function storedAttendanceTime(at: string, offset: number): string {
  const wall = new Date(Date.parse(at) + offset * 60_000).toISOString();
  const absolute = Math.abs(offset);
  const zone = `${offset < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${wall.slice(0, 10)} ${wall.slice(11, 16)} ${zone}`;
}

export function attendanceHistory(entry: AttendancePrompt["history"][number]) {
  const author = entry.extension?.authorKind ?? "worker";
  const label =
    entry.entryKind === "confirmation" || entry.extension?.respondsToEntryId
      ? t("attendance.response")
      : entry.entryKind === "correction"
        ? t("attendance.proposed")
        : t("attendance.original");
  return html`<li>
    <span>${label}: </span
    ><time datetime=${entry.eventAt}
      >${storedAttendanceTime(entry.eventAt, entry.offsetMinutes)}</time
    >
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
