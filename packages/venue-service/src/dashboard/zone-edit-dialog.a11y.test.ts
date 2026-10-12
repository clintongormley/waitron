import { afterEach, describe, expect, it } from "vitest";
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
});
