import { afterEach, it } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./theme-preview.js";

type Preview = HTMLElementTagNameMap["dashboard-theme-preview"];

const drafts: Record<string, ThemeChoices> = {
  waitron: WAITRON_CHOICES,
  lucia: {
    brandColor: "#1e5b3a",
    brandFix: { dark: true },
    background: "tinted",
    corners: "round",
    handSet: { light: {}, dark: {} },
  },
  lemon: { ...WAITRON_CHOICES, brandColor: "#f2d300" },
  "two fixes": {
    ...WAITRON_CHOICES,
    handSet: { light: { text: "#6a6a6a", "surface-sunken": "#bbbbbb" }, dark: {} },
  },
};

const cases = ["light", "dark"].flatMap((mode) =>
  Object.keys(drafts).map((draft) => ({ mode: mode as "light" | "dark", draft })),
);

afterEach(() => {
  cleanupWidgets();
});

it.each(cases)("theme preview: $draft / $mode", async ({ mode, draft }) => {
  const { host } = await mountWidget<Preview>(
    "dashboard-theme-preview",
    { theme: deriveTheme(drafts[draft]!), name: "Bar Lucía" },
    mode,
  );
  await expectNoA11yViolations(host);
});
