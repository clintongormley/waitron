import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import type { StaffRole, StaffingApi } from "./client.js";
import type { StaffRoleDialog } from "./staff-role-dialog.js";
import "./staff-role-dialog.js";

const waiter: StaffRole = {
  id: "role-1",
  name: "Waiter",
  colour: "green",
  position: 0,
  holderIds: ["p-ana"],
  blockCount: 0,
  shiftCount: 0,
};
const api = {
  listPeople: vi.fn(async () => [
    { personId: "p-ana", displayName: "Ana", status: "active" },
    { personId: "p-marc", displayName: "Marc", status: "active" },
  ]),
} as unknown as StaffingApi;

class StaffRoleLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<staff-role-dialog
        .open=${true}
        .api=${api}
        .staffRole=${waiter}
      ></staff-role-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("staff-role-leave-test-app", StaffRoleLeaveApp);
let app: StaffRoleLeaveApp;
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  app?.remove();
  setLocale(locale);
});
async function mount() {
  app = document.createElement("staff-role-leave-test-app") as StaffRoleLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<StaffRoleDialog>("staff-role-dialog")!;
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=people]")!.options,
    ).toHaveLength(2),
  );
  return el;
}
async function rename(el: StaffRoleDialog, value: string) {
  el.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
const people = (el: StaffRoleDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=people]")!;
const modal = (el: StaffRoleDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
const save = (el: StaffRoleDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-staff-role]")!;
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  const q =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}

it("asks before closing a changed staff role, and Keep preserves the editor", async () => {
  const el = await mount();
  expect(unload()).toBe(false);
  await chooseOptions(people(el), ["p-ana", "p-marc"]);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(el.open).toBe(true);
  expect(people(el).values).toEqual(["p-ana", "p-marc"]);
  const discard = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await expect.poll(() => el.open).toBe(false);
  expect(unload()).toBe(false);
});

it("restoring the opened values makes Save quiet and closes without asking", async () => {
  const el = await mount();
  await rename(el, "Runner");
  await chooseOptions(people(el), ["p-marc", "p-ana"]);
  expect(save(el).variant).toBe("primary");
  await rename(el, "Waiter");
  await chooseOptions(people(el), ["p-ana"]);
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("counts people chosen in another order as unchanged", async () => {
  const el = await mount();
  await chooseOptions(people(el), ["p-marc", "p-ana"]);
  await chooseOptions(people(el), ["p-ana"]);
  expect(save(el).disabled).toBe(true);
});

it("keeps an edit made before the dialog is taken out and put back", async () => {
  const el = await mount();
  await rename(el, "Runner");
  const parent = el.parentNode!;
  el.remove();
  parent.appendChild(el);
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Runner");
  expect(save(el).disabled).toBe(false);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("discard");
  expect(await close).toBe(true);
});
