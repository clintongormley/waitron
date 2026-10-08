import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillKeepOpenDialog } from "./keep-open-dialog.js";
import "./keep-open-dialog.js";
class KeepOpenLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  confirmed: unknown[] = [];
  override render() {
    return html`<till-keep-open-dialog
        .period=${{ id: "lunch", name: "Lunch", endsAt: "14:00", running: true, extendedUntil: null, choices: ["14:15", "14:30", "05:00"], next: null }}
        @close=${() => this.closes++}
        @keep-open-confirm=${(e: CustomEvent) => this.confirmed.push(e.detail)}
      ></till-keep-open-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("keep-open-leave-test-app", KeepOpenLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<KeepOpenLeaveApp>("keep-open-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<TillKeepOpenDialog>("till-keep-open-dialog")!;
  await form.updateComplete;
  expect(form.shadowRoot).not.toBeNull();
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choose(form: TillKeepOpenDialog, value: string) {
  const f = form.shadowRoot!.querySelector("wt-combobox")!;
  if (value === "") {
    f.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    await form.updateComplete;
    return;
  }
  f.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await f.updateComplete;
  f.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[
    f.options.findIndex((o) => o.value === value)
  ]!.click();
  await form.updateComplete;
}
async function question(app: KeepOpenLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: TillKeepOpenDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
}
it.each(["Cancel", "Escape"])(
  "an edited %s asks to keep or discard without submitting",
  async (action) => {
    const { app, form } = await mount();
    await choose(form, "14:30");
    expect(unload()).toBe(true);
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(form.shadowRoot!.querySelector("wt-combobox")!.value).toBe("14:30");
    expect(app.closes).toBe(0);
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(app.confirmed).toEqual([]);
    expect(unload()).toBe(false);
  },
);
it("clean and reverted selections close without a warning", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  await choose(form, "14:30");
  await choose(form, "");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("a reconnect retains the opening baseline; departed presses cannot change or submit it", async () => {
  const { app, form } = await mount();
  await choose(form, "14:30");
  const field = form.shadowRoot!.querySelector("wt-combobox")!;
  form.remove();
  expect(unload()).toBe(false);
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  form.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  cancel(form);
  expect(app.confirmed).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  expect(field.value).toBe("14:30");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("successful commit invalidates an old discard and retains an independent parent draft", async () => {
  const { app, form } = await mount();
  let value = "saved";
  const scope = app.leave.coordinator.register({
    id: app,
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => (value = v),
  });
  value = "edited";
  scope.changed();
  await choose(form, "14:30");
  cancel(form);
  const q = await question(app);
  const old = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.commit();
  await expect.poll(() => q.open).toBe(false);
  old.click();
  expect(app.closes).toBe(0);
  expect(value).toBe("edited");
  expect(unload()).toBe(true);
  scope.dispose();
  expect(unload()).toBe(false);
});
it("a request refusal keeps the chosen draft protected and refreshing choices does not reset it", async () => {
  const { app, form } = await mount();
  await choose(form, "14:30");
  form.refusal = "period_extension.invalid";
  form.period = { ...form.period!, choices: ["14:15", "14:30", "19:00", "05:00"] };
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-combobox")!.value).toBe("14:30");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
