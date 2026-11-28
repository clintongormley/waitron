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
const clockEntries = times.map((time, index) => {
  const entry = attendanceEntry({
    entryId: index === 0 ? "original-in" : "original-out",
    entryKind: time.kind,
    eventAt: time.at,
    offsetMinutes: time.offsetMinutes,
    sequenceNo: index + 1,
    extension: index === 0 ? null : attendanceEntry().extension,
  });
  return {
    entry,
    author: { kind: "worker" as const, personId: other.personId },
    effective: true,
    confirmed: false,
    confirmedByWorker: false,
    selfApproved: false,
    corrected: false,
    disputed: false,
    closedPeriodIds: [],
  };
});
const view: AttendanceDayView = {
  personId: other.personId,
  date: other.date,
  revision: "day-revision",
  timeZone: "Europe/Madrid",
  items: [requested],
  record: {
    sessions: [],
    entries: clockEntries,
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

it.each([
  { label: "worker request", item: requested },
  { label: "disputed change", item: disputed },
  { label: "finished day", item: undefined },
])("sends a whole-day edit for a $label from the manager’s till", async ({ item }) => {
  const f = await manager({
    items: item ? [item] : [],
    finishedDays: item ? [] : [{ ...other, times: [...times], workedMinutes: 420 }],
  });
  await open(f.el);
  const edit = page.getByRole("button", { name: item ? "Edit" : /Edit.*Javier/, exact: !!item });
  await expect.element(edit).toBeVisible();
  await edit.click();
  await expect.element(page.getByRole("heading", { name: /Javier/ })).toBeVisible();
  const form = screen(f.el)!.shadowRoot!.querySelector("till-attendance-correction-dialog")!;
  const root = form.shadowRoot!;
  const fields = [
    ...root.querySelectorAll<HTMLElementTagNameMap["wt-input"]>('wt-input[type="time"]'),
  ];
  expect(fields.map((field) => field.value)).toEqual(["10:00", item ? "01:15" : "17:00"]);
  if (item === requested) {
    await expectNoA11yViolations(form);
    expect(root.querySelectorAll<HTMLElement>(".clock-label")[1]!.innerText).toBe(
      "Clock out · 2026-10-14 *",
    );
  }
  if (item) {
    expect(root.textContent).toContain("17:00");
    expect(root.textContent).toContain("01:15");
  }
  const send = root.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-save]")!;
  expect(send.textContent?.trim()).toBe("Save and send to Javier");
  expect(send.disabled).toBe(true);
  const reason = root.querySelector("wt-textarea")!;
  expect(reason.hasAttribute("required")).toBe(true);
  const date = root.querySelectorAll('wt-input[type="date"]')[1]!;
  for (const [field, value] of [
    [date, other.date],
    [fields[1]!, "18:00"],
  ] as const) {
    field.dispatchEvent(new CustomEvent("wt-change", { detail: { value }, bubbles: true }));
  }
  reason.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "  Closing took longer  " },
      bubbles: true,
    }),
  );
  await vi.waitFor(() => {
    expect(send.disabled).toBe(false);
    expect(root.textContent).toContain("Worked would be 8 hours");
  });
  f.getAttendanceManagerQueue.mockResolvedValue({ items: [], finishedDays: [] });
  await userEvent.click(send);
  await vi.waitFor(() =>
    expect(f.sendAttendanceManagerCommand).toHaveBeenCalledExactlyOnceWith(
      {
        action: "propose",
        personId: other.personId,
        date: other.date,
        ...(item ? { replaces: item.id } : {}),
        expectedRevision: "day-revision",
        commandId: expect.any(String),
        reason: "Closing took longer",
        changes: [
          {
            target: { entryId: "original-out" },
            at: "2026-10-13T16:00:00.000Z",
            offsetMinutes: 120,
          },
        ],
      },
      expect.anything(),
    ),
  );
  await expect
    .element(page.getByText("No hours are waiting for your approval.", { exact: true }))
    .toBeVisible();
});

it("keeps a worker’s requested missing time available for the manager to fill", async () => {
  const item = {
    ...requested,
    changes: [
      {
        target: { missingKind: "break_start" as const },
        at: "2026-10-13T11:00:00.000Z",
        offsetMinutes: 120,
      },
    ],
  };
  const f = await manager({ items: [item], finishedDays: [] });
  await open(f.el);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: /Javier/ })).toBeVisible();
  const form = screen(f.el)!.shadowRoot!.querySelector("till-attendance-correction-dialog")!;
  const root = form.shadowRoot!;
  expect(
    root.querySelectorAll<HTMLElementTagNameMap["wt-input"]>('wt-input[type="time"]')[2]?.value,
  ).toBe("13:00");
  expect(root.textContent).not.toContain("Remove added time");
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

it("counts a dispute the manager can edit even without a worker time to take", async () => {
  const unsolved = { ...disputed, workerVersion: undefined };
  const f = await manager({ items: [unsolved], finishedDays: [] });
  await open(f.el);
  const root = screen(f.el)!.shadowRoot!;
  expect(root.textContent).toContain("I closed the bar.");
  await expect.element(page.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
  expect(root.querySelector("[data-approve-request]")).toBeNull();
  const back = root.querySelector("wt-top-bar")!;
  await userEvent.click(back.shadowRoot!.querySelector("wt-button")!);
  await openMore(f.el);
  expect(menuEntry(f.el)!.textContent?.trim()).toBe("To approve · 1");
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
  expect(root.textContent).not.toContain("Edit");
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
