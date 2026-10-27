import { mediaTestReference, mediaTestRendition } from "@waitron/ui/src/test-helpers.js";
import type { ThemeLogo } from "@waitron/ui-core/theme";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi, ThemeLogoPrint } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { ThemeLogoField } from "./theme-logo-field.js";
import "./theme-logo-field.js";

const LIGHT = mediaTestReference("lucia.png");
const DARK = mediaTestReference("lucia-dark.png");

const BLACK: ThemeLogoPrint = {
  paperDots: 504,
  address: mediaTestRendition(LIGHT, "display"),
  picture: { widthDots: 16, heightDots: 1, data: "8A8=" },
  blackDots: 8,
};

const states: Record<string, { logo: ThemeLogo | null; errors?: () => ThemeLogoField["errors"] }> =
  {
    none: { logo: null },
    "none, with an error": {
      logo: null,
      errors: () => ({ light: t("appearance.logo_not_found") }),
    },
    "main only": { logo: { light: LIGHT } },
    "main only, with an error": {
      logo: { light: LIGHT },
      errors: () => ({ dark: t("appearance.logo_dark_without_light") }),
    },
    "main and dark": { logo: { light: LIGHT, dark: DARK } },
    "main and dark, with errors": {
      logo: { light: LIGHT, dark: DARK },
      errors: () => ({
        light: t("appearance.logo_not_found"),
        dark: t("appearance.logo_not_found"),
      }),
    },
  };

const cases = (["light", "dark"] as const).flatMap((mode) =>
  Object.keys(states).flatMap((state) =>
    (["en-GB", "es-ES"] as const).map((locale) => ({ mode, state, locale })),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

it.each(cases)("Logo field: $state, $locale / $mode", async ({ mode, state, locale }) => {
  setLocale(locale);
  const { logo, errors } = states[state]!;
  const { el, host } = await mountWidget<ThemeLogoField>(
    "dashboard-theme-logo-field",
    {
      api: {
        imageLibraryRequest: vi.fn(),
        getThemeLogoPrint: vi.fn(async () => BLACK),
      } as unknown as DashboardApi,
      logo,
      errors: errors?.() ?? {},
    },
    mode,
  );
  expect(el.shadowRoot!.querySelectorAll("p.error")).toHaveLength(
    Object.keys(errors?.() ?? {}).length,
  );
  if (logo !== null) {
    const print = el.shadowRoot!.querySelector("dashboard-theme-logo-print")!;
    await vi.waitFor(() =>
      expect(print.shadowRoot!.querySelector('[data-test="logo-print"] img')).not.toBeNull(),
    );
  }
  await expectNoA11yViolations(host);
});
