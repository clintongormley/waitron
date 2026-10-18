import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtDisclosure } from "./wt-disclosure.js";
import "./wt-disclosure.js";
import "./wt-help-tooltip.js";
import { setHelpMode } from "../help-mode.js";

afterEach(cleanup);
afterEach(() => setHelpMode(false));

describe.each(["light", "dark"] as const)("wt-disclosure a11y (%s theme)", (theme) => {
  test.each(["", "open", "has-error"])("ruled section %s", async (state) => {
    await mountThemed(
      `<wt-disclosure ruled heading="Selling" ${state}><span slot="summary">Available</span><p>Anyone can order</p></wt-disclosure>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });
  test("collapsed", async () => {
    await mountThemed(
      '<wt-disclosure heading="Cocina" summary="2 opciones"><p>cuerpo</p></wt-disclosure>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("open", async () => {
    await mountThemed(
      '<wt-disclosure heading="Cocina" summary="2 opciones" open><p>cuerpo</p></wt-disclosure>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("has-error", async () => {
    await mountThemed(
      '<wt-disclosure heading="Cocina" summary="Revisa este campo" has-error><p>cuerpo</p></wt-disclosure>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("collapsed, with named summary fields", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Cocina"><p>cuerpo</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryFields = [
      { label: "Pantalla", value: "Barra" },
      { label: "Orden", value: "Entrantes" },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no field names.
    expect(el.shadowRoot!.querySelectorAll(".summary-label")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  test("collapsed, with summary rows", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Descriptores"><p>cuerpo</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryRows = [
      { label: "Name", value: "EN: Beef tenderloin · ES: Solomillo de ternera", lines: 1 },
      { label: "Description", value: "EN: Seared · ES: Sellado", lines: 2 },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no rows.
    expect(el.shadowRoot!.querySelectorAll(".summary-row .summary-label")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  test("collapsed, with a value drawn as a placeholder", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryFields = [
      { label: "Kitchen name", value: "None specified" },
      { label: "Course", value: "Mains", placeholder: true },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no placeholder value.
    expect(el.shadowRoot!.querySelectorAll(".summary-placeholder")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  test("collapsed, with a summary row drawn as a placeholder", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Descriptors"><p>body</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryRows = [
      { label: "Name", value: "None specified", lines: 1 },
      { label: "Description", value: "EN: Roasted in house", lines: 2, placeholder: true },
    ];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll(".summary-row .summary-placeholder")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help off", async () => {
    await mountThemed(
      '<wt-disclosure heading="Selling" summary="Available"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Selling">Who can order it.</wt-help-tooltip><p>Anyone can order</p></wt-disclosure>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help on", async () => {
    await mountThemed(
      '<wt-disclosure heading="Selling" summary="Available"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Selling">Who can order it.</wt-help-tooltip><p>Anyone can order</p></wt-disclosure>',
      theme,
    );
    const badge = host.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-help-tooltip",
    )!;
    setHelpMode(true);
    await badge.updateComplete;
    expect(badge.checkVisibility()).toBe(true);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
