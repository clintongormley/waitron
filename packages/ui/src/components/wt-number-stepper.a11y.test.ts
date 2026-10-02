import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-number-stepper.js";

afterEach(cleanup);

// Registered so the buttons draw their icons as they do in the app; an icon is aria-hidden, so it
// never names a button.
registerIcons({
  minus: "M2.5 7.25H13.5V8.75H2.5Z",
  plus: "M7.25 2.5H8.75V7.25H13.5V8.75H8.75V13.5H7.25V8.75H2.5V7.25H7.25Z",
});

// axe does not score a placeholder's contrast, so a test of a placeholder-hinted field measures its
// own ratio.
// The parser reads rgb()/rgba() only, which is why each colour is checked for that form first.
function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe.each(["light", "dark"] as const)("wt-number-stepper a11y (%s theme)", (theme) => {
  test("empty", async () => {
    await mountThemed(
      '<wt-number-stepper label="Maximum choices" name="max" placeholder="No limit"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
    const root = host.querySelector("wt-number-stepper")!.shadowRoot!;
    const placeholder = getComputedStyle(root.querySelector("input")!, "::placeholder").color;
    const field = getComputedStyle(root.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });

  test("with a value", async () => {
    await mountThemed(
      '<wt-number-stepper label="Maximum choices" name="max" value="3"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("at min", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="1" min="1"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("at max", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="5" min="1" max="5"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("required, with a hint", async () => {
    await mountThemed(
      '<wt-number-stepper label="Minimum choices" name="min" value="0" required hint="0 makes the list optional"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("invalid with an error", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="0" min="1" error="Enter 1 or more"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("a long label, its box widened to fit it", async () => {
    await mountThemed(
      '<wt-number-stepper label="Borrar las copias después de (días)" name="days" value="30" required></wt-number-stepper>',
      theme,
    );
    host.style.width = "600px";
    await expectNoA11yViolations(host);
    const text = host
      .querySelector("wt-number-stepper")!
      .shadowRoot!.querySelector<HTMLElement>(".field-label-text")!;
    expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
  });

  test("disabled", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="2" disabled></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("resting label in an empty box", async () => {
    await mountThemed('<wt-number-stepper label="Máximo" name="max"></wt-number-stepper>', theme);
    await expectNoA11yViolations(host);
  });

  test("focused number", async () => {
    const el = await mountThemed(
      '<wt-number-stepper label="Máximo" name="max" value="3"></wt-number-stepper>',
      theme,
    );
    el.focus();
    expect(el.shadowRoot!.activeElement).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("invalid, with no error message", async () => {
    await mountThemed(
      '<wt-number-stepper label="Máximo" name="max" value="0" min="1" invalid></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("a label cut in a row too narrow for it", async () => {
    await mountThemed(
      '<wt-number-stepper label="Maximum number of portions in an order" name="max" value="3"></wt-number-stepper>',
      theme,
    );
    host.style.width = "220px";
    await expectNoA11yViolations(host);
    const text = host
      .querySelector("wt-number-stepper")!
      .shadowRoot!.querySelector<HTMLElement>(".field-label-text")!;
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
  });

  test("hide-label", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="2" hide-label></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
