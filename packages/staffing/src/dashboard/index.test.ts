import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import type { CalendarViewHost, DashboardRequest } from "@waitron/dashboard-kit";
import { STAFFING_DASHBOARD } from "./index.js";
import type { StaffRolesScreen } from "./staff-roles-screen.js";
import type { StaffingMonthView } from "./staffing-month.js";
import { staffingMonth } from "../testing/staffing-month-fixture.js";

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

async function mount(readOnly?: boolean) {
  const request = vi.fn(async () => ({ staffRoles: [] }));
  const handle = STAFFING_DASHBOARD.create({ request: request as unknown as DashboardRequest });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  render(handle.render(readOnly), container);
  const screen = container.querySelector<StaffRolesScreen>("dashboard-staff-roles-screen")!;
  await screen.updateComplete;
  return { screen, request };
}

describe("STAFFING_DASHBOARD", () => {
  it("puts the Staff roles page in the Team group for managers of staffing, readable by venue viewers", () => {
    expect(STAFFING_DASHBOARD.module).toBe("staffing");
    expect(STAFFING_DASHBOARD.screen).toEqual({
      id: "staff-roles",
      navLabelKey: "nav.staff_roles",
      group: "team",
      requiresPermission: "staffing.manage",
      readPermission: "venue.view",
    });
    expect(STAFFING_DASHBOARD.strings.es["nav.staff_roles"]).toBe("Roles de personal");
  });

  it("mounts the page with an api on the app's request, editable unless read-only", async () => {
    const { screen, request } = await mount();
    expect(screen.readOnly).toBe(false);
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/management-api/staffing/staff-roles",
        "GET",
        undefined,
        {
          passive: true,
        },
      ),
    );
    expect((await mount(true)).screen.readOnly).toBe(true);
  });

  it("adds the Staffing view to the Calendar, drawn for the host's current month and address", async () => {
    const [view, ...others] = STAFFING_DASHBOARD.calendarViews!;
    expect(others).toEqual([]);
    expect(view).toMatchObject({
      id: "staffing",
      labelKey: "staffing.view.tab",
      order: 10,
      requiresPermission: "staffing.manage",
      readPermission: "venue.view",
    });
    expect(STAFFING_DASHBOARD.strings.en["staffing.view.tab"]).toBe("Staffing");
    expect(STAFFING_DASHBOARD.strings.es["staffing.view.tab"]).toBe("Personal");

    const request = vi.fn(async (path: string) =>
      path.includes("/month?") ? staffingMonth(path.slice(-7)) : { areas: [] },
    );
    const opened = vi.fn();
    const address = { month: "2026-12", params: { month: "2026-12" } as Record<string, string> };
    const host: CalendarViewHost = {
      get month() {
        return address.month;
      },
      get params() {
        return address.params;
      },
      canWrite: false,
      open: opened,
    };
    const handle = view!.create({ request: request as unknown as DashboardRequest }, host);
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(true), container);
    const month = container.querySelector<StaffingMonthView>("staffing-month")!;
    await vi.waitFor(() =>
      expect(month.shadowRoot!.querySelector("td[data-date='2026-12-01']")).not.toBeNull(),
    );
    expect(month.canWrite).toBe(false);

    month.shadowRoot!.querySelector<HTMLElement>("[data-test=next-month]")!.click();
    expect(opened).toHaveBeenCalledWith("staffing", { month: "2027-01" });

    address.month = "2027-01";
    address.params = { month: "2027-01", area: "station:st-kitchen" };
    render(handle.render(true), container);
    expect(month.month).toBe("2027-01");
    expect(month.params).toEqual({ month: "2027-01", area: "station:st-kitchen" });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/management-api/staffing/month?month=2027-01",
        "GET",
        undefined,
        { passive: true },
      ),
    );
  });
});
