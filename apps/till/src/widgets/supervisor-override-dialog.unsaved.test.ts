import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./supervisor-override-dialog.js";
import type {
  OverrideConfirmDetail,
  TillSupervisorOverrideDialog,
} from "./supervisor-override-dialog.js";

class ProofLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  cancelled = 0;
  submitted: OverrideConfirmDetail[] = [];
  override render() {
    return html`<till-supervisor-override-dialog
        .authorizers=${[{ personId: "manager-1", displayName: "Ana" }]}
        @override-cancel=${() => this.cancelled++}
        @override-confirm=${(event: CustomEvent<OverrideConfirmDetail>) => this.submitted.push(event.detail)}
      ></till-supervisor-override-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("proof-leave-test-app", ProofLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<ProofLeaveApp>("proof-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-supervisor-override-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
function button(form: TillSupervisorOverrideDialog, selector: string) {
  return form.shadowRoot!.querySelector<HTMLElement>(selector)!;
}
function pad(form: TillSupervisorOverrideDialog) {
  return form.shadowRoot!.querySelector("till-numeric-pad")!;
}
async function pick(form: TillSupervisorOverrideDialog) {
  button(form, "[data-person]").click();
  await form.updateComplete;
  await pad(form).updateComplete;
}
async function key(form: TillSupervisorOverrideDialog, value: string) {
  pad(form).shadowRoot!.querySelector<HTMLElement>(`[data-key="${value}"]`)!.click();
  await form.updateComplete;
  await pad(form).updateComplete;
}
async function question(app: ProofLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function answer(app: ProofLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

for (const action of ["Back", "Escape"] as const) {
  it(`PIN ${action} keeps unsubmitted digits, then discards only the proof once`, async () => {
    const { app, form } = await mount();
    await pick(form);
    await key(form, "0");
    await key(form, "1");
    if (action === "Back") button(form, ".back").click();
    else await userEvent.keyboard("{Escape}");
    expect((await question(app)).open).toBe(true);
    expect(pad(form).value).toBe("01");
    expect(app.cancelled).toBe(0);
    expect(app.submitted).toEqual([]);
    await answer(app, "keep");
    expect(pad(form).value).toBe("01");
    expect(unload()).toBe(true);
    if (action === "Back") button(form, ".back").click();
    else await userEvent.keyboard("{Escape}");
    await answer(app, "discard");
    if (action === "Back") {
      await expect.poll(() => form.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
      expect(app.cancelled).toBe(0);
      await pick(form);
      expect(pad(form).value).toBe("");
    } else {
      await expect.poll(() => app.cancelled).toBe(1);
      expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    }
    expect(unload()).toBe(false);
    expect(app.submitted).toEqual([]);
  });
}
it("selecting an authorizer without typing is exempt, and deleting all digits reverts", async () => {
  const { app, form } = await mount();
  await pick(form);
  expect(unload()).toBe(false);
  button(form, ".back").click();
  await expect.poll(() => form.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
  expect((await question(app)).open).toBe(false);
  await pick(form);
  await key(form, "0");
  expect(unload()).toBe(true);
  await key(form, "backspace");
  expect(unload()).toBe(false);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("Authorize sends exact leading-zero proof once and clears the warning without asking", async () => {
  const { app, form } = await mount();
  await pick(form);
  await key(form, "0");
  await key(form, "1");
  expect(unload()).toBe(true);
  button(form, ".authorize").click();
  await form.updateComplete;
  expect(app.submitted).toEqual([{ personId: "manager-1", pin: "01" }]);
  expect(pad(form).value).toBe("");
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
  form.error = "pin.invalid";
  await form.updateComplete;
  await key(form, "2");
  button(form, ".back").click();
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  expect(pad(form).value).toBe("2");
  expect(app.submitted).toEqual([{ personId: "manager-1", pin: "01" }]);
});
it("a refusal or roster refresh cannot clear unsubmitted digits or a pending question", async () => {
  const { app, form } = await mount();
  await pick(form);
  await key(form, "3");
  button(form, ".back").click();
  expect((await question(app)).open).toBe(true);
  form.error = "pin.throttled";
  form.authorizers = [{ personId: "manager-1", displayName: "Ana refreshed" }];
  await form.updateComplete;
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  expect(pad(form).value).toBe("3");
  expect(unload()).toBe(true);
  expect(app.submitted).toEqual([]);
});
it("Authorize invalidates an outstanding Back answer before clearing the proof", async () => {
  const { app, form } = await mount();
  await pick(form);
  await key(form, "4");
  button(form, ".back").click();
  const q = await question(app);
  expect(q.open).toBe(true);
  const staleDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  button(form, ".authorize").click();
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  staleDiscard.click();
  await app.updateComplete;
  expect(pad(form).value).toBe("");
  expect(app.submitted).toEqual([{ personId: "manager-1", pin: "4" }]);
  expect(app.cancelled).toBe(0);
  expect(unload()).toBe(false);
});
it("disconnect clears sensitive digits and unregisters proof; departed controls cannot submit", async () => {
  const { app, form } = await mount();
  await pick(form);
  await key(form, "5");
  expect(unload()).toBe(true);
  const oldAuthorize = button(form, ".authorize");
  const oldBack = button(form, ".back");
  form.remove();
  oldAuthorize.click();
  oldBack.click();
  expect(app.submitted).toEqual([]);
  expect(app.cancelled).toBe(0);
  expect(unload()).toBe(false);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(pad(form).value).toBe("");
  await key(form, "6");
  expect(unload()).toBe(true);
});
it("forced reset makes an old discard inert while the owner is removed", async () => {
  const { app, form } = await mount();
  await pick(form);
  await key(form, "7");
  button(form, ".back").click();
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  app.leave.forceReset();
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  oldDiscard.click();
  expect(app.submitted).toEqual([]);
  expect(app.cancelled).toBe(0);
  expect(unload()).toBe(false);
});
it("the clean picker Cancel reports once without asking or submitting", async () => {
  const { app, form } = await mount();
  button(form, ".cancel").click();
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
  expect(unload()).toBe(false);
});
it("Keep restores keypad focus, and repeated Escape cannot cancel or submit the proof", async () => {
  const { app, form } = await mount();
  await pick(form);
  const digit = pad(form)
    .shadowRoot!.querySelector("[data-key='8']")!
    .shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(digit));
  await form.updateComplete;
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => q.open).toBe(false);
  expect(pad(form).value).toBe("8");
  expect(
    digit.getRootNode() instanceof ShadowRoot && (digit.getRootNode() as ShadowRoot).activeElement,
  ).toBe(digit);
  expect(app.cancelled).toBe(0);
  expect(app.submitted).toEqual([]);
});
it("disconnect aborts Back; reconnect starts with an empty proof and old answers stay inert", async () => {
  const { app, form } = await mount();
  await pick(form);
  await key(form, "9");
  button(form, ".back").click();
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(pad(form).value).toBe("");
  await key(form, "1");
  oldDiscard.click();
  await app.updateComplete;
  expect(pad(form).value).toBe("1");
  expect(unload()).toBe(true);
  expect(app.cancelled).toBe(0);
  expect(app.submitted).toEqual([]);
});
it("departed keypad events cannot seed a proof on reconnect", async () => {
  const { app, form } = await mount();
  await pick(form);
  const oldPad = pad(form);
  form.remove();
  oldPad.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "88" },
      bubbles: true,
      composed: true,
    }),
  );
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(pad(form).value).toBe("");
  expect(unload()).toBe(false);
  expect(app.submitted).toEqual([]);
});
it("discarding proof leaves its independent action draft dirty", async () => {
  const { app, form } = await mount();
  let note = "stored";
  const scope = app.leave.coordinator.register({
    id: app,
    current: () => note,
    snapshot: (value) => value,
    equal: (a, b) => a === b,
    restore: (value) => {
      note = value;
    },
  });
  note = "edited";
  scope.changed();
  await pick(form);
  await key(form, "1");
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  await answer(app, "discard");
  await expect.poll(() => app.cancelled).toBe(1);
  expect(note).toBe("edited");
  expect(unload()).toBe(true);
  expect(app.submitted).toEqual([]);
  scope.dispose();
  expect(unload()).toBe(false);
});
