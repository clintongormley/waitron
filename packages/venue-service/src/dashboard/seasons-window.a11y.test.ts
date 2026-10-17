import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { SeasonsWindow } from "./seasons-window.js";
import "./seasons-window.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const seasons = [
  { id: "spring", name: "Spring", startsOn: "03-01", colour: "green" as const },
  { id: "summer", name: "Summer", startsOn: "06-01", colour: "amber" as const },
  { id: "autumn", name: "Autumn", startsOn: "09-01", colour: "orange" as const },
  { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" as const },
];

async function mount(state: string, theme: "light" | "dark") {
  const wrapper = await mountThemed("<div></div>", theme);
  const el = document.createElement("seasons-window") as SeasonsWindow;
  el.seasons = seasons;
  el.clockRevision = 0;
  el.readOnly = state === "read-only";
  wrapper.append(el);
  await el.updateComplete;
  if (state === "added") {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-season]")!
      .shadowRoot!.querySelector("button")!
      .click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(5);
  }
  return el;
}

describe.each(["light", "dark"] as const)("Seasons window (%s)", (theme) => {
  test.each(["editable", "read-only", "added"])("%s has no violations", async (state) => {
    const el = await mount(state, theme);
    await expectNoA11yViolations(el);
  });

  test("at 390 has no violations", async () => {
    const old = [window.innerWidth, window.innerHeight] as const;
    try {
      await page.viewport(390, 800);
      expect(window.innerWidth).toBe(390);
      const el = await mount("editable", theme);
      await expectNoA11yViolations(el);
    } finally {
      await page.viewport(old[0], old[1]);
    }
  });
});
