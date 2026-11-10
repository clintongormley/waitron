import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  DRAFT_SIDE_BY_SIDE_MIN_WIDTH,
  type TillTableOrderScreen,
} from "./till-table-order-screen.js";
import {
  beer,
  browser,
  flan,
  ham,
  menuOf,
  mount,
  resized,
  rows,
  shown,
  showView,
  shownView,
  tap,
} from "./till-table-order-screen.test-helpers.js";
import { storedDish, storedExtra } from "./till-table-order-screen.sent-fallback.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: browsing and the order by the screen's width", () => {
  const review = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-view=order]");
  const draftPane = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]");
  const browsing = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-browsing]");

  const orderButton = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-view=order]");
  const viewSwitch = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-switch]");

  it("below the width, Menu and Order switch the views, Order counting the New order, the focus staying on the button tapped", async () => {
    const { el, host } = await mount();
    host.style.width = "390px";
    await resized(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Flan");

    expect(shownView(el)).toBe("menu");
    expect(orderButton(el)!.textContent!.trim()).toBe(`${t("table.view_order")} · 3`);
    expect(orderButton(el)!.querySelector('[aria-hidden="true"]')!.textContent!.trim()).toBe("·");
    await expect
      .element(page.getByRole("button", { name: "Order 3", exact: true }))
      .toBeInTheDocument();

    await showView(el, "order");
    expect(shownView(el)).toBe("order");
    expect(shown(draftPane(el))).toBe(true);
    expect(shown(browsing(el))).toBe(false);
    expect(el.shadowRoot!.activeElement).toBe(orderButton(el));

    await showView(el, "menu");
    expect(shownView(el)).toBe("menu");
    expect(shown(browsing(el))).toBe(true);
    expect(shown(draftPane(el))).toBe(false);
    expect(el.shadowRoot!.activeElement).toBe(
      el.shadowRoot!.querySelector<HTMLElement>("[data-view=menu]"),
    );
  });

  it("the Order count takes whole, weighed and recalled lines as items", async () => {
    const draft = new DraftStore();
    draft.appendLines([
      { product: beer, quantity: "2" },
      {
        product: flan,
        quantity: "1",
        extras: [
          { listId: "extras", productId: "sauce", name: "Sauce", quantity: 3, price: "0.25" },
        ],
      },
      { product: ham, quantity: "0.375" },
      {
        product: { ...beer, id: "retired", name: "Recorded dish" },
        quantity: "2.000",
        noMerge: true,
        source: { line: storedDish, extras: [storedExtra], netAmount: "8.00" },
      },
    ]);
    const { el, host } = await mount({ draftStore: draft, lines: [storedDish, storedExtra] });
    host.style.width = "390px";
    await resized(el);

    expect(orderButton(el)!.textContent!.trim()).toBe(`${t("table.view_order")} · 6`);
  });

  it("an empty New order reads Order with no number", async () => {
    const { el, host } = await mount();
    host.style.width = "390px";
    await resized(el);

    expect(orderButton(el)!.textContent!.trim()).toBe(t("table.view_order"));
    await expect
      .element(page.getByRole("button", { name: t("table.view_order"), exact: true }))
      .toBeInTheDocument();
  });

  it("the switch only below the width", async () => {
    const { el, host } = await mount();
    host.style.width = `${DRAFT_SIDE_BY_SIDE_MIN_WIDTH - 1}px`;
    await resized(el);
    expect(shown(viewSwitch(el))).toBe(true);

    host.style.width = `${DRAFT_SIDE_BY_SIDE_MIN_WIDTH}px`;
    await resized(el);
    expect(viewSwitch(el)).toBeNull();
  });

  it("Spanish: Carta and Pedido · 3", async () => {
    setLocale("es");
    try {
      expect(t("table.view_menu")).not.toBe("Menu");
      expect(t("table.view_order")).not.toBe("Order");
      const { el, host } = await mount();
      host.style.width = "390px";
      await resized(el);
      await tap(el, "Beer");
      await tap(el, "Beer");
      await tap(el, "Flan");

      expect(el.shadowRoot!.querySelector("[data-view=menu]")!.textContent!.trim()).toBe(
        t("table.view_menu"),
      );
      expect(orderButton(el)!.textContent!.trim()).toBe(`${t("table.view_order")} · 3`);
    } finally {
      setLocale("en");
    }
  });

  it("gives each line's name the Order view's width at 390 px, so it is not broken letter by letter", async () => {
    const { el, host } = await mount();
    host.style.width = "390px";
    await resized(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    review(el)!.click();
    await el.updateComplete;
    for (const basket of el.shadowRoot!.querySelectorAll<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("till-basket"))
      await basket.updateComplete;

    const toggle = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-select]")!;
    expect(toggle.getBoundingClientRect().height).toBeLessThan(2 * 44);
  });

  it("comes Back to the same browsing, its open section and its scroll position, with the draft kept", async () => {
    const fillers = Array.from({ length: 40 }, (_, n) => ({
      ...beer,
      id: `tapa-${n}`,
      menuItemId: `offer-tapa-${n}`,
      name: `Tapa ${n}`,
    }));
    const offered = [beer, ...fillers];
    const { el, host } = await mount({
      products: offered,
      menus: menuOf(offered, (product) => (product.id.startsWith("tapa") ? "Tapas" : undefined)),
    });
    host.style.width = "390px";
    host.style.height = "500px";
    host.style.overflowY = "auto";
    await resized(el);
    await tap(el, "Beer");
    const section = [
      ...browser(el).shadowRoot!.querySelectorAll<HTMLElement>('wt-button[data-kind="section"]'),
    ][0]!;
    section.click();
    await browser(el).updateComplete;
    await tap(el, "Tapa 30");
    host.scrollTop = 900;
    const scrolled = host.scrollTop;
    expect(scrolled).toBeGreaterThan(0);
    const before = browser(el);

    review(el)!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-view=menu]")!.click();
    await resized(el);

    expect(browser(el)).toBe(before);
    expect(browser(el).shadowRoot!.querySelector('[data-region="section"]')).not.toBeNull();
    expect(host.scrollTop).toBe(scrolled);
    expect(rows(el)).toEqual(["Beer ×1", "Tapa 30 ×1"]);
    expect(shown(browsing(el))).toBe(true);
  });

  it("closes Order when the screen widens to side by side, putting browsing's scroll back", async () => {
    const tapas = Array.from({ length: 40 }, (_, n) => ({
      ...beer,
      id: `tapa-${n}`,
      menuItemId: `offer-tapa-${n}`,
      name: `Tapa ${n}`,
    }));
    const { el, host } = await mount({ products: tapas, menus: menuOf(tapas) });
    host.style.width = "390px";
    host.style.height = "500px";
    host.style.overflowY = "auto";
    await resized(el);
    await tap(el, "Tapa 1");
    host.scrollTop = 700;
    const scrolled = host.scrollTop;
    expect(scrolled).toBeGreaterThan(0);
    review(el)!.click();
    await resized(el);

    host.style.width = "1280px";
    await resized(el);
    await resized(el);
    // The wider menu is shorter, so the browser holds the offset at the most it can scroll.
    const most = host.scrollHeight - host.clientHeight;
    expect(most).toBeGreaterThan(0);
    expect(host.scrollTop).toBe(Math.min(scrolled, most));

    host.style.width = "390px";
    await resized(el);
    expect(shown(browsing(el))).toBe(true);
    expect(shown(draftPane(el))).toBe(false);
  });

  it("shows browsing and the draft side by side at the width and above, with no Order", async () => {
    const { el, host } = await mount();
    host.style.width = `${DRAFT_SIDE_BY_SIDE_MIN_WIDTH}px`;
    await resized(el);
    await tap(el, "Beer");

    expect(review(el)).toBeNull();
    expect(shown(browsing(el))).toBe(true);
    expect(shown(draftPane(el))).toBe(true);
    const side = browsing(el)!.getBoundingClientRect();
    const pane = draftPane(el)!.getBoundingClientRect();
    expect(pane.left).toBeGreaterThanOrEqual(side.right);
  });

  it("goes back to Order below the width, from side by side", async () => {
    const { el, host } = await mount();
    host.style.width = "1280px";
    await resized(el);
    await tap(el, "Beer");
    expect(review(el)).toBeNull();

    host.style.width = `${DRAFT_SIDE_BY_SIDE_MIN_WIDTH - 1}px`;
    await resized(el);

    expect(shown(review(el))).toBe(true);
    expect(shown(draftPane(el))).toBe(false);
  });

  it.each([
    ["the switch", "[data-view=order]"],
    ["the Menu bar's words", "[data-new-order-summary]"],
    ["the Menu bar's Send all", "[data-menu-send-all]"],
  ])(
    "showing Order by %s shows its top, with the switch in view, not the dish just added",
    async (_, opener) => {
      const sent = Array.from({ length: 20 }, (_, n) => ({
        ...storedDish,
        id: `sent-${n}`,
        lineNo: n + 1,
        name: `Sent dish ${n}`,
      }));
      const cola = { ...beer, id: "cola", menuItemId: "offer-cola", name: "Cola" };
      const offered = [beer, flan, cola];
      const { el, host } = await mount({ lines: sent, products: offered, menus: menuOf(offered) });
      host.style.width = "390px";
      host.style.height = "600px";
      host.style.overflowY = "auto";
      await resized(el);
      await showView(el, "menu");
      for (const name of ["Beer", "Flan", "Cola"]) await tap(el, name);

      el.shadowRoot!.querySelector<HTMLElement>(opener)!.click();
      await resized(el);
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
      const area = host.getBoundingClientRect();
      const toggle = viewSwitch(el)!.getBoundingClientRect();
      expect(toggle.top).toBeGreaterThanOrEqual(area.top);
      expect(toggle.bottom).toBeLessThanOrEqual(area.bottom);
    },
  );

  it("a screen drawn for a bill with sent lines opens on Order", async () => {
    const { el, host } = await mount({ lines: [storedDish] });
    host.style.width = "390px";
    await resized(el);

    expect(shownView(el)).toBe("order");
    expect(shown(draftPane(el))).toBe(true);
    expect(shown(browsing(el))).toBe(false);
  });

  it("an open that lands with sent lines opens on Order, and with none on Menu", async () => {
    const { el, host } = await mount({ loading: true });
    host.style.width = "390px";
    await resized(el);
    el.lines = [storedDish];
    el.loading = false;
    await el.updateComplete;
    expect(shownView(el)).toBe("order");

    el.loading = true;
    await el.updateComplete;
    el.lines = [];
    el.loading = false;
    await el.updateComplete;
    expect(shownView(el)).toBe("menu");
  });

  it("a bill switch shows Menu", async () => {
    const { el, host } = await mount({ lines: [storedDish] });
    host.style.width = "390px";
    await resized(el);
    await showView(el, "order");
    expect(shownView(el)).toBe("order");

    el.orderId = "wo-5";
    await el.updateComplete;
    expect(shownView(el)).toBe("menu");
  });

  it("at the width and above, the opening view changes nothing", async () => {
    await page.viewport(1280, 844);
    try {
      const { el, host } = await mount({ lines: [storedDish] });
      await resized(el);
      expect(viewSwitch(el)).toBeNull();
      expect(shown(browsing(el))).toBe(true);
      expect(shown(draftPane(el))).toBe(true);

      host.style.width = "390px";
      await resized(el);
      expect(shownView(el)).toBe("menu");
    } finally {
      await page.viewport(414, 896);
    }
  });
});
