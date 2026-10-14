import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PeriodDeleteImpact } from "./opening-hours-client.js";
import type { PeriodDeleteDialog } from "./period-delete-dialog.js";
import "./period-delete-dialog.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const impactOf = (overrides: Partial<PeriodDeleteImpact> = {}): PeriodDeleteImpact => ({
  seasons: 0,
  specialDays: 0,
  routingUses: [],
  keptOpenToday: false,
  replacements: [
    { id: "p2", name: "Lunch" },
    { id: "p3", name: "Brunch" },
  ],
  clockRevision: 0,
  ...overrides,
});
const painted = impactOf({
  seasons: 4,
  specialDays: 2,
  routingUses: [{ rowKind: "category", rowLabel: "Cocktails", zoneName: null }],
});
const confirm = (el: PeriodDeleteDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-delete]")!;

async function mount(theme: "light" | "dark") {
  const el = (await mountThemed(
    "<period-delete-dialog></period-delete-dialog>",
    theme,
  )) as PeriodDeleteDialog;
  el.period = { id: "p1", name: "Dinner" };
  el.open = true;
  return el;
}

describe.each(["light", "dark"] as const)("Period delete dialog (%s)", (theme) => {
  test.each([
    "loading",
    "read-failed",
    "painted",
    "routing",
    "kept-open",
    "replaced",
    "refused",
    "nowhere",
  ])("%s", async (state) => {
    const el = await mount(theme);
    if (state === "read-failed") el.readError = "The deletion impact could not be loaded.";
    if (state === "painted" || state === "replaced" || state === "refused") el.impact = painted;
    if (state === "routing") el.impact = impactOf({ routingUses: painted.routingUses });
    if (state === "kept-open") el.impact = impactOf({ keptOpenToday: true });
    if (state === "nowhere") el.impact = impactOf();
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=replacementPeriodId]",
    );
    if (state === "replaced" || state === "refused") {
      picker!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "p2" }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
    }
    if (state === "refused") {
      el.refusal = { code: "menu_period.invalid", params: { field: "replacementPeriodId" } };
      await el.updateComplete;
      expect(picker!.error).toBe("Choose another period.");
    }
    if (state === "loading") expect(el.shadowRoot!.querySelector("[role=status]")).not.toBeNull();
    if (state === "read-failed")
      expect(el.shadowRoot!.querySelector("[data-test=retry-delete]")).not.toBeNull();
    if (state === "painted" || state === "kept-open") expect(picker).not.toBeNull();
    if (state === "routing" || state === "nowhere") expect(picker).toBeNull();
    await expectNoA11yViolations(host);
  });
});

describe.each(["en", "es"] as const)("At phone width (%s)", (locale) => {
  test("the Confirm button stays on screen", async () => {
    setLocale(locale);
    await page.viewport(390, 900);
    try {
      const el = await mount("light");
      el.period = { id: "p1", name: "Christmas set menu" };
      el.impact = painted;
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
