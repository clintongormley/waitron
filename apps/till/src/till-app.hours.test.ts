import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { clockApp, clockState, deferred, signIn, shellAction, working } from "../test/clock-app.js";
import { hoursView } from "../test/hours-fixtures.js";
import type { TillApp } from "./till-app.js";
import type { PersonHours } from "./api/client.js";
import type { TillHoursScreen } from "./screens/till-hours-screen.js";
import { attendanceInbox, attendancePrompt } from "../test/attendance-fixtures.js";
import { codeMessage } from "./i18n/codes.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  setLocale(locale);
});
const screen = (el: TillApp) => el.shadowRoot!.querySelector<TillHoursScreen>("till-hours-screen");
async function open(el: TillApp) {
  await shellAction(el, "[data-my-hours]");
  await vi.waitFor(() => expect(screen(el)).not.toBeNull());
  await screen(el)!.updateComplete;
}
it("offers My hours only in the name menu and opens the server's current week without a sign-in step", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  await signIn(f.el);
  await working(f.el);
  expect(screen(f.el)).toBeNull();
  expect(f.api.getHours).not.toHaveBeenCalled();
  await open(f.el);
  await vi.waitFor(() => expect(screen(f.el)!.view?.workedMinutes).toBe(480));
  expect(f.api.getHours).toHaveBeenCalledWith(
    "venue",
    { kind: "week" },
    { signal: expect.any(AbortSignal) },
  );
  expect(location.pathname).toContain("/view/hours");
  expect(f.el.shadowRoot!.querySelector("till-attendance-questions")).toBeNull();
  expect(f.el.shadowRoot!.querySelector("till-clock-in-screen")).toBeNull();
  await userEvent.click(screen(f.el)!.shadowRoot!.querySelector<HTMLElement>("[data-back]")!);
  await vi.waitFor(() => expect(screen(f.el)).toBeNull());
  expect(location.pathname).not.toContain("/view/hours");
  expect(f.api.clockIn).not.toHaveBeenCalled();
  expect(f.api.clockOut).not.toHaveBeenCalled();
});
it("a selected hours day reuses the existing calendar-day editor with authoritative revision", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  await signIn(f.el);
  await working(f.el);
  await open(f.el);
  await vi.waitFor(() => expect(screen(f.el)!.view).not.toBeNull());
  await userEvent.click(
    screen(f.el)!.shadowRoot!.querySelector<HTMLElement>('[data-fix="2026-01-05"]')!,
  );
  await vi.waitFor(() =>
    expect(f.api.getAttendanceDay).toHaveBeenCalledWith("2026-01-05", "venue", {
      signal: expect.any(AbortSignal),
    }),
  );
  const dialog = f.el.shadowRoot!.querySelector<HTMLElement & { open: boolean; date: string }>(
    "till-attendance-day-dialog",
  )!;
  expect(dialog.open).toBe(true);
  expect(dialog.date).toBe("2026-01-05");
});
it.each([{ enabled: false }, { action: false }])(
  "a signed-in worker without hours access cannot open a forged menu event: %j",
  async (options) => {
    const f = await clockApp({ ...options, state: clockState("working", "in") });
    await signIn(f.el);
    await working(f.el);
    f.el
      .shadowRoot!.querySelector("till-tab-shell")!
      .dispatchEvent(new CustomEvent("my-hours", { bubbles: true, composed: true }));
    await f.el.updateComplete;
    expect(screen(f.el)).toBeNull();
    expect(f.api.getHours).not.toHaveBeenCalled();
  },
);
it("logout cancels a held hours read and a late completion cannot return the previous person's content", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  await signIn(f.el);
  await working(f.el);
  const held = deferred<PersonHours>();
  f.api.getHours.mockReturnValueOnce(held.promise);
  await open(f.el);
  const signal = f.api.getHours.mock.calls.at(-1)![2]!.signal!;
  await shellAction(f.el, ".logout");
  await vi.waitFor(() => expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  expect(signal.aborted).toBe(true);
  held.resolve(hoursView());
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await f.el.updateComplete;
  expect(screen(f.el)).toBeNull();
});
it("explicit Refresh and a date selection replace the current scoped read without a clock write", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  await signIn(f.el);
  await working(f.el);
  await open(f.el);
  await vi.waitFor(() => expect(screen(f.el)!.view).not.toBeNull());
  const calls = f.api.getHours.mock.calls.length;
  await userEvent.click(screen(f.el)!.shadowRoot!.querySelector<HTMLElement>("[data-refresh]")!);
  await vi.waitFor(() => expect(f.api.getHours.mock.calls.length).toBeGreaterThan(calls));
  screen(f.el)!.dispatchEvent(
    new CustomEvent("hours-select", {
      detail: { locationId: "venue", selection: { kind: "month", date: "2026-02-01" } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() =>
    expect(f.api.getHours).toHaveBeenCalledWith(
      "venue",
      { kind: "month", date: "2026-02-01" },
      { signal: expect.any(AbortSignal) },
    ),
  );
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
});
it("a summary prompt alone cannot authorise a response from an empty current inbox", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  await signIn(f.el);
  await working(f.el);
  await open(f.el);
  await vi.waitFor(() => expect(screen(f.el)!.view).not.toBeNull());
  await userEvent.click(
    screen(f.el)!.shadowRoot!.querySelector<HTMLElement>('[data-prompt-action="confirm"]')!,
  );
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
});
it("hours responses use the current inbox revision and a later successful summary read preserves their refusal", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  await signIn(f.el);
  await working(f.el);
  const prompt = attendancePrompt({
    personId: "p1",
    locationId: "venue",
    timeZone: "Europe/Madrid",
  });
  f.api.getAttendanceInbox.mockResolvedValue({
    ...attendanceInbox([prompt]),
    personId: "p1",
    revision: "fresh-inbox",
    locations: [{ id: "venue", name: "Clock venue", timeZone: "Europe/Madrid" }],
  });
  f.api.sendAttendanceCommand.mockRejectedValueOnce({ code: "attendance.state_changed" });
  await open(f.el);
  await vi.waitFor(() => expect(screen(f.el)!.reading).toBe(false));
  await userEvent.click(
    screen(f.el)!.shadowRoot!.querySelector<HTMLElement>('[data-prompt-action="confirm"]')!,
  );
  await vi.waitFor(() =>
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledWith(
      {
        commandId: expect.any(String),
        expectedRevision: "fresh-inbox",
        action: "confirm",
        questionId: "question",
      },
      undefined,
      { signal: expect.any(AbortSignal) },
    ),
  );
  await vi.waitFor(() => expect(screen(f.el)!.error).toBe(codeMessage("attendance.state_changed")));
  await userEvent.click(screen(f.el)!.shadowRoot!.querySelector<HTMLElement>("[data-refresh]")!);
  await vi.waitFor(() => expect(screen(f.el)!.reading).toBe(false));
  expect(screen(f.el)!.error).toBe(codeMessage("attendance.state_changed"));
  expect(f.el.shadowRoot!.querySelector("till-attendance-questions")).toBeNull();
});
it.each(["device.forbidden_action", "attendance.not_permitted", "session.required"])(
  "a new hours %s refusal retires the private view",
  async (code) => {
    const f = await clockApp({ state: clockState("working", "in") });
    await signIn(f.el);
    await working(f.el);
    f.api.getHours.mockRejectedValueOnce({ code });
    await shellAction(f.el, "[data-my-hours]");
    await vi.waitFor(() => expect(f.api.getHours).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(screen(f.el)).toBeNull());
    if (code === "session.required")
      await vi.waitFor(() =>
        expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull(),
      );
  },
);
it("a known absent response can be retried from Hours with the same command identity", async () => {
  const f = await clockApp({ state: clockState("working", "in") });
  await signIn(f.el);
  await working(f.el);
  const prompt = attendancePrompt({
    personId: "p1",
    locationId: "venue",
    timeZone: "Europe/Madrid",
  });
  const inbox = {
    ...attendanceInbox([prompt]),
    personId: "p1",
    locations: [{ id: "venue", name: "Clock venue", timeZone: "Europe/Madrid" }],
  };
  f.api.getAttendanceInbox.mockResolvedValue(inbox);
  f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("answer lost"));
  f.api.getAttendanceCommand.mockResolvedValueOnce(null);
  await open(f.el);
  await vi.waitFor(() => expect(screen(f.el)!.reading).toBe(false));
  await userEvent.click(
    screen(f.el)!.shadowRoot!.querySelector<HTMLElement>('[data-prompt-action="confirm"]')!,
  );
  await vi.waitFor(() => expect(f.api.getAttendanceCommand).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(screen(f.el)!.shadowRoot!.querySelector("[data-retry-response]")).not.toBeNull(),
  );
  const original = f.api.sendAttendanceCommand.mock.calls[0]![0];
  expect(f.api.getAttendanceCommand).toHaveBeenCalledWith(original.commandId, {
    signal: expect.any(AbortSignal),
  });
  f.api.getAttendanceInbox.mockResolvedValue({ ...inbox, prompts: [] });
  await userEvent.click(
    screen(f.el)!.shadowRoot!.querySelector<HTMLElement>("[data-retry-response]")!,
  );
  await vi.waitFor(() => expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(2));
  expect(f.api.sendAttendanceCommand.mock.calls[1]![0]).toEqual(original);
  await vi.waitFor(() =>
    expect(screen(f.el)!.shadowRoot!.querySelector("[data-retry-response]")).toBeNull(),
  );
  expect(f.el.shadowRoot!.querySelector("till-attendance-questions")).toBeNull();
});
