import { afterEach, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { WAITRON_CHOICES, themeSheet, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
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
  handSet: { light: {}, dark: {} },
};
const LEMON: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#f2d300" };
const LEMON_LIGHT_FIX: ThemeChoices = { ...LEMON, brandFix: { light: true } };

const primary = (el: Element) => getComputedStyle(el).getPropertyValue("--wt-color-primary").trim();
const panel = (el: Preview, mode: "light" | "dark") =>
  el.shadowRoot!.querySelector<HTMLElement>(`figure[data-mode=${mode}] .panel`)!;

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

afterEach(async () => {
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

/** Every box in a panel, or in a panel's sample body, that ends past that box's inner edge. */
function overflowing(el: Preview): string[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>(".panel, .body")].flatMap((box) => {
    const edge = box.getBoundingClientRect().right - box.clientLeft;
    return [...box.querySelectorAll("*")]
      .map((node) => [node, node.getBoundingClientRect().right - edge] as const)
      .filter(([, past]) => past > 0.5)
      .map(
        ([node, past]) =>
          `${box.closest("figure")!.dataset.mode} .${box.className} .${node.className} ${past.toFixed(1)}px`,
      );
  });
}

for (const locale of ["en-GB", "es-ES"] as const) {
  it(`each panel's sample fits inside its panel from a phone's width up (${locale})`, async () => {
    const { innerWidth: width, innerHeight: height } = window;
    await page.viewport(1280, 900);
    try {
      setLocale(locale);
      const { el, host } = await mountWidget<Preview>("dashboard-theme-preview", {
        theme: deriveTheme(LUCIA_DARK_FIX),
        name: "Bar Lucía",
      });
      const found: string[] = [];
      for (let previewWidth = 220; previewWidth <= 900; previewWidth += 8) {
        host.style.width = `${previewWidth}px`;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        found.push(...overflowing(el).map((line) => `${previewWidth}px ${line}`));
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
  });
}
