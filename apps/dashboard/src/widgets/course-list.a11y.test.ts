import { afterEach, describe, it, vi, expect } from "vitest";
import { page } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { Course, DashboardApi } from "../api/client.js";
import { CourseList } from "./course-list.js";

afterEach(async () => {
  cleanupWidgets();
  await page.viewport(1280, 900);
});

const COURSES: Course[] = [
  { id: "c1", name: "Starters", displayOrder: 0, active: true },
  { id: "c2", name: "Mains", displayOrder: 1, active: true },
];

function stubApi(state: State): DashboardApi {
  return {
    listCourses:
      state === "load failed"
        ? vi.fn().mockRejectedValue({ code: "connection.failed" })
        : vi.fn().mockResolvedValue(state === "empty" ? [] : COURSES.map((c) => ({ ...c }))),
    createCourse: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCourse: vi.fn().mockResolvedValue(undefined),
    deactivateCourse: vi.fn().mockResolvedValue(undefined),
    moveCourse: vi.fn().mockResolvedValue(COURSES),
  } as unknown as DashboardApi;
}

const states = [
  "populated",
  "empty",
  "load failed",
  "renaming, refused blank",
  "adding",
  "menu open at phone width",
] as const;
type State = (typeof states)[number];

async function settle(el: CourseList): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("course list (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    if (state === "menu open at phone width") await page.viewport(390, 900);
    const { el, host } = await mountWidget<CourseList>(
      "dashboard-course-list",
      { api: stubApi(state) },
      theme,
    );
    await settle(el);
    const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector)!;
    if (state === "load failed") expect(q("[role=alert]")).not.toBeNull();
    if (state === "renaming, refused blank") {
      q('[data-test="name-c1"]').click();
      await settle(el);
      const input = q('wt-input[name="course-name"]').shadowRoot!.querySelector("input")!;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
      );
      await settle(el);
      expect(q('wt-input[name="course-name"]').getAttribute("error")).not.toBe("");
    }
    if (state === "adding") {
      q('[data-test="add-course"]').click();
      await settle(el);
    }
    if (state === "menu open at phone width") {
      (q('tr[data-course="c2"] wt-row-actions') as unknown as WtRowActions).show();
      await settle(el);
    }
    await expectNoA11yViolations(host);
  });
});
