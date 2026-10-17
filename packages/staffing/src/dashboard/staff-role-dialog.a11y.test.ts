import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StaffRole, StaffingApi } from "./client.js";
import type { StaffRoleDialog } from "./staff-role-dialog.js";
import "./staff-role-dialog.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const waiter: StaffRole = {
  id: "role-1",
  name: "Waiter",
  colour: "green",
  position: 0,
  holderIds: ["p-ana"],
};
const people = [
  { personId: "p-ana", displayName: "Ana", status: "active" },
  { personId: "p-marc", displayName: "Marc", status: "active" },
];

async function open(staffRole: StaffRole | undefined, listPeople: () => Promise<unknown>) {
  const el = document.createElement("staff-role-dialog") as StaffRoleDialog;
  el.api = {
    listPeople: vi.fn(listPeople),
    createStaffRole: vi.fn(),
    updateStaffRole: vi.fn(),
  } as unknown as StaffingApi;
  el.staffRole = staffRole;
  el.open = true;
  host.append(el);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  return el;
}
const save = (el: StaffRoleDialog) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-staff-role]")!;

const states: Record<string, () => Promise<void>> = {
  "a new staff role": async () => {
    await open(undefined, async () => people);
  },
  "an existing staff role": async () => {
    await open(waiter, async () => people);
  },
  "a blank name refused": async () => {
    const el = await open(undefined, async () => people);
    el.shadowRoot!.querySelector("[name=colour]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "purple" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    save(el).click();
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
    ).not.toBe("");
  },
  "the people could not be loaded": async () => {
    await open(waiter, () => Promise.reject({ code: "connection.failed" }));
  },
};

describe.each(["light", "dark"] as const)("Staff role dialog accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    await states[state]!();
    await expectNoA11yViolations(host);
  });
});
