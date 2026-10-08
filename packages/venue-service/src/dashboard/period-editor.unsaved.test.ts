import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { PeriodEditor } from "./period-editor.js";
import "./period-editor.js";

class PeriodLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<period-editor
        .open=${true}
        departmentName="Restaurant"
        .menus=${[{ id: "lunch", name: "Lunch", active: true, includes: [] }]}
        .period=${{ id: "p1", name: "Lunch", colour: "blue", menuId: "lunch", staffMenuIds: [], endOffsetMinutes: -15, weekdays: [1] }}
      ></period-editor
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("period-leave-test-app", PeriodLeaveApp);
let app: PeriodLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  app = document.createElement("period-leave-test-app") as PeriodLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<PeriodEditor>("period-editor")!;
  await el.updateComplete;
  return el;
}
function name(el: PeriodEditor) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]");
  expect(field).not.toBeNull();
  return field!;
}
async function change(el: PeriodEditor, value: string) {
  name(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function modal(el: PeriodEditor) {
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal");
  expect(modal).not.toBeNull();
  return modal!;
}
function save(el: PeriodEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-period]",
  )!;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await q.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
async function reconnect(el: PeriodEditor) {
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  expect(unload()).toBe(false);
  parent.appendChild(el);
  await el.updateComplete;
}

it("asks before closing a changed period and Keep preserves the editor", async () => {
  const el = await mount();
  expect(unload()).toBe(false);
  await change(el, "Dinner");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(el.open).toBe(true);
  expect(name(el).value).toBe("Dinner");
  const discard = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await expect.poll(() => el.open).toBe(false);
  expect(unload()).toBe(false);
});

it("restoring the opened values makes Save quiet and closes without asking", async () => {
  const el = await mount();
  await change(el, "Dinner");
  await change(el, "Lunch");
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("asks for an edit made after removal and reconnect", async () => {
  const el = await mount();
  await reconnect(el);
  await change(el, "Dinner");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("retains an edit made before removal and still compares it to the opened values", async () => {
  const el = await mount();
  await change(el, "Dinner");
  await reconnect(el);
  expect(name(el).value).toBe("Dinner");
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("a saved submission becomes the baseline without losing edits made while it was saving", async () => {
  const el = await mount();
  await change(el, "Dinner");
  save(el).click();
  await change(el, "Evening");
  expect(
    el.commitSubmitted({ name: "Dinner", colour: "blue", menuId: "lunch", staffMenuIds: [] }),
  ).toBe(false);
  expect(name(el).value).toBe("Evening");
  expect(unload()).toBe(true);
  await reconnect(el);
  await change(el, "Dinner");
  expect(unload()).toBe(false);
  expect(save(el).disabled).toBe(true);
});

it("a submission that began before removal cannot commit after reconnect", async () => {
  const el = await mount();
  await change(el, "Dinner");
  save(el).click();
  await reconnect(el);
  expect(
    el.commitSubmitted({ name: "Dinner", colour: "blue", menuId: "lunch", staffMenuIds: [] }),
  ).toBe(false);
  expect(unload()).toBe(true);
  expect(save(el).disabled).toBe(false);
});

it("changing the draft cancels a pending discard answer", async () => {
  const el = await mount();
  await change(el, "Dinner");
  const close = modal(el).requestClose("cancel");
  expect((await question()).open).toBe(true);
  await change(el, "Evening");
  expect(await close).toBe(false);
  expect((await question()).open).toBe(false);
  expect(el.open).toBe(true);
  expect(unload()).toBe(true);
});

it("busy and disconnected editors refuse a retained close guard", async () => {
  const el = await mount();
  await change(el, "Dinner");
  const guard = modal(el).beforeClose!;
  el.busy = true;
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
  expect((await question()).open).toBe(false);
  el.busy = false;
  el.remove();
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
});

async function offset(el: PeriodEditor, value: string) {
  const control =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endOffsetMinutes]");
  expect(control).not.toBeNull();
  control!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  return control!;
}

it("offset-only edits protect navigation, survive Stay and reconnect, and Discard restores the saved value", async () => {
  const el = await mount();
  await offset(el, "14");
  expect(unload()).toBe(true);
  const stay = app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
  await choose("keep");
  expect(await stay).toBe("kept");
  await reconnect(el);
  const control =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endOffsetMinutes]")!;
  await control.updateComplete;
  expect(control.shadowRoot!.querySelector("input")!.value).toBe("14");
  const close = modal(el).requestClose("cancel");
  await choose("discard");
  expect(await close).toBe(true);
  el.open = true;
  await el.updateComplete;
  expect((await offset(el, "-0015")).value).toBe("-0015");
  expect(unload()).toBe(false);
  expect(save(el).disabled).toBe(true);
});

it("offset edits made during saving stay dirty against the submitted numeric baseline", async () => {
  const el = await mount();
  await offset(el, "14");
  save(el).click();
  await offset(el, "16");
  expect(
    el.commitSubmitted({
      name: "Lunch",
      colour: "blue",
      menuId: "lunch",
      staffMenuIds: [],
      endOffsetMinutes: 14,
    }),
  ).toBe(false);
  expect(unload()).toBe(true);
  await reconnect(el);
  await offset(el, "+014");
  expect(unload()).toBe(false);
  expect(save(el).disabled).toBe(true);
});
