import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { NamedDayEditor } from "./named-day-editor.js";
import "./named-day-editor.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Named day (%s)", (theme) => {
  test.each(["new", "edit", "leap", "closed", "refused", "invalid", "saving"])(
    "%s",
    async (state) => {
      setLocale("en");
      const el = (await mountThemed(
        "<named-day-editor></named-day-editor>",
        theme,
      )) as NamedDayEditor;
      if (state !== "new" && state !== "invalid")
        el.day = {
          id: "d1",
          date: "2028-02-29",
          name: "Anniversary",
          kind: "holiday",
          repeats: state === "leap",
          ownHours: state === "leap",
          closeWholeVenue: state === "closed",
          hasStationHours: false,
        };
      el.open = true;
      await el.updateComplete;
      if (state === "invalid") {
        el.shadowRoot!.querySelector("[name=repeats]")!.dispatchEvent(
          new CustomEvent("wt-change", { detail: { checked: true } }),
        );
        await el.updateComplete;
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-named-day]")!.click();
      }
      if (state === "refused") el.refusal = { code: "hours.invalid", params: { field: "repeats" } };
      if (state === "saving") el.busy = true;
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.open,
      ).toBe(true);
      if (state === "invalid")
        expect(
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
        ).not.toBe("");
      if (state === "closed") expect(el.shadowRoot!.querySelector("[name=ownHours]")).toBeNull();
      if (state === "refused")
        expect(el.shadowRoot!.querySelector("[data-error=repeats]")!.textContent).not.toBe("");
      if (state === "saving")
        expect(
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.disabled,
        ).toBe(true);
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
      const el = (await mountThemed(
        "<named-day-editor></named-day-editor>",
        theme,
      )) as NamedDayEditor;
      el.day = {
        id: "d1",
        date: "2028-02-29",
        name: locale === "es" ? "Aniversario del restaurante" : "Restaurant anniversary",
        kind: "holiday",
        repeats: true,
        ownHours: true,
        closeWholeVenue: false,
        hasStationHours: false,
      };
      el.ownHours = true;
      el.savableAtOpen = true;
      el.open = true;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
      await page.screenshot({ path: `../__screenshots__/task19-${locale}-${theme}-${width}.png` });
      await page.viewport(1280, 768);
    });
  });
});
