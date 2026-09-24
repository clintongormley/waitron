import { afterEach, expect, test } from "vitest";

let sheet: CSSStyleSheet | undefined;
let probe: HTMLElement | undefined;

afterEach(() => {
  probe?.remove();
  probe = undefined;
  if (sheet) {
    const stale = sheet;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== stale);
    sheet = undefined;
  }
});

test("resolves custom properties through the cascade, which jsdom cannot do", () => {
  sheet = new CSSStyleSheet();
  sheet.replaceSync(".probe { --probe: 42px; padding: var(--probe); }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  probe = document.createElement("div");
  probe.className = "probe";
  document.body.appendChild(probe);

  // Needs a real browser: jsdom has no `adoptedStyleSheets` and only partial `var()` resolution.
  const styles = getComputedStyle(probe);
  expect(styles.getPropertyValue("--probe").trim()).toBe("42px");
  expect(styles.padding).toBe("42px");
});
