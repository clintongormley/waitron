import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS, deriveTheme } from "@waitron/ui-core/theme/waitron";
import { DashboardApi, type ThemeList, type ThemeView } from "../api/client.js";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./themes-card.js";

type Card = HTMLElementTagNameMap["dashboard-themes-card"];
type Table = HTMLElementTagNameMap["wt-data-table"];

const PRIMARY = "--wt-color-primary";
const BG = "--wt-color-bg";

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
  handSet: { light: {}, dark: {} },
});
const xmas = theme("t-xmas", "Christmas", {
  ...WAITRON_CHOICES,
  brandColor: "#7a1f2b",
  brandFix: { dark: true },
});
/** `#2a6fb0` warns on dark screens only. */
const summer = theme("t-summer", "Summer terrace", { ...WAITRON_CHOICES, brandColor: "#2a6fb0" });
const four: ThemeList = { themes: [lucia, xmas, summer], inUse: "t-lucia" };

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const table = (el: Card) => el.shadowRoot!.querySelector("wt-data-table") as Table;
const inTable = (el: Card, selector: string) =>
  table(el).shadowRoot!.querySelector<HTMLElement>(selector);
const row = (el: Card, key: string) => inTable(el, `tr[data-row-key="${key}"]`);
const chips = (el: Card, key: string) =>
  [...row(el, key)!.querySelectorAll<HTMLElement>("[part~=chip]")].map(
    (chip) => chip.style.background,
  );
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};
const columnKeys = (el: Card) => table(el).columns.map((column) => column.key);

async function mount(list: ThemeList, canEdit = true): Promise<Card> {
  const api = new DashboardApi("", () => Promise.reject(new Error("no request expected")));
  const { el } = await mountWidget<Card>("dashboard-themes-card", { api, list, canEdit });
  await table(el).updateComplete;
  return el;
}

afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  await page.viewport(1280, 800);
});

describe("dashboard-themes-card", () => {
  it("lists Waitron's theme first, built in, then the venue's", async () => {
    setLocale("en-GB");
    const el = await mount(four);
    expect(text(el.shadowRoot!.querySelector("h2"))).toBe("Themes");
    expect(table(el).getAttribute("aria-label")).toBe("Theme list");
    const names = [
      ...table(el).shadowRoot!.querySelectorAll<HTMLElement>("[data-test^=theme-row-]"),
    ].map((cell) => [cell.dataset.test, text(cell)]);
    expect(names).toEqual([
      ["theme-row-waitron", "Waitron"],
      ["theme-row-t-lucia", "Bar Lucía"],
      ["theme-row-t-xmas", "Christmas"],
      ["theme-row-t-summer", "Summer terrace"],
    ]);
    expect(text(row(el, "waitron")!.querySelector("[data-test=tag-built-in]"))).toBe("built in");
    expect(row(el, "t-lucia")!.querySelector("[data-test=tag-built-in]")).toBeNull();
    expect(text(row(el, "t-lucia")!.querySelector("[data-test=tag-in-use]"))).toBe("In use");
    expect(table(el).shadowRoot!.querySelectorAll("[data-test=tag-in-use]")).toHaveLength(1);
    expect(row(el, "t-xmas")!.querySelector("[data-test=tag-hard-to-read]")).toBeNull();
    const warning = row(el, "t-summer")!.querySelector("[data-test=tag-hard-to-read]");
    expect(summer.warnings).toHaveLength(1);
    expect(summer.warnings[0]!.mode).toBe("dark");
    expect(text(warning)).toBe("1 hard to read");
    expect(warning!.querySelector("wt-icon")!.getAttribute("name")).toBe("warning");
  });

  it("counts two warnings, and words the count in Spanish", async () => {
    const doubled: ThemeView = { ...summer, warnings: [...summer.warnings, ...summer.warnings] };
    const el = await mount({ themes: [doubled], inUse: null });
    expect(text(inTable(el, "[data-test=tag-hard-to-read]"))).toBe("2 hard to read");
    setLocale("es-ES");
    const spanish = await mount({ themes: [summer], inUse: null });
    expect(text(row(spanish, "t-summer")!.querySelector("[data-test=tag-hard-to-read]"))).toBe(
      es["appearance.hard_to_read_count_one"],
    );
  });

  it("Waitron's row is in use when no theme is", async () => {
    const el = await mount({ ...four, inUse: null });
    const inUse = [...table(el).shadowRoot!.querySelectorAll("[data-test=tag-in-use]")];
    expect(inUse).toHaveLength(1);
    expect(inUse[0]!.closest("tr")!.dataset.rowKey).toBe("waitron");
  });

  it("each row's colours are its brand colour, light page and dark page", async () => {
    const unreadable: ThemeView = {
      ...xmas,
      id: "t-old",
      name: "Old",
      choices: null,
      light: null,
      dark: null,
      warnings: [],
    };
    const noBrand = theme("t-plain", "Plain", { ...WAITRON_CHOICES, background: "tinted" });
    const el = await mount({ themes: [lucia, unreadable, noBrand], inUse: null });
    expect(lucia.light![BG]).not.toBe(WAITRON_DEFAULTS.light[BG]);
    expect(chips(el, "t-lucia")).toEqual(["#1e5b3a", lucia.light![BG]!, lucia.dark![BG]!].map(rgb));
    const waitron = [
      WAITRON_DEFAULTS.light[PRIMARY]!,
      WAITRON_DEFAULTS.light[BG]!,
      WAITRON_DEFAULTS.dark[BG]!,
    ].map(rgb);
    expect(chips(el, "waitron")).toEqual(waitron);
    expect(chips(el, "t-old")).toEqual(waitron);
    expect(chips(el, "t-plain")).toEqual(
      [WAITRON_DEFAULTS.light[PRIMARY]!, noBrand.light![BG]!, noBrand.dark![BG]!].map(rgb),
    );
  });

  it("the brand chip is the chosen colour, not a fixed shade", async () => {
    const lemon = theme("t-lemon", "Café Limón", {
      ...WAITRON_CHOICES,
      brandColor: "#f2d300",
      brandFix: { light: true },
    });
    expect(lemon.light![PRIMARY]).toBe("#9d8a15");
    const el = await mount({ themes: [lemon], inUse: null });
    expect(chips(el, "t-lemon")[0]).toBe(rgb("#f2d300"));
  });

  it("a supervisor sees no New theme and no row menus", async () => {
    const el = await mount(four, false);
    expect(el.shadowRoot!.querySelector("[data-test=new-theme]")).toBeNull();
    expect(table(el).shadowRoot!.querySelector("wt-row-actions")).toBeNull();
    expect(columnKeys(el)).toEqual(["name", "colours", "status"]);
  });

  it("an editor gets New theme and an actions column pinned to the end", async () => {
    const el = await mount(four);
    const button = el.shadowRoot!.querySelector("[data-test=new-theme]")!;
    expect(text(button)).toBe("New theme");
    expect(button.getAttribute("variant")).toBe("secondary");
    const columns = table(el).columns;
    expect(columns.map((column) => column.key)).toEqual(["name", "colours", "status", "actions"]);
    expect(columns.map((column) => column.label)).toEqual(["Name", "Colours", "Status", "Actions"]);
    expect(columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
    expect(row(el, "t-xmas")!.querySelector("wt-row-actions")!.getAttribute("label")).toBe(
      "Actions: Christmas",
    );
  });

  it("at phone width the colours column is left out", async () => {
    await page.viewport(390, 800);
    const el = await mount(four);
    await expect.poll(() => columnKeys(el)).toEqual(["name", "status", "actions"]);
    await page.viewport(1280, 800);
    await expect.poll(() => columnKeys(el)).toEqual(["name", "colours", "status", "actions"]);
  });
});
