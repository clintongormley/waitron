import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-input.js";

afterEach(cleanup);

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

describe.each(["light", "dark"] as const)("wt-input a11y (%s theme)", (theme) => {
  test("labelled input", async () => {
    await mountThemed('<wt-input label="Weight (kg)" value="1.25"></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  test("invalid input", async () => {
    await mountThemed('<wt-input label="Weight (kg)" invalid value="-1"></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  test("placeholder", async () => {
    await mountThemed('<wt-input label="Weight (kg)" placeholder="1.25"></wt-input>', theme);
    await expectNoA11yViolations(host);
    const root = host.querySelector("wt-input")!.shadowRoot!;
    const placeholder = getComputedStyle(root.querySelector("input")!, "::placeholder").color;
    const field = getComputedStyle(root.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });

  test("input with a hint", async () => {
    await mountThemed(
      '<wt-input label="Price" hint="Leave empty to use the product price."></wt-input>',
      theme,
    );
    await expectNoA11yViolations(host);
    const root = host.querySelector("wt-input")!.shadowRoot!;
    const placeholder = getComputedStyle(root.querySelector("input")!, "::placeholder").color;
    const field = getComputedStyle(root.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });

  test("disabled input", async () => {
    await mountThemed('<wt-input label="Weight (kg)" disabled></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  test("resting label in an empty field", async () => {
    await mountThemed('<wt-input label="Name"></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  test("focused field", async () => {
    const el = await mountThemed('<wt-input label="Name"></wt-input>', theme);
    el.focus();
    expect(el.shadowRoot!.activeElement).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("field with its label hidden", async () => {
    await mountThemed('<wt-input label="Search" hide-label></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  test("disabled field holding a value", async () => {
    await mountThemed('<wt-input label="Name" value="Ana" disabled></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  test("invalid field with an error message", async () => {
    await mountThemed(
      '<wt-input label="Email" value="ana@" error="Enter a valid email address"></wt-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("read-only field holding a value", async () => {
    await mountThemed(
      '<wt-input label="Email" name="chosen-email" type="email" value="ana@example.com" readonly></wt-input>',
      theme,
    );
    await expectNoA11yViolations(host);
    const input = host.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
    expect(input.readOnly).toBe(true);
  });

  test("read-only field with an action at its end", async () => {
    await mountThemed(
      '<wt-input label="Email" value="ana@example.com" readonly><button slot="end" aria-label="Use another account">✎</button></wt-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("field with a help button beside it", async () => {
    await mountThemed(
      '<wt-input label="Email"><button slot="help" aria-label="Help">?</button></wt-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
