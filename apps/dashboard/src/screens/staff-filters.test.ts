import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi, PersonSummary } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { StaffList } from "../widgets/staff-list.js";
import { StaffScreen } from "./staff-screen.js";
import { setLocale } from "../i18n/t.js";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";

type Combobox = HTMLElement & {
  value: string;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const people: PersonSummary[] = [
  {
    personId: "1",
    displayName: "Ada",
    firstNames: "Ada Augusta",
    lastNames: "Lovelace",
    telephone: "+44 111",
    role: "admin",
    status: "active",
    email: "ada@example.com",
    hasPassword: true,
    hasTotp: false,
  },
  {
    personId: "2",
    displayName: "Grace",
    firstNames: "Grace",
    lastNames: "Hopper",
    telephone: "+1 222",
    role: "manager",
    status: "pending",
    email: "grace@example.com",
    hasPassword: false,
    hasTotp: false,
  },
  {
    personId: "3",
    displayName: "Inactive Alex",
    firstNames: "Alex",
    lastNames: "Smith",
    telephone: null,
    role: "staff",
    status: "suspended",
    email: "alex@example.com",
    hasPassword: false,
    hasTotp: false,
  },
];

async function screen(): Promise<StaffScreen> {
  const api = { listStaff: vi.fn().mockResolvedValue(people) } as unknown as DashboardApi;
  const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  return el;
}

function shown(el: StaffScreen): PersonSummary[] {
  return el.shadowRoot!.querySelector<StaffList>("dashboard-staff-list")!.people;
}

/** The people the staff table draws, in the order it draws them. */
async function drawn(el: StaffScreen): Promise<string[]> {
  const list = el.shadowRoot!.querySelector<StaffList>("dashboard-staff-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return [...table.shadowRoot!.querySelectorAll("tbody tr[data-row-key]")].map((row) =>
    row.getAttribute("data-row-key")!,
  );
}

it("searches names, email and phone as the administrator types", async () => {
  const el = await screen();
  expect(shown(el).map((person) => person.displayName)).toEqual(["Ada", "Grace"]);
  const search = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
    "[data-test=search]",
  )!;
  search.value = "222";
  search.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "222" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(await drawn(el)).toEqual(["2"]);
});

it("combines role and status filters and can include inactive users", async () => {
  const el = await screen();
  const status = el.shadowRoot!.querySelector<HTMLElement>("[data-test=status-filter]")!;
  await chooseOption(status, "all");
  const role = el.shadowRoot!.querySelector<HTMLElement>("[data-test=role-filter]")!;
  await chooseOption(role, "staff");
  await el.updateComplete;
  expect(shown(el).map((person) => person.displayName)).toEqual(["Inactive Alex"]);
});

it("lists the role filter's roles alphabetically in the current language, after All roles", async () => {
  setLocale("en-GB");
  const el = await screen();
  const role = el.shadowRoot!.querySelector<Combobox>("[data-test=role-filter]")!;
  expect(role.options.map((option) => option.value)).toEqual([
    "all",
    "admin",
    "manager",
    "staff",
    "supervisor",
  ]);
});

it("marks the chosen role's option selected when the options re-render in a different order", async () => {
  setLocale("en-GB");
  const el = await screen();
  const role = el.shadowRoot!.querySelector<Combobox>("[data-test=role-filter]")!;
  await chooseOption(role, "manager");
  await el.updateComplete;
  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(shown(el).map((person) => person.displayName)).toEqual(["Grace"]);
  expect(role.value).toBe("manager");
  await role.updateComplete;
  expect(role.shadowRoot!.querySelector(".trigger .value")!.textContent!.trim()).toBe("Encargado");
});

it("explains what current users are in a help tooltip beside the status filter", async () => {
  setLocale("en-GB");
  const el = await screen();
  const status = el.shadowRoot!.querySelector<HTMLElement>("[data-test=status-filter]")!;
  const help = el.shadowRoot!.querySelector<HTMLElement>("[data-test=status-filter-help]")!;
  expect(help.tagName).toBe("WT-HELP-TOOLTIP");
  expect(help.getAttribute("aria-label")).toBe("About current users");
  expect(help.textContent?.trim()).toBe(
    "Current users are everyone who has not been disabled: active users, and pending users (invited, but yet to finish setting up their account).",
  );
  // The tooltip sits outside the label, so the dropdown's label text is just "Status".
  expect(help.closest("label")).toBeNull();
  const trigger = status.shadowRoot!.querySelector("[aria-labelledby]")!;
  const label = status.shadowRoot!.getElementById(trigger.getAttribute("aria-labelledby")!);
  expect(label?.textContent?.trim()).toBe("Status");
});
