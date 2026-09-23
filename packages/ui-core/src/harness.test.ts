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

  // Why this needs a real browser, verified empirically against jsdom 29.1.1:
  // document.adoptedStyleSheets is unimplemented there (jsdom/jsdom#2985), so this
  // test throws outright rather than mismatching. jsdom's var() resolution is also
  // incomplete and version-dependent (25 returns the literal "var(--probe)", 29
  // returns "0"), so neither assertion below would hold.
  const styles = getComputedStyle(probe);
  expect(styles.getPropertyValue("--probe").trim()).toBe("42px");
  expect(styles.padding).toBe("42px");
});
