import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { clockApp, signIn } from "../test/clock-app.js";
import { attendanceInbox, attendancePrompt } from "../test/attendance-fixtures.js";
import { SessionActivity } from "./session-activity.js";
import type { TillApp } from "./till-app.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  setLocale(locale);
});
async function edit(options: Parameters<typeof clockApp>[0] = {}) {
  const f = await clockApp(options);
  f.api.getAttendanceInbox.mockResolvedValue({
    ...attendanceInbox([
      attendancePrompt({ personId: "p1", locationId: "venue", timeZone: "Europe/Madrid" }),
    ]),
    personId: "p1",
    locations: [{ id: "venue", name: "Clock venue", timeZone: "Europe/Madrid" }],
  });
  await signIn(f.el);
  await vi.waitFor(() =>
    expect(
      f.el
        .shadowRoot!.querySelector("till-attendance-questions")
        ?.shadowRoot!.querySelector("[data-edit]") ?? null,
    ).not.toBeNull(),
  );
  const questions = f.el.shadowRoot!.querySelector("till-attendance-questions")!;
  await userEvent.click(questions.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!);
  const editor = f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")!;
  await editor.updateComplete;
  const field = editor.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("textarea")!;
  await userEvent.fill(page.elementLocator(input), "Closed after the delivery");
  return { ...f, editor, input };
}
async function warning(el: TillApp) {
  await el.updateComplete;
  const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}

it("native Escape in the real sign-in editor protects the response until Keep or Discard", async () => {
  const f = await edit();
  await userEvent.keyboard("{Escape}");
  const q = await warning(f.el);
  expect(q.open).toBe(true);
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  await expect.poll(() => q.open).toBe(false);
  expect(f.input.value).toBe("Closed after the delivery");
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
  await userEvent.click(f.editor.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
  await warning(f.el);
  const closed = new Promise((resolve) =>
    f.editor.addEventListener("correction-cancel", resolve, { once: true }),
  );
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  await closed;
  await vi.waitFor(() =>
    expect(f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")).toBeNull(),
  );
  expect(f.el.shadowRoot!.querySelector("till-attendance-questions")).not.toBeNull();
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
});

it("an idle lock forcibly clears the attendance draft and retires its pending discard", async () => {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { fire: () => void; ms: number }>();
  const activity = new SessionActivity({
    now: () => now,
    setTimer: (fire, ms) => {
      const id = ++next;
      timers.set(id, { fire, ms });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    wakeLock: { request: async () => ({ released: false, release: async () => {} }) },
  });
  const f = await edit({ timeoutSeconds: 60, props: { sessionActivity: activity } });
  await userEvent.keyboard("{Escape}");
  const q = await warning(f.el);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  const save = f.editor.shadowRoot!.querySelector<HTMLElement>("[data-save]")!;
  expect([...timers.values()][0]!.ms).toBe(60_000);
  now = 60_000;
  [...timers.values()][0]!.fire();
  await vi.waitFor(() => expect(f.el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  expect(f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")).toBeNull();
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  save.click();
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
  f.api.getAttendanceInbox.mockResolvedValue({ ...attendanceInbox([]), personId: "p2" });
  await signIn(f.el, "p2");
  const clock = f.el.shadowRoot!.querySelector("till-clock-in-screen");
  await vi.waitFor(() =>
    expect(f.el.shadowRoot!.querySelector("till-clock-in-screen")).not.toBeNull(),
  );
  expect(f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")).toBeNull();
  expect(clock?.textContent ?? "").not.toContain("Closed after the delivery");
});

it("a live locale change retains the real editor's draft and form scope", async () => {
  const f = await edit();
  setLocale("es-ES");
  await f.el.updateComplete;
  await f.editor.updateComplete;
  expect(f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")).toBe(f.editor);
  expect(f.input.value).toBe("Closed after the delivery");
  expect(f.editor.shadowRoot!.querySelector("wt-textarea")!.label).toBe("Motivo");
  await userEvent.click(f.editor.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
  expect((await warning(f.el)).open).toBe(true);
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
});
