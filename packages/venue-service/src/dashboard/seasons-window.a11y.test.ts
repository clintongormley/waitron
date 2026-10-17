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
  if (state === "refused") {
    el.api = {
      saveSeasons: async () => {
        throw { code: "season.invalid", params: { field: "save.0.name", reason: "taken" } };
      },
      readSeasonDeleteImpact: async () => ({ departments: [] }),
    };
    const name = el.shadowRoot!.querySelector<HTMLElement>("[name=season-1-name]")!;
    name.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Early spring" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-seasons]")!
      .shadowRoot!.querySelector("button")!
      .click();
    await expect
      .poll(() => (name as HTMLElement & { error: string }).error)
      .toBe("Another season has this name.");
    await el.updateComplete;
  }
  if (state === "deleting") {
    el.api = {
      saveSeasons: async () => [],
      readSeasonDeleteImpact: async () => ({ departments: [{ id: "r", name: "Restaurant" }] }),
    };
    el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=delete-season]")[3]!
      .shadowRoot!.querySelector("button")!
      .click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-note]")?.textContent ?? "")
      .toContain("Restaurant");
    await el.updateComplete;
  }
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
  test.each(["editable", "read-only", "added", "refused", "deleting"])(
    "%s has no violations",
    async (state) => {
      const el = await mount(state, theme);
      await expectNoA11yViolations(el);
    },
  );

  test("at 390 has no violations", async () => {
    const old = [window.innerWidth, window.innerHeight] as const;
    try {
      await page.viewport(390, 800);
      expect(window.innerWidth).toBe(390);
      const el = await mount("editable", theme);
      const surface = getComputedStyle(
        el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!,
      ).backgroundColor;
      for (const cell of el.shadowRoot!.querySelectorAll(".bin"))
        expect(getComputedStyle(cell).backgroundColor).toBe(surface);
      await expectNoA11yViolations(el);
    } finally {
      await page.viewport(old[0], old[1]);
    }
  });
});
