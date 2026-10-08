import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { MenuDocumentTree } from "./menu-document-tree.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

registerIcons(DASHBOARD_ICONS);
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

describe.each(["light", "dark"] as const)("frozen menu tree (%s)", (theme) => {
  it.each(["closed", "expanded", "fallback", "empty", "revealed"] as const)(
    "draws %s accessibly",
    async (state) => {
      await page.viewport(1280, 900);
      const document = menuDocument(
        state === "empty"
          ? []
          : [documentSection("drinks", "Counter drinks", [documentProduct("mi", "lager")])],
        { lager: "Counter lager" },
      );
      if (state !== "empty") {
        document.offers.mi!.image = "lager.webp";
        document.offers.mi!.customerName = null;
      }
      const { el, host } = await mountWidget<MenuDocumentTree>(
        "dashboard-menu-document-tree",
        {
          document,
          view: state === "fallback" ? { kind: "customer", language: "en" } : { kind: "internal" },
        },
        theme,
      );
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      if (state === "expanded" || state === "fallback") {
        table.setExpanded("drinks", true);
        await table.updateComplete;
      }
      if (state === "fallback")
        expect(table.shadowRoot!.textContent).toContain("Staff name fallback");
      if (state === "revealed") {
        expect(
          await el.reveal({
            kind: "product",
            sectionIds: ["drinks"],
            menuItemId: "mi",
            productId: "lager",
            field: { kind: "summary" },
          }),
        ).toBe(true);
        expect(table.shadowRoot!.querySelector('[aria-current="true"]')).not.toBeNull();
      }
      await expectNoA11yViolations(host);
    },
  );
});
