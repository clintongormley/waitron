import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import {
  cleanupZoneEditors,
  mountZoneEditor,
  editZoneName,
  zoneSave,
} from "../testing/zone-edit-fixture.js";
afterEach(() => {
  cleanupZoneEditors();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("zone editor accessibility in %s", (theme) => {
  it.each(["clean", "invalid", "refused", "pending"] as const)("%s", async (state) => {
    setLocale("en");
    let finish: (() => void) | undefined;
    const { el, modal, app } = await mountZoneEditor(
      (async (path, method = "GET") => {
        if (method === "GET")
          return path.includes("floor-plan") ? { tables: [] } : { departments: [] };
        if (state === "pending")
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        if (state === "refused") throw { code: "zone.name_taken" };
      }) as DashboardRequest,
      theme,
    );
    try {
      if (state !== "clean") {
        await editZoneName(el, state === "invalid" ? "" : "Draft");
        zoneSave(el).click();
        await el.updateComplete;
        if (state === "refused")
          await expect
            .poll(
              () =>
                el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!
                  .error,
            )
            .toBe("A zone with this name already exists.");
        if (state === "pending") await expect.poll(() => !!finish).toBe(true);
      }
      expect(modal.open).toBe(true);
      await expectNoA11yViolations(app);
    } finally {
      finish?.();
    }
  });
  it.each([
    ["en", 390],
    ["en", 1280],
    ["es", 390],
    ["es", 1280],
  ] as const)("%s at %i stays inside the viewport", async (locale, width) => {
    const old = [window.innerWidth, window.innerHeight];
    try {
      await page.viewport(width, 1100);
      setLocale(locale);
      const { el, app } = await mountZoneEditor(undefined, theme);
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      expect(window.innerWidth).toBe(width);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(
        el.shadowRoot!.querySelector("wt-form-actions")!.getBoundingClientRect().bottom,
      ).toBeLessThan(1100);
      await expectNoA11yViolations(app);
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });
});
