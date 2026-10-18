import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StaffingMonth } from "../staffing-types.js";
import type { StaffingMonthView } from "./staffing-month.js";
import "./staffing-month.js";
import { fakeApi, staffingMonth } from "../testing/staffing-month-fixture.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

async function view(
  read?: (month: string) => Promise<StaffingMonth>,
  params: Record<string, string> = {},
) {
  const el = document.createElement("staffing-month") as StaffingMonthView;
  el.api = fakeApi(read).api;
  el.month = "2026-12";
  el.params = params;
  host.append(el);
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
  }
  return el;
}
const root = (el: StaffingMonthView) => el.shadowRoot!;
async function openBox(canWrite: boolean) {
  const el = await view();
  el.canWrite = canWrite;
  el.canOpenRota = true;
  await el.updateComplete;
  root(el).querySelector<HTMLButtonElement>("td[data-date='2026-12-24'] button.day")!.click();
  await el.updateComplete;
  const box = root(el).querySelector("calendar-day-box")!;
  await vi.waitFor(() => expect(box.shown).toBe(true));
  expect(box.querySelectorAll("wt-button").length).toBeGreaterThan(0);
}

const states: Record<string, () => Promise<void>> = {
  loading: async () => {
    const el = await view(() => new Promise(() => undefined));
    expect(root(el).querySelector("[data-test=loading]")).not.toBeNull();
  },
  "a painted month": async () => {
    const el = await view();
    expect(root(el).querySelectorAll("[data-test=area-line]").length).toBeGreaterThan(0);
  },
  "one area": async () => {
    const el = await view(undefined, { area: "station:st-kitchen" });
    expect(root(el).querySelector("td[data-date='2026-12-01']")!.textContent).toContain(
      "Kitchen 4",
    );
  },
  "a month with no paint": async () => {
    const el = await view(async (month) => ({
      ...staffingMonth(month),
      days: staffingMonth(month).days.map((day) => ({ ...day, areas: [] })),
    }));
    expect(root(el).querySelector("[data-test=area-line]")).toBeNull();
  },
  "a month a person may write to": async () => {
    const el = await view();
    el.canWrite = true;
    await el.updateComplete;
    expect(root(el).querySelector("button.day")).not.toBeNull();
    expect(root(el).querySelector("td[data-date='2026-12-03'] button.day")).not.toBeNull();
  },
  "the day box, a writer": async () => {
    await openBox(true);
  },
  "the day box, a viewer": async () => {
    await openBox(false);
  },
  "a special-day run": async () => {
    const fair = { id: "sd-fair", name: "Fair" };
    const el = await view(async (month) => {
      const read = staffingMonth(month);
      return {
        ...read,
        days: read.days.map((day) => ({
          ...day,
          specialDay: ["2026-12-15", "2026-12-16", "2026-12-17"].includes(day.date) ? fair : null,
        })),
      };
    });
    expect(root(el).querySelectorAll("[data-test=special-run]")).toHaveLength(3);
  },
  "a read failure": async () => {
    const el = await view(() => Promise.reject({ code: "connection.failed" }));
    expect(root(el).querySelector("[data-test=load-error]")).not.toBeNull();
  },
};

describe.each(["light", "dark"] as const)("Staffing month accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    await states[state]!();
    await expectNoA11yViolations(host);
  });
});
