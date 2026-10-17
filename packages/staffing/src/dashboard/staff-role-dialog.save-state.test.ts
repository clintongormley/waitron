import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
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
  holderIds: [],
};
let el: StaffRoleDialog;
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  el?.remove();
  setLocale(locale);
});

async function mount(staffRole?: StaffRole) {
  const api = {
    listPeople: vi.fn(async () => [{ personId: "p-ana", displayName: "Ana", status: "active" }]),
    createStaffRole: vi.fn(),
    updateStaffRole: vi.fn(),
    setHolders: vi.fn(),
  };
  el = document.createElement("staff-role-dialog");
  el.api = api as unknown as StaffingApi;
  el.staffRole = staffRole;
  el.open = true;
  applyTokens(el);
  document.body.append(el);
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=people]")!.options,
    ).toHaveLength(1),
  );
  return api;
}
const box = (name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(`[name=${name}]`)!;
async function rename(value: string) {
  el.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function pick(value: string) {
  el.shadowRoot!.querySelector("wt-colour-chooser[name=colour]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function state(disabled: boolean, variant: string) {
  const button = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-staff-role]",
  )!;
  await button.updateComplete;
  expect(button.disabled).toBe(disabled);
  expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(disabled);
  expect(button.variant).toBe(variant);
}

it.each([false, true])(
  "opens quiet, enables on each field's edit and quiets on undo (edit=%s)",
  async (editing) => {
    await mount(editing ? waiter : undefined);
    await state(true, "secondary");
    await rename("Runner");
    await state(false, "primary");
    await rename(editing ? "Waiter" : "");
    await state(true, "secondary");
    const opened = editing ? "green" : "red";
    await pick("purple");
    await state(false, "primary");
    await pick(opened);
    await state(true, "secondary");
    await chooseOptions(box("people"), ["p-ana"]);
    await state(false, "primary");
    await chooseOptions(box("people"), []);
    await state(true, "secondary");
  },
);

it("an unchanged Save sends nothing, even clicked directly", async () => {
  const api = await mount(waiter);
  const saved = vi.fn();
  el.addEventListener("staff-role-saved", saved);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-staff-role]")!.click();
  await el.updateComplete;
  expect(saved).not.toHaveBeenCalled();
  expect(api.updateStaffRole).not.toHaveBeenCalled();
  expect(api.setHolders).not.toHaveBeenCalled();
  expect(el.open).toBe(true);
});
