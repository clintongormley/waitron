import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog, type WtInput } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { ThemeNameKind, ThemeNameRequest } from "./theme-name-dialog.js";
import "./theme-name-dialog.js";

class ThemeNameLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<dashboard-theme-name-dialog></dashboard-theme-name-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("theme-name-leave-test-app", ThemeNameLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function fixture(kind: ThemeNameKind = "copy", name = "Christmas") {
  setLocale("en-GB");
  const submit = vi.fn<ThemeNameRequest["submit"]>(async () => {});
  const { el: app } = await mountWidget<ThemeNameLeaveApp>("theme-name-leave-test-app", {});
  const host = app.shadowRoot!.querySelector("dashboard-theme-name-dialog")!;
  host.show({ kind, name, inUse: false, warningLines: [], submit });
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  const input = dialog.querySelector<WtInput>("wt-input[name=name]")!;
  await input.updateComplete;
  return { app, host, dialog, input, submit };
}

async function question(app: ThemeNameLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

async function choose(app: ThemeNameLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}

const back = (dialog: WtDialog) =>
  dialog.querySelector<HTMLElement>("wt-button[data-test=name-back]")!;

async function typeMore(app: ThemeNameLeaveApp, input: WtInput, keys = "{End} 2") {
  input.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard(keys);
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
}

it("Back with a typed name asks, and Keep keeps it", async () => {
  const { app, dialog, input, submit } = await fixture();
  await typeMore(app, input);
  back(dialog).click();
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "keep");
  await expect.poll(async () => (await question(app)).open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(input.value).toBe("Christmas 2");
  expect(submit).not.toHaveBeenCalled();
});

it("Back with a typed name asks, and Discard closes with no request", async () => {
  const { app, dialog, input, submit } = await fixture();
  await typeMore(app, input);
  back(dialog).click();
  await expect.poll(async () => (await question(app)).open).toBe(true);
  const closed = dialogClosed(dialog);
  await choose(app, "discard");
  await closed;
  expect(dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it("Escape with a change asks", async () => {
  const { app, dialog, input, submit } = await fixture();
  await typeMore(app, input);
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});

it("an untouched Make a copy closes on Back without asking", async () => {
  const { app, dialog, submit } = await fixture();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const closed = dialogClosed(dialog);
  back(dialog).click();
  await closed;
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it("a typed-then-reverted name closes without asking", async () => {
  const { app, dialog, input } = await fixture();
  await typeMore(app, input);
  await userEvent.keyboard("{Backspace}{Backspace}");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(false);
  const closed = dialogClosed(dialog);
  back(dialog).click();
  await closed;
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("after a successful save nothing asks", async () => {
  const { app, host, dialog, input, submit } = await fixture("rename");
  await typeMore(app, input);
  const closed = dialogClosed(dialog);
  dialog.querySelector<HTMLElement>("wt-button[data-test=name-save]")!.click();
  await closed;
  await host.updateComplete;
  expect(submit).toHaveBeenCalledWith({ name: "Christmas 2", inUse: false });
  expect(dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
