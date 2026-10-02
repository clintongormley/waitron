import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./reprint-language-dialog.js";
import type { TillReprintLanguageDialog } from "./reprint-language-dialog.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)(
  "till-reprint-language-dialog a11y (%s theme)",
  (theme) => {
    it("has no violations when it opens", async () => {
      setLocale("es-ES");
      const { host } = await mountWidget<TillReprintLanguageDialog>(
        "till-reprint-language-dialog",
        { languages: ["es-ES", "ca-ES", "gl-ES", "eu-ES"], defaultLanguage: "ca-ES" },
        theme,
      );
      await expectNoA11yViolations(host);
    });
  },
);
