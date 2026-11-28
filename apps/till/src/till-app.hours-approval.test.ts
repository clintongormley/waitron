import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  AttendanceCommand,
  AttendanceDayApprovalTarget,
  AttendanceDayView,
  AttendanceManagerQueue,
} from "@waitron/workforce/attendance-contract";
import { attendanceEntry, attendanceItem } from "../test/attendance-fixtures.js";
import { clockApp, clockState, deferred, shellAction, signIn, working } from "../test/clock-app.js";
import type { TillApp } from "./till-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";

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
  options: { permitted?: boolean; action?: boolean; canSelfApprove?: boolean } = {},
) {
  const getAttendanceManagerQueue = vi.fn().mockResolvedValue(queue);
  const getAttendanceManagerLookups = vi.fn().mockResolvedValue({
    viewer: { personId: "p1", canSelfApprove: options.canSelfApprove ?? false },
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
      { ...other, times: [...times], workedMinutes: 420, breakMinutes: 15 },
      { ...own, times: [...times] },
    ],
  });
  await open(f.el);
  await vi.waitFor(() => expect(menuEntry(f.el)?.textContent).toContain("To approve · 1"));
  const root = screen(f.el)!.shadowRoot!;
  expect(root.textContent).toContain("Javier Torres");
  expect(root.textContent).toContain("Marta Ruiz");
  expect(root.querySelector("[data-worked]")?.textContent).toBe("7 hours");
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
  expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve · 1");
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

it("keeps a single banner landmark when the Manager queue is open", async () => {
  const f = await manager({ items: [requested, disputed], finishedDays: [] });
  await open(f.el);
  await expectNoA11yViolations(screen(f.el)!);
});

it("shows disputes that require a dashboard edit without counting them as till actions", async () => {
  const unsolved = { ...disputed, workerVersion: undefined };
  const f = await manager({ items: [unsolved], finishedDays: [] });
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  expect(root.textContent).toContain("I closed the bar.");
  expect(root.textContent).toContain("Open this day in the dashboard to send an edit.");
  expect(root.querySelector("[data-approve-request]")).toBeNull();
  expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve");
});

it("reads the count when the manager opens More and refreshes it on reopening", async () => {
  const f = await manager({ items: [], finishedDays: [{ ...other, times: [...times] }] });
  expect(f.getAttendanceManagerQueue).not.toHaveBeenCalled();
  const showMore = async () => {
    await vi.waitFor(() => expect(menuEntry(f.el)).not.toBeNull());
    const menu = menuEntry(f.el)!.closest("wt-row-actions")!;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  };
  await showMore();
  await vi.waitFor(() => expect(menuEntry(f.el)?.textContent).toContain("To approve · 1"));
  await userEvent.keyboard("{Escape}");
  f.getAttendanceManagerQueue.mockResolvedValue({ items: [], finishedDays: [] });
  await showMore();
  await vi.waitFor(() => expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve"));
});

it("an administrator may approve their own request but has no button to decline it", async () => {
  const f = await manager(
    { items: [{ ...requested, personId: own.personId }], finishedDays: [] },
    { canSelfApprove: true },
  );
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  expect(root.querySelector("[data-approve-request]")).not.toBeNull();
  expect(
    [...root.querySelectorAll("wt-button")].map((button) => button.textContent?.trim()),
  ).not.toContain("Decline");
});

it("clears the previous count when a new sign-in opens More while its count is still loading", async () => {
  const f = await manager({ items: [], finishedDays: [{ ...other, times: [...times] }] });
  await open(f.el);
  expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve · 1");
  await shellAction(f.el, ".logout");
  await vi.waitFor(() => expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  const held = deferred<AttendanceManagerQueue>();
  f.getAttendanceManagerQueue.mockClear().mockReturnValue(held.promise);
  await signIn(f.el);
  await working(f.el);
  const menu = menuEntry(f.el)!.closest("wt-row-actions")!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await vi.waitFor(() => expect(f.getAttendanceManagerQueue).toHaveBeenCalledTimes(1));
  expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve");
  held.resolve({ items: [], finishedDays: [] });
});

it("reads the current queue when browser Back reopens the approval screen", async () => {
  const f = await manager({ items: [requested], finishedDays: [] });
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  expect(root.textContent).toContain("Asked to change");
  const back = root.querySelector("wt-top-bar")!.shadowRoot!.querySelector("wt-button")!;
  await userEvent.click(back);
  await vi.waitFor(() => expect(screen(f.el)?.active).toBe(false));
  f.getAttendanceManagerQueue.mockResolvedValue({ items: [], finishedDays: [] });
  history.back();
  await vi.waitFor(() => expect(screen(f.el)?.active).toBe(true));
  await vi.waitFor(() =>
    expect(root.textContent).toContain("No hours are waiting for your approval."),
  );
});
