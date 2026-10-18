import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type {
  FloorPlanSetDeleteDialog,
  FloorPlanSetDeleteImpact,
} from "./floor-plan-set-delete-dialog.js";
import "./floor-plan-set-delete-dialog.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const used: FloorPlanSetDeleteImpact = {
  periods: [{ id: "dinner-period", name: "Dinner" }],
  zonesShowing: [{ id: "inside", name: "Inside" }],
};
const confirm = (el: FloorPlanSetDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-delete]")!;

async function mount(theme: "light" | "dark") {
  const el = (await mountThemed(
    "<dashboard-floor-plan-set-delete-dialog></dashboard-floor-plan-set-delete-dialog>",
    theme,
  )) as FloorPlanSetDeleteDialog;
  el.set = { id: "dinner", name: "Dinner" };
  el.defaultSet = { id: "standard", name: "Standard" };
  el.replacements = [{ id: "private", name: "Private party" }];
  el.open = true;
  return el;
}

describe.each(["light", "dark"] as const)("Floor plan set delete dialog (%s)", (theme) => {
  test.each(["loading", "read-failed", "used", "unused", "refused"])("%s", async (state) => {
    const el = await mount(theme);
    if (state === "read-failed") el.readError = "What deleting it changes could not be read.";
    if (state === "used" || state === "refused") el.impact = used;
    if (state === "unused") el.impact = { periods: [], zonesShowing: [] };
    if (state === "refused")
      el.refusal = { code: "floor_plan_set.invalid", params: { field: "replaceWith" } };
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector("[name=replaceWith]");
    if (state === "loading") expect(el.shadowRoot!.querySelector("[role=status]")).not.toBeNull();
    if (state === "read-failed")
      expect(el.shadowRoot!.querySelector("[data-test=retry-delete]")).not.toBeNull();
    if (state === "used" || state === "refused") expect(picker).not.toBeNull();
    if (state === "unused") expect(picker).toBeNull();
    await expectNoA11yViolations(host);
  });
});

describe.each(["en", "es"] as const)("At phone width (%s)", (locale) => {
  test("the Delete button stays on screen", async () => {
    setLocale(locale);
    await page.viewport(390, 900);
    try {
      const el = await mount("light");
      el.set = { id: "dinner", name: "Christmas private party" };
      el.impact = used;
      await el.updateComplete;
      await confirm(el).updateComplete;
      const right = confirm(el).getBoundingClientRect().right;
      expect(right).toBeGreaterThan(0);
      expect(right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    } finally {
      await page.viewport(1280, 768);
    }
  });
});
