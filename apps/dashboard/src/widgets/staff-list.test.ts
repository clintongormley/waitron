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

  // The row shows the person's dashboard sign-in email so a manager can see it at a glance. A person
  // WITH an email shows the address; one WITHOUT (email: null) shows an em-dash placeholder, never
  // the literal "null".
  it("shows the person's email, and an em-dash when there is none", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const rows = table.shadowRoot!.querySelectorAll("tbody tr");
    expect(rows[0]!.textContent).toContain("ada@x.com");
    // The email-less person shows the em-dash placeholder, not the raw null.
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

  // The edit-person event must escape this widget's shadow boundary to reach the app shell (a later
  // task), so it is dispatched bubbles+composed — asserted here so a future edit does not quietly
  // drop either flag and strand every consumer above the boundary.
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

  // An empty roster renders no rows (and does not throw) — the widget defaults `people` to `[]`, so
  // it is safe to render before the app assigns the list.
  it("renders no rows for an empty people list", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people: [] });
    expect(
      el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.querySelectorAll("tbody tr"),
    ).toHaveLength(0);
  });
});
