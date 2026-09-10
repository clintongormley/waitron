import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi, PersonSummary } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { StaffList } from "../widgets/staff-list.js";
import { StaffScreen } from "./staff-screen.js";

afterEach(cleanupWidgets);

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

it("searches names, email and phone as the administrator types", async () => {
  const el = await screen();
  expect(shown(el).map((person) => person.displayName)).toEqual(["Ada", "Grace"]);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=search]")!;
  search.value = "222";
  search.dispatchEvent(new InputEvent("input"));
  await el.updateComplete;
  expect(shown(el).map((person) => person.displayName)).toEqual(["Grace"]);
});

it("combines role and status filters and can include inactive users", async () => {
  const el = await screen();
  const status = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=status-filter]")!;
  status.value = "all";
  status.dispatchEvent(new Event("change"));
  const role = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=role-filter]")!;
  role.value = "staff";
  role.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(shown(el).map((person) => person.displayName)).toEqual(["Inactive Alex"]);
});
