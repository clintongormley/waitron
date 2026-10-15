import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./split-guests-dialog.js";
import type { SplitGuestsDetail, TillSplitGuestsDialog } from "./split-guests-dialog.js";

class SplitGuestsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  staying = "5";
  savedStaying = "5";
  leaving = "";
  closes = 0;
  submitted: SplitGuestsDetail[] = [];
  override render() {
    return html`<till-split-guests-dialog
        stayingLabel="Mesa 5"
        leavingLabel="Mesa 4"
        .staying=${this.staying}
        .savedStaying=${this.savedStaying}
        .leaving=${this.leaving}
        @split-guests-cancel=${() => this.closes++}
        @split-guests-confirm=${(event: CustomEvent<SplitGuestsDetail>) => this.submitted.push(event.detail)}
      ></till-split-guests-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("split-guests-leave-test-app", SplitGuestsLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<SplitGuestsLeaveApp>("split-guests-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-split-guests-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
type Side = "stayingGuests" | "leavingGuests";
const field = (form: TillSplitGuestsDialog, side: Side) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name=${side}]`)!;
async function fill(form: TillSplitGuestsDialog, side: Side, value: string) {
  const host = field(form, side);
  await host.updateComplete;
  const input = host.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function cancel(form: TillSplitGuestsDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-split-guests-cancel]")!.click();
}
function split(form: TillSplitGuestsDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-split-guests-confirm]")!.click();
}
async function question(app: SplitGuestsLeaveApp) {
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
it("opening and closing untouched asks nothing", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
for (const side of ["stayingGuests", "leavingGuests"] as const) {
  for (const action of ["Cancel", "Escape"]) {
    it(`split guests ${action} keeps a count typed in ${side}, then discards without splitting`, async () => {
      const { app, form } = await mount();
      const input = await fill(form, side, "3");
      if (action === "Cancel") cancel(form);
      else await userEvent.keyboard("{Escape}");
      const q = await question(app);
      expect(q.open).toBe(true);
      expect(app.closes).toBe(0);
      expect(app.submitted).toEqual([]);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await expect.poll(() => q.open).toBe(false);
      expect(input.value).toBe("3");
      cancel(form);
      await question(app);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => app.closes).toBe(1);
      expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
      expect(input.value).toBe(side === "stayingGuests" ? "5" : "");
      expect(app.submitted).toEqual([]);
      expect(unload()).toBe(false);
    });
  }
}
it("counts typed back to the opening ones, however spelled, close without a warning", async () => {
  const { app, form } = await mount();
  await fill(form, "stayingGuests", "3");
  await fill(form, "leavingGuests", "2");
  expect(unload()).toBe(true);
  await fill(form, "stayingGuests", " 05 ");
  expect(unload()).toBe(true);
  await fill(form, "leavingGuests", "  ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
it("an invalid count remains protected after validation refuses it", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "leavingGuests", "0");
  split(form);
  await form.updateComplete;
  expect(app.submitted).toEqual([]);
  expect(field(form, "leavingGuests").error).toBe(t("seat.guest_count_invalid"));
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("0");
  expect(app.submitted).toEqual([]);
});
it("splitting sends the counts and commits them without a discard question", async () => {
  const { app, form } = await mount();
  await fill(form, "stayingGuests", " 3 ");
  await fill(form, "leavingGuests", "2");
  split(form);
  expect(app.submitted).toEqual([{ staying: 3, leaving: 2 }]);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(false);
  await fill(form, "leavingGuests", "02");
  expect(unload()).toBe(false);
  await fill(form, "leavingGuests", "4");
  expect(unload()).toBe(true);
});
it("disconnect aborts a split-guests leave decision; reconnect retains the opening baseline", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "leavingGuests", "2");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(input.value).toBe("2");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("retained departed split-guests controls cannot split, cancel or replace the draft", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "leavingGuests", "2");
  const submit = form.shadowRoot!.querySelector<HTMLElement>("[data-split-guests-confirm]")!;
  form.remove();
  submit.click();
  cancel(form);
  input.value = "7";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(field(form, "leavingGuests").value).toBe("2");
  expect(unload()).toBe(true);
});
it("a parent rerender does not reset the typed counts or pending warning", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "leavingGuests", "2");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.stayingLabel = "Mesa 5, 6";
  form.leavingLabel = "Mesa 7";
  await form.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("2");
  expect(unload()).toBe(true);
});
it("a stored count changed elsewhere moves an untouched staying side with it, and leaves the window unsaved only for what was typed", async () => {
  const { app, form } = await mount();
  app.savedStaying = "6";
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(form.staying).toBe("6");
  expect(unload()).toBe(false);
  await fill(form, "leavingGuests", "2");
  app.savedStaying = "7";
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(form.staying).toBe("7");
  expect(unload()).toBe(true);
  await fill(form, "leavingGuests", "");
  expect(unload()).toBe(false);
});
it("a staying count typed before the stored one changes elsewhere stays, unsaved against the new stored count", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "stayingGuests", "3");
  app.savedStaying = "6";
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(input.value).toBe("3");
  expect(unload()).toBe(true);
  await fill(form, "stayingGuests", "6");
  expect(unload()).toBe(false);
});
