import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, flan, menuOf, products, resized } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)(
  "till-table-order-screen a11y: a draft line that cannot be sold now (%s theme)",
  (theme) => {
    async function flaggedDraft(width: string) {
      const draftStore = new DraftStore();
      draftStore.loadFrom(draftStore.id, [
        { product: beer, quantity: "2", unavailableOnServer: true },
        { product: flan, quantity: "1", blocked: "unavailable" },
        { product: beer, quantity: "1", noMerge: true },
      ]);
      const mounted = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          products,
          menus: menuOf(products),
          lines: [],
          statuses: [],
          orderId: "wo-4",
          draftStore,
        },
        theme,
      );
      mounted.host.style.width = width;
      await resized(mounted.el);
      await settled(mounted.el);
      return mounted;
    }

    async function settled(el: TillTableOrderScreen): Promise<void> {
      await el.updateComplete;
      for (const basket of el.shadowRoot!.querySelectorAll<
        HTMLElement & { updateComplete: Promise<unknown> }
      >("till-basket"))
        await basket.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
    }

    function mustShow(el: TillTableOrderScreen, selector: string): void {
      if (!el.shadowRoot!.querySelector(selector)?.checkVisibility())
        throw new Error(`the scan must include ${selector}`);
    }

    it("has no violations beside browsing, with Remove and Keep on each flagged line", async () => {
      const { el, host } = await flaggedDraft("1280px");
      mustShow(el, '[data-flag-remove="0"]');
      mustShow(el, '[data-flag-keep="1"]');
      await expectNoA11yViolations(host);
    });

    it("has no violations on Review at phone width, once a line is kept", async () => {
      const { el, host } = await flaggedDraft("390px");
      el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
      await settled(el);
      el.shadowRoot!.querySelector<HTMLElement>('[data-flag-keep="0"]')!.click();
      await settled(el);
      mustShow(el, "[data-flag-kept]");
      mustShow(el, '[data-flag-remove="1"]');
      await expectNoA11yViolations(host);
    });

    it("has no violations in a preview that names what it leaves out", async () => {
      const { el, host } = await flaggedDraft("1280px");
      el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
      await settled(el);
      mustShow(el, "[data-preview-left-out]");
      await expectNoA11yViolations(host);
    });
  },
);
