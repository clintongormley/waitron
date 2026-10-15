import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./party-guests-dialog.js";
import type { PartyGuestsDetail, TillPartyGuestsDialog } from "./party-guests-dialog.js";

class PartyGuestsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  value = "2";
  savedValue = "2";
  refusal = "";
  closes = 0;
  submitted: PartyGuestsDetail[] = [];
  override render() {
    return html`<till-party-guests-dialog
        tables="Jo"
        .value=${this.value}
        .savedValue=${this.savedValue}
        .refusal=${this.refusal}
        @party-guests-cancel=${() => this.closes++}
        @party-guests-confirm=${(event: CustomEvent<PartyGuestsDetail>) => this.submitted.push(event.detail)}
      ></till-party-guests-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("party-guests-leave-test-app", PartyGuestsLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(props: Partial<PartyGuestsLeaveApp> = {}) {
  const { el: app } = await mountWidget<PartyGuestsLeaveApp>("party-guests-leave-test-app", props);
  const form = app.shadowRoot!.querySelector("till-party-guests-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillPartyGuestsDialog, value: string) {
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function cancel(form: TillPartyGuestsDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-guests-cancel]")!.click();
}
async function question(app: PartyGuestsLeaveApp) {
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
  it(`party guests ${action} keeps the typed count, then discards without sending`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "4");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.submitted).toEqual([]);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("4");
    if (action === "Escape")
      expect(
        input.getRootNode() instanceof ShadowRoot &&
          (input.getRootNode() as ShadowRoot).activeElement,
      ).toBe(input);
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    expect(input.value).toBe("2");
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("a count typed back to the stored one, however spelled, closes without a warning", async () => {
  const { app, form } = await mount();
  await fill(form, "4");
  expect(unload()).toBe(true);
  await fill(form, " 02 ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
it("an invalid count remains protected after validation refuses it", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "0");
  form.shadowRoot!.querySelector<HTMLElement>("[data-guests-save]")!.click();
  await form.updateComplete;
  expect(app.submitted).toEqual([]);
  expect(form.shadowRoot!.querySelector("wt-input")!.error).toBe(t("seat.guest_count_invalid"));
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("0");
  expect(app.submitted).toEqual([]);
});
it("submitting sends the count directly and commits it without a discard question", async () => {
  const { app, form } = await mount();
  await fill(form, " 4 ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-guests-save]")!.click();
  expect(app.submitted).toEqual([{ guestCount: 4 }]);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(false);
  await fill(form, "04");
  expect(unload()).toBe(false);
  await fill(form, "5");
  expect(unload()).toBe(true);
});
it("disconnect aborts a party-guests leave decision; reconnect retains the original baseline", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "4");
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
  expect(input.value).toBe("4");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("retained departed party-guests controls cannot submit, cancel or replace the draft", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "4");
  const submit = form.shadowRoot!.querySelector<HTMLElement>("[data-guests-save]")!;
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
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("4");
  expect(unload()).toBe(true);
});
it("a parent rerender does not reset the typed count or pending warning", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "4");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.tables = "4, 5";
  form.refusal = "Count refused";
  await form.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("4");
  expect(unload()).toBe(true);
});
it("a party-guests submission invalidates a pending Discard and reconnect keeps the accepted baseline", async () => {
  const { app, form } = await mount();
  await fill(form, "4");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.shadowRoot!.querySelector<HTMLElement>("[data-guests-save]")!.click();
  expect(app.submitted).toEqual([{ guestCount: 4 }]);
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
  form.remove();
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(unload()).toBe(false);
  await fill(form, "5");
  expect(unload()).toBe(true);
  await fill(form, " 4 ");
  expect(unload()).toBe(false);
});
it("a refused submitted count starts dirty against the stored count", async () => {
  const { app, form } = await mount({ value: "4", savedValue: "2", refusal: "Count refused" });
  expect(form.shadowRoot!.querySelector("wt-input")!.error).toBe("Count refused");
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(form.value).toBe("4");
  await fill(form, " 2 ");
  expect(unload()).toBe(false);
});
