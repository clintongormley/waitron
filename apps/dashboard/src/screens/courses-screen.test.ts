import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtInput } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import type { Course, DashboardApi } from "../api/client.js";
import type { CourseList } from "../widgets/course-list.js";
import type { CoursesScreen } from "./courses-screen.js";
import "./courses-screen.js";

afterEach(cleanupWidgets);

const COURSES: Course[] = [
  { id: "c1", name: "Starters", displayOrder: 0, active: true, inUse: false },
  { id: "c2", name: "Mains", displayOrder: 1, active: true, inUse: false },
];

function stubApi(courses: Course[] = COURSES): DashboardApi {
  return {
    listCourses: vi.fn().mockResolvedValue(courses.map((course) => ({ ...course }))),
    createCourse: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCourse: vi.fn().mockResolvedValue(undefined),
    moveCourse: vi.fn().mockResolvedValue(courses.map((course) => ({ ...course }))),
  } as unknown as DashboardApi;
}

const q = <T extends Element = HTMLElement>(el: CoursesScreen, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);

const list = (el: CoursesScreen) => q<CourseList>(el, "dashboard-course-list")!;

async function mount(readOnly = false): Promise<{ el: CoursesScreen; api: DashboardApi }> {
  const api = stubApi();
  const { el } = await mountWidget<CoursesScreen>("dashboard-courses-screen", { api, readOnly });
  await vi.waitFor(() => expect(list(el).shadowRoot!.textContent).toContain("Starters"));
  return { el, api };
}

describe("dashboard-courses-screen", () => {
  it("shows the Courses heading, its description and the shared course list", async () => {
    const { el, api } = await mount();
    expect(q(el, "h1")!.textContent!.trim()).toBe(t("kitchen.courses_title"));
    expect(q(el, ".description")!.textContent!.trim()).toBe(t("courses.description"));
    expect(el.shadowRoot!.querySelectorAll("dashboard-course-list")).toHaveLength(1);
    expect(list(el).api).toBe(api);
    expect(list(el).readOnly).toBe(false);
    expect(list(el).showAddButton).toBe(false);
    expect(list(el).shadowRoot!.querySelector("[data-test=add-course]")).toBeNull();
    expect(api.listCourses).toHaveBeenCalledTimes(1);
  });

  it("Add course in the header opens the new course row with its name field focused", async () => {
    const { el } = await mount();
    const add = q(el, ".heading [data-test=add-course]")!;
    expect(add.textContent!.trim()).toBe(t("kitchen.add_course"));
    add.click();
    const courseList = list(el);
    await vi.waitFor(() =>
      expect(courseList.shadowRoot!.querySelector('tfoot tr[data-course="new"]')).not.toBeNull(),
    );
    const field = courseList.shadowRoot!.querySelector<WtInput>('wt-input[name="course-name"]')!;
    await vi.waitFor(() => expect(courseList.shadowRoot!.activeElement).toBe(field));
  });

  it("read-only: names only, no Add course, and the description without the drag sentence", async () => {
    const { el } = await mount(true);
    expect(q(el, "[data-test=add-course]")).toBeNull();
    expect(q(el, ".description")!.textContent!.trim()).toBe(t("courses.description_read_only"));
    const courseList = list(el);
    expect(courseList.readOnly).toBe(true);
    expect(
      [...courseList.shadowRoot!.querySelectorAll("li[data-course]")].map((row) =>
        row.textContent!.trim(),
      ),
    ).toEqual(["Starters", "Mains"]);
    expect(courseList.shadowRoot!.querySelector("[data-test=add-course]")).toBeNull();
    expect(courseList.shadowRoot!.querySelector("[data-test=name-c1]")).toBeNull();
  });
});
