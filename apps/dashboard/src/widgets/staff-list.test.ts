import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { roleName, statusName } from "../i18n/domain.js";
import type { PersonSummary } from "../api/client.js";
import { StaffList } from "./staff-list.js";

afterEach(cleanupWidgets);
const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: false,
    email: "ada@x.com",
  },
  {
    personId: "p2",
    displayName: "Bea",
    role: "staff",
    status: "suspended",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];

async function editButton(el: StaffList, personId: string): Promise<HTMLElement> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return table.shadowRoot!.querySelector<HTMLElement>(`[data-test=edit-${personId}]`)!;
}

describe("staff-list", () => {
  it("opens a row menu with edit, reset login, reset PIN and Disable", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const menu = table.shadowRoot!.querySelector("wt-row-actions")!;
    expect(menu).not.toBeNull();
    await menu.updateComplete;
    menu.shadowRoot!.querySelector("button")!.click();
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    expect(
      [...menu.querySelectorAll("wt-button")].map((button) => button.getAttribute("data-test")),
    ).toEqual(["edit-p1", "reset-login-p1", "reset-pin-p1", "disable-p1"]);
    const events: CustomEvent[] = [];
    el.addEventListener("person-action", (event) => events.push(event as CustomEvent));
    menu.querySelector<HTMLElement>("[data-test=reset-pin-p1]")!.click();
    expect(events[0]!.detail).toEqual({ personId: "p1", action: "reset-pin" });
  });

  it("renders one row per person with role and status", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const rows = table.shadowRoot!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Ada");
    // Role and status render through the i18n layer as localised display names, never the raw token.
    expect(rows[0]!.textContent).toContain(roleName("manager", "es-ES"));
    expect(rows[0]!.textContent).not.toContain("manager");
    expect(rows[1]!.textContent).toContain(statusName("suspended", "es-ES"));
    expect(rows[1]!.textContent).not.toContain("suspended");
  });

  it("shows the person's email, and an em-dash when there is none", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const rows = table.shadowRoot!.querySelectorAll("tbody tr");
    expect(rows[0]!.textContent).toContain("ada@x.com");
    expect(rows[1]!.textContent).toContain("—");
    expect(rows[1]!.textContent).not.toContain("null");
  });

  it("emits edit-person when a row's edit control is clicked", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const detail = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("edit-person", (e) => resolve((e as CustomEvent).detail)),
    );
    (await editButton(el, "p1")).click();
    expect((await detail).personId).toBe("p1");
  });

  it("emits edit-person as a bubbling, composed event", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const seen = new Promise<Event>((resolve) => el.addEventListener("edit-person", resolve));
    (await editButton(el, "p2")).click();
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("shows legal names and phone in the administrative columns", async () => {
    const detailed: PersonSummary[] = [
      {
        ...people[0]!,
        firstNames: "Ada Augusta",
        lastNames: "Lovelace",
        telephone: "+44 20 1234",
      },
    ];
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people: detailed });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const text = table.shadowRoot!.querySelector("tbody tr")!.textContent!;
    expect(text).toContain("Lovelace, Ada Augusta");
    expect(text).toContain("+44 20 1234");
  });

  it("renders no rows for an empty people list", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people: [] });
    expect(
      el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.querySelectorAll("tbody tr"),
    ).toHaveLength(0);
  });
});

describe("staff-list sorting", () => {
  // Raw row order is Dora, Eva, Carl, and every column's order differs from it and from the
  // display-name order, so each case fails if its column's sort value stops varying or reads the
  // display name. Three rows cannot give seven distinct orders: role and status share one, as do
  // legal name, email and telephone, so a swap between two columns in the same group goes unseen.
  const roster: PersonSummary[] = [
    {
      personId: "a",
      displayName: "Dora",
      firstNames: "Dorotea",
      lastNames: "Abad",
      telephone: "+34 600",
      role: "manager",
      status: "pending",
      hasPassword: false,
      hasTotp: false,
      email: "dora@x.com",
    },
    {
      personId: "b",
      displayName: "Eva",
      firstNames: "Eva María",
      telephone: null,
      role: "staff",
      status: "suspended",
      hasPassword: false,
      hasTotp: false,
      email: null,
    },
    {
      personId: "c",
      displayName: "Carl",
      lastNames: "Abad",
      telephone: "+34 500",
      role: "admin",
      status: "active",
      hasPassword: true,
      hasTotp: false,
      email: "carl@x.com",
    },
  ];

  async function sortedBy(key: string): Promise<string[]> {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people: roster });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-sort=${key}]`)!.click();
    await table.updateComplete;
    return [...table.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
      row.querySelector("td, th")!.textContent!.trim(),
    );
  }

  it("sorts by display name", async () => {
    expect(await sortedBy("displayName")).toEqual(["Carl", "Dora", "Eva"]);
  });

  it("sorts by legal name, treating a missing surname or given name as empty", async () => {
    expect(await sortedBy("legalName")).toEqual(["Eva", "Carl", "Dora"]);
  });

  // The localised role names order differently from the raw tokens (admin, manager, staff).
  it("sorts by the localised role name, not the raw role", async () => {
    expect(await sortedBy("role")).toEqual(["Carl", "Eva", "Dora"]);
  });

  it.each(["email", "telephone"])("sorts a missing %s first as empty text", async (key) => {
    expect(await sortedBy(key)).toEqual(["Eva", "Carl", "Dora"]);
  });

  // The localised status names order differently from the raw tokens (active, pending, suspended).
  it("sorts by the localised status name, not the raw status", async () => {
    expect(await sortedBy("status")).toEqual(["Carl", "Eva", "Dora"]);
  });

  it("offers Resend invitation only to a pending person and emits it for that person", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people: roster });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector("[data-test=resend-invitation-b]")).toBeNull();
    expect(table.shadowRoot!.querySelector("[data-test=resend-invitation-c]")).toBeNull();
    const events: CustomEvent[] = [];
    el.addEventListener("person-action", (event) => events.push(event as CustomEvent));
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=resend-invitation-a]")!.click();
    expect(events.map((event) => event.detail)).toEqual([
      { personId: "a", action: "resend-invitation" },
    ]);
  });
});
