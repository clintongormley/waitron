import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { leaveCoordinatorFor, type WtButton } from "@waitron/ui";
import { clockApp } from "../test/clock-app.js";
import { reportOf, openStrip, editReport, closed, preview, data } from "../test/problem-report.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale(locale);
});

it("Escape Keep retains the report; Discard closes only its draft and leaves another edit alone", async () => {
  const { el } = await clockApp();
  const dialog = await openStrip(el);
  const leave = leaveCoordinatorFor(reportOf(el))!;
  let title = "Saved title";
  const other = leave.register({
    id: {},
    current: () => title,
    snapshot: (value) => value,
    equal: (a, b) => a === b,
    restore: (value) => {
      title = value;
    },
  });
  other.commit(title);
  title = "Unfinished title";
  other.changed();
  await editReport(dialog, "The screen stopped responding.");
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => question.open).toBe(true);
  await userEvent.click(question.shadowRoot!.querySelector<WtButton>("[data-choice=keep]")!);
  await expect.poll(() => question.open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(dialog.description).toBe("The screen stopped responding.");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => question.open).toBe(true);
  const didClose = closed(dialog);
  await userEvent.click(question.shadowRoot!.querySelector<WtButton>("[data-choice=discard]")!);
  await didClose;
  expect(dialog.open).toBe(false);
  expect(other.isDirty()).toBe(true);
  expect(title).toBe("Unfinished title");
});

it("Cancel discards the report without asking; disconnect disposes its draft and reconnect starts fresh", async () => {
  const { el } = await clockApp();
  const dialog = await openStrip(el);
  const report = reportOf(el);
  const leave = leaveCoordinatorFor(report)!;
  await editReport(dialog, "The screen stopped responding.");
  expect(leave.isDirty()).toBe(true);
  const didClose = closed(dialog);
  await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>('[slot="cancel"]')!);
  await didClose;
  expect(leave.isDirty()).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  const next = await openStrip(el);
  const previous = data(preview(next)).id;
  await editReport(next, "Another problem.");
  report.remove();
  expect(leave.isDirty()).toBe(false);
  el.shadowRoot!.querySelector(".app")!.append(report);
  const reopened = await openStrip(el);
  expect(reopened.description).toBe("");
  expect(data(preview(reopened)).id).not.toBe(previous);
});
