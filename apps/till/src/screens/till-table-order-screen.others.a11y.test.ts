import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { OtherDraft, TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, burger, menuOf, products, resized } from "./till-table-order-screen.test-helpers.js";
import { mountWidget } from "../widgets/test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const others: OtherDraft[] = [
  {
    id: "draft-alex",
    revision: 1,
    ownerName: "Alex",
    takenFromYou: false,
    lines: [
      { product: beer, quantity: "2", note: "no ice" },
      {
        product: burger,
        quantity: "1",
        extras: [
          {
            listId: "list-extras",
            productId: "p-bacon",
            name: "Bacon",
            price: "1.00",
            quantity: 1,
          },
        ],
      },
    ],
  },
  {
    id: "draft-sam",
    revision: 4,
    ownerName: "Sam",
    takenFromYou: true,
    lines: [
      {
        product: { ...beer, id: "gone", menuItemId: "offer-gone", name: "" },
        quantity: "1",
        notOffered: true,
        blocked: "removed",
      },
    ],
  },
];

describe.each(["light", "dark"] as const)(
  "till-table-order-screen a11y: other people's drafts (%s theme)",
  (theme) => {
    async function withOthers() {
      const mounted = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          products,
          menus: menuOf(products),
          lines: [],
          statuses: [],
          orderId: "wo-4",
          draftStore: new DraftStore(),
          otherDrafts: others,
        },
        theme,
      );
      mounted.host.style.width = "1280px";
      await resized(mounted.el);
      await settled(mounted.el);
      return mounted;
    }

    async function settled(el: TillTableOrderScreen): Promise<void> {
      for (const basket of el.shadowRoot!.querySelectorAll<
        HTMLElement & { updateComplete: Promise<unknown> }
      >("till-basket"))
        await basket.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
    }

    it("has no violations in the read-only panels, one taken over from the person", async () => {
      const { el, host } = await withOthers();
      const panels = [...el.shadowRoot!.querySelectorAll("[data-other-draft]")];
      if (panels.length !== 2 || !panels.every((panel) => panel.checkVisibility()))
        throw new Error("the scan must include both read-only panels");
      await expectNoA11yViolations(host);
    });

    it("has no violations in the take-over dialog", async () => {
      const { el, host } = await withOthers();
      el.shadowRoot!.querySelector<HTMLElement>('[data-take-over="draft-alex"]')!.click();
      await settled(el);
      if (!el.shadowRoot!.querySelector("[data-take-over-confirm]")?.checkVisibility())
        throw new Error("the scan must include the open dialog");
      await expectNoA11yViolations(host);
    });

    it("has no violations while a take-over is out, with Confirm off", async () => {
      const { el, host } = await withOthers();
      el.shadowRoot!.querySelector<HTMLElement>('[data-take-over="draft-alex"]')!.click();
      await settled(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-take-over-confirm]")!.click();
      await settled(el);
      await expectNoA11yViolations(host);
    });
  },
);
