import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./bill-choice-dialog.js";
import type { TillBillChoiceDialog } from "./bill-choice-dialog.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-bill-choice-dialog a11y (%s theme)", (theme) => {
  it("has no violations when it opens", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillBillChoiceDialog>(
      "till-bill-choice-dialog",
      { scope: "Ana (Mesa 4, 5) se une a Luis (Mesa 7)" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations when it asks about a bill moving into a party", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillBillChoiceDialog>(
      "till-bill-choice-dialog",
      {
        scope: "Ana · Cuenta 2 a Luis (Mesa 7)",
        question:
          "¿Juntar esta cuenta con su cuenta principal o mantenerla como una cuenta aparte?",
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
