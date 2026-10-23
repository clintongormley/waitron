import { afterEach, expect, it } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { DashboardApi, type ThemeList, type ThemeView } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./appearance-screen.js";

type Screen = HTMLElementTagNameMap["dashboard-appearance-screen"];
type Card = HTMLElementTagNameMap["dashboard-look-card"];

function theme(id: string, name: string, choices: ThemeChoices): ThemeView {
  const derived = deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived.light,
    dark: derived.dark,
    warnings: derived.warnings,
  };
}

const lucia = theme("t-lucia", "Bar Lucía", {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  logo: null,
  handSet: { light: {}, dark: {} },
});
const lemon = theme("t-lemon", "Lemon Café", { ...WAITRON_CHOICES, brandColor: "#f2d300" });
const hand = theme("t-hand", "By hand", {
  ...WAITRON_CHOICES,
  handSet: { dark: { bg: "#101010" }, light: { text: "#6a6a6a", bg: "#f8f1e1" } },
});
const inUse = (view: ThemeView): ThemeList => ({ themes: [view], inUse: view.id });
const xmas = theme("t-xmas", "Christmas", {
  ...WAITRON_CHOICES,
  brandColor: "#7a1f2b",
  brandFix: { dark: true },
});
/** `#2a6fb0` warns on dark screens only. */
const summer = theme("t-summer", "Summer terrace", { ...WAITRON_CHOICES, brandColor: "#2a6fb0" });
const four: ThemeList = { themes: [lucia, xmas, summer], inUse: lucia.id };

const states: Record<string, { list: ThemeList; select: string; canEdit?: boolean }> = {
  waitron: { list: { themes: [lucia], inUse: null }, select: "[data-test=saved-theme]" },
  lucia: { list: inUse(lucia), select: "[data-test=edit]" },
  "lemon-warning": { list: inUse(lemon), select: "[data-test=saved-warning]" },
  "hand-set": { list: inUse(hand), select: "[data-test=saved-hand]" },
  "four themes, editor": { list: four, select: "[data-test=saved-theme]" },
  "four themes, supervisor": { list: four, select: "[data-test=saved-theme]", canEdit: false },
};

const cases = ["light", "dark"].flatMap((mode) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    Object.keys(states).map((state) => ({ mode: mode as "light" | "dark", locale, state })),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)("Appearance page: $state, $locale / $mode", async ({ mode, locale, state }) => {
  setLocale(locale);
  const { list, select, canEdit = true } = states[state]!;
  const fetchImpl = () => Promise.resolve(new Response(JSON.stringify(list), { status: 200 }));
  const api = new DashboardApi("", fetchImpl);
  const { el, host } = await mountWidget<Screen>(
    "dashboard-appearance-screen",
    { api, canEdit },
    mode,
  );
  await expect
    .poll(() =>
      (
        el.shadowRoot!.querySelector("dashboard-look-card") as Card | null
      )?.shadowRoot?.querySelector(select),
    )
    .toBeTruthy();
  await expect
    .poll(() =>
      el
        .shadowRoot!.querySelector("dashboard-themes-card")
        ?.shadowRoot?.querySelector("wt-data-table"),
    )
    .toBeTruthy();
  await (el.shadowRoot!.querySelector("dashboard-look-card") as Card).updateComplete;
  const themes = el.shadowRoot!.querySelector("dashboard-themes-card")!;
  await themes.updateComplete;
  await themes.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  await expectNoA11yViolations(host);
});
