import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./roster-screen.js";
import type { RosterScreen } from "./roster-screen.js";
import type { DashboardApi, PersonSummary, RosterSnapshot } from "../api/client.js";

const staff: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ana",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
  {
    personId: "p2",
    displayName: "Beto",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];
// Two locations, because `<dashboard-location-picker>` renders nothing for a single one.
const locations = [
  { id: "loc-1", name: "Main" },
  { id: "loc-2", name: "Annex" },
];
// In UTC, like the screen's `today()`, so the shift lands in the week the screen opens on.
const day = new Date().toISOString().slice(0, 10);

function stubApi(snapshot: RosterSnapshot): DashboardApi {
  return {
    getLocations: vi.fn().mockResolvedValue(locations),
    listStaff: vi.fn().mockResolvedValue(staff),
    getRoster: vi.fn().mockResolvedValue(snapshot),
  } as unknown as DashboardApi;
}

async function flush(el: RosterScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("roster-screen a11y (%s theme)", (theme) => {
  it("renders accessibly for an empty week", async () => {
    const { el, host } = await mountWidget<RosterScreen>(
      "dashboard-roster-screen",
      { api: stubApi({ version: null, shifts: [] }) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
    // axe did not flag a bare clickable <td>, so this checks for a real button directly.
    const cell = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-test^=cell-]")!;
    expect(cell.tagName).toBe("BUTTON");
    expect(cell.getAttribute("aria-label")).toBeTruthy();
  });

  it("renders accessibly for a draft week with shifts", async () => {
    const snapshot: RosterSnapshot = {
      version: {
        id: "v1",
        locationId: "loc-1",
        periodStart: day,
        periodEnd: day,
        status: "draft",
        publishedAt: null,
        publishedByPersonId: null,
      },
      shifts: [
        {
          id: "s1",
          personId: "p1",
          locationId: "loc-1",
          startsAt: `${day}T09:00:00Z`,
          startsOffsetMinutes: 0,
          endsAt: `${day}T13:00:00Z`,
          endsOffsetMinutes: 0,
          role: "bar",
          rosterVersionId: "v1",
        },
      ],
    };
    const { el, host } = await mountWidget<RosterScreen>(
      "dashboard-roster-screen",
      { api: stubApi(snapshot) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
