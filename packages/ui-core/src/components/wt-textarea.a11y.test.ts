import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-textarea.js";

afterEach(cleanup);

// axe does not score a placeholder's contrast, so the hinted case measures its own ratio.
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

describe.each(["light", "dark"] as const)("wt-textarea a11y (%s theme)", (theme) => {
  test("resting label in an empty textarea", async () => {
    await mountThemed('<wt-textarea label="Nota para cocina"></wt-textarea>', theme);
    await expectNoA11yViolations(host);
  });

  test("label floated over a value", async () => {
    await mountThemed(
      '<wt-textarea label="Nota para cocina" value="Sin cebolla"></wt-textarea>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("textarea with a hint", async () => {
    await mountThemed(
      '<wt-textarea label="Descripción" hint="La ve el cliente en la carta."></wt-textarea>',
      theme,
    );
    await expectNoA11yViolations(host);
    const root = host.querySelector("wt-textarea")!.shadowRoot!;
    const placeholder = getComputedStyle(root.querySelector("textarea")!, "::placeholder").color;
    const field = getComputedStyle(root.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });

  test("focused textarea", async () => {
    const el = await mountThemed('<wt-textarea label="Nota para cocina"></wt-textarea>', theme);
    el.focus();
    expect(el.shadowRoot!.activeElement).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("invalid textarea", async () => {
    await mountThemed(
      '<wt-textarea label="Nota para cocina" invalid value="x"></wt-textarea>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("invalid textarea with an error message", async () => {
    await mountThemed(
      '<wt-textarea label="Nota para cocina" value="x" error="Escribe como mucho 200 caracteres"></wt-textarea>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("required textarea", async () => {
    await mountThemed('<wt-textarea label="Nota para cocina" required></wt-textarea>', theme);
    await expectNoA11yViolations(host);
  });

  test("disabled textarea holding a value", async () => {
    await mountThemed(
      '<wt-textarea label="Nota para cocina" value="Sin cebolla" disabled></wt-textarea>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("textarea with its label hidden", async () => {
    await mountThemed('<wt-textarea label="Nota para cocina" hide-label></wt-textarea>', theme);
    await expectNoA11yViolations(host);
  });

  test("textarea with a help button beside it", async () => {
    await mountThemed(
      '<wt-textarea label="Nota para cocina"><button slot="help" aria-label="Ayuda">?</button></wt-textarea>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
