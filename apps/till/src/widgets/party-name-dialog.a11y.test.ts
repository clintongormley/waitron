import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./party-name-dialog.js";
import type { TillPartyNameDialog } from "./party-name-dialog.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-party-name-dialog a11y (%s theme)", (theme) => {
  it("has no violations when it opens", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillPartyNameDialog>(
      "till-party-name-dialog",
      { tables: "Mesa 4, 5", value: "Ana" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal shown beside the field", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillPartyNameDialog>(
      "till-party-name-dialog",
      { tables: "Mesa 4, 5", value: "Ana", refusal: t("table.name_too_long") },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
