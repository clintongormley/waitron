import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { countText, fill, setLocale, t } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { sellingValuesOf, type TillProduct } from "../api/client.js";
import { productAsVariant } from "../state/order-line.js";
import type { SubmitDraftDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import {
  beer,
  browser,
  menuOf,
  mount,
  resized,
  shown,
  shownView,
  store,
  tap,
} from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const dish = (id: string, name: string): TillProduct => ({
  ...beer,
  id,
  menuItemId: `offer-${id}`,
  name,
});
const croquettes = dish("croquettes", "Croquettes");
const pork = dish("pork", "Pork shoulder");
const dishes = [croquettes, pork];

const bar = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-new-order-bar]");
const summary = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-new-order-summary]")!;
const menuSendAll = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean; variant: string }>(
    "[data-menu-send-all]",
  )!;
const draftSendAll = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean; variant: string }>(
    '[data-draft-action="send-all"]',
  )!;

async function phone(over: Partial<TillTableOrderScreen> = {}, products = dishes) {
  const mounted = await mount({ products, menus: menuOf(products), ...over });
  mounted.host.style.width = "390px";
  await resized(mounted.el);
  return mounted;
}

function sends(el: TillTableOrderScreen): SubmitDraftDetail[] {
  const seen: SubmitDraftDetail[] = [];
  el.addEventListener("submit-draft", (event) =>
    seen.push((event as CustomEvent<SubmitDraftDetail>).detail),
  );
  return seen;
}

describe("till-table-order-screen: the Menu's New order bar", () => {
  it("the Menu's New order bar: appears only while the New order has a dish, and only below the width", async () => {
    const { el, host } = await phone();
    expect(bar(el)).toBeNull();

    await tap(el, "Croquettes");
    expect(shown(bar(el))).toBe(true);

    host.style.width = "1280px";
    await resized(el);
    expect(bar(el)).toBeNull();
  });

  it("the Menu's New order bar: says what the New order holds", async () => {
    const { el } = await phone();
    await tap(el, "Croquettes");
    expect(summary(el).textContent!.trim()).toBe(
      `${t("table.draft_title")} · ${countText(1, "order_counts.items", "order_counts.items_one")} — ${fill(t("table.new_order_dish"), { n: "1", name: "Croquettes" })}`,
    );
    expect(summary(el).textContent!.trim()).toContain("1 item —");

    await tap(el, "Croquettes");
    await tap(el, "Pork shoulder");
    expect(summary(el).textContent!.trim()).toBe(
      `${t("table.draft_title")} · ${countText(3, "order_counts.items", "order_counts.items_one")} — 2 × Croquettes · 1 × Pork shoulder`,
    );
  });

  it("the Menu's New order bar: the words open Order", async () => {
    const { el } = await phone();
    await tap(el, "Croquettes");

    await userEvent.click(summary(el));
    await el.updateComplete;

    expect(shownView(el)).toBe("order");
    expect(shown(el.shadowRoot!.querySelector("[data-draft-pane]"))).toBe(true);
  });

  it("the Menu's New order bar: Send all shows Order as the send starts", async () => {
    const { el } = await phone();
    const seen = sends(el);
    await tap(el, "Croquettes");

    await userEvent.click(menuSendAll(el));
    await el.updateComplete;

    expect(seen).toHaveLength(1);
    expect(shownView(el)).toBe("order");
    expect(shown(el.shadowRoot!.querySelector("[data-draft-pane]"))).toBe(true);
  });

  it("the Menu's New order bar: Send all sends what the draft bar's Send all sends", async () => {
    const { el } = await phone();
    const seen = sends(el);
    await tap(el, "Croquettes");
    await tap(el, "Croquettes");
    await tap(el, "Pork shoulder");

    await userEvent.click(menuSendAll(el));
    await el.updateComplete;
    await userEvent.click(draftSendAll(el));
    await el.updateComplete;

    expect(seen).toHaveLength(2);
    expect(seen[0]!.lines).toHaveLength(2);
    expect(seen[0]!.lines).toEqual(seen[1]!.lines);
  });

  it("the Menu's New order bar: Send all is quiet and disabled exactly when the draft bar's is", async () => {
    const { el } = await phone();
    await tap(el, "Croquettes");
    const looks = () =>
      [menuSendAll(el), draftSendAll(el)].map((button) => [button.disabled, button.variant]);

    expect(looks()).toEqual([
      [false, "primary"],
      [false, "primary"],
    ]);

    el.draftActionsAllowed = false;
    await el.updateComplete;
    expect(looks()).toEqual([
      [true, "secondary"],
      [true, "secondary"],
    ]);

    el.draftActionsAllowed = true;
    el.draftStore!.sending = true;
    await el.updateComplete;
    expect(looks()).toEqual([
      [true, "secondary"],
      [true, "secondary"],
    ]);
  });

  it("the Menu's New order bar: stays at the window's foot while the menu scrolls, and leaves the last tile uncovered at the end", async () => {
    const many = Array.from({ length: 40 }, (_, n) => dish(`dish-${n}`, `Dish ${n}`));
    const { el, host } = await phone({}, many);
    host.style.height = "600px";
    host.style.overflowY = "auto";
    await resized(el);
    await tap(el, "Dish 0");
    await resized(el);
    expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);

    host.scrollTop = 0;
    await resized(el);
    const area = host.getBoundingClientRect();
    const top = bar(el)!.getBoundingClientRect();
    expect(top.top).toBeGreaterThanOrEqual(area.top);
    expect(Math.abs(top.bottom - area.bottom)).toBeLessThanOrEqual(1);

    host.scrollTop = host.scrollHeight;
    await resized(el);
    const tiles = browser(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile");
    const lastTile = tiles[tiles.length - 1]!.getBoundingClientRect();
    expect(lastTile.bottom).toBeLessThanOrEqual(bar(el)!.getBoundingClientRect().top);
  });

  it("the Menu's New order bar: a long list is cut on one line", async () => {
    const ten = Array.from({ length: 10 }, (_, n) => dish(`dish-${n}`, `Long dish name ${n}`));
    const { el } = await phone({}, ten);
    await tap(el, "Long dish name 0");
    const oneLine = summary(el).getBoundingClientRect().height;

    for (let n = 1; n < 10; n++) await tap(el, `Long dish name ${n}`);

    expect(summary(el).getBoundingClientRect().height).toBe(oneLine);
    expect(summary(el).scrollWidth).toBeGreaterThan(summary(el).clientWidth);
  });

  it.each(["en", "es"])(
    "the Menu's New order bar: Send all stays on one line while the words are cut, at 360 px (%s)",
    async (locale) => {
      setLocale(locale);
      const ten = Array.from({ length: 10 }, (_, n) => dish(`dish-${n}`, `Long dish name ${n}`));
      const { el, host } = await phone({}, ten);
      host.style.width = "700px";
      await resized(el);
      await tap(el, "Long dish name 0");
      expect(summary(el).scrollWidth).toBeLessThanOrEqual(summary(el).clientWidth);
      const oneLine = menuSendAll(el).getBoundingClientRect().height;

      host.style.width = "360px";
      await resized(el);
      for (let n = 1; n < 10; n++) await tap(el, `Long dish name ${n}`);

      expect(summary(el).scrollWidth).toBeGreaterThan(summary(el).clientWidth);
      expect(menuSendAll(el).getBoundingClientRect().height).toBe(oneLine);
    },
  );

  it("the Menu's New order bar: Spanish", async () => {
    setLocale("es");
    const { el } = await phone();
    await tap(el, "Croquettes");
    await tap(el, "Croquettes");
    await tap(el, "Pork shoulder");

    expect(summary(el).textContent!.trim()).toBe(
      `${t("table.draft_title")} · ${fill(t("order_counts.items"), { n: "3" })} — ${fill(t("table.new_order_dish"), { n: "2", name: "Croquettes" })} · ${fill(t("table.new_order_dish"), { n: "1", name: "Pork shoulder" })}`,
    );
    expect(menuSendAll(el).textContent!.trim()).toBe(t("table.draft_send_all"));
    for (const key of ["table.draft_title", "order_counts.items", "table.draft_send_all"] as const)
      expect(es[key]).not.toBe(en[key]);
    expect(es["table.new_order_dish"]).toBe(en["table.new_order_dish"]);
  });
});

describe("till-table-order-screen: the Menu's tile numbers", () => {
  const tile = (el: TillTableOrderScreen, name: string) =>
    [...browser(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")].find(
      (each) => each.querySelector(".name")?.textContent === name,
    )!;
  const number = (el: TillTableOrderScreen, name: string) =>
    tile(el, name).querySelector("[data-in-order-count]")?.textContent?.trim() ?? null;

  it("tapping a tile numbers it; a variant counts on its dish; removing the line clears it", async () => {
    const { el, host } = await phone();
    expect(number(el, "Croquettes")).toBeNull();

    await tap(el, "Croquettes");
    expect(number(el, "Croquettes")).toBe("1");
    expect(number(el, "Pork shoulder")).toBeNull();

    const sauce = productAsVariant(croquettes, {
      ...sellingValuesOf(croquettes),
      id: "v-sauce",
      name: "Croquettes with aioli",
      unitPrice: "4.00",
      unitPriceDifference: null,
      available: true,
    });
    store(el).addProduct(sauce, "2");
    await el.updateComplete;
    expect(store(el).lines).toHaveLength(2);
    expect(number(el, "Croquettes")).toBe("3");

    store(el).removeLine(1);
    await el.updateComplete;
    expect(number(el, "Croquettes")).toBe("1");
    store(el).removeLine(0);
    await el.updateComplete;
    expect(number(el, "Croquettes")).toBeNull();

    await tap(el, "Croquettes");
    expect(number(el, "Croquettes")).toBe("1");
    host.style.width = "1280px";
    await resized(el);
    expect(store(el).lines).toHaveLength(1);
    expect(number(el, "Croquettes")).toBeNull();
  });
});
