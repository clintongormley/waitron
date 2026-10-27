import { afterEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { stationColumnNames } from "./station-queue.js";
import type { TillKitchenColumnsDialog } from "./kitchen-columns-dialog.js";
import "./kitchen-columns-dialog.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

describe.each(["light", "dark"] as const)("the Columns window a11y (%s theme)", (theme) => {
  it.each(["en", "es"] as const)(
    "%s: the Columns window, with a hidden column and both ends' arrows disabled, has no violations",
    async (language) => {
      setLocale(language);
      const { el, host } = await mountWidget<TillKitchenColumnsDialog>(
        "till-kitchen-columns-dialog",
        {
          layout: {
            order: ["waiting", "preparing", "ready"],
            hidden: ["preparing"],
            collapsed: [],
          },
          names: stationColumnNames(),
          boardName: "Grill",
          opener: null,
        },
        theme,
      );
      await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-column-show="preparing"]')).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );
});
