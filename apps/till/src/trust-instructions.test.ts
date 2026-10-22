import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "lit";
import { applyTokens } from "@waitron/ui";
import { en, es } from "./i18n/strings.js";
import { trustInstructions } from "./trust-instructions.js";

const originalBodyStyle = document.body.style.cssText;
const originalTheme = document.documentElement.getAttribute("data-theme");
const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  document.body.style.cssText = originalBodyStyle;
  if (originalTheme === null) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", originalTheme);
});

describe("certificate trust instructions", () => {
  it.each([
    { languages: ["es-MX", "en"], locale: "es-ES", strings: es },
    { languages: ["en-US", "es"], locale: "en-GB", strings: en },
    { languages: ["fr-FR", "es"], locale: "es-ES", strings: es },
    { languages: ["fr-FR"], locale: "en-GB", strings: en },
    { languages: [], locale: "en-GB", strings: en },
  ])("renders the installed browser language for $languages", ({ languages, locale, strings }) => {
    render(trustInstructions({ hostname: "box.test", languages }), host);
    expect(host.querySelector("h1")?.textContent).toBe(strings["trust.title"]);
    expect(host.textContent).toContain(strings["trust.explanation"]);
    expect(host.querySelector("a")?.textContent).toBe(strings["trust.open_setup"]);
    expect(host.querySelector("main")?.lang).toBe(locale);
    expect(host.querySelector("a")?.href).toBe("http://box.test/");
  });

  it("uses browser preferences and the current hostname by default", () => {
    render(trustInstructions(), host);
    expect(host.querySelector("a")?.href).toBe(`http://${location.hostname}/`);
    expect(host.querySelector("h1")?.textContent).toBeTruthy();
  });

  it.each(["light", "dark"] as const)(
    "keeps both translations readable at phone and desktop widths in %s",
    async (theme) => {
      applyTokens(document.documentElement);
      document.documentElement.setAttribute("data-theme", theme);
      document.body.style.cssText =
        "box-sizing:border-box;height:100dvh;margin:0;background:var(--wt-color-bg);color:var(--wt-color-text);font-family:var(--wt-font-family);font-size:var(--wt-font-size-md)";
      for (const width of [390, 1280]) {
        await page.viewport(width, 800);
        expect(innerWidth).toBe(width);
        document.body.style.padding = width === 390 ? "var(--wt-space-2)" : "var(--wt-space-5)";
        for (const language of ["en", "es"]) {
          render(trustInstructions({ hostname: "box.test", languages: [language] }), host);
          const main = host.querySelector("main")!;
          const link = host.querySelector("a")!;
          expect(main.getBoundingClientRect().width).toBeGreaterThan(250);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          expect(getComputedStyle(main).color).not.toBe(getComputedStyle(main).backgroundColor);
          expect(link.getBoundingClientRect().height).toBeGreaterThan(0);
          await page.screenshot({
            path: `./__screenshots__/a830-trust/${language}-${theme}-${width}.png`,
          });
        }
      }
      await page.viewport(1280, 800);
    },
  );
});
