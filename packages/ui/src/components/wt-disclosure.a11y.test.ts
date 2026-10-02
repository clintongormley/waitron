import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtDisclosure } from "./wt-disclosure.js";
import "./wt-disclosure.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-disclosure a11y (%s theme)", (theme) => {
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
      { label: "Nombre", value: "EN: Beef tenderloin · ES: Solomillo de ternera", lines: 1 },
      { label: "Descripción", value: "EN: Seared · ES: Sellado", lines: 2 },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no rows.
    expect(el.shadowRoot!.querySelectorAll(".summary-row .summary-label")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });
});
