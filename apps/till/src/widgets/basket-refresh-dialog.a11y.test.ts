import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./basket-refresh-dialog.js";
import type { TillBasketRefreshDialog } from "./basket-refresh-dialog.js";

afterEach(cleanupWidgets);

const changed = [{ lineNo: 1, name: "Limonada", from: "3.00", to: "2.50" }];
const blocked = [{ lineNo: 2, name: "Hamburguesa", reason: "removed" as const }];

describe.each(["light", "dark"] as const)("till-basket-refresh-dialog a11y (%s theme)", (theme) => {
  it.each([
    ["new prices only", { changed, blocked: [] }],
    ["lines to resolve only", { changed: [], blocked }],
    ["both", { changed, blocked }],
  ])("has no violations with %s", async (_state, props) => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillBasketRefreshDialog>(
      "till-basket-refresh-dialog",
      props,
      theme,
    );
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)(
  "till-basket-refresh-dialog a11y on a table's order (%s theme)",
  (theme) => {
    it("has no violations with a line shown at its new price alone and a line left unsent", async () => {
      setLocale("es-ES");
      const { host } = await mountWidget<TillBasketRefreshDialog>(
        "till-basket-refresh-dialog",
        { changed: [{ lineNo: 1, name: "Caña", to: "6.00" }], blocked, purpose: "send" },
        theme,
      );
      await expectNoA11yViolations(host);
    });
  },
);
