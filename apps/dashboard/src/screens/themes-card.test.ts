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

async function mount(list: ThemeList, canEdit = true, scheme?: "light" | "dark"): Promise<Card> {
  const api = new DashboardApi("", () => Promise.reject(new Error("no request expected")));
  const { el } = await mountWidget<Card>("dashboard-themes-card", { api, list, canEdit }, scheme);
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

  for (const scheme of ["light", "dark"] as const) {
    it(`the built in tag is a pill that stands out from the card (${scheme})`, async () => {
      const el = await mount(four, true, scheme);
      const tag = row(el, "waitron")!.querySelector<HTMLElement>("[data-test=tag-built-in]")!;
      const card = getComputedStyle(el.shadowRoot!.querySelector("section")!).backgroundColor;
      const pill = getComputedStyle(tag).backgroundColor;
      expect(pill).not.toBe("rgba(0, 0, 0, 0)");
      expect(pill).not.toBe(card);
      const probe = document.createElement("span");
      probe.style.background = "var(--wt-color-surface-lifted)";
      tag.after(probe);
      expect(pill).toBe(getComputedStyle(probe).backgroundColor);
      probe.remove();
    });
  }

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

  it("a supervisor sees no Add theme and no row menus", async () => {
    const el = await mount(four, false);
    expect(el.shadowRoot!.querySelector("[data-test=new-theme]")).toBeNull();
    expect(table(el).shadowRoot!.querySelector("wt-row-actions")).toBeNull();
    expect(columnKeys(el)).toEqual(["name", "colours", "status"]);
  });

  it("an editor gets Add theme and an actions column pinned to the end", async () => {
    const el = await mount(four);
    const button = el.shadowRoot!.querySelector("[data-test=new-theme]")!;
    expect(text(button)).toBe("Add theme");
    expect(button.getAttribute("variant")).toBe("secondary");
    const columns = table(el).columns;
    expect(columns.map((column) => column.key)).toEqual(["name", "colours", "status", "actions"]);
    expect(columns.map((column) => column.label)).toEqual(["Name", "Colours", "Status", "Actions"]);
    expect(columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
    expect(row(el, "t-xmas")!.querySelector("wt-row-actions")!.getAttribute("label")).toBe(
      "Actions: Christmas",
    );
  });
});

/** The card widths the look run measured: a 390 px window, an 800 px window with the side menu
 * open, and a 1024 px window with the side menu open. */
const WIDTHS = [
  { window: 390, card: 310 },
  { window: 800, card: 420 },
  { window: 1024, card: 644 },
] as const;

describe("the Themes card fits its own width", () => {
  async function sized(cardWidth: number, list = four, canEdit = true): Promise<Card> {
    const el = await mount(list, canEdit);
    el.parentElement!.style.width = `${cardWidth}px`;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await el.updateComplete;
    await table(el).updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return el;
  }

  for (const locale of ["en-GB", "es-ES"] as const) {
    for (const { window: width, card } of WIDTHS) {
      for (const canEdit of [true, false]) {
        it(`does not scroll sideways and shows every tag whole in a ${card}px card (${locale}, ${canEdit ? "editor" : "supervisor"})`, async () => {
          await page.viewport(width, 800);
          setLocale(locale);
          const el = await sized(card, four, canEdit);
          expect(el.shadowRoot!.querySelector("section")!.getBoundingClientRect().width).toBe(card);
          const box = inTable(el, ".scroll")!;
          expect(box.scrollWidth, `${box.scrollWidth} in ${box.clientWidth}`).toBeLessThanOrEqual(
            box.clientWidth,
          );
          const edge = box.getBoundingClientRect();
          const tags = [...table(el).shadowRoot!.querySelectorAll<HTMLElement>("[part~=tag]")];
          expect(tags.length).toBeGreaterThanOrEqual(3);
          for (const tag of tags) {
            const rect = tag.getBoundingClientRect();
            expect(rect.right, text(tag)).toBeLessThanOrEqual(edge.right);
            expect(tag.scrollWidth, text(tag)).toBeLessThanOrEqual(tag.clientWidth);
          }
        });
      }
    }
  }

  for (const { window: width, card } of WIDTHS) {
    it(`fits a row carrying both status tags in a ${card}px card`, async () => {
      await page.viewport(width, 800);
      setLocale("es-ES");
      const el = await sized(card, { ...four, inUse: "t-summer" });
      const box = inTable(el, ".scroll")!;
      expect(box.scrollWidth, `${box.scrollWidth} in ${box.clientWidth}`).toBeLessThanOrEqual(
        box.clientWidth,
      );
      const both = row(el, "t-summer")!.querySelectorAll<HTMLElement>("[part~=tag]");
      expect(both).toHaveLength(2);
      for (const tag of both) {
        expect(tag.getBoundingClientRect().right).toBeLessThanOrEqual(
          box.getBoundingClientRect().right,
        );
      }
    });
  }

  it("decides the colours column by the card's width, not the window's", async () => {
    await page.viewport(1280, 800);
    const narrow = await sized(420);
    await expect.poll(() => columnKeys(narrow)).toEqual(["name", "status", "actions"]);
    cleanupWidgets();
    await page.viewport(390, 800);
    const wide = await sized(644);
    await expect.poll(() => columnKeys(wide)).toEqual(["name", "colours", "status", "actions"]);
  });

  it("follows the card as it narrows and widens", async () => {
    const el = await sized(644);
    expect(columnKeys(el)).toEqual(["name", "colours", "status", "actions"]);
    el.parentElement!.style.width = "310px";
    await expect.poll(() => columnKeys(el)).toEqual(["name", "actions"]);
    el.parentElement!.style.width = "900px";
    await expect.poll(() => columnKeys(el)).toEqual(["name", "colours", "status", "actions"]);
  });

  it("in the narrowest card the status tags follow the name", async () => {
    setLocale("en-GB");
    const el = await sized(310);
    expect(columnKeys(el)).toEqual(["name", "actions"]);
    const name = (key: string) => row(el, key)!.querySelector("td")!;
    expect(text(name("t-lucia").querySelector("[data-test=tag-in-use]"))).toBe("In use");
    expect(text(name("t-summer").querySelector("[data-test=tag-hard-to-read]"))).toBe(
      "1 hard to read",
    );
    expect(name("waitron").querySelector("[data-test=tag-built-in]")).not.toBeNull();
    expect(name("t-xmas").querySelector("[part~=tag]")).toBeNull();
  });

  it("a tag that wraps under the name lines up with it", async () => {
    setLocale("en-GB");
    const el = await sized(310);
    const cell = row(el, "t-summer")!;
    const name = cell.querySelector("[data-test=theme-row-t-summer]")!.getBoundingClientRect();
    const tag = cell.querySelector("[data-test=tag-hard-to-read]")!.getBoundingClientRect();
    expect(tag.top).toBeGreaterThanOrEqual(name.bottom);
    expect(tag.left).toBeCloseTo(name.left, 0);
  });
});
