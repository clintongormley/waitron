import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { menuOf, products } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)(
  "till-table-order-screen a11y: loading (%s theme)",
  (theme) => {
    it("has no violations while the table loads", async () => {
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          products,
          menus: menuOf(products),
          lines: [],
          statuses: [],
          orderId: "wo-4",
          draftStore: new DraftStore(),
          loading: true,
        },
        theme,
      );
      if (!el.shadowRoot!.querySelector("[data-loading]")?.checkVisibility())
        throw new Error("the scan must include the loading line");
      await expectNoA11yViolations(host);
    });
  },
);
