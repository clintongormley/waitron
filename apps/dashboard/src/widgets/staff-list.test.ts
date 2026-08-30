import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
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

describe("staff-list", () => {
  it("renders one row per person with role and status", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const rows = el.shadowRoot!.querySelectorAll("[data-test=row]");
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
    const rows = el.shadowRoot!.querySelectorAll("[data-test=row]");
    expect(rows[0]!.querySelector(".email")!.textContent).toContain("ada@x.com");
    // The email-less person shows the em-dash placeholder, not the raw null.
    expect(rows[1]!.querySelector(".email")!.textContent).toContain("—");
    expect(rows[1]!.querySelector(".email")!.textContent).not.toContain("null");
  });

  it("emits edit-person when a row's edit control is clicked", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const detail = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("edit-person", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    expect((await detail).personId).toBe("p1");
  });

  // The edit-person event must escape this widget's shadow boundary to reach the app shell (a later
  // task), so it is dispatched bubbles+composed — asserted here so a future edit does not quietly
  // drop either flag and strand every consumer above the boundary.
  it("emits edit-person as a bubbling, composed event", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people });
    const seen = new Promise<Event>((resolve) => el.addEventListener("edit-person", resolve));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p2]")!.click();
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // The hasTotp=true credential branch: the two spec people above are both hasTotp=false, so without
  // this the true arm of that badge is never rendered (the coverage gate would fail on it).
  it("renders a credential badge for each of hasPassword and hasTotp", async () => {
    const withBoth: PersonSummary[] = [
      {
        personId: "p3",
        displayName: "Cy",
        role: "admin",
        status: "active",
        hasPassword: true,
        hasTotp: true,
        email: "cy@x.com",
      },
    ];
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people: withBoth });
    const badges = el.shadowRoot!.querySelectorAll("[data-test=row] .badge");
    // both credential badges present, and each carries text (not colour alone) naming the credential.
    expect(badges.length).toBe(2);
    const text = Array.from(badges, (b) => b.textContent ?? "").join(" ");
    expect(text).toContain(t("staff.badge_password", "es-ES"));
    expect(text).toContain(t("staff.badge_totp", "es-ES"));
  });

  // An empty roster renders no rows (and does not throw) — the widget defaults `people` to `[]`, so
  // it is safe to render before the app assigns the list.
  it("renders no rows for an empty people list", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", { people: [] });
    expect(el.shadowRoot!.querySelectorAll("[data-test=row]").length).toBe(0);
  });
});
