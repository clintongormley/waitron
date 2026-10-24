import { afterEach, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { applyTokens, currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { mediaTestReference } from "@waitron/ui/src/test-helpers.js";
import { THEME_STORAGE_KEY, chooseTheme } from "@waitron/ui/src/theme-choice.js";
import { WAITRON_LOCKUP_DARK_URL, WAITRON_LOCKUP_URL } from "@waitron/ui/src/waitron-lockup.js";
import {
  WAITRON_CHOICES,
  themeSheet,
  type ThemeChoices,
  type ThemeLogo,
} from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { en, es } from "../i18n/strings.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, serveLogos, servedLogo } from "./test-helpers.js";
import "./theme-preview.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

type Preview = HTMLElementTagNameMap["dashboard-theme-preview"];

const LUCIA_DARK_FIX: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  logo: null,
  handSet: { light: {}, dark: {} },
  textScale: 100,
};
const LEMON: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#f2d300" };
const LEMON_LIGHT_FIX: ThemeChoices = { ...LEMON, brandFix: { light: true } };

const primary = (el: Element) => getComputedStyle(el).getPropertyValue("--wt-color-primary").trim();
const panel = (el: Preview, mode: "light" | "dark") =>
  el.shadowRoot!.querySelector<HTMLElement>(`figure[data-mode=${mode}] .panel`)!;

const L = mediaTestReference("lucia.png");
const D = mediaTestReference("lucia-dark.png");
serveLogos([L, D]);

const strip = (el: Preview, mode: "light" | "dark") =>
  panel(el, mode).querySelector<HTMLElement>(".strip")!;
const logoOf = (el: Preview, mode: "light" | "dark") =>
  strip(el, mode).querySelector<HTMLElementTagNameMap["wt-venue-logo"]>("wt-venue-logo")!;
const boxOf = (logo: HTMLElement) => logo.shadowRoot!.querySelector<HTMLElement>(".box")!;

/** Waits until the panel's logo has its image and has measured it. */
async function loaded(el: Preview, mode: "light" | "dark"): Promise<HTMLElement> {
  await expect
    .poll(() => logoOf(el, mode)?.shadowRoot?.querySelector<HTMLImageElement>("img")?.naturalWidth)
    .toBe(400);
  const logo = logoOf(el, mode);
  await expect.poll(() => boxOf(logo).style.getPropertyValue("--wt-venue-logo-ratio")).toBe("4");
  return logo;
}

async function mountWithLogo(logo: ThemeLogo | null, legalName = "BAR LUCÍA S.L.") {
  return mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(LUCIA_DARK_FIX),
    name: "Bar Lucía",
    logo,
    legalName,
  });
}

let venueSheet: CSSStyleSheet | undefined;
let outside: HTMLElement | undefined;

/** Gives the document's own root a venue sheet whose light brand colour is the lemon's fix. */
function paintPage(): void {
  const root = document.documentElement;
  applyTokens(root);
  root.setAttribute("data-theme", "light");
  venueSheet = new CSSStyleSheet();
  venueSheet.replaceSync(themeSheet(deriveTheme(LEMON_LIGHT_FIX)));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, venueSheet];
}

const contentLanguagesBefore = currentContentLanguages();

afterEach(async () => {
  vi.restoreAllMocks();
  setContentLanguages(contentLanguagesBefore);
  cleanupWidgets();
  setLocale("en-GB");
  outside?.remove();
  outside = undefined;
  if (venueSheet !== undefined) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== venueSheet);
    venueSheet = undefined;
    document.documentElement.removeAttribute("data-wt-theme-root");
    document.documentElement.removeAttribute("data-theme");
  }
  await commands.emulateColorScheme(null);
});

async function mountOutside(theme: ThemeChoices): Promise<Preview> {
  outside = document.createElement("div");
  document.body.appendChild(outside);
  const el = document.createElement("dashboard-theme-preview");
  el.theme = deriveTheme(theme);
  el.name = "Bar Lucía";
  outside.appendChild(el);
  await el.updateComplete;
  return el;
}

it("each panel paints its own version of the draft", async () => {
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(LUCIA_DARK_FIX),
    name: "Bar Lucía",
  });
  const light = panel(el, "light");
  const dark = panel(el, "dark");
  expect(light.getAttribute("data-theme")).toBe("light");
  expect(dark.getAttribute("data-theme")).toBe("dark");
  expect(light.getAttribute("aria-hidden")).toBe("true");
  expect(primary(light)).toBe("#1e5b3a");
  expect(primary(dark)).toBe("#437e5b");
  expect(getComputedStyle(light).colorScheme).toBe("light");
  expect(getComputedStyle(dark).colorScheme).toBe("dark");
  expect(getComputedStyle(light.querySelector(".save")!).backgroundColor).toBe("rgb(30, 91, 58)");
});

it("nothing outside the panels changes", async () => {
  paintPage();
  expect(primary(document.documentElement)).toBe("#9d8a15");
  const el = await mountOutside(LUCIA_DARK_FIX);
  expect(primary(panel(el, "light"))).toBe("#1e5b3a");
  expect(primary(el)).toBe("#9d8a15");
  expect(primary(document.documentElement)).toBe("#9d8a15");
  expect(primary(outside!)).toBe("#9d8a15");
});

it("the panels follow their own mode whatever the device says", async () => {
  for (const scheme of ["dark", "light"] as const) {
    await commands.emulateColorScheme(scheme);
    for (const mode of ["light", "dark", undefined] as const) {
      const { el } = await mountWidget<Preview>(
        "dashboard-theme-preview",
        { theme: deriveTheme(LUCIA_DARK_FIX), name: "Bar Lucía" },
        mode,
      );
      expect([scheme, mode, primary(panel(el, "light")), primary(panel(el, "dark"))]).toEqual([
        scheme,
        mode,
        "#1e5b3a",
        "#437e5b",
      ]);
      cleanupWidgets();
    }
  }
});

it("a new draft repaints", async () => {
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(LUCIA_DARK_FIX),
    name: "Bar Lucía",
  });
  expect(primary(panel(el, "light"))).toBe("#1e5b3a");
  el.theme = deriveTheme(LEMON);
  await el.updateComplete;
  expect(primary(panel(el, "light"))).toBe("#f2d300");
});

it("control: Waitron's draft paints Waitron's colours while the page's root keeps its own", async () => {
  paintPage();
  const el = await mountOutside(WAITRON_CHOICES);
  expect(primary(panel(el, "light"))).toBe("#1f6feb");
  expect(primary(panel(el, "dark"))).toBe("#4c8dff");
  expect(primary(document.documentElement)).toBe("#9d8a15");
});

it("shows the theme's name in the focused field, and a new name keeps the draft's colours", async () => {
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(LUCIA_DARK_FIX),
    name: "Bar Lucía",
  });
  const field = () => panel(el, "light").querySelector(".field-value")!.textContent;
  expect(field()).toBe("Bar Lucía");
  el.name = "Lemon Café";
  await el.updateComplete;
  expect(field()).toBe("Lemon Café");
  expect(primary(panel(el, "light"))).toBe("#1e5b3a");
});

/** Whether `node` or a box between it and `box` clips what spills out of it. */
function clipped(node: Element, box: Element): boolean {
  for (let at: Element | null = node; at && at !== box; at = at.parentElement) {
    if (getComputedStyle(at).overflowX !== "visible") return true;
  }
  return false;
}

/**
 * The right edge of `node`'s box, or of its text where nothing clips it, whichever ends further:
 * text can spill past a box allowed to shrink below it.
 */
function rightOf(node: Element, box: Element): number {
  const own = node.getBoundingClientRect().right;
  if (clipped(node, box)) return own;
  const range = document.createRange();
  const text = [...node.childNodes]
    .filter((child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim())
    .map((child) => {
      range.selectNode(child);
      return range.getBoundingClientRect().right;
    });
  return Math.max(own, ...text);
}

/** Every box or text in a panel, or in a panel's sample body, that ends past that box's inner edge. */
function overflowing(el: Preview): string[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>(".panel, .body")].flatMap((box) => {
    const edge = box.getBoundingClientRect().right - box.clientLeft;
    return [...box.querySelectorAll("*")]
      .map((node) => [node, rightOf(node, box) - edge] as const)
      .filter(([, past]) => past > 0.5)
      .map(
        ([node, past]) =>
          `${box.closest("figure")!.dataset.mode} .${box.className} .${node.className} ${past.toFixed(1)}px`,
      );
  });
}

const SWEEPS = (["en-GB", "es-ES"] as const).flatMap((locale) => [
  { locale, label: "no logo", logo: null, legalName: "" },
  {
    locale,
    label: "no logo and a long legal name",
    logo: null,
    legalName: "THE CORNER OF GRANDMOTHER LUCÍA'S RESTAURANT LTD",
  },
  {
    locale,
    label: "a 4:1 logo and a long legal name",
    logo: { light: L },
    legalName: "THE CORNER OF GRANDMOTHER LUCÍA'S RESTAURANT LTD",
  },
  // Words this name's spaces split fit a phone's panel; one word longer than the panel has to
  // break inside itself.
  {
    locale,
    label: "a legal name with no spaces",
    logo: { light: L },
    legalName: "GRANDMOTHERLUCIASCORNERRESTAURANT",
  },
]);

it.each(SWEEPS)(
  "each panel's sample fits inside its panel from a phone's width up ($locale, $label)",
  async ({ locale, logo, legalName }) => {
    const { innerWidth: width, innerHeight: height } = window;
    await page.viewport(1280, 900);
    try {
      setLocale(locale);
      const { el, host } = await mountWithLogo(logo, legalName);
      if (logo !== null) await Promise.all([loaded(el, "light"), loaded(el, "dark")]);
      const lockups = [...el.shadowRoot!.querySelectorAll<HTMLImageElement>("img.lockup")];
      expect(lockups).toHaveLength(logo === null ? 2 : 0);
      await Promise.all(lockups.map((image) => image.decode()));
      const found: string[] = [];
      for (let previewWidth = 220; previewWidth <= 900; previewWidth += 8) {
        host.style.width = `${previewWidth}px`;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        found.push(...overflowing(el).map((line) => `${previewWidth}px ${line}`));
        for (const image of lockups) {
          const box = image.getBoundingClientRect();
          const drawn = box.width / box.height;
          const natural = image.naturalWidth / image.naturalHeight;
          if (Math.abs(drawn - natural) > 0.05)
            found.push(
              `${previewWidth}px lockup drawn ${drawn.toFixed(2)}:1, not ${natural.toFixed(2)}:1`,
            );
        }
      }
      expect(found).toEqual([]);
      const besideAt = (previewWidth: number) => {
        host.style.width = `${previewWidth}px`;
        const light = panel(el, "light");
        const nav = light.querySelector(".nav")!.getBoundingClientRect();
        return nav.right <= light.querySelector(".body")!.getBoundingClientRect().left;
      };
      expect([besideAt(220), besideAt(900)]).toEqual([false, true]);
      el.name = "The Long-Named Neighbourhood Tapas and Vermouth Bar";
      await el.updateComplete;
      host.style.width = "900px";
      expect(overflowing(el)).toEqual([]);
      expect(besideAt(900)).toBe(true);
    } finally {
      await page.viewport(width, height);
    }
  },
);

it("each panel starts with a banner strip: the logo, then the legal name", async () => {
  const { el } = await mountWithLogo({ light: L });
  for (const mode of ["light", "dark"] as const) {
    const children = [...panel(el, mode).children];
    expect(children[0]).toBe(strip(el, mode));
    const [first, second] = [...strip(el, mode).children];
    expect(first!.localName).toBe("wt-venue-logo");
    expect(second!.className).toBe("legal-name");
    expect(second!.textContent).toBe("BAR LUCÍA S.L.");
    expect(first!.getAttribute("size")).toBe("bar");
  }
  const light = await loaded(el, "light");
  const dark = await loaded(el, "dark");
  expect(light.getAttribute("light")).toBe(servedLogo(L, "display"));
  expect(dark.getAttribute("light")).toBe(servedLogo(L, "display"));
  expect(dark.hasAttribute("dark")).toBe(false);
  expect(boxOf(dark).hasAttribute("data-plate")).toBe(true);
  expect(boxOf(light).hasAttribute("data-plate")).toBe(false);
});

it("the strip's divider runs from one edge of the panel to the other", async () => {
  const { el } = await mountWithLogo({ light: L });
  for (const mode of ["light", "dark"] as const) {
    const box = panel(el, mode);
    const outer = box.getBoundingClientRect();
    const line = strip(el, mode).getBoundingClientRect();
    expect([line.left, line.right]).toEqual([
      outer.left + box.clientLeft,
      outer.right - box.clientLeft,
    ]);
  }
});

it("with a dark image the dark panel draws it, unplated", async () => {
  const { el } = await mountWithLogo({ light: L, dark: D });
  const dark = await loaded(el, "dark");
  const light = await loaded(el, "light");
  expect(dark.shadowRoot!.querySelector("img")!.getAttribute("src")).toBe(servedLogo(D, "display"));
  expect(light.shadowRoot!.querySelector("img")!.getAttribute("src")).toBe(
    servedLogo(L, "display"),
  );
  expect(boxOf(dark).hasAttribute("data-plate")).toBe(false);
});

it("with no logo, Waitron's lockup in each panel's drawing", async () => {
  const { el } = await mountWithLogo(null);
  expect(strip(el, "light").querySelector("wt-venue-logo")).toBeNull();
  const lockup = (mode: "light" | "dark") =>
    strip(el, mode).querySelector<HTMLImageElement>("img.lockup")!;
  expect(lockup("light").src).toBe(WAITRON_LOCKUP_URL);
  expect(lockup("dark").src).toBe(WAITRON_LOCKUP_DARK_URL);
  expect(strip(el, "dark").querySelector(".legal-name")!.textContent).toBe("BAR LUCÍA S.L.");
  const bar = getComputedStyle(lockup("light")).height;
  el.logo = { light: L };
  await el.updateComplete;
  expect(getComputedStyle(boxOf(logoOf(el, "light"))).height).toBe(bar);
});

it("the page's own setting does not move a panel's version", async () => {
  const root = document.documentElement;
  applyTokens(root);
  try {
    chooseTheme("dark");
    expect(getComputedStyle(root).colorScheme).toBe("dark");
    outside = document.createElement("div");
    document.body.appendChild(outside);
    const el = document.createElement("dashboard-theme-preview");
    Object.assign(el, {
      theme: deriveTheme(LUCIA_DARK_FIX),
      name: "Bar Lucía",
      logo: { light: L },
      legalName: "BAR LUCÍA S.L.",
    });
    outside.appendChild(el);
    await el.updateComplete;
    const light = await loaded(el, "light");
    const dark = await loaded(el, "dark");
    expect(boxOf(light).hasAttribute("data-plate")).toBe(false);
    expect(boxOf(dark).hasAttribute("data-plate")).toBe(true);
  } finally {
    chooseTheme("device");
    localStorage.removeItem(THEME_STORAGE_KEY);
    root.removeAttribute("data-wt-theme-root");
  }
});

const fontSize = (el: Element) => getComputedStyle(el).fontSize;
const tile = (el: Preview, mode: "light" | "dark") =>
  panel(el, mode).querySelector<HTMLElement>("[data-test=preview-tile]")!;
const billLine = (el: Preview, mode: "light" | "dark") =>
  panel(el, mode).querySelector<HTMLElement>("[data-test=preview-bill-line]")!;
const names = (el: Preview) =>
  (["light", "dark"] as const).flatMap((mode) => [
    tile(el, mode).querySelector<HTMLElement>(".tile-name")!,
    billLine(el, mode).querySelector<HTMLElement>(".bill-name")!,
  ]);

it("each panel draws its text at the theme's sizes", async () => {
  for (const [textScale, md, sm] of [
    [130, "18px", "16px"],
    [100, "14px", "12px"],
  ] as const) {
    const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
      theme: deriveTheme({ ...LUCIA_DARK_FIX, textScale }),
      name: "Bar Lucía",
    });
    for (const mode of ["light", "dark"] as const) {
      const box = panel(el, mode);
      expect([
        textScale,
        mode,
        fontSize(box.querySelector(".field-value")!),
        fontSize(box.querySelector(".field-label")!),
        fontSize(box.closest("figure")!.querySelector("h4")!),
      ]).toEqual([textScale, mode, md, sm, "12px"]);
    }
    cleanupWidgets();
  }
});

it("a mounted preview's till button and bill line follow a change of text size", async () => {
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(LUCIA_DARK_FIX),
    name: "Bar Lucía",
  });
  for (const [textScale, md, sm] of [
    [100, "14px", "12px"],
    [130, "18px", "16px"],
    [100, "14px", "12px"],
  ] as const) {
    el.theme = deriveTheme({ ...LUCIA_DARK_FIX, textScale });
    await el.updateComplete;
    for (const mode of ["light", "dark"] as const) {
      const button = tile(el, mode);
      expect([
        textScale,
        mode,
        fontSize(button.querySelector(".tile-name")!),
        fontSize(button.querySelector(".tile-price")!),
        fontSize(billLine(el, mode).querySelector(".bill-name")!),
      ]).toEqual([textScale, mode, md, sm, md]);
    }
  }
});

it("each panel shows a till button and a bill line", async () => {
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(WAITRON_CHOICES),
    name: "Bar Lucía",
  });
  await document.fonts.ready;
  const name = en["appearance.preview_product"];
  for (const mode of ["light", "dark"] as const) {
    const button = tile(el, mode);
    const tileName = button.querySelector<HTMLElement>(".tile-name")!;
    const price = button.querySelector<HTMLElement>(".tile-price")!;
    expect(tileName.textContent).toBe(name);
    expect(price.textContent).toBe(formatMoney("2.20", currentLocale()));
    expect(button.getBoundingClientRect().width).toBe(104);
    expect(getComputedStyle(tileName).fontWeight).toBe(
      getComputedStyle(button).getPropertyValue("--wt-font-weight-bold").trim(),
    );
    expect(fontSize(price)).toBe("12px");
    expect(fontSize(tileName)).toBe("14px");
    const line = billLine(el, mode);
    expect([...line.children].map((child) => child.textContent)).toEqual([
      name,
      "2",
      formatMoney("4.40", currentLocale()),
    ]);
    const outer = panel(el, mode).getBoundingClientRect();
    for (const inner of [button.getBoundingClientRect(), line.getBoundingClientRect()]) {
      expect(inner.left).toBeGreaterThanOrEqual(outer.left);
      expect(inner.right).toBeLessThanOrEqual(outer.right);
      expect(inner.top).toBeGreaterThanOrEqual(outer.top);
      expect(inner.bottom).toBeLessThanOrEqual(outer.bottom);
    }
  }
});

it("an English screen in a Spanish venue shows the Spanish sample, as the tills would break it", async () => {
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(WAITRON_CHOICES),
    name: "Bar Lucía",
  });
  for (const name of names(el)) {
    expect([name.getAttribute("lang"), name.textContent, getComputedStyle(name).hyphens]).toEqual([
      "es",
      es["appearance.preview_product"],
      "auto",
    ]);
  }
});

/** Each word of `node`'s text, with the boxes it is drawn in. */
function wordBoxes(node: HTMLElement): { word: string; boxes: DOMRect[] }[] {
  const text = node.firstChild!;
  let at = 0;
  return text.textContent!.split(" ").map((word) => {
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + word.length);
    at += word.length + 1;
    return { word, boxes: [...range.getClientRects()] };
  });
}

it("the preview's names leave a word under 8 letters whole, as the tills do", async () => {
  setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme({ ...WAITRON_CHOICES, textScale: 130 }),
    name: "Bar Lucía",
  });
  await document.fonts.ready;
  for (const name of names(el)) {
    expect(getComputedStyle(name).getPropertyValue("hyphenate-limit-chars")).toBe("8");
    // Where a short word sits in its line depends on the font, so a copy of the name is laid out
    // at every width from its widest short word up to its own width.
    const probe = name.cloneNode() as HTMLElement;
    probe.textContent = name.textContent;
    Object.assign(probe.style, { flex: "none", width: "max-content" });
    name.after(probe);
    const natural = Math.floor(probe.getBoundingClientRect().width);
    const short = wordBoxes(probe).filter(({ word }) => word.length < 8);
    expect(short.length).toBeGreaterThan(0);
    const widest = Math.max(...short.map(({ boxes }) => boxes[0]!.width));
    const split: string[] = [];
    for (let width = Math.ceil(widest) + 1; width <= natural; width++) {
      probe.style.width = `${width}px`;
      for (const { word, boxes } of wordBoxes(probe)) {
        if (word.length < 8 && new Set(boxes.map((box) => Math.round(box.top))).size > 1) {
          split.push(`${word} at ${width}px`);
        }
      }
    }
    probe.remove();
    expect(split, name.className).toEqual([]);
  }
});

it("the sample follows a change of the venue's content language", async () => {
  setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(WAITRON_CHOICES),
    name: "Bar Lucía",
  });
  expect(names(el)[0]!.getAttribute("lang")).toBe("es");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  await el.updateComplete;
  for (const name of names(el)) {
    expect([name.getAttribute("lang"), name.textContent]).toEqual([
      "en",
      en["appearance.preview_product"],
    ]);
  }
});

it("the sample text follows the panel's own colours", async () => {
  const { el } = await mountWidget<Preview>("dashboard-theme-preview", {
    theme: deriveTheme(LUCIA_DARK_FIX),
    name: "Bar Lucía",
  });
  const drawn = (mode: "light" | "dark") => {
    const box = panel(el, mode);
    const probe = document.createElement("span");
    box.appendChild(probe);
    probe.style.borderTop = "1px solid var(--wt-color-border)";
    probe.style.backgroundColor = "var(--wt-color-surface)";
    const want = [getComputedStyle(probe).borderTopColor, getComputedStyle(probe).backgroundColor];
    probe.remove();
    const style = getComputedStyle(tile(el, mode));
    return { want, got: [style.borderTopColor, style.backgroundColor] };
  };
  const light = drawn("light");
  const dark = drawn("dark");
  expect(light.got).toEqual(light.want);
  expect(dark.got).toEqual(dark.want);
  expect(dark.got).not.toEqual(light.got);
});
