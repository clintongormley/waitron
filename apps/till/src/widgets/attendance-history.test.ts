import { afterEach, expect, it } from "vitest";
import { render } from "lit";
import { attendanceEntry, attendancePrompt } from "../../test/attendance-fixtures.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { questionAttendanceHistory } from "./attendance-history.js";

const locale = currentLocale();
afterEach(() => setLocale(locale));

const extension = {
  authorKind: "worker" as const,
  direction: null,
  missingEntryKind: null,
  respondsToEntryId: null,
  payPeriodClosureId: null,
};

function lines(...history: ReturnType<typeof attendanceEntry>[]) {
  setLocale("en-GB");
  const host = document.createElement("ul");
  render(questionAttendanceHistory(attendancePrompt({ history }), []), host);
  return [...host.querySelectorAll("li")].map((li) => li.textContent!.replace(/\s+/g, " ").trim());
}

it("shows the worker's own pending change with its reason", () => {
  expect(
    lines(
      attendanceEntry({
        entryId: "asked",
        entryKind: "correction",
        eventAt: "2026-10-13T10:00:00.000Z",
        correctsEntryId: "original",
        correctionStatus: "requested",
        correctionReason: "I forgot to clock in.",
        extension: { ...extension, direction: "worker_request" },
      }),
    ),
  ).toEqual(["You changed it to 12:00: I forgot to clock in."]);
});

it("shows a settled correction by its status", () => {
  expect(
    lines(
      attendanceEntry({
        entryId: "approved",
        entryKind: "correction",
        eventAt: "2026-10-13T10:00:00.000Z",
        correctionStatus: "approved",
        extension: { ...extension, authorKind: "manager", direction: "manager_proposal" },
      }),
    ),
  ).toEqual(["Approved 12:00"]);
});

it("shows a lone break start with its author and reason", () => {
  expect(
    lines(
      attendanceEntry({
        entryId: "break",
        entryKind: "break_start",
        eventAt: "2026-10-13T10:00:00.000Z",
        correctionReason: "Lunch",
        extension: { ...extension, authorKind: "manager" },
      }),
    ),
  ).toEqual(["Original time: 12:00 · Manager: Lunch"]);
});

it("keeps a declined request to add a break as a declined correction, not an ask to add", () => {
  expect(
    lines(
      attendanceEntry({
        entryId: "declined",
        entryKind: "correction",
        eventAt: "2026-10-13T10:00:00.000Z",
        correctionStatus: "declined",
        extension: {
          ...extension,
          authorKind: "manager",
          direction: "worker_request",
          missingEntryKind: "break_start",
          respondsToEntryId: "request",
        },
      }),
    ),
  ).toEqual(["Declined 12:00"]);
});

it("shows the short time when the day's time zone cannot be read", () => {
  setLocale("en-GB");
  const host = document.createElement("ul");
  render(
    questionAttendanceHistory(
      attendancePrompt({
        timeZone: "Not/A_Zone",
        history: [attendanceEntry({ eventAt: "2026-10-13T10:00:00.000Z", extension })],
      }),
      [],
    ),
    host,
  );
  expect(host.querySelector("time")!.textContent).toBe("12:00");
});
