import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
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
import {
  cleanupWidgets,
  expectNoA11yViolations,
  pageAt,
  resetPage,
} from "./widgets/test-helpers.js";

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
    requested.history[0]!,
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
      { personId: "colleague", displayName: "Ana Rivero" },
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
    getAttendanceManagerLookups,
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
async function openMore(el: TillApp) {
  await vi.waitFor(() => expect(menuEntry(el)).not.toBeNull());
  const menu = menuEntry(el)!.closest("wt-row-actions")!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
}

async function open(el: TillApp, label?: string) {
  await openMore(el);
  if (label) await vi.waitFor(() => expect(menuEntry(el)?.textContent?.trim()).toBe(label));
  await userEvent.click(menuEntry(el)!);
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
  await open(f.el, "To approve · 1");
  const root = screen(f.el)!.shadowRoot!;
  expect(root.textContent).toContain("Javier Torres");
  expect(root.textContent).toContain("Marta Ruiz");
  const worked = root.querySelector("[data-worked]")!;
  expect(worked.querySelector<HTMLElement>('[aria-hidden="true"]')?.innerText).toBe("7 h 00");
  expect(worked.textContent).toContain("7 hours");
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
  await open(f.el, "To approve · 1");
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

it("shows only the approval screen’s bar at phone width and restores More on return", async () => {
  const size = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(390, 844);
  try {
    const f = await manager({ items: [requested, disputed], finishedDays: [] });
    const more = () => page.getByRole("button", { name: "More", exact: true });
    await expect.element(more()).toBeVisible();
    await open(f.el);
    const shell = f.el.shadowRoot!.querySelector("till-shell")!.shadowRoot!;
    await vi.waitFor(() => expect(shell.querySelector("header.head")).toBeNull());
    const back = screen(f.el)!.shadowRoot!.querySelector("wt-top-bar")!;
    expect(back.backLabel).toBe("Counter");
    await expectNoA11yViolations(screen(f.el)!);
    await userEvent.click(back.shadowRoot!.querySelector("wt-button")!);
    await expect.element(more()).toBeVisible();
  } finally {
    await page.viewport(size.width, size.height);
  }
});

it("identifies the automatic time as the old time on a request", async () => {
  const f = await manager({
    items: [
      {
        ...requested,
        changes: [
          { target: { entryId: "original-out" }, at: "2026-10-13T21:15:00Z", offsetMinutes: 120 },
        ],
        history: [attendanceEntry({ entryId: "original-out", eventAt: "2026-10-13T21:48:00Z" })],
      },
    ],
    finishedDays: [],
  });
  await open(f.el);
  const card = screen(f.el)!.shadowRoot!.querySelector("article")!;
  const change = card.querySelector("p")!;
  const note = change.querySelector("span")!;
  expect(note.textContent).toContain("(23:48 added by Waitron)");
  expect(getComputedStyle(note).color).toBe(getComputedStyle(change).color);
  expect(card.textContent).toContain(`“${requested.reason}”`);
});

it("labels each side of a dispute with the person who gave that time", async () => {
  const f = await manager({
    items: [
      { ...disputed, requestedByPersonId: "p1" },
      { ...disputed, id: "colleague-dispute", requestedByPersonId: "colleague" },
    ],
    finishedDays: [],
  });
  await open(f.el);
  const [ownCard, colleagueCard] = screen(f.el)!.shadowRoot!.querySelectorAll("article");
  expect([...ownCard!.querySelectorAll("dt")].map((label) => label.textContent?.trim())).toEqual([
    "You changed",
    "Javier says",
  ]);
  expect(colleagueCard!.querySelector("dt")?.textContent?.trim()).toBe("Ana changed");
  const change = ownCard!.querySelector<HTMLParagraphElement>("dd p")!;
  expect(change.innerText).toBe("clock-out 17:00 → 18:00");
  const times = change.querySelector("span")!;
  expect(getComputedStyle(times).fontWeight).toBe(getComputedStyle(change).fontWeight);
  expect(ownCard!.textContent).toContain("“I closed the bar.”");
  expect(ownCard!.textContent).toContain("Both versions stay on the record.");
});

it("keeps the finished day’s times together and keeps both notes visible at phone width", async () => {
  const size = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(320, 844);
  try {
    const f = await manager({
      items: [],
      finishedDays: [
        {
          ...other,
          times: [
            times[0],
            { ...times[1], at: "2026-10-13T12:00:00Z", automatic: false },
            { ...times[0], at: "2026-10-13T16:00:00Z" },
            { ...times[1], at: "2026-10-13T21:45:00Z" },
          ],
          workedMinutes: 570,
          breakMinutes: 15,
        },
      ],
    });
    await open(f.el);
    const root = screen(f.el)!.shadowRoot!;
    const row = root.querySelector(".day-facts")!;
    expect(row.querySelector("time")?.textContent).toBe("Tue 13");
    for (const times of ["10:00 – 14:00", "18:00 – 23:45"]) {
      const range = page.getByText(times, { exact: true });
      await expect.element(range).toBeVisible();
      expect(new Set([...range.element().getClientRects()].map((rect) => rect.top)).size).toBe(1);
    }
    const list = row.closest("ul")!.getBoundingClientRect();
    expect(list.left).toBe(0);
    expect(list.right).toBe(window.innerWidth);
    expect(row.closest("li")!.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    expect(row.querySelector("small")?.textContent).toMatch(
      /Break 15 min\s*·\s*Clocked out automatically/,
    );
    const button = root.querySelector("[data-approve-all]")!.shadowRoot!.querySelector("button")!;
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const reference = document.createElement("span");
    reference.style.color = "var(--wt-color-primary-text)";
    row.append(reference);
    expect(getComputedStyle(button).color).toBe(getComputedStyle(reference).color);
  } finally {
    await page.viewport(size.width, size.height);
  }
});

it("shows disputes that require a dashboard edit without counting them as till actions", async () => {
  const unsolved = { ...disputed, workerVersion: undefined };
  const f = await manager({ items: [unsolved], finishedDays: [] });
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  expect(root.textContent).toContain("I closed the bar.");
  expect(root.textContent).toContain("Open this day in the dashboard to send an edit.");
  expect(root.querySelector("[data-approve-request]")).toBeNull();
  const back = root.querySelector("wt-top-bar")!;
  await userEvent.click(back.shadowRoot!.querySelector("wt-button")!);
  await openMore(f.el);
  expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve");
});

it("reads the count when the manager opens More and refreshes it on reopening", async () => {
  const f = await manager({ items: [], finishedDays: [{ ...other, times: [...times] }] });
  expect(f.getAttendanceManagerQueue).not.toHaveBeenCalled();
  await openMore(f.el);
  await vi.waitFor(() => expect(menuEntry(f.el)?.textContent).toContain("To approve · 1"));
  await userEvent.keyboard("{Escape}");
  f.getAttendanceManagerQueue.mockResolvedValue({ items: [], finishedDays: [] });
  await openMore(f.el);
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
  await open(f.el, "To approve · 1");
  const back = screen(f.el)!.shadowRoot!.querySelector("wt-top-bar")!;
  await userEvent.click(back.shadowRoot!.querySelector("wt-button")!);
  await vi.waitFor(() => expect(screen(f.el)?.active).toBe(false));
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

const lockScreen = (el: TillApp) => el.shadowRoot!.querySelector("till-lock-screen");
const alertText = (el: TillApp) =>
  screen(el)?.shadowRoot?.querySelector('[role="alert"]')?.textContent?.trim();
const buttonLabelled = (el: TillApp, label: string) =>
  [...screen(el)!.shadowRoot!.querySelectorAll("wt-button")].find(
    (button) => button.textContent?.trim() === label,
  )!;

it.each([
  { refusal: { code: "management.request_invalid" }, message: "Check the form and try again" },
  { refusal: new Error("Server down"), message: "Could not read the hours to approve. Try again." },
])(
  "shows a refused queue read ($message) above phone width and reads it again on Retry",
  async ({ refusal, message }) => {
    await pageAt(1024, 768);
    try {
      const f = await manager({ items: [], finishedDays: [{ ...other, times: [...times] }] });
      f.getAttendanceManagerQueue.mockRejectedValue(refusal);
      await vi.waitFor(() => expect(menuEntry(f.el)).not.toBeNull());
      await shellAction(f.el, ".hours-approval");
      await vi.waitFor(() => expect(alertText(f.el)).toContain(message));
      expect(screen(f.el)!.shadowRoot!.querySelector("[data-finished-days]")).toBeNull();
      expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve");
      f.getAttendanceManagerQueue.mockResolvedValue({
        items: [],
        finishedDays: [{ ...other, times: [...times] }],
      });
      await userEvent.click(buttonLabelled(f.el, "Retry"));
      await vi.waitFor(() =>
        expect(screen(f.el)!.shadowRoot!.textContent).toContain("Javier Torres"),
      );
      expect(alertText(f.el)).toBeUndefined();
      expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve · 1");
    } finally {
      await resetPage();
    }
  },
);

it("refuses a queue whose lookups belong to another operator", async () => {
  const f = await manager({ items: [], finishedDays: [{ ...other, times: [...times] }] });
  f.getAttendanceManagerLookups.mockResolvedValue({
    viewer: { personId: "someone-else", canSelfApprove: false },
    people: [{ personId: "worker", displayName: "Javier Torres" }],
  });
  await vi.waitFor(() => expect(menuEntry(f.el)).not.toBeNull());
  await shellAction(f.el, ".hours-approval");
  await vi.waitFor(() =>
    expect(alertText(f.el)).toBe("Could not read the hours to approve. Try again."),
  );
  expect(screen(f.el)!.shadowRoot!.textContent).not.toContain("Javier Torres");
});

it("does not count a correction that waits for the worker", async () => {
  const f = await manager({
    items: [{ ...requested, status: "waiting-worker", readyToApply: true }],
    finishedDays: [],
  });
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  expect(root.querySelector("[data-approve-request]")).toBeNull();
  await userEvent.click(root.querySelector("wt-top-bar")!.shadowRoot!.querySelector("wt-button")!);
  await openMore(f.el);
  expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve");
});

it("reads the queue once when More reopens while the first read is still running", async () => {
  const f = await manager({ items: [], finishedDays: [{ ...other, times: [...times] }] });
  const held = deferred<AttendanceManagerQueue>();
  f.getAttendanceManagerQueue.mockReturnValue(held.promise);
  await openMore(f.el);
  await vi.waitFor(() => expect(f.getAttendanceManagerQueue).toHaveBeenCalledTimes(1));
  await userEvent.keyboard("{Escape}");
  await openMore(f.el);
  await f.el.updateComplete;
  expect(f.getAttendanceManagerQueue).toHaveBeenCalledTimes(1);
  held.resolve({ items: [], finishedDays: [{ ...other, times: [...times] }] });
  await vi.waitFor(() => expect(menuEntry(f.el)?.textContent).toContain("To approve · 1"));
});

it("sends nothing and re-reads the queue when the day no longer holds the request", async () => {
  const f = await manager({ items: [requested], finishedDays: [] });
  f.getAttendanceManagerDay.mockResolvedValue({ ...view, items: [] });
  await open(f.el);
  f.getAttendanceManagerQueue.mockClear().mockResolvedValue({ items: [], finishedDays: [] });
  await userEvent.click(buttonLabelled(f.el, "Approve"));
  await vi.waitFor(() =>
    expect(alertText(f.el)).toBe("These hours changed. Check the latest times before continuing."),
  );
  await vi.waitFor(() => expect(f.getAttendanceManagerQueue).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(screen(f.el)!.shadowRoot!.textContent).toContain(
      "No hours are waiting for your approval.",
    ),
  );
  expect(f.sendAttendanceManagerCommand).not.toHaveBeenCalled();
});

it("refuses a day read that answers for another day", async () => {
  const f = await manager({ items: [requested], finishedDays: [] });
  f.getAttendanceManagerDay.mockResolvedValue({ ...view, date: "2026-10-14" });
  await open(f.el);
  await userEvent.click(buttonLabelled(f.el, "Approve"));
  await vi.waitFor(() => expect(alertText(f.el)).toBe("Could not confirm the change. Try again."));
  expect(f.sendAttendanceManagerCommand).not.toHaveBeenCalled();
});

it("explains a decision the signed-in person may not make", async () => {
  const f = await manager({ items: [requested], finishedDays: [] });
  f.sendAttendanceManagerCommand.mockRejectedValueOnce({ code: "authorization.not_permitted" });
  await open(f.el);
  await userEvent.click(buttonLabelled(f.el, "Decline"));
  await vi.waitFor(() =>
    expect(alertText(f.el)).toBe(
      "You cannot approve hours from this till. Check your sign-in or use the dashboard.",
    ),
  );
  expect(
    [...screen(f.el)!.shadowRoot!.querySelectorAll("wt-button")].map((button) =>
      button.textContent?.trim(),
    ),
  ).not.toContain("Retry response");
});

it("offers Retry response when the answer names another command", async () => {
  const f = await manager({ items: [requested], finishedDays: [] });
  f.sendAttendanceManagerCommand.mockResolvedValueOnce({
    commandId: "someone-elses",
    entryIds: [],
    replayed: false,
  });
  await open(f.el);
  await userEvent.click(buttonLabelled(f.el, "Approve"));
  await vi.waitFor(() => expect(alertText(f.el)).toBe("Could not confirm the change. Try again."));
  expect(buttonLabelled(f.el, "Retry response")).toBeDefined();
});

it("returns to the lock screen when the manager's sign-in has ended", async () => {
  const f = await manager({ items: [requested], finishedDays: [] });
  f.sendAttendanceManagerCommand.mockRejectedValueOnce({ code: "session.required" });
  await open(f.el);
  await userEvent.click(buttonLabelled(f.el, "Approve"));
  await vi.waitFor(() => expect(lockScreen(f.el)).not.toBeNull());
});

it("sends no decision when the manager signs out above phone width while the day is being read", async () => {
  await pageAt(1024, 768);
  try {
    const f = await manager({ items: [requested], finishedDays: [] });
    const held = deferred<AttendanceDayView>();
    f.getAttendanceManagerDay.mockReturnValue(held.promise);
    await open(f.el);
    await userEvent.click(buttonLabelled(f.el, "Approve"));
    await vi.waitFor(() => expect(f.getAttendanceManagerDay).toHaveBeenCalledTimes(1));
    await shellAction(f.el, ".logout");
    await vi.waitFor(() => expect(lockScreen(f.el)).not.toBeNull());
    held.resolve({ ...view, items: [requested] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.sendAttendanceManagerCommand).not.toHaveBeenCalled();
  } finally {
    await resetPage();
  }
});

it("cancels a decision in flight when the manager signs out above phone width and ignores its later answer", async () => {
  await pageAt(1024, 768);
  try {
    const f = await manager({ items: [requested], finishedDays: [] });
    const held = deferred<{ commandId: string; entryIds: string[]; replayed: boolean }>();
    f.sendAttendanceManagerCommand.mockImplementationOnce(() => held.promise);
    await open(f.el);
    await userEvent.click(buttonLabelled(f.el, "Approve"));
    await vi.waitFor(() => expect(f.sendAttendanceManagerCommand).toHaveBeenCalledTimes(1));
    const [command, options] = f.sendAttendanceManagerCommand.mock.calls[0] as unknown as [
      AttendanceCommand,
      { signal: AbortSignal },
    ];
    expect(options.signal.aborted).toBe(false);
    await shellAction(f.el, ".logout");
    await vi.waitFor(() => expect(lockScreen(f.el)).not.toBeNull());
    expect(options.signal.aborted).toBe(true);
    const reads = f.getAttendanceManagerQueue.mock.calls.length;
    held.resolve({ commandId: command.commandId, entryIds: ["answer"], replayed: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.getAttendanceManagerQueue).toHaveBeenCalledTimes(reads);
  } finally {
    await resetPage();
  }
});

it("sends no decision when browser Back leaves the screen while the day is being read", async () => {
  const f = await manager({ items: [requested], finishedDays: [] });
  const held = deferred<AttendanceDayView>();
  f.getAttendanceManagerDay.mockReturnValue(held.promise);
  await open(f.el);
  await userEvent.click(buttonLabelled(f.el, "Approve"));
  await vi.waitFor(() => expect(f.getAttendanceManagerDay).toHaveBeenCalledTimes(1));
  history.back();
  await vi.waitFor(() => expect(screen(f.el)?.active).toBe(false));
  held.resolve({ ...view, items: [requested] });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(f.sendAttendanceManagerCommand).not.toHaveBeenCalled();
});

it("a phone's floor More shows the approval count and opens the queue", async () => {
  await pageAt(390, 844);
  try {
    const f = await manager({ items: [requested], finishedDays: [] });
    Object.assign(f.el, { formFactor: "phone-portrait" });
    await f.el.updateComplete;
    const shell = f.el.shadowRoot!.querySelector("till-shell")!;
    const menu = await vi.waitFor(() => {
      const menu = shell.shadowRoot!.querySelector<
        HTMLElement & { updateComplete: Promise<unknown> }
      >("[data-floor-bar] [data-test=more-menu]");
      expect(menu?.querySelector(".hours-approval")).toBeTruthy();
      return menu!;
    });
    await menu.updateComplete;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    const entry = () => menu.querySelector<HTMLElement>(".hours-approval")!;
    await vi.waitFor(() => expect(entry().shadowRoot?.textContent).toContain("To approve · 1"));
    await userEvent.click(entry());
    await vi.waitFor(() =>
      expect(screen(f.el)?.shadowRoot?.textContent).toContain("Asked to change"),
    );
  } finally {
    await resetPage();
  }
});
