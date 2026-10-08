import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./my-schedule-screen.js";
import type { MyScheduleScreen } from "./my-schedule-screen.js";
import type { DashboardApi, MyAbsence, MyShift, MySwap, RosterEntry } from "../api/client.js";

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

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getStaffRoster: vi.fn().mockResolvedValue(roster),
    listMyShifts: vi.fn().mockResolvedValue(shifts),
    listMySwaps: vi.fn().mockResolvedValue(swaps),
    listMyAbsences: vi.fn().mockResolvedValue(absences),
    requestSwap: vi.fn(),
    acceptSwap: vi.fn(),
    requestAbsence: vi.fn(),
    ...overrides,
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

  it("has no violations with both submit actions quiet, then changed", async () => {
    const { el, host } = await mountWidget<MyScheduleScreen>(
      "dashboard-my-schedule-screen",
      { api: stubApi(), myPersonId: "me" },
      theme,
    );
    await flush(el);
    const action = (name: string) =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${name}]`)!;
    const looks = () =>
      ["cover-submit", "abs-submit"].map((name) => [action(name).variant, action(name).disabled]);
    expect(looks()).toEqual([
      ["secondary", true],
      ["secondary", true],
    ]);
    await expectNoA11yViolations(host);
    await chooseOption(el.shadowRoot!.querySelector("[data-test=cover-shift]")!, "s1");
    await chooseOption(el.shadowRoot!.querySelector("[data-test=cover-colleague]")!, "col1");
    for (const [name, value] of [
      ["abs-from", "2026-06-01"],
      ["abs-to", "2026-06-03"],
    ]) {
      const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        `[data-test=${name}]`,
      )!;
      await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
    }
    await flush(el);
    expect(looks()).toEqual([
      ["primary", false],
      ["primary", false],
    ]);
    await expectNoA11yViolations(host);
  });

  it("has no violations with a list's load-failed notice and the retry", async () => {
    const { el, host } = await mountWidget<MyScheduleScreen>(
      "dashboard-my-schedule-screen",
      {
        api: stubApi({ listMySwaps: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
        myPersonId: "me",
      },
      theme,
    );
    await flush(el);
    if (el.shadowRoot!.querySelector("[data-test=swaps-failed]") === null) {
      throw new Error("the swaps list's load-failed notice did not render");
    }
    await expectNoA11yViolations(host);
  });
});
