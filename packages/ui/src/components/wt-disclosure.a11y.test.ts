import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
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
});
