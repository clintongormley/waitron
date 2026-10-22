import { afterEach, expect, it, vi } from "vitest";
import type { WtInput } from "@waitron/ui";
import type { DashboardApi, PersonSummary } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { PersonEdit } from "../widgets/person-edit.js";
import type { StaffList } from "../widgets/staff-list.js";
import { StaffScreen } from "./staff-screen.js";

afterEach(cleanupWidgets);
const people: PersonSummary[] = [
  {
    personId: "other",
    displayName: "Other Person",
    firstNames: "Other",
    lastNames: "Person",
    email: "other@example.test",
    telephone: "+44 20",
    role: "staff",
    status: "pending",
    hasPassword: false,
    hasTotp: false,
  },
];

it.each([false, true])(
  "offers account actions only with admin authority (%s)",
  async (canAdminister) => {
    const api = { listStaff: vi.fn().mockResolvedValue(people) } as unknown as DashboardApi;
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", {
      api,
      currentPersonId: "manager",
      canAdminister,
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector<StaffList>("dashboard-staff-list")!.people).toEqual(
        people,
      ),
    );
    const list = el.shadowRoot!.querySelector<StaffList>("dashboard-staff-list")!;
    await list.updateComplete;
    const table = list.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=add]") !== null).toBe(canAdminister);
    const menu = table.shadowRoot!.querySelector("wt-row-actions")!;
    expect(
      [...menu.querySelectorAll("wt-button")].map((button) => button.getAttribute("data-test")),
    ).toEqual(
      canAdminister
        ? [
            "edit-other",
            "reset-login-other",
            "reset-pin-other",
            "disable-other",
            "resend-invitation-other",
          ]
        : ["edit-other"],
    );
    menu.querySelector<HTMLElement>("[data-test=edit-other]")!.click();
    await el.updateComplete;
    const edit = el.shadowRoot!.querySelector<PersonEdit>("dashboard-person-edit")!;
    await edit.updateComplete;
    const email = edit.shadowRoot!.querySelector<WtInput>("[data-test=edit-email]")!;
    await email.updateComplete;
    expect(email.shadowRoot!.querySelector("input")!.disabled).toBe(!canAdminister);
    for (const field of ["role", "status"]) {
      const input = edit.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        `[data-test=edit-${field}]`,
      )!;
      expect(input.disabled).toBe(!canAdminister);
    }
    expect(edit.shadowRoot!.querySelector("[data-test=resend-invitation]") !== null).toBe(
      canAdminister,
    );
    const firstNames = edit.shadowRoot!.querySelector<WtInput>("[data-test=edit-first-names]")!;
    await firstNames.updateComplete;
    expect(firstNames.shadowRoot!.querySelector("input")!.disabled).toBe(false);
  },
);

it("preserves a manager's own login email control", async () => {
  const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
    person: people[0]!,
    currentPersonId: "other",
    canAdminister: false,
    open: true,
  });
  const email = el.shadowRoot!.querySelector<WtInput>("[data-test=edit-email]")!;
  await email.updateComplete;
  expect(email.shadowRoot!.querySelector("input")!.disabled).toBe(false);
});

it.each(["email", "role", "status"])(
  "keeps another person's %s control disabled for a manager",
  async (field) => {
    const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
      person: people[0]!,
      currentPersonId: "manager",
      canAdminister: false,
      open: true,
    });
    const control = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      `[data-test=edit-${field}]`,
    )!;
    expect(control.disabled).toBe(true);
  },
);
it("hides invitation resend in a manager's editor", async () => {
  const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
    person: people[0]!,
    currentPersonId: "manager",
    canAdminister: false,
    open: true,
  });
  expect(el.shadowRoot!.querySelector("[data-test=resend-invitation]")).toBeNull();
});
it("offers only editing in a manager's staff row menu", async () => {
  const { el } = await mountWidget<StaffList>("dashboard-staff-list", {
    people,
    currentPersonId: "manager",
    canAdminister: false,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  expect(
    [...table.shadowRoot!.querySelectorAll("wt-row-actions wt-button")].map((button) =>
      button.getAttribute("data-test"),
    ),
  ).toEqual(["edit-other"]);
});

it("preserves a manager's own role control", async () => {
  const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
    person: { ...people[0]!, role: "manager", status: "active" },
    currentPersonId: "other",
    canAdminister: false,
    open: true,
  });
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=edit-role]")!
      .disabled,
  ).toBe(false);
});
