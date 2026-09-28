import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  DRAFT_SIDE_BY_SIDE_MIN_WIDTH,
  type TillTableOrderScreen,
} from "./till-table-order-screen.js";
import {
  beer,
  browser,
  menuOf,
  mount,
  resized,
  rows,
  shown,
  tap,
} from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: browsing and the draft by the screen's width", () => {
  const review = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  const draftPane = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]");
  const browsing = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-browsing]");

  it("keeps browsing and the draft apart below the width, and opens the whole draft on Review", async () => {
    const { el, host } = await mount();
    host.style.width = "390px";
    await resized(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Flan");

    expect(shown(browsing(el))).toBe(true);
    expect(shown(draftPane(el))).toBe(false);
    expect(review(el)!.textContent!.trim()).toBe(t("table.review").replace("{n}", "3"));

    review(el)!.click();
    await el.updateComplete;

    expect(shown(draftPane(el))).toBe(true);
    expect(shown(browsing(el))).toBe(false);
    const toggles = [...el.shadowRoot!.querySelectorAll("[data-draft-select]")];
    expect(toggles.map((toggle) => shown(toggle))).toEqual([true, true]);
    expect(shown(el.shadowRoot!.querySelector('[data-draft-action="send-all"]'))).toBe(true);
  });

  it("gives each line's name the Review view's width at 390 px, so it is not broken letter by letter", async () => {
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-review-back]")!.click();
    await resized(el);

    expect(browser(el)).toBe(before);
    expect(browser(el).shadowRoot!.querySelector('[data-region="section"]')).not.toBeNull();
    expect(host.scrollTop).toBe(scrolled);
    expect(rows(el)).toEqual(["Beer ×1", "Tapa 30 ×1"]);
    expect(shown(browsing(el))).toBe(true);
  });

  it("moves focus to Back when Review opens, and back to Review on Back", async () => {
    const { el, host } = await mount();
    host.style.width = "390px";
    await resized(el);
    await tap(el, "Beer");
    review(el)!.focus();

    review(el)!.click();
    await resized(el);
    const back = el.shadowRoot!.querySelector<HTMLElement>("[data-review-back]")!;
    expect(el.shadowRoot!.activeElement).toBe(back);

    back.click();
    await resized(el);
    expect(el.shadowRoot!.activeElement).toBe(review(el));
  });

  it("closes Review when the screen widens to side by side, putting browsing's scroll back", async () => {
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

  it("shows browsing and the draft side by side at the width and above, with no Review", async () => {
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

  it("goes back to Review below the width, from side by side", async () => {
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
});
