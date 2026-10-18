import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { TillCourse } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish, storedExtra } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { openSentDish } from "./till-table-order-screen.sent.test-helpers.js";
import { mount } from "./till-table-order-screen.test-helpers.js";

const course: TillCourse = {
  id: "dessert",
  name: "Dessert $& $'",
  displayOrder: 3,
  heldUntilFired: true,
};

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("course information after sending", () => {
  it.each(["held", "fired", "served"] as const)(
    "keeps a %s dish's course readable without editing it",
    async (kind) => {
      const state = kind === "held" ? "held" : "fired";
      const { el } = await mount({
        groups: [orderGroup("group", 1, state)],
        courses: [course],
        currentOrders: current({
          reminder: null,
          ungrouped: [],
          groups: [
            currentGroup("group", 1, state, [
              row("dish", "Recorded dish", "1.000", {
                courseId: course.id,
                released: kind !== "held",
                ...(kind === "served"
                  ? { servedAt: "2026-10-10T20:00:00Z", servedQuantity: "1.000" }
                  : {}),
              }),
            ]),
          ],
        }),
      });
      const dialog = await openSentDish(el, "dish", kind);
      expect(dialog.querySelector("[data-sent-course]")?.textContent?.trim()).toBe("Dessert $& $'");
      expect(
        dialog.querySelector("wt-combobox, till-modifier-picker, [data-change-line]"),
      ).toBeNull();
    },
  );

  it.each(["service", "bill"] as const)(
    "keeps a retired course from the %s read when active courses are gone",
    async (source) => {
      const { el } = await mount({
        courses: [],
        lines: source === "bill" ? [{ ...storedDish, courseId: course.id, course }] : [],
        groups: [orderGroup("group", 1, "held")],
        currentOrders: current({
          retainedCourses: source === "service" ? [course] : [],
          reminder: null,
          ungrouped: [],
          groups: [
            currentGroup("group", 1, "held", [
              row(storedDish.id, "Recorded dish", "2.000", {
                courseId: course.id,
                released: false,
              }),
            ]),
          ],
        }),
      });
      const dialog = await openSentDish(el, storedDish.id, "held");
      expect(dialog.querySelector("[data-sent-course]")?.textContent?.trim()).toBe("Dessert $& $'");
    },
  );

  it("uses the current service row's course identity when the bill read is older", async () => {
    const { el } = await mount({
      courses: [course],
      lines: [
        { ...storedDish, courseId: "old", course: { ...course, id: "old", name: "Older course" } },
      ],
      groups: [],
      currentOrders: current({
        groups: [],
        reminder: null,
        ungrouped: [row(storedDish.id, "Recorded dish", "2.000", { courseId: "retired" })],
      }),
    });
    const dialog = await openSentDish(el, storedDish.id);
    expect(dialog.querySelector("[data-sent-course]")?.textContent?.trim()).toBe("retired");
    expect(dialog.textContent).not.toContain("Older course");
  });

  it.each(["en", "es"] as const)("shows the localized no-course label in %s", async (locale) => {
    setLocale(locale);
    const { el } = await mount({
      courses: [course],
      currentOrders: current({
        groups: [],
        reminder: null,
        ungrouped: [row("dish", "Recorded dish", "1.000")],
      }),
    });
    const dialog = await openSentDish(el, "dish");
    expect(dialog.querySelector("[data-sent-course]")?.textContent?.trim()).toBe(
      t("table.course_none"),
    );
  });

  it("keeps course information in the read-only fallback, with no separate course on extras", async () => {
    const { el } = await mount({
      courses: [],
      currentOrders: null,
      lines: [
        { ...storedDish, courseId: course.id, course },
        { ...storedExtra, courseId: course.id, course },
      ],
    });
    const fallback = el.shadowRoot!.querySelector("[data-sent-fallback]")!;
    expect(fallback.querySelector("[data-sent-course]")?.textContent?.trim()).toBe("Dessert $& $'");
    expect(fallback.querySelectorAll("[data-sent-course]")).toHaveLength(1);
    expect(fallback.querySelector("wt-combobox")).toBeNull();
  });

  it("omits course information when there is no course configuration or retained label", async () => {
    const { el } = await mount({
      courses: [],
      currentOrders: current({
        groups: [],
        reminder: null,
        ungrouped: [row("dish", "Recorded dish", "1.000")],
      }),
    });
    const dialog = await openSentDish(el, "dish");
    expect(dialog.querySelector("[data-sent-course]")).toBeNull();
  });
});

it.each(["held", "fired", "served"] as const)(
  "opening the drawer cannot edit a %s dish's recorded course",
  async (kind) => {
    const { el } = await mount({
      courses: [course],
      lines: [
        {
          ...storedDish,
          courseId: course.id,
          course,
          firedAt: kind === "held" ? null : "2026-10-10T20:00:00Z",
          servedAt: kind === "served" ? "2026-10-10T20:01:00Z" : null,
        },
      ],
    });
    const changed: Event[] = [];
    el.addEventListener("set-line-course", (event) => changed.push(event));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    const drawer = el.shadowRoot!.querySelector<HTMLElement>("[data-drawer]")!;
    expect(drawer.querySelector("[data-line-course], [data-line-course-static]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-sent-course]")?.textContent?.trim()).toBe(
      "Dessert $& $'",
    );
    expect(changed).toEqual([]);
  },
);
