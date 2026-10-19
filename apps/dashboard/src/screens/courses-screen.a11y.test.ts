import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course, DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { CoursesScreen } from "./courses-screen.js";
import "./courses-screen.js";

afterEach(cleanupWidgets);

const COURSES: Course[] = [
  { id: "c1", name: "Starters", displayOrder: 0, active: true, inUse: false, heldUntilFired: true },
  { id: "c2", name: "Mains", displayOrder: 1, active: true, inUse: true, heldUntilFired: true },
];

function api(courses: Course[]): DashboardApi {
  return {
    listCourses: vi.fn().mockResolvedValue(courses.map((course) => ({ ...course }))),
  } as unknown as DashboardApi;
}

async function mount(courses: Course[], theme: "light" | "dark", readOnly = false) {
  const mounted = await mountWidget<CoursesScreen>(
    "dashboard-courses-screen",
    { api: api(courses), readOnly },
    theme,
  );
  const list = mounted.el.shadowRoot!.querySelector("dashboard-course-list")!;
  const row = readOnly ? "li[data-course]" : "tbody tr[data-course]";
  await vi.waitFor(() =>
    expect(
      list.shadowRoot!.querySelector(courses.length ? row : "[data-test=empty]"),
    ).not.toBeNull(),
  );
  return mounted;
}

describe.each(["light", "dark"] as const)("courses-screen a11y (%s theme)", (theme) => {
  it("renders a populated list accessibly", async () => {
    const { host } = await mount(COURSES, theme);
    await expectNoA11yViolations(host);
  });

  it("renders an empty list accessibly", async () => {
    const { host } = await mount([], theme);
    await expectNoA11yViolations(host);
  });

  it("renders a read-only list accessibly", async () => {
    const { host } = await mount(COURSES, theme, true);
    await expectNoA11yViolations(host);
  });
});
