import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillDeadEndsSection } from "./dead-ends-section.js";
import type { DeadEndAnswer } from "../api/client.js";
import "./dead-ends-dialog.js";
import type { DeadEndsDecision, TillDeadEndsDialog } from "./dead-ends-dialog.js";

const answer: DeadEndAnswer = {
  sends: true,
  deadEnds: [
    { key: "0", name: "Beer", quantity: "2", stationId: "bar", stationName: "Bar", why: "closed" },
    { key: "1", name: "Soup", quantity: "1", stationId: "bar", stationName: "Bar", why: "closed" },
  ],
  stations: [
    { id: "kitchen", name: "Kitchen", open: true },
    { id: "grill", name: "Grill", open: true },
  ],
};
class DeadEndsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  answer = answer;
  allowRemove = true;
  closes = 0;
  submitted: DeadEndsDecision[] = [];
  override render() {
    return html`<till-dead-ends-dialog
        .answer=${this.answer}
        .allowRemove=${this.allowRemove}
        @dead-ends-cancel=${() => this.closes++}
        @dead-ends-continue=${(event: CustomEvent<DeadEndsDecision>) => this.submitted.push(event.detail)}
      ></till-dead-ends-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("dead-ends-leave-test-app", DeadEndsLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(props: Partial<DeadEndsLeaveApp> = {}) {
  const { el: app, host } = await mountWidget<DeadEndsLeaveApp>("dead-ends-leave-test-app", props);
  const form = app.shadowRoot!.querySelector("till-dead-ends-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  await section(form).updateComplete;
  return { app, form, host };
}
function section(form: TillDeadEndsDialog) {
  return form.shadowRoot!.querySelector<TillDeadEndsSection>("till-dead-ends-section")!;
}
async function choose(form: TillDeadEndsDialog, key: string, station: string) {
  const field = section(form).shadowRoot!.querySelector(
    `[data-dead-end="${key}"] wt-combobox`,
  )! as HTMLElementTagNameMap["wt-combobox"];
  await field.updateComplete;
  field.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await field.updateComplete;
  const option = Array.from(
    field.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((option) => option.textContent?.trim() === station)!;
  await userEvent.click(page.elementLocator(option));
  await form.updateComplete;
  await section(form).updateComplete;
  return field;
}
async function remove(form: TillDeadEndsDialog, key: string) {
  section(form).shadowRoot!.querySelector<HTMLElement>(`[data-dead-end="${key}"] .remove`)!.click();
  await form.updateComplete;
  await section(form).updateComplete;
}
function cancel(form: TillDeadEndsDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
}
function submit(form: TillDeadEndsDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
}
async function question(app: DeadEndsLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const action of ["Cancel", "Escape"]) {
  it(`dead-end ${action} keeps destinations and removals, then discards without continuing`, async () => {
    const { app, form } = await mount();
    await choose(form, "0", "Kitchen");
    await remove(form, "1");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.submitted).toEqual([]);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(section(form).choices.get("0")).toBe("kitchen");
    expect(section(form).shadowRoot!.querySelector('[data-dead-end="1"]')).toBeNull();
    expect(unload()).toBe(true);
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    await form.updateComplete;
    await section(form).updateComplete;
    expect(section(form).choices.size).toBe(0);
    expect(section(form).shadowRoot!.querySelector('[data-dead-end="1"]')).not.toBeNull();
    expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("an unchanged dead-end dialog cancels without a warning", async () => {
  const { app, form } = await mount();
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
it("a reverted destination clears dirty protection while incomplete choices remain protected", async () => {
  const { app, form } = await mount();
  await choose(form, "0", "Kitchen");
  expect(unload()).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button[data-continue]")!
      .disabled,
  ).toBe(true);
  section(form).dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "" } }));
  await form.updateComplete;
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("Continue commits its local choices directly and invalidates an earlier discard answer", async () => {
  const { app, form } = await mount();
  await choose(form, "0", "Kitchen");
  await remove(form, "1");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  submit(form);
  await expect.poll(() => q.open).toBe(false);
  expect(app.submitted).toEqual([{ choices: { "0": "kitchen" }, removed: ["1"] }]);
  expect(unload()).toBe(false);
  oldDiscard.click();
  await app.updateComplete;
  expect(app.closes).toBe(0);
  expect(section(form).choices.get("0")).toBe("kitchen");
});
it("after Continue, reverting choices in a different insertion order stays clean", async () => {
  const { app, form } = await mount();
  await choose(form, "0", "Kitchen");
  await choose(form, "1", "Grill");
  submit(form);
  expect(app.submitted).toEqual([{ choices: { "0": "kitchen", "1": "grill" }, removed: [] }]);
  expect(unload()).toBe(false);
  section(form).dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "" } }));
  await form.updateComplete;
  expect(unload()).toBe(true);
  await choose(form, "0", "Kitchen");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("background answer updates preserve the draft and pending warning", async () => {
  const { app, form } = await mount();
  await choose(form, "0", "Kitchen");
  cancel(form);
  const q = await question(app);
  app.answer = { ...answer, stations: [...answer.stations].reverse() };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(q.open).toBe(true);
  expect(section(form).choices.get("0")).toBe("kitchen");
  expect(unload()).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(app.closes).toBe(0);
});
it("disconnection invalidates the warning and reconnect preserves the initial baseline", async () => {
  const { app, form } = await mount();
  await choose(form, "0", "Kitchen");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  expect(unload()).toBe(true);
  discard.click();
  await app.updateComplete;
  expect(app.closes).toBe(0);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("departed dialog controls cannot change, continue or close a replacement", async () => {
  const { app, form } = await mount();
  const oldSection = section(form);
  const departedEvents: string[] = [];
  form.addEventListener("dead-ends-continue", () => departedEvents.push("continue"));
  form.addEventListener("dead-ends-cancel", () => departedEvents.push("cancel"));
  const continueButton = form.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!;
  const cancelButton = form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!;
  form.remove();
  oldSection.dispatchEvent(
    new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }),
  );
  oldSection.dispatchEvent(new CustomEvent("remove", { detail: { key: "1" } }));
  continueButton.click();
  cancelButton.click();
  await form.updateComplete;
  expect(oldSection.choices.size).toBe(0);
  expect(oldSection.answer.deadEnds).toHaveLength(2);
  expect(departedEvents).toEqual([]);
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
});
it("stored-bill removal stays refused and its unchanged dialog remains exempt", async () => {
  const { app, form } = await mount({ allowRemove: false });
  section(form).dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
  await form.updateComplete;
  expect(section(form).answer.deadEnds).toHaveLength(2);
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
