import { afterEach, expect, it } from "vitest";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { ThemeSwitchDialog } from "./theme-switch-dialog.js";
import "./theme-switch-dialog.js";

const cases = (["none", "lines", "error"] as const).flatMap((shape) =>
  (["light", "dark"] as const).flatMap((mode) =>
    ["en-GB", "es-ES"].map((locale) => ({ shape, mode, locale })),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)("switch dialog, $shape, $locale / $mode", async ({ shape, mode, locale }) => {
  setLocale(locale);
  const { el, host } = await mountWidget<ThemeSwitchDialog>(
    "dashboard-theme-switch-dialog",
    {
      open: true,
      name: "Summer terrace",
      lines: shape === "lines" ? [t("appearance.dialog_brand_dark")] : [],
      error: shape === "error" ? codeMessage("theme.name_taken") : "",
    },
    mode,
  );
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  expect(dialog.querySelectorAll("li")).toHaveLength(shape === "lines" ? 1 : 0);
  await expectNoA11yViolations(host);
});
