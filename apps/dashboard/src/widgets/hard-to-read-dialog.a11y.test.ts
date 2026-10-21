import { afterEach, expect, it } from "vitest";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./hard-to-read-dialog.js";

type Dialog = HTMLElementTagNameMap["dashboard-hard-to-read-dialog"];

const cases = [true, false].flatMap((canFix) =>
  (["light", "dark"] as const).flatMap((mode) =>
    ["en-GB", "es-ES"].map((locale) => ({ canFix, mode, locale })),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)(
  "Hard to read dialog, Fix and save $canFix, $locale / $mode",
  async ({ canFix, mode, locale }) => {
    setLocale(locale);
    const { el, host } = await mountWidget<Dialog>(
      "dashboard-hard-to-read-dialog",
      {
        open: true,
        canFix,
        lines: [t("appearance.dialog_brand_light"), t("appearance.dialog_brand_dark")],
      },
      mode,
    );
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    expect(el.shadowRoot!.querySelectorAll("li")).toHaveLength(2);
    await expectNoA11yViolations(host);
  },
);
