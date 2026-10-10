import { afterEach, describe, expect, it } from "vitest";
import { registerIcons, DROPDOWN_ICONS } from "@waitron/ui";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { VenueServiceApi } from "./client.js";
import { placedZonePlan, zonesModel } from "../testing/department-zones-fixture.js";
import "./department-zones.js";
registerIcons({
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
  ...DROPDOWN_ICONS,
});
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Zones (%s)", (theme) => {
  it.each(["active", "preview", "disabled", "empty", "refusal", "menu"] as const)(
    "%s is accessible",
    async (state) => {
      setLocale("en");
      const el = (await mountThemed(
        "<department-zones></department-zones>",
        theme,
      )) as HTMLElementTagNameMap["department-zones"];
      el.model = structuredClone(zonesModel);
      el.departmentId = "d1";
      el.zone = "z2";
      if (state === "disabled") el.model.zones[1]!.active = false;
      if (state === "empty") el.model.zones = [];
      el.api = new VenueServiceApi((async (path: string) => {
        if (state === "preview" && path.endsWith("/floor-plan")) return placedZonePlan;
        throw { code: "management.request_invalid", params: { field: "paidWhen" } };
      }) as DashboardRequest);
      await el.updateComplete;
      if (state === "preview")
        await expect
          .poll(() =>
            el
              .shadowRoot!.querySelector("wt-floor-plan-preview")
              ?.shadowRoot?.querySelector("[role=img]")
              ?.getAttribute("aria-label"),
          )
          .toBe("Floor plan: Bar");
      if (state === "refusal") {
        const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
        fields.dispatchEvent(
          new CustomEvent("service-settings-change", {
            detail: { value: { ...fields.value, paidWhen: "ticket_then_pay" } },
            bubbles: true,
            composed: true,
          }),
        );
        await el.updateComplete;
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-zone]")!.click();
        await expect
          .poll(
            async () =>
              (await formMessageOf(el.shadowRoot!.querySelector("wt-form-actions")!))?.textContent,
          )
          .toContain("Correct the highlighted fields");
      }
      if (state === "menu") {
        const menu = el.shadowRoot!.querySelector("wt-row-actions")!;
        await menu.updateComplete;
        menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
        await menu.updateComplete;
      }
      if (state === "active")
        for (const link of ["zone-opening-hours", "zone-floor-plan"])
          expect(el.shadowRoot!.querySelector(`a[data-test=${link}]`)).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );
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
      const el = (await mountThemed(
        "<department-zones></department-zones>",
        theme,
      )) as HTMLElementTagNameMap["department-zones"];
      host.style.width = "100%";
      host.style.boxSizing = "border-box";
      host.style.padding = "var(--wt-space-4)";
      el.model = structuredClone(zonesModel);
      el.departmentId = "d1";
      el.zone = "z2";
      await el.updateComplete;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      expect(window.innerWidth).toBe(width);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(
        el.shadowRoot!.querySelector("wt-form-actions")!.getBoundingClientRect().bottom,
      ).toBeLessThan(1100);
      await expectNoA11yViolations(host);
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });
});
