import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { STAFFING_DASHBOARD } from "./index.js";
import type { StaffRolesScreen } from "./staff-roles-screen.js";

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
});
