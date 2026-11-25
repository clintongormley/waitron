import { html, nothing } from "lit";
import { timeZoneOffsetMinutes } from "@waitron/shared";
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

type AttendanceEntry = AttendancePrompt["history"][number];

function questionHistoryLabel(entry: AttendanceEntry): StringKey | undefined {
  const author = entry.extension?.authorKind ?? "worker";
  if (author === "worker") {
    switch (entry.entryKind) {
      case "in":
        return "attendance.clocked_in";
      case "out":
        return "attendance.clocked_out";
      case "confirmation":
        return "attendance.you_answered";
    }
  }
  if (author === "automatic" && entry.entryKind === "out") return "attendance.clocked_out";
}

export function questionAttendanceHistory(entry: AttendanceEntry, day: string, timeZone: string) {
  const label = questionHistoryLabel(entry);
  if (!label) return attendanceHistory(entry);
  const stored = storedAttendanceTime(entry.eventAt, entry.offsetMinutes);
  if (stored.slice(0, 10) !== day) return attendanceHistory(entry);
  try {
    if (timeZoneOffsetMinutes(timeZone, new Date(entry.eventAt)) !== entry.offsetMinutes) {
      return attendanceHistory(entry);
    }
  } catch {
    return attendanceHistory(entry);
  }
  return html`<li>
    ${t(label)} <time class="short-time" datetime=${entry.eventAt}>${stored.slice(11, 16)}</time>
    ${
      entry.extension?.authorKind === "automatic"
        ? html`<span class="muted"> · ${t("attendance.added_automatically")}</span>`
        : nothing
    }
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
