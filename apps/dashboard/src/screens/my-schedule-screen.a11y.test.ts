import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./my-schedule-screen.js";
import type { MyScheduleScreen } from "./my-schedule-screen.js";
import type { DashboardApi, MyAbsence, MyShift, MySwap, RosterEntry } from "../api/client.js";

// One row of each list (a shift, an acceptable swap offered to me, an absence) plus the two request
// forms and their pickers, so every control the screen renders is under axe at once — in BOTH themes,
// where the color-contrast check means what it means in the deployed app.
const roster: RosterEntry[] = [
  { personId: "me", displayName: "Yo" },
  { personId: "col1", displayName: "Colega" },
];
const shifts: MyShift[] = [
  {
    id: "s1",
    locationId: "loc1",
    startsAt: "2026-05-04T09:00:00Z",
    startsOffsetMinutes: 0,
    endsAt: "2026-05-04T17:00:00Z",
    endsOffsetMinutes: 0,
    role: "bar",
    rosterVersionId: null,
  },
];
const swaps: MySwap[] = [
  {
    id: "sw-offered",
    requestedByPersonId: "col1",
    fromShiftId: "s2",
    toPersonId: "me",
    toShiftId: null,
    status: "requested",
    createdAt: "2026-05-01T10:00:00Z",
    direction: "offered_to_me",
  },
];
const absences: MyAbsence[] = [
  {
    id: "a1",
    personId: "me",
    kind: "holiday",
    startsOn: "2026-06-01",
    endsOn: "2026-06-03",
    status: "requested",
    note: null,
    createdAt: "2026-05-01T10:00:00Z",
  },
];

function stubApi(): DashboardApi {
  return {
    getStaffRoster: vi.fn().mockResolvedValue(roster),
    listMyShifts: vi.fn().mockResolvedValue(shifts),
    listMySwaps: vi.fn().mockResolvedValue(swaps),
    listMyAbsences: vi.fn().mockResolvedValue(absences),
    requestSwap: vi.fn(),
    acceptSwap: vi.fn(),
    requestAbsence: vi.fn(),
  } as unknown as DashboardApi;
}

async function flush(el: MyScheduleScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("my-schedule-screen a11y (%s theme)", (theme) => {
  it("has no violations rendering the loaded schedule and its forms", async () => {
    const { el, host } = await mountWidget<MyScheduleScreen>(
      "dashboard-my-schedule-screen",
      { api: stubApi(), myPersonId: "me" },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
