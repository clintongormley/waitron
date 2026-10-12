import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { SpecialDayDialog } from "./special-day-dialog.js";
import "./special-day-dialog.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
const navidad = {
  id: "h",
  date: "2026-12-25",
  name: "Navidad",
  scope: "national" as const,
  sourceId: "s",
};
const stored = {
  id: "d1",
  name: "Christmas dinners",
  repeatsYearly: true,
  dates: [
    { date: "2026-12-14", closedAllDay: false },
    { date: "2026-12-25", closedAllDay: true },
  ],
  paint: [],
  zonePaint: [],
};
async function mount(theme: "light" | "dark", state: string) {
  const el = (await mountThemed(
    "<special-day-dialog></special-day-dialog>",
    theme,
  )) as SpecialDayDialog;
  el.holidays = [navidad];
  if (state === "offer") {
    el.date = "2026-12-25";
    el.existing = [{ id: "n", name: "Navidad" }];
  } else if (state === "new" || state === "invalid") el.date = "2026-11-04";
  else el.specialDay = structuredClone(stored);
  el.open = true;
  await el.updateComplete;
  const root = el.shadowRoot!;
  if (state === "adding") root.querySelector<HTMLElement>("[data-test=add-dates]")!.click();
  if (state === "invalid") {
    root.querySelector<HTMLElement>("[data-test=remove-date]")!.click();
    await el.updateComplete;
    root
      .querySelector("[name=repeatsYearly]")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "yes" } }));
    await el.updateComplete;
    root.querySelector<HTMLElement>("[data-test=save-special-day]")!.click();
  }
  if (state === "refused")
    el.refusal = {
      code: "special_day.date_taken",
      params: { date: "2026-12-14", name: "Other", specialDayId: "o" },
    };
  if (state === "saving") el.busy = true;
  await el.updateComplete;
  return el;
}

describe.each(["light", "dark"] as const)("Special day (%s)", (theme) => {
  test.each(["new", "edit", "offer", "adding", "invalid", "refused", "saving"])(
    "%s",
    async (state) => {
      setLocale("en");
      const el = await mount(theme, state);
      const root = el.shadowRoot!;
      expect(root.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.open).toBe(true);
      if (state === "offer") expect(root.querySelector("[data-test=add-to]")).not.toBeNull();
      if (state === "edit") expect(root.querySelector("[data-test=holiday-note]")).not.toBeNull();
      if (state === "adding") expect(root.querySelector("[name=addFrom]")).not.toBeNull();
      if (state === "invalid" || state === "refused")
        expect(root.querySelector("[data-error=dates]")!.textContent).not.toBe("");
      if (state === "saving")
        expect(root.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.disabled).toBe(
          true,
        );
      await expectNoA11yViolations(host);
    },
  );
});

describe.each(["en", "es"] as const)("visual %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    test.each([390, 1280])("%s px", async (width) => {
      setLocale(locale);
      await page.viewport(width, 900);
      expect(window.innerWidth).toBe(width);
      const el = await mount(theme, "edit");
      expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
      await page.screenshot({
        path: `../__screenshots__/special-day-${locale}-${theme}-${width}.png`,
      });
      await page.viewport(1280, 768);
    });
  });
});
