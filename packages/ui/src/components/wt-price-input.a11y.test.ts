import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-price-input.js";

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

describe.each(["light", "dark"] as const)("wt-price-input a11y (%s theme)", (theme) => {
  test("default", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ea"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("error", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ea" error="Enter a price"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with-unit", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="kg" value="9.90"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("placeholder", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ea" placeholder="4.50"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
    const root = host.querySelector("wt-price-input")!.shadowRoot!;
    const placeholder = getComputedStyle(root.querySelector("input")!, "::placeholder").color;
    const field = getComputedStyle(root.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });

  test("hidden label, fixed unit", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="kg" fixed-unit hide-label value="9.90"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("fixed unit with an error", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="kg" fixed-unit error="Enter a price"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("English currency sign, before the amount", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="kg" locale="en-GB" value="9.90"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("Spanish currency sign, after the amount, with a fixed unit and an error", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="kg" fixed-unit locale="es-ES" value="9,90" error="Enter a price"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("currency sign beside a placeholder, with a hidden label", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ea" locale="en-GB" placeholder="4.50" hide-label></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
    const shadow = host.querySelector("wt-price-input")!.shadowRoot!;
    const sign = getComputedStyle(shadow.querySelector('[part~="currency"]')!).color;
    const field = getComputedStyle(shadow.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(sign, field)).toBeGreaterThanOrEqual(4.5);
  });

  test("hint, with a currency sign and an error", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" locale="es-ES" fixed-unit hint="Leave it empty to use the product price, 9,00 €." error="Enter a price"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
    const root = host.querySelector("wt-price-input")!.shadowRoot!;
    const placeholder = getComputedStyle(root.querySelector("input")!, "::placeholder").color;
    const field = getComputedStyle(root.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });

  test("disabled currency sign", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ud" locale="es-ES" value="9,90" disabled></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("invalid, with no error message", async () => {
    await mountThemed(
      '<wt-price-input label="Precio" name="price" unit="kg" value="-1" invalid></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("resting label in an empty field", async () => {
    await mountThemed(
      '<wt-price-input label="Precio" name="price" unit="kg"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("focused amount", async () => {
    const el = await mountThemed(
      '<wt-price-input label="Precio" name="price" unit="kg" locale="es-ES"></wt-price-input>',
      theme,
    );
    el.focus();
    expect(el.shadowRoot!.activeElement).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("disabled, with a fixed unit", async () => {
    await mountThemed(
      '<wt-price-input label="Precio" name="price" unit="%" fixed-unit value="10" disabled></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
    const unit = host.querySelector("wt-price-input")!.shadowRoot!.querySelector(".unit")!;
    const shadow = host.querySelector("wt-price-input")!.shadowRoot!;
    expect(
      contrastRatio(
        getComputedStyle(unit).color,
        getComputedStyle(shadow.querySelector(".field")!).backgroundColor,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("disabled", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ea" value="9.90" disabled></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
