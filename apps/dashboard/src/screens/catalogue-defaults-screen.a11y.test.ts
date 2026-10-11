import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { CatalogueDefaultsScreen } from "./catalogue-defaults-screen.js";
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
  "scans the Defaults page in $locale/$theme/$width",
  async ({ theme, locale, width }) => {
    await page.viewport(width, 900);
    setLocale(locale);
    const api = {
      liveData: new LiveData(),
      getCatalogueSettings: vi
        .fn()
        .mockResolvedValue({ defaultProductVatClass: "reduced", defaultColor: null }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<CatalogueDefaultsScreen>(
      "dashboard-catalogue-defaults-screen",
      { api },
      theme,
    );
    host.style.width = "100%";
    const panel = el.shadowRoot!.querySelector("dashboard-catalogue-settings-panel")!;
    await expect.poll(() => panel.shadowRoot?.querySelector("wt-combobox")).toBeTruthy();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    await expectNoA11yViolations(host);
  },
);
