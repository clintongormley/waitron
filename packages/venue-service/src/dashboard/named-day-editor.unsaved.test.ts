import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { NamedDayEditor } from "./named-day-editor.js";
import "./named-day-editor.js";

class NamedDayLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<named-day-editor
        .open=${true}
        .day=${{ id: "d1", date: "2027-03-01", name: "Lunch", kind: "working_day", repeats: false, ownHours: false, closeWholeVenue: false }}
      ></named-day-editor
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("named-day-leave-test-app", NamedDayLeaveApp);
let app: NamedDayLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  app = document.createElement("named-day-leave-test-app") as NamedDayLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<NamedDayEditor>("named-day-editor")!;
  await el.updateComplete;
  return el;
}
function name(el: NamedDayEditor) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]");
  expect(field).not.toBeNull();
  return field!;
}
async function change(el: NamedDayEditor, value: string) {
  name(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function modal(el: NamedDayEditor) {
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal");
  expect(modal).not.toBeNull();
  return modal!;
}
function save(el: NamedDayEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-named-day]",
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
async function reconnect(el: NamedDayEditor) {
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  expect(unload()).toBe(false);
  parent.appendChild(el);
  await el.updateComplete;
}

it("asks before closing a changed named day and Keep preserves the editor", async () => {
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
    el.commitSubmitted({
      date: "2027-03-01",
      name: "Dinner",
      kind: "working_day",
      repeats: false,
      ownHours: false,
      closeWholeVenue: false,
    }),
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
    el.commitSubmitted({
      date: "2027-03-01",
      name: "Dinner",
      kind: "working_day",
      repeats: false,
      ownHours: false,
      closeWholeVenue: false,
    }),
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
