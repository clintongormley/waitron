import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { Shift } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./shift-dialog.js";

const shift: Shift = {
  id: "s1",
  personId: "p1",
  locationId: "loc-1",
  rosterVersionId: "v1",
  startsAt: "2027-01-04T07:00:00Z",
  startsOffsetMinutes: 120,
  endsAt: "2027-01-04T15:00:00Z",
  endsOffsetMinutes: 120,
  role: "bar",
};
class ShiftLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  shift: Shift | null = shift;
  busy = false;
  closes = 0;
  override render() {
    return html`<dashboard-shift-dialog
        .open=${true}
        day="2027-01-04"
        personId="p1"
        .shift=${this.shift}
        .busy=${this.busy}
        @wt-close=${() => this.closes++}
      ></dashboard-shift-dialog
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("shift-leave-test-app", ShiftLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(add = false) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<ShiftLeaveApp>("shift-leave-test-app", {
    shift: add ? null : shift,
  });
  const form = app.shadowRoot!.querySelector("dashboard-shift-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function edit(
  form: HTMLElementTagNameMap["dashboard-shift-dialog"],
  name: string,
  value: string,
) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[data-test=shift-${name}]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
  return field.shadowRoot!.querySelector("input")!;
}
async function question(app: ShiftLeaveApp) {
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
for (const add of [false, true]) {
  it(`${add ? "Add" : "Edit"} shift Escape keeps the edited value and focus, then discards once`, async () => {
    const { app, form } = await mount(add);
    const input = await edit(form, "role", "kitchen");
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("kitchen");
    expect(
      input.getRootNode() instanceof ShadowRoot &&
        (input.getRootNode() as ShadowRoot).activeElement,
    ).toBe(input);
    await userEvent.keyboard("{Escape}");
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
    await expect.poll(() => app.closes).toBe(1);
    await closeReportsDelivered();
    expect(app.closes).toBe(1);
    expect(form.open).toBe(false);
    expect(unload()).toBe(false);
  });
}
for (const [name, changed, original] of [
  ["start", "00:30", "09:00"],
  ["end", "19:00", "17:00"],
  ["role", "kitchen", " bar "],
] as const) {
  it(`shift ${name} edits warn, and a submitted-value revert clears the warning`, async () => {
    const { app, form } = await mount();
    await edit(form, name, changed);
    expect(unload()).toBe(true);
    await edit(form, name, original);
    expect(unload()).toBe(false);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => app.closes).toBe(1);
    expect((await question(app)).open).toBe(false);
  });
}
it("a same-shift refresh retains the draft; replacing its identity cancels the old question", async () => {
  const { app, form } = await mount();
  await edit(form, "role", "kitchen");
  app.shift = { ...shift, role: "Server update" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=shift-role]")!
      .value,
  ).toBe("kitchen");
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  app.shift = { ...shift, id: "s2", role: "terrace" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  expect(form.open).toBe(true);
  expect(app.closes).toBe(0);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=shift-role]")!
      .value,
  ).toBe("terrace");
  expect(unload()).toBe(false);
});

it("a same-shift refresh cannot change the time offsets of the entered draft", async () => {
  const { app, form } = await mount();
  await edit(form, "start", "00:30");
  app.shift = { ...shift, startsOffsetMinutes: 60, endsOffsetMinutes: 60 };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  let submitted: unknown;
  form.addEventListener("update-shift", (event) => {
    submitted = (event as CustomEvent).detail;
  });
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(submitted).toEqual({
    shiftId: "s1",
    patch: {
      startsAt: "2027-01-03T22:30:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2027-01-04T15:00:00Z",
      endsOffsetMinutes: 120,
      role: "bar",
    },
  });
});
it("a shift write in flight disables fields and refuses Escape without a question", async () => {
  const { app, form } = await mount();
  await edit(form, "role", "kitchen");
  app.busy = true;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  const field =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=shift-role]")!;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector("input")!.disabled).toBe(true);
  await userEvent.keyboard("{Escape}{Escape}");
  await closeReportsDelivered();
  expect(
    form.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!.querySelector("dialog")!.open,
  ).toBe(true);
  expect(app.closes).toBe(0);
  expect((await question(app)).open).toBe(false);
});

it("a completed shift save commits its submitted values and retains a newer draft", async () => {
  const { app, form } = await mount();
  await edit(form, "role", "kitchen");
  let submitted: unknown;
  form.addEventListener("update-shift", (event) => {
    submitted = (event as CustomEvent).detail;
  });
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(submitted).toEqual({
    shiftId: "s1",
    patch: {
      startsAt: "2027-01-04T07:00:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2027-01-04T15:00:00Z",
      endsOffsetMinutes: 120,
      role: "kitchen",
    },
  });
  const completeWrite = form.writeCompletion();
  await edit(form, "role", "terrace");
  expect(completeWrite()).toBe(false);
  expect(form.open).toBe(true);
  expect(unload()).toBe(true);
  await edit(form, "role", " kitchen ");
  expect(unload()).toBe(false);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});

it("a completed shift save cancels a pending discard question", async () => {
  const { app, form } = await mount();
  await edit(form, "role", "kitchen");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  const completeWrite = form.writeCompletion();
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(completeWrite()).toBe(true);
  await expect.poll(() => q.open).toBe(false);
  await closeReportsDelivered();
  expect(app.closes).toBe(1);
  expect(form.open).toBe(false);
  expect(unload()).toBe(false);
});
