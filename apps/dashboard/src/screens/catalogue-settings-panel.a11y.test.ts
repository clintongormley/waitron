import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { CatalogueSettingsPanel } from "./catalogue-settings-panel.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(1280, 900);
});
const cases = ["light", "dark"].flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    [390, 1280].map((width) => ({ theme: theme as "light" | "dark", locale, width })),
  ),
);

it.each(cases)(
  "paints and scans the VAT default in $locale/$theme/$width",
  async ({ theme, locale, width }) => {
    await page.viewport(width, 900);
    setLocale(locale);
    for (const state of ["ready", "invalid", "saving", "save-error", "loading", "read-error"]) {
      const api = {
        liveData: new LiveData(),
        getCatalogueSettings: vi.fn().mockResolvedValue({ defaultProductVatClass: "reduced" }),
        saveCatalogueSettings: vi.fn().mockRejectedValue({ code: "connection.failed" }),
      } as unknown as DashboardApi;
      if (state === "loading")
        vi.mocked(api.getCatalogueSettings).mockImplementation(() => new Promise(() => undefined));
      if (state === "read-error")
        vi.mocked(api.getCatalogueSettings).mockRejectedValue({ code: "connection.failed" });
      if (state === "saving")
        vi.mocked(api.saveCatalogueSettings).mockImplementation(() => new Promise(() => undefined));
      const { el, host } = await mountWidget<CatalogueSettingsPanel>(
        "dashboard-catalogue-settings-panel",
        { api },
        theme,
      );
      host.style.width = "100%";
      if (!["loading", "read-error"].includes(state)) {
        await expect.poll(() => el.shadowRoot?.querySelector("wt-combobox")).toBeTruthy();
        if (state === "invalid") {
          el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: "" },
              bubbles: true,
              composed: true,
            }),
          );
          await el.updateComplete;
        }
        if (["invalid", "saving", "save-error"].includes(state)) {
          el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
          await el.updateComplete;
          if (state === "save-error")
            await expect
              .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
              .not.toBe("");
        }
      } else if (state === "read-error") {
        await expect.poll(() => el.shadowRoot?.querySelector('[role="alert"]')).toBeTruthy();
      }
      expect(host.getBoundingClientRect().width).toBeLessThanOrEqual(width);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/a356/${locale}-${theme}-${width}-${state}.png`,
      });
      cleanupWidgets();
    }
  },
);
