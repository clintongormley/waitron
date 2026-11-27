import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { currentLocale } from "../i18n/t.js";
import { WorkingOrderStore, type OrderLine } from "../state/working-order.js";
import type { TillProduct } from "../api/menu-api.js";
import "./basket.js";
import type { TillBasket } from "./basket.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { OpenDraftRow, draftSlotStyles } from "./draft-row-open.js";
import { draftSplitArrow } from "./draft-portions.js";
import type { WtStepper } from "@waitron/ui";

/** The order screen's part in an opened row: it holds which row is open and slots its controls. */
class OpenedRowHost extends LitElement {
  static override styles = draftSlotStyles;
  store!: WorkingOrderStore;
  readonly opener = new OpenDraftRow(
    this,
    () => false,
    () => this.store,
    () => document.scrollingElement!,
  );
  override render() {
    return html`<till-basket
      .store=${this.store}
      .lineDetails=${true}
      .compactRows=${true}
      stacked
      .openedLine=${this.opener.line(this.store)}
      >${this.store.lines.map(
        (line, index) =>
          html`${this.opener.controls(this.store, line, index, {
            allowed: true,
            run: () => {},
          })}${draftSplitArrow(
            line,
            index,
            () => true,
            () => {},
          )}`,
      )}</till-basket
    >`;
  }
}
customElements.define("test-opened-row-host", OpenedRowHost);

const dish = (id: string, name: string): TillProduct => ({
  id,
  name,
  unitPrice: "7.80",
  pricingUnit: "each",
  category: null,
  allergens: { gluten: { kinds: ["wheat"] } },
});
const croquettes = dish("croquettes", "Croquettes");
const bravas = dish("bravas", "Bravas");
const toast: TillProduct = {
  ...dish("toast", "Toast"),
  offeredModifiers: [
    {
      kind: "extras",
      id: "toppings",
      name: "Toppings",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: 3,
      items: [
        {
          presentation: {
            name: "Cheese",
            customerName: null,
            kitchenName: null,
            variantName: null,
            variantCustomerName: null,
            variantKitchenName: null,
          },
          productId: "cheese",
          name: "Cheese",
          customerName: null,
          kitchenName: null,
          price: "1.00",
          portion: "1",
          unit: {
            id: "each",
            staffName: "Each",
            staffAbbreviation: "ea",
            name: { en: "Each" },
            abbreviation: { en: "ea" },
            precision: 0,
            hardwareUnit: null,
          },
          maxQuantity: 3,
          preselected: false,
          addAllergens: { milk: {} },
          suitableFor: ["vegetarian", "vegan"],
        },
      ],
    },
  ],
};

async function mount(theme: "light" | "dark", lines: OrderLine[], props: Partial<TillBasket> = {}) {
  const store = new WorkingOrderStore();
  store.loadFrom("draft", lines);
  const mounted = await mountWidget<TillBasket>(
    "till-basket",
    { store, lineDetails: true, stacked: true, compactRows: true, ...props },
    theme,
  );
  return { ...mounted, store };
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("compact draft rows a11y (%s theme)", (theme) => {
  it("a plain row has no violations and one button named by quantity, name and price", async () => {
    const { el, host } = await mount(theme, [{ product: croquettes, quantity: "2" }]);
    expect(el.shadowRoot!.querySelectorAll("button")).toHaveLength(1);
    const price = formatMoney("15.60", currentLocale()).replace(/[.]/g, "\\.");
    const named = page.getByRole("button", { name: new RegExp(`^2 Croquettes .*${price}$`) });
    expect(named.elements()).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the row added last has no violations", async () => {
    const { el, host, store } = await mount(theme, [{ product: bravas, quantity: "1" }]);
    store.addProduct(croquettes, "1");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-last-added]")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the row added last, with an extra's own allergen and diet marks, has no violations", async () => {
    const { el, host, store } = await mount(theme, [{ product: bravas, quantity: "1" }]);
    store.addProduct(toast, "1", {
      extras: [
        { listId: "toppings", productId: "cheese", name: "Cheese", price: "1.00", quantity: 1 },
      ],
    });
    await el.updateComplete;
    const row = el.shadowRoot!.querySelector("[data-last-added]")!;
    expect(row.querySelector('[data-test="option-allergens-1-0"]')).not.toBeNull();
    expect(row.querySelectorAll('[data-test="option-diet-1-0"] > .diet-badge')).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  it("the row added last has no violations with its period ended, then blocked", async () => {
    const { el, host, store } = await mount(theme, [{ product: bravas, quantity: "1" }]);
    store.addProduct(croquettes, "1");
    store.setEndedPeriods([undefined, { menuId: "lunch", periodName: "Lunch" }]);
    const warning = document.createElement("div");
    warning.slot = "after-1";
    warning.textContent = "⚠ Kitchen is closed";
    el.append(warning);
    await el.updateComplete;
    const row = () => el.shadowRoot!.querySelector("[data-last-added]")!;
    expect(row().querySelector("[data-period-ended]")).not.toBeNull();
    await expectNoA11yViolations(host);
    store.setBlocked([undefined, "unavailable"]);
    await el.updateComplete;
    expect(row().querySelector(".not-offered")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("a row carrying warnings has no violations", async () => {
    const { el, host } = await mount(theme, [
      {
        product: croquettes,
        quantity: "1",
        notOffered: true,
        endedPeriod: { periodName: "Lunch" },
        notOfferedExtras: [
          { productId: "aioli", listId: "sauces", name: "Aioli", price: "0.50", quantity: 2 },
        ],
      } as OrderLine,
    ]);
    const warning = document.createElement("div");
    warning.slot = "after-0";
    warning.textContent = "⚠ Kitchen is closed";
    el.append(warning);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-period-ended]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("an opened row, with its stepper, Options and Note, has no violations, before and after it was added last", async () => {
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [{ product: croquettes, quantity: "2" }]);
    const { el, host } = await mountWidget<OpenedRowHost>("test-opened-row-host", { store }, theme);
    const basket = el.shadowRoot!.querySelector<TillBasket>("till-basket")!;
    await basket.updateComplete;
    const row = basket.shadowRoot!.querySelector<HTMLButtonElement>("[data-draft-row]")!;
    await userEvent.click(row);
    await el.updateComplete;
    await basket.updateComplete;
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const box = basket.shadowRoot!.querySelector<HTMLElement>(".entry[data-open]")!;
    const style = getComputedStyle(box);
    expect(style.borderTopWidth).toBe("2px");
    expect(style.boxShadow).toBe("none");
    const options = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-open-options]")!;
    expect(options.getBoundingClientRect().height).toBe(44);
    expect(el.shadowRoot!.querySelector("wt-stepper")).not.toBeNull();
    await expectNoA11yViolations(host);
    store.addProduct(bravas, "1");
    await el.updateComplete;
    await basket.updateComplete;
    await userEvent.click(
      basket.shadowRoot!.querySelector<HTMLButtonElement>('[data-draft-row="1"]')!,
    );
    await el.updateComplete;
    await basket.updateComplete;
    const added = basket.shadowRoot!.querySelector<HTMLElement>(".entry[data-last-added]")!;
    const plain = getComputedStyle(
      basket.shadowRoot!.querySelector(".entry:not([data-last-added])")!,
    );
    expect(added.hasAttribute("data-open")).toBe(true);
    expect(getComputedStyle(added).backgroundColor).toBe(plain.backgroundColor);
    const stepper = el.shadowRoot!.querySelector<WtStepper>('[data-draft-open="1"] wt-stepper')!;
    await stepper.updateComplete;
    expect(stepper.shadowRoot!.querySelector("[data-remove]")).not.toBeNull();
    await expectNoA11yViolations(host);
    await userEvent.click(
      basket.shadowRoot!.querySelector<HTMLButtonElement>('[data-draft-row="1"]')!,
    );
    await el.updateComplete;
    await basket.updateComplete;
    expect(added.hasAttribute("data-open")).toBe(false);
    expect(getComputedStyle(added).backgroundColor).not.toBe(plain.backgroundColor);
  });

  it("an opened row's description, allergens and diet labels, or its unreviewed and none-declared wording, have no violations", async () => {
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [
      {
        product: {
          ...croquettes,
          description: { en: "Ham croquettes, fried to order" },
          allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
          dietaryDeclarations: ["halal"],
        },
        quantity: "1",
      },
      { product: { ...bravas, allergens: null }, quantity: "1" },
      { product: { ...dish("olives", "Olives"), allergens: {} }, quantity: "1" },
    ]);
    const { el, host } = await mountWidget<OpenedRowHost>("test-opened-row-host", { store }, theme);
    const basket = el.shadowRoot!.querySelector<TillBasket>("till-basket")!;
    for (const index of [0, 1, 2]) {
      await basket.updateComplete;
      await userEvent.click(
        basket.shadowRoot!.querySelector<HTMLButtonElement>(`[data-draft-row="${index}"]`)!,
      );
      await el.updateComplete;
      await basket.updateComplete;
      const info = el.shadowRoot!.querySelector(
        `[data-draft-open="${index}"] [data-draft-open-info]`,
      );
      expect(info?.textContent).toContain(
        ["Ham croquettes", "Allergens not yet reviewed", "No declared allergens"][index],
      );
      await expectNoA11yViolations(host);
    }
  });

  it("an opened row keeps a closed row's height; its price and arrow keep the closed rows' column, or its price sits near the box's edge without an arrow", async () => {
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [
      { product: croquettes, quantity: "2" },
      { product: bravas, quantity: "2" },
      { product: dish("olives", "Olives"), quantity: "1" },
    ]);
    const { el } = await mountWidget<OpenedRowHost>("test-opened-row-host", { store }, theme);
    const basket = el.shadowRoot!.querySelector<TillBasket>("till-basket")!;
    await basket.updateComplete;
    const measure = async (index: number, open = true) => {
      const row = basket.shadowRoot!.querySelector<HTMLElement>(`[data-draft-row="${index}"]`)!;
      if (open && row.getAttribute("aria-expanded") !== "true") {
        await userEvent.click(row);
        await el.updateComplete;
        await basket.updateComplete;
      }
      const entry = row.closest<HTMLElement>(".entry")!;
      const style = getComputedStyle(entry);
      return {
        entry,
        inner: entry.getBoundingClientRect().right - Number.parseFloat(style.borderRightWidth),
        space: Number.parseFloat(style.getPropertyValue("--wt-space-2")),
        lead: entry.querySelector(".draft-row-lead")!.getBoundingClientRect(),
        price: row.querySelector(".draft-row-price")!.getBoundingClientRect(),
        split: el
          .shadowRoot!.querySelector(`[data-split-draft-line="${index}"]`)
          ?.getBoundingClientRect(),
      };
    };
    const closed = await measure(1, false);
    expect(closed.entry.hasAttribute("data-open")).toBe(false);
    const several = await measure(0);
    expect(several.entry.hasAttribute("data-open")).toBe(true);
    expect(several.lead.height).toBeCloseTo(closed.lead.height, 1);
    expect(several.split!.width).toBeGreaterThanOrEqual(44);
    expect(several.split!.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(several.price.right - closed.price.right)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(several.split!.left - closed.split!.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(several.split!.right - closed.split!.right)).toBeLessThanOrEqual(0.5);
    const chevron = el
      .shadowRoot!.querySelector(`[data-split-draft-line="0"] wt-icon`)!
      .getBoundingClientRect();
    expect(chevron.right).toBeLessThanOrEqual(several.inner + 0.5);
    const one = await measure(2);
    expect(one.entry.hasAttribute("data-open")).toBe(true);
    expect(one.split).toBeUndefined();
    expect(one.space).toBeGreaterThan(0);
    expect(Math.abs(one.price.right - (one.inner - one.space))).toBeLessThanOrEqual(0.5);
  });

  it("an opened row whose period ended keeps an opened row's tick inset and shows the amber stripe inside its box", async () => {
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [
      { product: croquettes, quantity: "1" },
      { product: bravas, quantity: "1" },
      { product: dish("olives", "Olives"), quantity: "1" },
    ]);
    store.setEndedPeriods([
      undefined,
      { menuId: "lunch", periodName: "Lunch" },
      { menuId: "lunch", periodName: "Lunch" },
    ]);
    const { el } = await mountWidget<OpenedRowHost>("test-opened-row-host", { store }, theme);
    const basket = el.shadowRoot!.querySelector<TillBasket>("till-basket")!;
    await basket.updateComplete;
    const entry = (index: number) =>
      basket
        .shadowRoot!.querySelector(`[data-draft-row="${index}"]`)!
        .closest<HTMLElement>(".entry")!;
    const open = async (index: number) => {
      await userEvent.click(
        basket.shadowRoot!.querySelector<HTMLElement>(`[data-draft-row="${index}"]`)!,
      );
      await el.updateComplete;
      await basket.updateComplete;
      const box = entry(index);
      expect(box.hasAttribute("data-open")).toBe(true);
      const style = getComputedStyle(box);
      return {
        inset:
          box.querySelector(".draft-row-lead")!.getBoundingClientRect().left -
          (box.getBoundingClientRect().left + Number.parseFloat(style.borderLeftWidth)),
        shadow: style.boxShadow,
      };
    };
    const closedEnded = getComputedStyle(entry(2));
    expect(entry(2).classList.contains("period-ended-entry")).toBe(true);
    const amber = closedEnded.borderLeftColor;
    const stripe = closedEnded.borderLeftWidth;
    expect(Number.parseFloat(stripe)).toBeGreaterThan(0);
    const plain = await open(0);
    const ended = await open(1);
    expect(Math.abs(ended.inset - plain.inset)).toBeLessThanOrEqual(0.5);
    expect(plain.shadow).not.toContain(amber);
    expect(ended.shadow).toContain(amber);
    expect(ended.shadow).toContain(`${stripe} 0px 0px 0px inset`);
  });

  it("a disabled row has no violations", async () => {
    const { el, host } = await mount(theme, [{ product: croquettes, quantity: "1" }], {
      orderInFlight: true,
    });
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-draft-row]")!.disabled).toBe(
      true,
    );
    await expectNoA11yViolations(host);
  });
});
