import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-switch.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-switch a11y (%s theme)", (theme) => {
  test("unchecked", async () => {
    await mountThemed('<wt-switch label="Modo formación"></wt-switch>', theme);
    await expectNoA11yViolations(host);
  });

  test("checked", async () => {
    await mountThemed('<wt-switch label="Activado" checked></wt-switch>', theme);
    await expectNoA11yViolations(host);
  });

  test("hidden label", async () => {
    await mountThemed('<wt-switch label="Disponible" hide-label checked></wt-switch>', theme);
    await expectNoA11yViolations(host);
  });

  test("row-specific accessible name", async () => {
    const el = await mountThemed(
      '<wt-switch label="Disponible" accessible-name="Media" hide-label checked></wt-switch>',
      theme,
    );
    expect(el.shadowRoot!.querySelector("input")!.getAttribute("aria-label")).toBe("Media");
    await expectNoA11yViolations(host);
  });

  test("with a description read to assistive technology", async () => {
    const el = await mountThemed(
      '<wt-switch label="Todas las zonas" description="Incluye las zonas que se añadan" checked></wt-switch>',
      theme,
    );
    const input = el.shadowRoot!.querySelector("input")!;
    const described = el.shadowRoot!.getElementById(input.getAttribute("aria-describedby")!);
    expect(described?.textContent).toBe("Incluye las zonas que se añadan");
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed('<wt-switch label="Activado" disabled></wt-switch>', theme);
    await expectNoA11yViolations(host);
  });
});
