import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { RangeDialog } from "./range-dialog.js";
import "./range-dialog.js";

class RangeLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<range-dialog
        .open=${true}
        .periods=${[{ id: "lunch", name: "Lunch" }]}
        .range=${{ startsAt: "09:00", endsAt: "10:00", periodId: "lunch" }}
      ></range-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("range-leave-test-app", RangeLeaveApp);
let app: RangeLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  app = document.createElement("range-leave-test-app") as RangeLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<RangeDialog>("range-dialog")!;
  await el.updateComplete;
  return el;
}
function endTime(el: RangeDialog) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endsAt]");
  expect(field).not.toBeNull();
  return field!;
}
async function change(el: RangeDialog, value: string) {
  endTime(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function modal(el: RangeDialog) {
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal");
  expect(modal).not.toBeNull();
  return modal!;
}
function save(el: RangeDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-range]",
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
async function reconnect(el: RangeDialog) {
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  expect(unload()).toBe(false);
  parent.appendChild(el);
  await el.updateComplete;
}

it("asks before closing a changed range and Keep preserves the editor", async () => {
  const el = await mount();
  expect(unload()).toBe(false);
  await change(el, "11:00");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(el.open).toBe(true);
  expect(endTime(el).value).toBe("11:00");
  const discard = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await expect.poll(() => el.open).toBe(false);
  expect(unload()).toBe(false);
});

it("restoring the opened values makes Save quiet and closes without asking", async () => {
  const el = await mount();
  await change(el, "11:00");
  await change(el, "10:00");
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("asks for an edit made after removal and reconnect", async () => {
  const el = await mount();
  await reconnect(el);
  await change(el, "11:00");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("retains an edit made before removal and still compares it to the opened values", async () => {
  const el = await mount();
  await change(el, "11:00");
  await reconnect(el);
  expect(endTime(el).value).toBe("11:00");
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("changing the draft cancels a pending discard answer", async () => {
  const el = await mount();
  await change(el, "11:00");
  const close = modal(el).requestClose("cancel");
  expect((await question()).open).toBe(true);
  await change(el, "12:00");
  expect(await close).toBe(false);
  expect((await question()).open).toBe(false);
  expect(el.open).toBe(true);
  expect(unload()).toBe(true);
});

it("busy and disconnected editors refuse a retained close guard", async () => {
  const el = await mount();
  await change(el, "11:00");
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
