import { afterEach, expect, it, onTestFinished } from "vitest";
import { page } from "vitest/browser";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import type { MenuChange } from "../api/client.js";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import type { MenuPreviewPanel } from "./menu-preview.js";
import "./menu-preview.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(viewport.width, viewport.height);
});
const from: {
  name: Record<string, string>;
  abbreviation: Record<string, string>;
  staffName: string;
  staffAbbreviation: string;
  precision: number;
} = {
  name: { en: "Kilogram", es: "ES kilogram" },
  staffName: "Staff kilogram",
  abbreviation: { en: "kg", es: "kg" },
  staffAbbreviation: "staff-kg",
  precision: 3,
};
const status = {
  state: "changed" as const,
  clashes: 0,
  version: 2,
  publishedAt: "2026-10-20T08:00:00.000Z",
  hash: "a".repeat(64),
};
async function open(to: typeof from, theme: "light" | "dark" = "light") {
  const config = currentContentLanguages();
  onTestFinished(() => setContentLanguages(config));
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es", "fr"] });
  const change: MenuChange = {
    id: "unit-name-only",
    targets: { before: [], after: [] },
    kind: "extra_unit_changed",
    productId: "extra",
    name: "Ham",
    listId: "extras",
    listName: "Extras",
    from,
    to,
    source: "this_menu",
  };
  return mountWidget<MenuPreviewPanel>(
    "dashboard-menu-preview",
    {
      menuName: "Lunch",
      status,
      preview: {
        live: null,
        clashes: [],
        hash: "b".repeat(64),
        changes: [change],
        warnings: [],
        status,
        document: menuDocument([], {}),
      },
    },
    theme,
  );
}
function words(el: MenuPreviewPanel) {
  return [...el.shadowRoot!.querySelectorAll('[data-test="changes"] li > span')]
    .map((node) => node.textContent!.replace(/\s+/g, " ").trim())
    .join(" ");
}
it.each(
  ["light", "dark"].flatMap((theme) =>
    [390, 1280].flatMap((width) =>
      ["en-GB", "es-ES"].map((locale) => ({ theme: theme as "light" | "dark", width, locale })),
    ),
  ),
)(
  "distinguishes a unit-name-only change in $locale / $theme at $width px",
  async ({ theme, width, locale }) => {
    await page.viewport(width, 900);
    setLocale(locale);
    const { el, host } = await open({ ...from, name: { en: "Kilo", es: "ES kilo" } }, theme);
    const wanted =
      locale === "en-GB"
        ? "Extras: Ham unit changed from Kilogram · kg (3 decimal places) to Kilo · kg (3 decimal places)"
        : es["menu_preview.extra_unit_changed"]
            .replace("{list}", "Extras")
            .replace("{name}", "Ham")
            .replace("{from}", "ES kilogram · kg")
            .replace("{to}", "ES kilo · kg")
            .replace("{fromPrecision}", "3")
            .replace("{toPrecision}", "3");
    expect(words(el)).toBe(wanted);
    const list = el.shadowRoot!.querySelector<HTMLElement>('[data-test="changes"]')!;
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
    await expectNoA11yViolations(host);
    await page.screenshot({
      element: el,
      path: `__screenshots__/look/a682-unit-change-${locale}-${theme}-${width}.png`,
    });
  },
);
it("uses staff unit text for a new name when no enabled translation exists", async () => {
  setLocale("en-GB");
  const { el } = await open({
    ...from,
    name: {},
    staffName: "Weight",
    abbreviation: {},
    staffAbbreviation: "wt",
  });
  expect(words(el)).toBe(
    "Extras: Ham unit changed from Kilogram · kg (3 decimal places) to Weight · wt (3 decimal places)",
  );
});
it("describes hidden unit facts without printing an identical before/after pair", async () => {
  setLocale("en-GB");
  const { el } = await open({ ...from, staffName: "Changed staff unit" });
  expect(words(el)).toBe("Extras: Ham unit details changed");
});
