import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { clockApp, clockState, signIn, shellAction, working } from "../test/clock-app.js";
import type { TillApp } from "./till-app.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  setLocale(locale);
});
async function edit() {
  const f = await clockApp({ state: clockState("working", "in") });
  await signIn(f.el);
  await working(f.el);
  await shellAction(f.el, "[data-my-hours]");
  const hours = () => f.el.shadowRoot!.querySelector("till-hours-screen");
  await vi.waitFor(() => expect(hours()?.view).not.toBeNull());
  await userEvent.click(
    hours()!.shadowRoot!.querySelector<HTMLElement>('[data-fix="2026-01-05"]')!,
  );
  const day = () => f.el.shadowRoot!.querySelector("till-attendance-day-dialog");
  await vi.waitFor(() => expect(day()?.view).not.toBeNull());
  await userEvent.click(day()!.shadowRoot!.querySelector<HTMLElement>('[data-add-pair="shift"]')!);
  const editor = f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")!;
  await editor.updateComplete;
  const field = editor.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("textarea")!;
  await userEvent.fill(page.elementLocator(input), "Forgot this shift");
  return { ...f, hours, day, editor, input };
}
async function warning(el: TillApp) {
  const warning = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await warning.updateComplete;
  await warning.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return warning;
}
it("native Escape from the Hours correction keeps the draft until an explicit discard", async () => {
  const f = await edit();
  await userEvent.keyboard("{Escape}");
  const q = await warning(f.el);
  expect(q.open).toBe(true);
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  await expect.poll(() => q.open).toBe(false);
  expect(f.input.value).toBe("Forgot this shift");
  expect(f.hours()).not.toBeNull();
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
  expect(f.hours()).not.toBeNull();
  expect(f.day()!.open).toBe(true);
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
});
it("locale changes preserve the existing correction draft while the Hours screen redraws", async () => {
  const f = await edit();
  setLocale("es-ES");
  await f.el.updateComplete;
  await f.editor.updateComplete;
  expect(f.input.value).toBe("Forgot this shift");
  expect(f.editor.shadowRoot!.querySelector("wt-textarea")!.label).toBe("Motivo");
  expect(f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")).toBe(f.editor);
  expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
});
