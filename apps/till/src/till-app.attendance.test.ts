import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import {
  clockApp,
  clockPage,
  clockState,
  deferred,
  pageButton,
  shellAction,
  signIn,
  working,
} from "../test/clock-app.js";
import {
  attendanceEntry,
  attendanceInbox,
  attendanceItem,
  attendancePrompt,
} from "../test/attendance-fixtures.js";
import type { AttendanceCommandResult, AttendanceInbox } from "./api/client.js";
import type { TillApp } from "./till-app.js";
import type { TillAttendanceQuestions } from "./screens/till-attendance-questions.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  setLocale(locale);
});
const questions = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillAttendanceQuestions>("till-attendance-questions");
async function questionButton(el: TillApp, selector: string) {
  await vi.waitFor(() =>
    expect(questions(el)?.shadowRoot!.querySelector(selector) ?? null).not.toBeNull(),
  );
  await userEvent.click(questions(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!);
}
function inbox(): AttendanceInbox {
  const entry = attendanceEntry({ personId: "p1", locationId: "venue" });
  return {
    ...attendanceInbox([
      attendancePrompt({
        personId: "p1",
        locationId: "venue",
        timeZone: "Europe/Madrid",
        history: [entry],
      }),
    ]),
    personId: "p1",
    locations: [{ id: "venue", name: "Clock venue", timeZone: "Europe/Madrid" }],
  };
}
const empty = (): AttendanceInbox => ({ ...inbox(), prompts: [], items: [] });

describe("till attendance sign-in flow", () => {
  it("shows questions before Clock in and confirmation appends once before the clock page", async () => {
    const f = await clockApp();
    f.api.getAttendanceInbox.mockResolvedValueOnce(inbox()).mockResolvedValue(empty());
    await signIn(f.el);
    await vi.waitFor(() => expect(questions(f.el)).not.toBeNull());
    expect(clockPage(f.el)).toBeNull();
    expect(f.el.shadowRoot!.querySelector("till-shell")).toBeNull();
    await questionButton(f.el, "[data-confirm]");
    await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledWith(
      {
        commandId: expect.any(String),
        expectedRevision: "revision",
        action: "confirm",
        questionId: "question",
      },
      undefined,
      { signal: expect.any(AbortSignal) },
    );
    expect(f.api.clockIn).not.toHaveBeenCalled();
    await pageButton(f.el, "[data-clock-in]");
    await working(f.el);
  });

  it("an already-working operator answers a proposal with distinct times, then returns to work", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    const item = attendanceItem({ personId: "p1", locationId: "venue" });
    const prompt = attendancePrompt({
      kind: "proposal",
      questionId: null,
      itemId: item.id,
      personId: "p1",
      locationId: "venue",
      history: item.history,
    });
    f.api.getAttendanceInbox
      .mockResolvedValueOnce({ ...empty(), prompts: [prompt], items: [item] })
      .mockResolvedValue(empty());
    await signIn(f.el);
    await vi.waitFor(() =>
      expect(questions(f.el)?.shadowRoot!.textContent).toContain("17:00 +02:00"),
    );
    expect(questions(f.el)!.shadowRoot!.textContent).toContain("18:00 +02:00");
    await questionButton(f.el, "[data-accept]");
    await working(f.el);
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "accept", itemId: "proposal" }),
      undefined,
      { signal: expect.any(AbortSignal) },
    );
    expect(clockPage(f.el)).toBeNull();
    expect(f.api.clockIn).not.toHaveBeenCalled();
  });

  it("empty questions go directly to work for an existing shift, without any hours step", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    await signIn(f.el);
    await working(f.el);
    expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(1);
    expect(questions(f.el)).toBeNull();
    expect(clockPage(f.el)).toBeNull();
    expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "Cancel works while the initial inbox is held and its late answer never reopens the gate (empty=%s)",
    async (emptyReply) => {
      const f = await clockApp();
      const held = deferred<AttendanceInbox>();
      f.api.getAttendanceInbox.mockReturnValueOnce(held.promise);
      await signIn(f.el);
      await vi.waitFor(() => expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(1));
      await questionButton(f.el, "[data-cancel]");
      await working(f.el);
      held.resolve(emptyReply ? empty() : inbox());
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await f.el.updateComplete;
      expect(questions(f.el)).toBeNull();
      expect(clockPage(f.el)).toBeNull();
      expect(f.api.clockIn).not.toHaveBeenCalled();
      expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
      await shellAction(f.el, ".logout");
      await vi.waitFor(() =>
        expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
      );
      f.api.getAttendanceInbox.mockResolvedValueOnce(inbox());
      await signIn(f.el);
      await vi.waitFor(() =>
        expect(questions(f.el)?.shadowRoot!.querySelector("[data-confirm]")).not.toBeNull(),
      );
    },
  );

  it("menu Clock in asks new questions before recording the clock-in", async () => {
    const f = await clockApp();
    await signIn(f.el);
    await pageButton(f.el, "[data-cancel]");
    await working(f.el);
    f.api.getAttendanceInbox.mockResolvedValueOnce(inbox()).mockResolvedValue(empty());
    await shellAction(f.el, '[data-clock-action="in"]');
    await vi.waitFor(() => expect(questions(f.el)).not.toBeNull());
    expect(f.api.clockIn).not.toHaveBeenCalled();
    await questionButton(f.el, "[data-confirm]");
    await working(f.el);
    expect(f.api.clockIn).toHaveBeenCalledTimes(1);
    expect(f.state().state).toBe("working");
    expect(clockPage(f.el)).toBeNull();
  });

  it("a refused read offers Retry and Cancel, and retry does not write", async () => {
    const f = await clockApp();
    f.api.getAttendanceInbox
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(inbox());
    await signIn(f.el);
    await vi.waitFor(() =>
      expect(questions(f.el)?.shadowRoot!.querySelector("[data-retry]")).not.toBeNull(),
    );
    await questionButton(f.el, "[data-retry]");
    await vi.waitFor(() =>
      expect(questions(f.el)?.shadowRoot!.querySelector("[data-confirm]")).not.toBeNull(),
    );
    expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
    await questionButton(f.el, "[data-cancel]");
    await working(f.el);
  });

  it("uncertain writes use Retry read to recover the receipt without a second POST", async () => {
    const f = await clockApp();
    f.api.getAttendanceInbox.mockResolvedValueOnce(inbox()).mockResolvedValue(empty());
    let commandId = "";
    f.api.sendAttendanceCommand.mockImplementationOnce(async (command) => {
      commandId = command.commandId;
      throw new TypeError("lost response");
    });
    f.api.getAttendanceCommand
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce(async () => ({ commandId, entryIds: ["answer"], replayed: true }));
    await signIn(f.el);
    await questionButton(f.el, "[data-confirm]");
    await vi.waitFor(() =>
      expect(questions(f.el)?.shadowRoot!.textContent).toContain("The answer was lost."),
    );
    expect(
      questions(f.el)!.shadowRoot!.querySelector("[data-confirm]")!.hasAttribute("disabled"),
    ).toBe(true);
    await questionButton(f.el, "[data-retry]");
    await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
    expect(f.api.getAttendanceCommand).toHaveBeenCalledWith(commandId, {
      signal: expect.any(AbortSignal),
    });
  });

  it("a late old operator answer cannot expose work or clear the next operator's gate", async () => {
    const f = await clockApp();
    const held = deferred<AttendanceCommandResult>();
    f.api.getAttendanceInbox.mockResolvedValueOnce(inbox());
    f.api.sendAttendanceCommand.mockReturnValueOnce(held.promise);
    await signIn(f.el);
    await questionButton(f.el, "[data-confirm]");
    await vi.waitFor(() => expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1));
    questions(f.el)!.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }));
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
    );
    f.api.getAttendanceInbox.mockResolvedValueOnce({
      ...inbox(),
      personId: "p2",
      prompts: inbox().prompts.map((p) => ({ ...p, personId: "p2" })),
    });
    await signIn(f.el, "p2");
    await vi.waitFor(() => expect(questions(f.el)?.inbox?.personId).toBe("p2"));
    const commandId = f.api.sendAttendanceCommand.mock.calls[0]![0].commandId;
    held.resolve({ commandId, entryIds: ["old-answer"], replayed: false });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await f.el.updateComplete;
    expect(questions(f.el)?.inbox?.personId).toBe("p2");
    expect(f.el.shadowRoot!.querySelector("till-shell")).toBeNull();
    expect(f.api.logout).toHaveBeenCalledTimes(1);
  });

  it.each([{ enabled: false }, { action: false }])(
    "no attendance calls without clock capability %j",
    async (options) => {
      const f = await clockApp(options);
      await signIn(f.el);
      await working(f.el);
      expect(f.api.getAttendanceInbox).not.toHaveBeenCalled();
      expect(questions(f.el)).toBeNull();
    },
  );
});

async function correction(el: TillApp) {
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-attendance-correction-dialog")).not.toBeNull(),
  );
  const dialog = el.shadowRoot!.querySelector("till-attendance-correction-dialog")!;
  await dialog.updateComplete;
  return dialog;
}
async function fillCorrection(el: TillApp, name: string, value: string) {
  const { page } = await import("vitest/browser");
  const dialog = await correction(el);
  const field = dialog.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >(`[name="${name}"]`)!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(
      field.shadowRoot!.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!,
    ),
    value,
  );
  await dialog.updateComplete;
}
async function saveCorrection(el: TillApp) {
  const dialog = await correction(el);
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-save]")!);
}
async function pinDialog(el: TillApp) {
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector("till-supervisor-override-dialog[data-attendance-pin]"),
    ).not.toBeNull(),
  );
  const dialog = el.shadowRoot!.querySelector<
    import("./widgets/supervisor-override-dialog.js").TillSupervisorOverrideDialog
  >("till-supervisor-override-dialog[data-attendance-pin]")!;
  await dialog.updateComplete;
  return dialog;
}
async function selectPin(el: TillApp, personId: string) {
  const dialog = await pinDialog(el);
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLElement>(`[data-person="${personId}"]`)!,
  );
  await dialog.updateComplete;
  const pad = dialog.shadowRoot!.querySelector("till-numeric-pad")!;
  await pad.updateComplete;
  for (let n = 0; n < 4; n++)
    await userEvent.click(pad.shadowRoot!.querySelector<HTMLElement>('[data-key="5"]')!);
  await dialog.updateComplete;
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>(".authorize")!);
}

describe("till correction editors and manager PIN", () => {
  it("No, I left at opens the recorded time, submits a reasoned change, then closes before refresh", async () => {
    const f = await clockApp();
    f.api.getAttendanceInbox
      .mockResolvedValueOnce(inbox())
      .mockRejectedValueOnce(new TypeError("refresh offline"));
    await signIn(f.el);
    await questionButton(f.el, "[data-edit]");
    await fillCorrection(f.el, "attendanceTime0", "02:10");
    await fillCorrection(f.el, "attendanceReason", "Closed late");
    await saveCorrection(f.el);
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")).toBeNull(),
    );
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledWith(
      {
        commandId: expect.any(String),
        expectedRevision: "revision",
        action: "request",
        questionId: "question",
        locationId: "venue",
        changes: [
          {
            target: { entryId: "automatic-out" },
            at: "2026-10-14T00:10:00.000Z",
            offsetMinutes: 120,
          },
        ],
        reason: "Closed late",
      },
      undefined,
      { signal: expect.any(AbortSignal) },
    );
    await vi.waitFor(() =>
      expect(questions(f.el)?.shadowRoot!.textContent).toContain("could not be read"),
    );
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  });

  it("a missing pair opens with blank dates and times, and sends both explicitly chosen entries", async () => {
    const f = await clockApp();
    const missing = attendancePrompt({
      kind: "missing-times",
      personId: "p1",
      locationId: "venue",
      timeZone: "Europe/Madrid",
      automaticEntryId: null,
      history: [],
      missingKinds: ["in", "out"],
    });
    f.api.getAttendanceInbox
      .mockResolvedValueOnce({ ...empty(), prompts: [missing] })
      .mockResolvedValue(empty());
    await signIn(f.el);
    await questionButton(f.el, "[data-edit]");
    const editor = await correction(f.el);
    expect(
      [...editor.shadowRoot!.querySelectorAll("wt-input")].map((field) => field.value),
    ).toEqual(["", "", "", ""]);
    await fillCorrection(f.el, "attendanceDate0", "2026-10-13");
    await fillCorrection(f.el, "attendanceTime0", "22:00");
    await fillCorrection(f.el, "attendanceDate1", "2026-10-14");
    await fillCorrection(f.el, "attendanceTime1", "01:30");
    await fillCorrection(f.el, "attendanceReason", "Forgot the clock");
    await saveCorrection(f.el);
    await vi.waitFor(() => expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1));
    expect(f.api.sendAttendanceCommand.mock.calls[0]![0]).toEqual({
      commandId: expect.any(String),
      expectedRevision: "revision",
      action: "request",
      questionId: "question",
      locationId: "venue",
      changes: [
        { target: { missingKind: "in" }, at: "2026-10-13T20:00:00.000Z", offsetMinutes: 120 },
        { target: { missingKind: "out" }, at: "2026-10-13T23:30:00.000Z", offsetMinutes: 120 },
      ],
      reason: "Forgot the clock",
    });
  });

  it("disagreement requires a reason and sends no invented time or manager identity", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    const item = attendanceItem({ personId: "p1", locationId: "venue" });
    f.api.getAttendanceInbox
      .mockResolvedValueOnce({
        ...empty(),
        items: [item],
        prompts: [
          attendancePrompt({
            kind: "proposal",
            itemId: item.id,
            questionId: null,
            locationId: "venue",
            personId: "p1",
            history: item.history,
          }),
        ],
      })
      .mockResolvedValue(empty());
    await signIn(f.el);
    await questionButton(f.el, "[data-disagree]");
    const editor = await correction(f.el);
    expect(editor.shadowRoot!.querySelector("wt-input")).toBeNull();
    expect(editor.shadowRoot!.querySelector("[data-save]")!.hasAttribute("disabled")).toBe(true);
    await fillCorrection(f.el, "attendanceReason", "The original time is right");
    await saveCorrection(f.el);
    await working(f.el);
    expect(f.api.sendAttendanceCommand.mock.calls[0]![0]).toEqual({
      commandId: expect.any(String),
      expectedRevision: "revision",
      action: "disagree",
      itemId: "proposal",
      reason: "The original time is right",
    });
  });

  it("Fix my hours in the name menu opens a real chosen-day editor and a missing pair", async () => {
    const { page } = await import("vitest/browser");
    const f = await clockApp({ state: clockState("working", "in") });
    await signIn(f.el);
    await working(f.el);
    await shellAction(f.el, "[data-fix-hours]");
    await vi.waitFor(() =>
      expect(f.el.shadowRoot!.querySelector("till-attendance-day-dialog")).not.toBeNull(),
    );
    const day = f.el.shadowRoot!.querySelector("till-attendance-day-dialog")!;
    await day.updateComplete;
    const date =
      day.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("[name=attendanceDay]")!;
    await date.updateComplete;
    await userEvent.fill(
      page.elementLocator(date.shadowRoot!.querySelector("input")!),
      "2026-10-14",
    );
    await vi.waitFor(() => expect(day.view?.date).toBe("2026-10-14"));
    expect(f.api.getAttendanceDay).toHaveBeenCalledWith("2026-10-14", "venue", {
      signal: expect.any(AbortSignal),
    });
    await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>('[data-add-pair="shift"]')!);
    const editor = await correction(f.el);
    expect(
      [...editor.shadowRoot!.querySelectorAll("wt-input")].map((field) => field.value),
    ).toEqual(["", "", "", ""]);
  });

  it.each([false, true])(
    "reopened pending requests use the server's eligible picker, including admin self=%s",
    async (admin) => {
      const f = await clockApp({ state: clockState("working", "in") });
      const item = attendanceItem({
        personId: "p1",
        locationId: "venue",
        direction: "worker_request",
        status: "waiting-manager",
      });
      f.api.getAttendanceInbox.mockResolvedValue({ ...empty(), items: [item] });
      f.api.getAttendanceDay.mockImplementation(async (date, locationId) => ({
        personId: "p1",
        locationId,
        date,
        revision: "day-revision",
        timeZone: "Europe/Madrid",
        record: { entries: [], sessions: [], closures: [], closedPeriodImpacts: [] },
        items: [item],
      }));
      f.api.listAttendanceApprovers.mockResolvedValue(
        admin
          ? [
              { personId: "p1", displayName: "Ana" },
              { personId: "manager", displayName: "Marta" },
            ]
          : [{ personId: "manager", displayName: "Marta" }],
      );
      await signIn(f.el);
      await working(f.el);
      await shellAction(f.el, "[data-fix-hours]");
      await vi.waitFor(() =>
        expect(f.el.shadowRoot!.querySelector("till-attendance-day-dialog")?.view).not.toBeNull(),
      );
      const day = f.el.shadowRoot!.querySelector("till-attendance-day-dialog")!;
      await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>("[data-approve]")!);
      const pin = await pinDialog(f.el);
      expect(pin.shadowRoot!.querySelector('[data-person="p1"]') !== null).toBe(admin);
      expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
      await selectPin(f.el, admin ? "p1" : "manager");
      await vi.waitFor(() => expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1));
      expect(f.api.sendAttendanceCommand).toHaveBeenCalledWith(
        {
          commandId: expect.any(String),
          expectedRevision: "day-revision",
          action: "approve",
          itemId: "proposal",
        },
        { personId: admin ? "p1" : "manager", pin: "5555" },
        { signal: expect.any(AbortSignal) },
      );
      expect(
        f.el.shadowRoot!.querySelector("till-supervisor-override-dialog[data-attendance-pin]"),
      ).toBeNull();
    },
  );

  it("canceling manager PIN leaves the request pending without a POST", async () => {
    const f = await clockApp({ state: clockState("working", "in") });
    const item = attendanceItem({
      personId: "p1",
      locationId: "venue",
      direction: "worker_request",
      status: "waiting-manager",
    });
    f.api.getAttendanceInbox.mockResolvedValue({ ...empty(), items: [item] });
    f.api.getAttendanceDay.mockImplementation(async (date, locationId) => ({
      personId: "p1",
      locationId,
      date,
      revision: "revision",
      timeZone: "Europe/Madrid",
      record: { entries: [], sessions: [], closures: [], closedPeriodImpacts: [] },
      items: [item],
    }));
    await signIn(f.el);
    await working(f.el);
    await shellAction(f.el, "[data-fix-hours]");
    const day = f.el.shadowRoot!.querySelector("till-attendance-day-dialog")!;
    await vi.waitFor(() => expect(day.shadowRoot!.querySelector("[data-approve]")).not.toBeNull());
    await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>("[data-approve]")!);
    const pin = await pinDialog(f.el);
    const closed = new Promise((resolve) =>
      pin.addEventListener("override-cancel", resolve, { once: true }),
    );
    await userEvent.click(pin.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
    await closed;
    await vi.waitFor(() =>
      expect(
        f.el.shadowRoot!.querySelector("till-supervisor-override-dialog[data-attendance-pin]"),
      ).toBeNull(),
    );
    expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
    expect(day.view!.items[0]!.status).toBe("waiting-manager");
  });
});

it("a known absent receipt offers an explicit retry of the identical command, without auto-sending", async () => {
  const f = await clockApp();
  f.api.getAttendanceInbox.mockResolvedValue(inbox());
  f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost response"));
  f.api.getAttendanceCommand.mockResolvedValueOnce(null);
  await signIn(f.el);
  await questionButton(f.el, "[data-confirm]");
  await vi.waitFor(() =>
    expect(
      questions(f.el)?.shadowRoot!.querySelector("[data-retry-command]") ?? null,
    ).not.toBeNull(),
  );
  expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  const sent = structuredClone(f.api.sendAttendanceCommand.mock.calls[0]![0]);
  f.api.getAttendanceInbox.mockResolvedValue(empty());
  await questionButton(f.el, "[data-retry-command]");
  await vi.waitFor(() => expect(clockPage(f.el)).not.toBeNull());
  expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(2);
  expect(f.api.sendAttendanceCommand.mock.calls[1]![0]).toEqual(sent);
});

it("a lost PIN approval is recovered from the day and retried with the same command and a fresh PIN", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  const item = attendanceItem({
    direction: "worker_request",
    status: "waiting-manager",
    personId: "p1",
    locationId: "venue",
  });
  f.api.getAttendanceInbox.mockResolvedValue({ ...empty(), items: [item] });
  f.api.getAttendanceDay.mockImplementation(async (date, locationId) => ({
    personId: "p1",
    locationId,
    date,
    revision: "revision",
    timeZone: "Europe/Madrid",
    record: { entries: [], sessions: [], closures: [], closedPeriodImpacts: [] },
    items: [item],
  }));
  f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost reply"));
  f.api.getAttendanceCommand
    .mockRejectedValueOnce(new TypeError("receipt offline"))
    .mockResolvedValueOnce(null);
  await signIn(f.el);
  await working(f.el);
  await shellAction(f.el, "[data-fix-hours]");
  const day = f.el.shadowRoot!.querySelector("till-attendance-day-dialog")!;
  await vi.waitFor(() => expect(day.shadowRoot!.querySelector("[data-approve]")).not.toBeNull());
  await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>("[data-approve]")!);
  await selectPin(f.el, "manager");
  await vi.waitFor(() => expect(day.error).toContain("The answer was lost."));
  expect(day.blocked).toBe(true);
  const originalCommand = structuredClone(f.api.sendAttendanceCommand.mock.calls[0]![0]);
  await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>("[data-retry]")!);
  await vi.waitFor(() => expect(day.canRetry).toBe(true));
  await vi.waitFor(() => expect(day.reading).toBe(false));
  expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>("[data-retry-command]")!);
  const pin = await pinDialog(f.el);
  expect(pin.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  await selectPin(f.el, "manager");
  await vi.waitFor(() => expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(2));
  expect(f.api.sendAttendanceCommand.mock.calls[1]![0]).toEqual(originalCommand);
  expect(f.api.sendAttendanceCommand.mock.calls[1]![1]).toEqual({
    personId: "manager",
    pin: "5555",
  });
  expect(f.api.listAttendanceApprovers.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    [item.id, "approve"],
    [item.id, "approve"],
  ]);
});

it("a recorded day's retime keeps its target and recovers a lost reply through the editor", async () => {
  const { page } = await import("vitest/browser");
  const f = await clockApp({ state: clockState("working", "in") });
  f.api.getAttendanceInbox.mockResolvedValue(empty());
  f.api.getAttendanceDay.mockImplementation(async (date, locationId) => ({
    personId: "p1",
    locationId,
    date,
    revision: "day-revision",
    timeZone: "Europe/Madrid",
    record: {
      entries:
        date === "2026-10-14"
          ? [
              {
                entry: attendanceEntry({ personId: "p1", locationId: "venue" }),
                author: { kind: "automatic", personId: null },
                effective: true,
                confirmed: true,
                confirmedByWorker: false,
                selfApproved: false,
                corrected: false,
                disputed: false,
                closedPeriodIds: [],
              },
            ]
          : [],
      sessions: [],
      closures: [],
      closedPeriodImpacts: [],
    },
    items: [],
  }));
  f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost reply"));
  f.api.getAttendanceCommand
    .mockRejectedValueOnce(new TypeError("receipt offline"))
    .mockResolvedValueOnce(null);
  await signIn(f.el);
  await working(f.el);
  await shellAction(f.el, "[data-fix-hours]");
  const day = f.el.shadowRoot!.querySelector("till-attendance-day-dialog")!;
  await day.updateComplete;
  const dateField =
    day.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("[name=attendanceDay]")!;
  await dateField.updateComplete;
  await userEvent.fill(
    page.elementLocator(dateField.shadowRoot!.querySelector("input")!),
    "2026-10-14",
  );
  await vi.waitFor(() => expect(day.view?.date).toBe("2026-10-14"));
  await vi.waitFor(() => expect(day.shadowRoot!.querySelector("[data-fix-entry]")).not.toBeNull());
  await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>("[data-fix-entry]")!);
  await fillCorrection(f.el, "attendanceTime0", "02:10");
  await fillCorrection(f.el, "attendanceReason", "Finished the delivery");
  await saveCorrection(f.el);
  const editor = await correction(f.el);
  await vi.waitFor(() => expect(editor.recovery).toBe("uncertain"));
  expect(editor.blocked).toBe(true);
  const originalCommand = structuredClone(f.api.sendAttendanceCommand.mock.calls[0]![0]);
  expect(originalCommand).toEqual({
    commandId: expect.any(String),
    expectedRevision: "day-revision",
    action: "request",
    questionId: null,
    locationId: "venue",
    reason: "Finished the delivery",
    changes: [
      { target: { entryId: "automatic-out" }, at: "2026-10-14T00:10:00.000Z", offsetMinutes: 120 },
    ],
  });
  await userEvent.click(editor.shadowRoot!.querySelector<HTMLElement>("[data-retry-read]")!);
  await vi.waitFor(() => expect(editor.recovery).toBe("retry"));
  await vi.waitFor(() => expect(editor.busy).toBe(false));
  expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  await userEvent.click(editor.shadowRoot!.querySelector<HTMLElement>("[data-retry-command]")!);
  await vi.waitFor(() => expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(2));
  expect(f.api.sendAttendanceCommand.mock.calls[1]![0]).toEqual(originalCommand);
  await vi.waitFor(() =>
    expect(f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")).toBeNull(),
  );
});

it("a new correction offers the matching pending request's PIN approval, and Cancel leaves it pending", async () => {
  const f = await clockApp();
  const item = attendanceItem({
    id: "new-request",
    requestEntryIds: ["new-request"],
    direction: "worker_request",
    status: "waiting-manager",
    personId: "p1",
    locationId: "venue",
  });
  f.api.getAttendanceInbox
    .mockResolvedValueOnce(inbox())
    .mockResolvedValue({ ...empty(), items: [item] });
  f.api.sendAttendanceCommand.mockImplementationOnce(async (command) => ({
    commandId: command.commandId,
    entryIds: ["new-request"],
    replayed: false,
  }));
  await signIn(f.el);
  await questionButton(f.el, "[data-edit]");
  await fillCorrection(f.el, "attendanceTime0", "02:15");
  await fillCorrection(f.el, "attendanceReason", "Closed late");
  await saveCorrection(f.el);
  const pin = await pinDialog(f.el);
  expect(f.api.listAttendanceApprovers).toHaveBeenCalledWith("new-request", "approve", {
    signal: expect.any(AbortSignal),
  });
  expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  const closed = new Promise((resolve) =>
    pin.addEventListener("override-cancel", resolve, { once: true }),
  );
  await userEvent.click(pin.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
  await closed;
  expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  expect(clockPage(f.el)).not.toBeNull();
});

it("Cancel can return to work during uncertainty, and Fix my hours can recover it without another POST", async () => {
  const f = await clockApp();
  f.api.getAttendanceInbox.mockResolvedValueOnce(inbox()).mockResolvedValue(empty());
  let commandId = "";
  f.api.sendAttendanceCommand.mockImplementationOnce(async (command) => {
    commandId = command.commandId;
    throw new TypeError("lost response");
  });
  f.api.getAttendanceCommand
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockImplementationOnce(async () => ({ commandId, entryIds: ["answer"], replayed: true }));
  await signIn(f.el);
  await questionButton(f.el, "[data-confirm]");
  await vi.waitFor(() =>
    expect(questions(f.el)?.shadowRoot!.textContent).toContain("The answer was lost."),
  );
  await questionButton(f.el, "[data-cancel]");
  await working(f.el);
  const shell = f.el.shadowRoot!.querySelector("till-shell")!;
  expect(
    shell.shadowRoot!.querySelector('[data-clock-action="in"]')!.hasAttribute("disabled"),
  ).toBe(true);
  expect(shell.shadowRoot!.querySelector("[data-fix-hours]")!.hasAttribute("disabled")).toBe(false);
  await shellAction(f.el, "[data-fix-hours]");
  await vi.waitFor(() =>
    expect(
      f.el.shadowRoot!.querySelector("till-attendance-day-dialog")?.view ?? null,
    ).not.toBeNull(),
  );
  expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  expect(f.api.getAttendanceCommand).toHaveBeenCalledTimes(2);
  expect(f.api.clockIn).not.toHaveBeenCalled();
  expect(questions(f.el)).toBeNull();
});

it("closing during an approver read retires that opening and does not block a reopened day", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  const item = attendanceItem({
    personId: "p1",
    locationId: "venue",
    direction: "worker_request",
    status: "waiting-manager",
  });
  f.api.getAttendanceInbox.mockResolvedValue({ ...empty(), items: [item] });
  f.api.getAttendanceDay.mockImplementation(async (date, locationId) => ({
    personId: "p1",
    locationId,
    date,
    revision: "revision",
    timeZone: "Europe/Madrid",
    record: { entries: [], sessions: [], closures: [], closedPeriodImpacts: [] },
    items: [item],
  }));
  const held = deferred<import("./api/client.js").StaffMember[]>();
  f.api.listAttendanceApprovers.mockReturnValueOnce(held.promise);
  await signIn(f.el);
  await working(f.el);
  await shellAction(f.el, "[data-fix-hours]");
  const day = f.el.shadowRoot!.querySelector("till-attendance-day-dialog")!;
  await vi.waitFor(() => expect(day.shadowRoot!.querySelector("[data-approve]")).not.toBeNull());
  await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>("[data-approve]")!);
  await vi.waitFor(() => expect(f.api.listAttendanceApprovers).toHaveBeenCalledTimes(1));
  const closed = new Promise((resolve) =>
    day.addEventListener("attendance-day-close", resolve, { once: true }),
  );
  await userEvent.click(day.shadowRoot!.querySelector<HTMLElement>("[data-close]")!);
  await closed;
  await shellAction(f.el, "[data-fix-hours]");
  const reopened = f.el.shadowRoot!.querySelector("till-attendance-day-dialog")!;
  await vi.waitFor(() => expect(reopened.view ?? null).not.toBeNull());
  held.resolve([{ personId: "manager", displayName: "Marta" }]);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await f.el.updateComplete;
  expect(
    f.el.shadowRoot!.querySelector("till-supervisor-override-dialog[data-attendance-pin]"),
  ).toBeNull();
  expect(reopened.reading).toBe(false);
  expect(reopened.shadowRoot!.querySelector("[data-approve]")).not.toBeNull();
});

it("an initial clock read failure keeps Retry read usable before attendance loads", async () => {
  const f = await clockApp();
  f.api.getClockState.mockRejectedValueOnce(new TypeError("clock offline"));
  f.api.getAttendanceInbox.mockResolvedValueOnce(inbox());
  await signIn(f.el);
  await vi.waitFor(() =>
    expect(questions(f.el)?.shadowRoot!.querySelector("[data-retry]") ?? null).not.toBeNull(),
  );
  expect(questions(f.el)!.shadowRoot!.querySelector("[data-retry]")!.hasAttribute("disabled")).toBe(
    false,
  );
  await questionButton(f.el, "[data-retry]");
  await vi.waitFor(() => expect(questions(f.el)?.inbox?.prompts.length).toBe(1));
  expect(f.api.getClockState).toHaveBeenCalledTimes(2);
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
});
