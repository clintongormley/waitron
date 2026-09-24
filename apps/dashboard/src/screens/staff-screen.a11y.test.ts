import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./staff-screen.js";
import type { StaffScreen } from "./staff-screen.js";
import type { DashboardApi, PersonSummary } from "../api/client.js";

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: true,
    email: null,
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

function stubApi(): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(people),
    createPerson: vi.fn().mockResolvedValue({ id: "p3" }),
  } as unknown as DashboardApi;
}

async function flush(el: StaffScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("staff-screen a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { el, host } = await mountWidget<StaffScreen>(
      "dashboard-staff-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
