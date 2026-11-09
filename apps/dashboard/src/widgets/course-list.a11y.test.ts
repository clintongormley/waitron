import { afterEach, describe, it, vi, expect } from "vitest";
import { page } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { Course, DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { CourseList } from "./course-list.js";

afterEach(async () => {
  cleanupWidgets();
  await page.viewport(1280, 900);
});

const COURSES: Course[] = [
  {
    id: "c1",
    name: "Starters",
    displayOrder: 0,
    active: true,
    inUse: false,
    heldUntilFired: false,
  },
  { id: "c2", name: "Mains", displayOrder: 1, active: true, inUse: true, heldUntilFired: true },
];
function stubApi(state: State): DashboardApi {
  return {
    listCourses:
      state === "load failed"
        ? vi.fn().mockRejectedValue({ code: "connection.failed" })
        : vi.fn().mockResolvedValue(
            state === "empty"
              ? []
              : COURSES.map((c) => ({
                  ...c,
                })),
          ),
    createCourse: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCourse: vi.fn().mockResolvedValue(undefined),
    deleteCourse:
      state === "Delete dialog, refused"
        ? vi.fn().mockRejectedValue({ code: "connection.failed" })
        : vi.fn().mockResolvedValue(undefined),
    getCourseDeleteImpact:
      state === "Delete dialog, loading"
        ? vi.fn(() => new Promise(() => {}))
        : state === "Delete dialog, read failed"
          ? vi.fn().mockRejectedValue({ code: "connection.failed" })
          : vi.fn().mockResolvedValue({
              target: { id: "c1", name: "Starters" },
              refusals: [],
              ends: [],
              removes:
                state === "Delete dialog, products"
                  ? [{ key: "course_products", count: 3, targets: [] }]
                  : [],
            }),
    moveCourse: vi.fn().mockResolvedValue(COURSES),
  } as unknown as DashboardApi;
}

const states = [
  "populated",
  "empty",
  "load failed",
  "renaming, refused blank",
  "adding",
  "direct Delete at phone width",
  "Delete dialog, products",
  "Delete dialog, loading",
  "Delete dialog, read failed",
  "Delete dialog at phone width",
  "Delete dialog, refused",
] as const;
type State = (typeof states)[number];

async function settle(el: CourseList): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("course list (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    if (state.includes("at phone width")) await page.viewport(390, 900);
    const { el, host } = await mountWidget<CourseList>(
      "dashboard-course-list",
      { api: stubApi(state) },
      theme,
    );
    await settle(el);
    const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector)!;
    if (state === "load failed") expect(q("[role=alert]")).not.toBeNull();
    if (state === "populated") {
      const switches = el.shadowRoot!.querySelectorAll("wt-segmented-control");
      expect(switches).toHaveLength(2);
      expect(
        switches[0]!.shadowRoot!.querySelector('[aria-checked="true"]')!.textContent!.trim(),
      ).toBe(t("courses.fire_now"));
      expect(
        switches[1]!.shadowRoot!.querySelector('[aria-checked="true"]')!.textContent!.trim(),
      ).toBe(t("courses.hold_for_later"));
    }

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
    if (state === "direct Delete at phone width") {
      const actions = q('tr[data-course="c2"] wt-row-actions') as unknown as WtRowActions;
      actions.show();
      expect(actions.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
      await settle(el);
    }
    if (state.startsWith("Delete dialog")) {
      q('[data-test="remove-c1"]').click();
      await settle(el);
      expect(q('[data-test="delete-course-dialog"]')).not.toBeNull();
    }
    if (state === "Delete dialog, refused") {
      const dialog = q("wt-delete-dialog");
      await vi.waitFor(() =>
        expect(
          dialog.shadowRoot
            ?.querySelector('wt-button[data-test="delete-confirm"]')
            ?.shadowRoot?.querySelector("button")?.disabled,
        ).toBe(false),
      );
      dialog
        .shadowRoot!.querySelector('wt-button[data-test="delete-confirm"]')!
        .shadowRoot!.querySelector("button")!
        .click();
      await vi.waitFor(() =>
        expect(
          (dialog.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
            .error,
        ).not.toBe(""),
      );
    }
    await expectNoA11yViolations(host);
  });
});
