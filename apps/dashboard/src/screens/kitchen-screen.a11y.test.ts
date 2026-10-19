import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./kitchen-screen.js";
import type { KitchenScreen } from "./kitchen-screen.js";
import type { Course, DashboardApi, Station } from "../api/client.js";

const STATIONS: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    isDefault: true,
    active: true,
    showsRestOfOrder: false,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
  {
    id: "s2",
    name: "Plancha",
    isDefault: false,
    active: true,
    showsRestOfOrder: false,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];

const COURSES: Course[] = [
  {
    id: "c1",
    name: "Entrantes",
    displayOrder: 0,
    active: true,
    inUse: false,
    heldUntilFired: true,
  },
  { id: "c2", name: "Postres", displayOrder: 1, active: true, inUse: false, heldUntilFired: true },
];

function stubApi(stations: Station[], courses: Course[] = COURSES): DashboardApi {
  return {
    listStations: vi.fn().mockResolvedValue(stations.map((s) => ({ ...s }))),
    createStation: vi.fn().mockResolvedValue({ id: "s9" }),
    updateStation: vi.fn().mockResolvedValue(undefined),
    setDefaultStation: vi.fn().mockResolvedValue(undefined),
    setBumpMode: vi.fn().mockResolvedValue(undefined),
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    listCourses: vi.fn().mockResolvedValue(courses.map((c) => ({ ...c }))),
    createCourse: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCourse: vi.fn().mockResolvedValue(undefined),
    getCourseDeleteImpact: vi.fn((id: string) =>
      Promise.resolve({
        target: { id, name: courses.find((c) => c.id === id)?.name ?? id },
        refusals: [],
        ends: [],
        removes: [],
      }),
    ),
    deleteCourse: vi.fn((id: string) =>
      Promise.resolve({
        target: { id, name: courses.find((c) => c.id === id)?.name ?? id },
        refusals: [],
        ends: [],
        removes: [],
      }),
    ),
    getKitchenTimingDefaults: vi.fn().mockResolvedValue({
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    }),
    setKitchenTimingDefaults: vi.fn().mockResolvedValue(undefined),
    getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
    setFireControl: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: KitchenScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("kitchen-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a populated list", async () => {
    const { el, host } = await mountWidget<KitchenScreen>(
      "dashboard-kitchen-screen",
      { api: stubApi(STATIONS) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with empty course list", async () => {
    const { el, host } = await mountWidget<KitchenScreen>(
      "dashboard-kitchen-screen",
      { api: stubApi([], []) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
