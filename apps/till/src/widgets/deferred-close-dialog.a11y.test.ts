import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./deferred-close-dialog.js";
import type { TillDeferredCloseDialog } from "./deferred-close-dialog.js";

afterEach(cleanupWidgets);

const bill = {
  label: "Mesa 4 · Cuenta 2",
  total: "62.40",
  customer: { legalName: "Hostelería Levante SL", taxId: "B12345678" },
  issued: false,
};

describe.each(["light", "dark"] as const)("till-deferred-close-dialog a11y (%s theme)", (theme) => {
  it.each([
    ["idle", ""],
    ["refused", "El total de esta cuenta ha cambiado. Revisa los datos y confirma de nuevo."],
  ])("has no violations when %s", async (_state, refusal) => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillDeferredCloseDialog>(
      "till-deferred-close-dialog",
      { open: true, bill, refusal },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
