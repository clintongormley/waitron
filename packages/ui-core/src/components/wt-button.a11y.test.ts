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
