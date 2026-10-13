import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-button.js";
import "./wt-icon.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-button a11y (%s theme)", (theme) => {
  test("text button", async () => {
    await mountThemed("<wt-button>Cobrar</wt-button>", theme);
    await expectNoA11yViolations(host);
  });

  // wt-icon's SVG is aria-hidden and there's no text content, so without a forwarded aria-label
  // the button has no accessible name at all.
  test("icon-only button", async () => {
    await mountThemed(
      '<wt-button aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test.each(["true", "false"] as const)("menu trigger, aria-expanded=%s", async (expanded) => {
    await mountThemed(
      `<wt-button aria-haspopup="menu" aria-expanded="${expanded}">Idioma</wt-button>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test.each(["primary", "secondary", "danger", "ghost"] as const)("%s variant", async (variant) => {
    await mountThemed(`<wt-button variant="${variant}">Cobrar</wt-button>`, theme);
    await expectNoA11yViolations(host);
  });

  test("disabled button", async () => {
    await mountThemed("<wt-button disabled>Cobrar</wt-button>", theme);
    await expectNoA11yViolations(host);
  });

  test.each(["primary", "danger"] as const)("disabled %s variant", async (variant) => {
    await mountThemed(`<wt-button variant="${variant}" disabled>Guardar</wt-button>`, theme);
    await expectNoA11yViolations(host);
  });

  test("disabled button with an accessible description", async () => {
    const el = await mountThemed(
      `<wt-button disabled aria-description="Uses the main product's photo">Remove image</wt-button>`,
      theme,
    );
    await expect
      .element(page.elementLocator(el.shadowRoot!.querySelector("button")!))
      .toHaveAccessibleDescription("Uses the main product's photo");
    await expectNoA11yViolations(host);
  });

  // The loading state nests a wt-spinner; it must be decorative so the button's accessible name stays
  // its own (localized) label and aria-busy carries the state.
  test("loading button", async () => {
    await mountThemed("<wt-button loading>Buscando…</wt-button>", theme);
    await expectNoA11yViolations(host);
  });

  test("round icon-only button", async () => {
    await mountThemed(
      '<wt-button shape="round" variant="primary" aria-label="Añadir"><wt-icon name="plus"></wt-icon></wt-button>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("wt-button hovered a11y (%s theme)", (theme) => {
  async function mountOn(surface: string, variant: string): Promise<HTMLButtonElement> {
    await mountThemed(
      `<div style="background: var(${surface}); padding: var(--wt-space-4)"><wt-button variant="${variant}">Cobrar</wt-button></div>`,
      theme,
    );
    const button = host.querySelector("wt-button")!;
    return button.shadowRoot!.querySelector("button")!;
  }

  // A dialog paints its body on --wt-color-surface-raised, a page's cards on --wt-color-surface.
  describe.each(["--wt-color-surface", "--wt-color-surface-raised"] as const)(
    "on %s",
    (surface) => {
      test.each(["primary", "danger", "secondary", "ghost"] as const)(
        "%s variant under the pointer",
        async (variant) => {
          const inner = await mountOn(surface, variant);
          await userEvent.hover(inner);
          expect(inner.matches(":hover")).toBe(true);
          await expectNoA11yViolations(host);
        },
      );
    },
  );

  test.each(["primary", "danger"] as const)(
    "%s variant focused from the keyboard and under the pointer",
    async (variant) => {
      const inner = await mountOn("--wt-color-surface", variant);
      await userEvent.tab();
      expect(inner.matches(":focus-visible")).toBe(true);
      await userEvent.hover(inner);
      expect(inner.matches(":hover")).toBe(true);
      await expectNoA11yViolations(host);
    },
  );
});

function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgb\(/);
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

test("in dark, a disabled primary button sits within 1.5:1 of its surface while an enabled one stands out", async () => {
  await mountThemed(
    `<div style="background: var(--wt-color-surface); padding: var(--wt-space-4)"><wt-button variant="primary" disabled>Guardar</wt-button><wt-button variant="primary">Guardar</wt-button></div>`,
    "dark",
  );
  const surface = getComputedStyle(host.querySelector("div")!).backgroundColor;
  const [disabled, enabled] = [...host.querySelectorAll("wt-button")].map(
    (el) => getComputedStyle(el.shadowRoot!.querySelector("button")!).backgroundColor,
  );
  expect(contrastRatio(disabled!, surface)).toBeLessThanOrEqual(1.5);
  expect(contrastRatio(enabled!, surface)).toBeGreaterThan(1.5);
});
