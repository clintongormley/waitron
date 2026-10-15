import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { AttendanceCorrectionDialog } from "./attendance-correction-dialog.js";
import "./attendance-correction-dialog.js";

class AttendanceLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  saves: unknown[] = [];
  override render() {
    return html`<till-attendance-correction-dialog
        .open=${true}
        .initialChanges=${[{ target: { missingKind: "in" }, at: "", offsetMinutes: 0 }]}
        timeZone="Europe/Madrid"
        @correction-cancel=${() => this.closes++}
        @correction-save=${(event: CustomEvent) => this.saves.push(event.detail)}
      ></till-attendance-correction-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("attendance-leave-test-app", AttendanceLeaveApp);
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<AttendanceLeaveApp>("attendance-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<AttendanceCorrectionDialog>(
    "till-attendance-correction-dialog",
  )!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: AttendanceCorrectionDialog, value: string) {
  const field = form.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("textarea")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
async function warning(app: AttendanceLeaveApp) {
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  await question.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return question;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

for (const action of ["Cancel", "Escape"] as const) {
  it(`${action} protects an edited time response; Keep retains it and Discard closes without a response`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "Forgot to clock");
    expect(unload()).toBe(true);
    if (action === "Escape") await userEvent.keyboard("{Escape}");
    else await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    const question = await warning(app);
    expect(question.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.saves).toEqual([]);
    await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
    await expect.poll(() => question.open).toBe(false);
    expect(input.value).toBe("Forgot to clock");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    await warning(app);
    const closed = new Promise((resolve) =>
      form.addEventListener("correction-cancel", resolve, { once: true }),
    );
    await userEvent.click(
      question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!,
    );
    await closed;
    expect(app.closes).toBe(1);
    expect(app.saves).toEqual([]);
    expect(form.open).toBe(false);
    expect(unload()).toBe(false);
  });
}

it("navigation can keep the draft, and locale refresh leaves the draft and leave choice intact", async () => {
  const locale = currentLocale();
  try {
    const { app, form } = await mount();
    const input = await fill(form, "Forgot to clock");
    let proceeded = 0;
    const leaving = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed: () => {
        proceeded++;
      },
    });
    const question = await warning(app);
    expect(question.open).toBe(true);
    setLocale("es-ES");
    await form.updateComplete;
    expect(input.value).toBe("Forgot to clock");
    expect(form.shadowRoot!.querySelector("wt-textarea")!.label).toBe("Motivo");
    expect(question.open).toBe(true);
    await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
    expect(await leaving).toBe("kept");
    expect(proceeded).toBe(0);
    expect(unload()).toBe(true);
  } finally {
    setLocale(locale);
  }
});

it("disconnect retires a pending discard, reconnect retains the old baseline and departed controls cannot send", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "Forgot to clock");
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
  const question = await warning(app);
  expect(question.open).toBe(true);
  const discard = question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  const save = form.shadowRoot!.querySelector<HTMLElement>("[data-save]")!;
  form.remove();
  await expect.poll(() => question.open).toBe(false);
  discard.click();
  save.click();
  expect(app.closes).toBe(0);
  expect(app.saves).toEqual([]);
  expect(unload()).toBe(false);
  app.shadowRoot!.append(form);
  await form.updateComplete;
  expect(input.value).toBe("Forgot to clock");
  expect(unload()).toBe(true);
  await fill(form, "");
  expect(unload()).toBe(false);
});

it("forced close retires a pending decision and reopening starts a new blank response", async () => {
  const { app, form } = await mount();
  await fill(form, "Forgot to clock");
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
  const question = await warning(app);
  const discard = question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.open = false;
  await form.updateComplete;
  await expect.poll(() => question.open).toBe(false);
  form.open = true;
  await form.updateComplete;
  discard.click();
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  expect(form.open).toBe(true);
  expect(form.shadowRoot!.querySelector("wt-textarea")!.value).toBe("");
  expect(app.closes).toBe(0);
  expect(app.saves).toEqual([]);
  expect(unload()).toBe(false);
});
