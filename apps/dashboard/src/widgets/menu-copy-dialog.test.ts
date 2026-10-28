import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { MenuCopyDialog } from "./menu-copy-dialog.js";
import "./menu-copy-dialog.js";
registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
it.each(
  [390, 1280].flatMap((width) =>
    ["en", "es"].flatMap((locale) =>
      ["light", "dark"].map((theme) => ({ width, locale, theme: theme as "light" | "dark" })),
    ),
  ),
)("Copy menu: $width $locale $theme", async ({ width, locale, theme }) => {
  const previous = currentLocale();
  const size = [window.innerWidth, window.innerHeight] as const;
  try {
    setLocale(locale);
    await page.viewport(width, 844);
    const { el: form, host } = await mountWidget<MenuCopyDialog>(
      "dashboard-menu-copy-dialog",
      {
        open: true,
        menu: { id: "lunch", name: "Lunch menu" },
        menus: [{ id: "dinner", name: "Dinner menu", active: true, version: 1 }],
        api: { duplicateCatalogue: vi.fn() },
      },
      theme,
    );
    const modal = form.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    const box = modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
    const input = form.shadowRoot!.querySelector("wt-input")!;
    await input.updateComplete;
    const copy =
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=copy]")!;
    expect(input.shadowRoot!.querySelector("input")!.required).toBe(true);
    expect(copy.disabled).toBe(true);
    await expectNoA11yViolations(host);
    await page.screenshot({ path: `__screenshots__/a1172/${locale}-${theme}-${width}-empty.png` });
    await userEvent.fill(
      page.elementLocator(input.shadowRoot!.querySelector("input")!),
      "dINNER MENU",
    );
    await form.updateComplete;
    copy.click();
    await form.updateComplete;
    expect(input.error).toBe(t("menus.name_taken"));
    expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    expect(copy.disabled).toBe(true);
    await expectNoA11yViolations(host);
    await page.screenshot({ path: `__screenshots__/a1172/${locale}-${theme}-${width}-taken.png` });
  } finally {
    setLocale(previous);
    await page.viewport(...size);
  }
});
