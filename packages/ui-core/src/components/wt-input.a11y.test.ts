import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-input.js";

afterEach(cleanup);

// axe does not score a placeholder's contrast, so a test of a hinted field measures its own ratio.
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

describe.each(["light", "dark"] as const)("wt-input a11y (%s theme)", (theme) => {
  test("labelled input", async () => {
    await mountThemed('<wt-input label="Peso (kg)" value="1.25"></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  // invalid only flips a visual border by default — the design-system contract requires it to
  // also set aria-invalid on the inner input, which is what makes this state accessible.
  test("invalid input", async () => {
    await mountThemed('<wt-input label="Peso (kg)" invalid value="-1"></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  test("placeholder", async () => {
    await mountThemed('<wt-input label="Peso (kg)" placeholder="1.25"></wt-input>', theme);
    await expectNoA11yViolations(host);
    const input = host.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
    const placeholder = getComputedStyle(input, "::placeholder").color;
    const field = getComputedStyle(input).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });

  test("hinted input", async () => {
    await mountThemed(
      '<wt-input label="Precio" hint="Déjalo vacío para usar el precio del producto."></wt-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled input", async () => {
    await mountThemed('<wt-input label="Peso (kg)" disabled></wt-input>', theme);
    await expectNoA11yViolations(host);
  });
});
