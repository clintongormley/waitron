import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./party-name-dialog.js";
import type { PartyNameDetail, TillPartyNameDialog } from "./party-name-dialog.js";

class PartyNameLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  value = "Ana";
  savedValue = "Ana";
  refusal = "";
  closes = 0;
  submitted: PartyNameDetail[] = [];
  override render() {
    return html`<till-party-name-dialog
        tables="Jo"
        .value=${this.value}
        .savedValue=${this.savedValue}
        .refusal=${this.refusal}
        @party-name-cancel=${() => this.closes++}
        @party-name-confirm=${(event: CustomEvent<PartyNameDetail>) => this.submitted.push(event.detail)}
      ></till-party-name-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("party-name-leave-test-app", PartyNameLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(props: Partial<PartyNameLeaveApp> = {}) {
  const { el: app } = await mountWidget<PartyNameLeaveApp>("party-name-leave-test-app", props);
  const form = app.shadowRoot!.querySelector("till-party-name-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillPartyNameDialog, value: string) {
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function cancel(form: TillPartyNameDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!.click();
}
async function question(app: PartyNameLeaveApp) {
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
  it(`party name ${action} keeps the typed name, then discards without naming`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "Luis");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.submitted).toEqual([]);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("Luis");
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
    expect(input.value).toBe("Ana");
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("normalized reverted party names close without a warning", async () => {
  const { app, form } = await mount();
  await fill(form, "Luis");
  expect(unload()).toBe(true);
  await fill(form, "  Ana ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
it("invalid long names remain protected after validation refuses them", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "x".repeat(40));
  input.value = "x".repeat(41);
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-name-save]")!.click();
  await form.updateComplete;
  expect(app.submitted).toEqual([]);
  expect(form.shadowRoot!.querySelector("wt-input")!.error).toBe(t("table.name_too_long"));
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("x".repeat(41));
  expect(app.submitted).toEqual([]);
});
it("submitting names directly and commits the normalized name without a discard question", async () => {
  const { app, form } = await mount();
  await fill(form, "  Luis  ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-name-save]")!.click();
  expect(app.submitted).toEqual([{ name: "Luis" }]);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(false);
  await fill(form, " Luis ");
  expect(unload()).toBe(false);
  await fill(form, "Jo");
  expect(unload()).toBe(true);
});
it("disconnect aborts a party-name leave decision; reconnect retains the original name baseline", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "Luis");
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
  expect(input.value).toBe("Luis");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("retained departed party-name controls cannot submit, cancel or replace the draft", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "Luis");
  const submit = form.shadowRoot!.querySelector<HTMLElement>("[data-name-save]")!;
  form.remove();
  submit.click();
  cancel(form);
  input.value = "Bob";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("Luis");
  expect(unload()).toBe(true);
});
it("a parent rerender does not reset the typed party name or pending warning", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "Luis");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.tables = "4, 5";
  form.refusal = "Name refused";
  await form.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("Luis");
  expect(unload()).toBe(true);
});
it("a party-name submission invalidates a pending Discard and reconnect keeps the accepted name baseline", async () => {
  const { app, form } = await mount();
  await fill(form, "Luis");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.shadowRoot!.querySelector<HTMLElement>("[data-name-save]")!.click();
  expect(app.submitted).toEqual([{ name: "Luis" }]);
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
  form.remove();
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(unload()).toBe(false);
  await fill(form, "Jo");
  expect(unload()).toBe(true);
  await fill(form, "  Luis  ");
  expect(unload()).toBe(false);
});

it("a refused submitted name starts dirty against the stored party name", async () => {
  const { app, form } = await mount({ value: "Luis", savedValue: "Ana", refusal: "Name refused" });
  expect(form.shadowRoot!.querySelector("wt-input")!.error).toBe("Name refused");
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(form.value).toBe("Luis");
  await fill(form, " Ana ");
  expect(unload()).toBe(false);
});
