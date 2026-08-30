import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./roster-screen.js";
import type { RosterScreen } from "./roster-screen.js";
import type { DashboardApi, PersonSummary, RosterSnapshot } from "../api/client.js";

/**
 * The roster screen scanned by axe in both themes, in two shapes: an EMPTY week (the location + week
 * pickers over a person × day grid with no shifts and no publish button) and a DRAFT week with a
 * couple of shifts (grid cells carrying shift spans, plus the Publish button). Mounted by ASSIGNING
 * the `api` stub as a property — the screen loads on connect, so the stub must resolve those or a
 * stray rejection pollutes the run. The shift dialog is left CLOSED (its default), so its dialog
 * renders nothing to the a11y tree. The `<table>` uses `<th scope>` row/column headers so the grid is
 * navigable by a screen reader.
 */
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
// Two locations so the shared `<dashboard-location-picker>` renders its select (it renders nothing
// for a single location) and axe scans it in the screen context, as the inlined picker used to be.
const locations = [
  { id: "loc-1", name: "Main" },
  { id: "loc-2", name: "Annex" },
];
// Today's date in UTC (`toISOString()` is UTC, matching the screen's `today()` seed) — always in the
// current week the screen defaults to, so the shift renders in a cell.
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
    // Beyond axe (which did not flag the mouse-only <td>): every editable cell's affordance is a real
    // <button> — keyboard-operable — and an empty one carries an accessible name (aria-label).
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
