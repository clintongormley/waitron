import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  AttendanceCommand,
  AttendanceDayApprovalTarget,
  AttendanceDayView,
  AttendanceManagerQueue,
} from "@waitron/workforce/attendance-contract";
import { attendanceEntry, attendanceItem } from "../test/attendance-fixtures.js";
import { clockApp, clockState, shellAction, signIn, working } from "../test/clock-app.js";
import type { TillApp } from "./till-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  setLocale(locale);
});

const other = { personId: "worker", date: "2026-10-13", digest: "A".repeat(64) };
const own = { personId: "p1", date: "2026-10-12", digest: "B".repeat(64) };
const requested = attendanceItem({
  id: "request",
  date: other.date,
  direction: "worker_request",
  status: "waiting-manager",
  changes: [
    { target: { entryId: "original-out" }, at: "2026-10-13T23:15:00.000Z", offsetMinutes: 120 },
  ],
});
const disputed = attendanceItem({
  id: "disputed",
  date: other.date,
  status: "disputed",
  workerVersion: { changes: requested.changes },
  responseEntryIds: ["disagreed"],
  history: [
    attendanceEntry({
      entryId: "disagreed",
      entryKind: "correction",
      correctionStatus: "disputed",
      correctionReason: "I closed the bar.",
    }),
  ],
});
const times = [
  { kind: "in", at: "2026-10-13T08:00:00.000Z", offsetMinutes: 120, automatic: false },
  { kind: "out", at: "2026-10-13T15:00:00.000Z", offsetMinutes: 120, automatic: true },
] as const;
const view: AttendanceDayView = {
  personId: other.personId,
  date: other.date,
  revision: "day-revision",
  timeZone: "Europe/Madrid",
  items: [requested],
  record: {
    sessions: [],
    entries: [],
    closures: [],
    closedPeriodImpacts: [],
  },
};

async function manager(
  queue: AttendanceManagerQueue,
  options: { permitted?: boolean; action?: boolean } = {},
) {
  const getAttendanceManagerQueue = vi.fn().mockResolvedValue(queue);
  const getAttendanceManagerLookups = vi.fn().mockResolvedValue({
    viewer: { personId: "p1", canSelfApprove: false },
    people: [
      { personId: "worker", displayName: "Javier Torres" },
      { personId: "p1", displayName: "Marta Ruiz" },
    ],
  });
  const getAttendanceManagerDay = vi.fn().mockResolvedValue({ ...view, items: queue.items });
  const approveAttendanceDays = vi
    .fn<
      (days: AttendanceDayApprovalTarget[], options?: { signal?: AbortSignal }) => Promise<void>
    >()
    .mockResolvedValue(undefined);
  const sendAttendanceManagerCommand = vi.fn(async (command: AttendanceCommand) => ({
    commandId: command.commandId,
    entryIds: ["answer"],
    replayed: false,
  }));
  const f = await clockApp({
    action: options.action,
    state: clockState("working", "in"),
    api: {
      login: async (personId) => ({
        personId,
        permissions: options.permitted === false ? [] : ["workforce.correct"],
        locale: null,
      }),
      getAttendanceManagerQueue,
      getAttendanceManagerLookups,
      getAttendanceManagerDay,
      approveAttendanceDays,
      sendAttendanceManagerCommand,
    },
  });
  await signIn(f.el);
  await working(f.el);
  return {
    ...f,
    getAttendanceManagerQueue,
    getAttendanceManagerDay,
    approveAttendanceDays,
    sendAttendanceManagerCommand,
  };
}

const menuEntry = (el: TillApp) =>
  el
    .shadowRoot!.querySelector("till-shell")!
    .shadowRoot!.querySelector<HTMLElement>(".hours-approval");
const screen = (el: TillApp) => el.shadowRoot!.querySelector("till-hours-approval-screen");
async function open(el: TillApp) {
  await vi.waitFor(() => expect(menuEntry(el)).not.toBeNull());
  await shellAction(el, ".hours-approval");
  await vi.waitFor(() =>
    expect(screen(el)?.shadowRoot?.querySelector("[data-finished-days]")).not.toBeNull(),
  );
}

it.each([{ permitted: false }, { action: false }])(
  "keeps the approval queue out of More when access is missing (%j)",
  async (options) => {
    const f = await manager({ items: [], finishedDays: [] }, options);
    expect(menuEntry(f.el)).toBeNull();
    f.el
      .shadowRoot!.querySelector("till-shell")!
      .dispatchEvent(new CustomEvent("hours-approval", { bubbles: true, composed: true }));
    await f.el.updateComplete;
    expect(screen(f.el)).toBeNull();
    expect(f.getAttendanceManagerQueue).not.toHaveBeenCalled();
  },
);

it("counts actionable days and approves only the displayed eligible day", async () => {
  const f = await manager({
    items: [],
    finishedDays: [
      { ...other, times: [...times] },
      { ...own, times: [...times] },
    ],
  });
  await vi.waitFor(() => expect(menuEntry(f.el)?.textContent).toContain("To approve · 1"));
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  expect(root.textContent).toContain("Javier Torres");
  expect(root.textContent).toContain("Marta Ruiz");
  f.getAttendanceManagerQueue.mockResolvedValue({
    items: [],
    finishedDays: [{ ...own, times: [...times] }],
  });
  await userEvent.click(root.querySelector<HTMLElement>("[data-approve-all]")!);
  await vi.waitFor(() =>
    expect(f.approveAttendanceDays).toHaveBeenCalledExactlyOnceWith([other], expect.anything()),
  );
  await vi.waitFor(() => expect(root.textContent).not.toContain("Javier Torres"));
  expect(root.querySelector("[data-approve-all]")).toBeNull();
});

it.each([
  { item: requested, label: "Approve", action: "approve" },
  { item: requested, label: "Decline", action: "decline" },
  { item: disputed, label: "Take Javier’s time", action: "approve" },
])("uses the work date and latest revision for $label", async ({ item, label, action }) => {
  const f = await manager({ items: [item], finishedDays: [] });
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  if (item.status === "disputed") expect(root.textContent).toContain("I closed the bar.");
  await userEvent.click(
    [...root.querySelectorAll("wt-button")].find((button) => button.textContent?.trim() === label)!,
  );
  await vi.waitFor(() =>
    expect(f.sendAttendanceManagerCommand).toHaveBeenCalledWith(
      {
        action,
        itemId: item.id,
        expectedRevision: "day-revision",
        commandId: expect.any(String),
      },
      expect.anything(),
    ),
  );
  expect(f.getAttendanceManagerDay).toHaveBeenCalledWith(
    other.personId,
    other.date,
    expect.anything(),
  );
});

it("retries an unanswered decision with the original command and revision", async () => {
  const f = await manager({ items: [requested], finishedDays: [] });
  f.sendAttendanceManagerCommand.mockRejectedValueOnce(new TypeError("Connection lost"));
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  await userEvent.click(root.querySelector<HTMLElement>("[data-approve-request]")!);
  const retry = () =>
    [...root.querySelectorAll("wt-button")].find(
      (button) => button.textContent?.trim() === "Retry response",
    );
  await vi.waitFor(() => expect(retry()?.disabled).toBe(false));
  expect(
    root.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-approve-request]")?.disabled,
  ).toBe(true);
  await userEvent.click(retry()!);
  await vi.waitFor(() => expect(retry()).toBeUndefined());
  expect(f.sendAttendanceManagerCommand).toHaveBeenCalledTimes(2);
  expect(f.sendAttendanceManagerCommand.mock.calls[1]![0]).toEqual(
    f.sendAttendanceManagerCommand.mock.calls[0]![0],
  );
  expect(f.getAttendanceManagerDay).toHaveBeenCalledTimes(1);
});
