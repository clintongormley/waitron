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

function questionTime(
  at: string,
  minutes: number,
  day: string | null,
  zone: string,
  mixed = false,
) {
  const stored = storedAttendanceTime(at, minutes);
  const date = stored.slice(0, 10);
  const time = stored.slice(11, 16);
  const clock = mixed || repeatedLocalTime(date, time, zone) ? stored.slice(11) : time;
  return html`<time class="short-time" datetime=${at}>${clock}</time>${
      date === day ? nothing : `, ${attendanceDateInWords(date)}`
    }`;
}

export function withHourArticle(key: StringKey, at: string, offset: number) {
  const one = storedAttendanceTime(at, offset).slice(11, 13) === "01";
  return t(key).replace("{plural}", one ? "" : "s");
}

function workerDeclineLabel(entry: AttendanceEntry): StringKey | undefined {
  const extension = entry.extension;
  if (
    entry.correctionStatus !== "declined" ||
    extension?.direction !== "worker_request" ||
    !extension.respondsToEntryId
  )
    return undefined;
  if (entry.correctsEntryId) return "attendance.asked_to_change";
  if (extension.missingEntryKind === "in" || extension.missingEntryKind === "out")
    return `attendance.asked_to_add_${extension.missingEntryKind}`;
  return undefined;
}

export function questionAttendanceHistory(
  { history, businessDay, timeZone }: AttendancePrompt,
  items: readonly CorrectionItem[],
) {
  const mixed = new Set(history.map((entry) => entry.offsetMinutes)).size > 1;
  const show = (entry: AttendanceEntry) =>
    questionTime(entry.eventAt, entry.offsetMinutes, businessDay, timeZone, mixed);
  const declineLabels = new Map<string, StringKey>();
  const declinedRequests = new Set<string>();
  for (const entry of history) {
    const label = workerDeclineLabel(entry);
    if (label) {
      declineLabels.set(entry.entryId, label);
      declinedRequests.add(entry.extension!.respondsToEntryId!);
    }
  }
  const earlierDeclines = new Set(
    items.flatMap((item) =>
      item.responseEntryIds.filter((id) => declineLabels.has(id)).slice(0, -1),
    ),
  );
  return history.map((entry, index) => {
    if (declinedRequests.has(entry.entryId)) return nothing;
    const declineLabel = declineLabels.get(entry.entryId);
    if (declineLabel) {
      const reason =
        entry.correctionReason && !earlierDeclines.has(entry.entryId)
          ? `: ${entry.correctionReason}`
          : "";
      return html`<li>
        ${withHourArticle(declineLabel, entry.eventAt, entry.offsetMinutes)}
        ${show(entry)}${reason}<span class="muted"> · ${t("attendance.declined_by_manager")}</span>
      </li>`;
    }
    const author = entry.extension?.authorKind ?? "worker";
    const next = history[index + 1];
    if (entry.entryKind === "break_start" && next?.entryKind === "break_end") {
      const recorder = author === "worker" ? (next.extension?.authorKind ?? author) : author;
      return html`<li>
        ${t("attendance.break")} ${show(entry)} ${t("attendance.break_to")}
        ${show(next)}${recorder === "worker" ? "" : ` · ${t(`attendance.author_${recorder}`)}`}
      </li>`;
    }
    if (entry.entryKind === "break_end" && history[index - 1]?.entryKind === "break_start")
      return nothing;
    if (
      entry.entryKind === "correction" &&
      entry.correctsEntryId &&
      entry.extension?.direction === "worker_request" &&
      entry.correctionStatus === "requested"
    ) {
      return html`<li>
        ${withHourArticle("attendance.you_changed", entry.eventAt, entry.offsetMinutes)}
        ${show(entry)}: ${entry.correctionReason}
      </li>`;
    }
    const status = entry.correctionStatus;
    if (entry.entryKind === "correction" && status && status !== "requested")
      return html`<li>${attendanceStatus(status)} ${show(entry)}</li>`;
    if (entry.entryKind === "confirmation" && author === "worker")
      return html`<li>${t("attendance.you_answered")} ${show(entry)}</li>`;
    if (entry.entryKind === "in" || entry.entryKind === "out") {
      const note =
        author === "manager" ? "attendance.added_by_manager" : "attendance.added_automatically";
      return html`<li>
        ${t(`attendance.clocked_${entry.entryKind}`)}
        ${show(entry)}${
          author === "worker" ? nothing : html`<span class="muted"> · ${t(note)}</span>`
        }
      </li>`;
    }
    const reason = entry.correctionReason ? `: ${entry.correctionReason}` : "";
    return html`<li>
      ${t(historyLabel(entry))}: ${show(entry)} · ${t(`attendance.author_${author}`)}${reason}
    </li>`;
  });
}

export function questionAttendanceProposal(item: CorrectionItem, timeZone: string) {
  const mixed = new Set(item.history.map((entry) => entry.offsetMinutes)).size > 1;
  const [first, second] = item.changes;
  if (
    first &&
    "missingKind" in first.target &&
    (first.target.missingKind === "in" || first.target.missingKind === "out")
  ) {
    const day = storedAttendanceTime(first.at, first.offsetMinutes).slice(0, 10);
    const label = `attendance.manager_proposed_${first.target.missingKind}` as const;
    const reason = item.reason ? `: ${item.reason}` : "";
    return [
      html`<li>
        ${attendanceDateInWords(day)}. ${withHourArticle(label, first.at, first.offsetMinutes)}
        ${questionTime(first.at, first.offsetMinutes, day, timeZone, mixed)}${
          second
            ? html` ${withHourArticle("attendance.proposed_and_out", second.at, second.offsetMinutes)}
              ${questionTime(second.at, second.offsetMinutes, day, timeZone, mixed)}`
            : nothing
        }${reason}
      </li>`,
    ];
  }
  return item.changes.map(({ target, at, offsetMinutes }, index) => {
    const original =
      "entryId" in target && item.history.find((entry) => entry.entryId === target.entryId);
    const day = storedAttendanceTime(at, offsetMinutes).slice(0, 10);
    const proposed = questionTime(at, offsetMinutes, day, timeZone, mixed);
    const reason = index === item.changes.length - 1 && item.reason ? `: ${item.reason}` : "";
    return html`<li>
      ${attendanceDateInWords(day)}.
      ${
        original
          ? html`${withHourArticle("attendance.manager_proposed", at, offsetMinutes)} ${proposed}
            ${withHourArticle("attendance.instead_of", original.eventAt, original.offsetMinutes)}
            ${questionTime(original.eventAt, original.offsetMinutes, day, timeZone, mixed)}`
          : html`${t("attendance.proposed")}: ${proposed} · ${t("attendance.author_manager")}`
      }${reason}
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
