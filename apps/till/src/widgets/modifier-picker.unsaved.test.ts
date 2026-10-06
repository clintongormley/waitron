import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";
import type { LineSelection } from "../state/working-order.js";
import type { ModifierConfirmDetail, TillModifierPicker } from "./modifier-picker.js";
import "./modifier-picker.js";
import "./menu-browser.js";
import "./basket.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillZoneMenu } from "../api/client.js";

const product: TillProduct = {
  id: "dish",
  menuItemId: "offer-dish",
  name: "Burger",
  customerName: { es: "Hamburguesa" },
  unitPrice: "8.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
  variants: [
    {
      id: "small",
      name: "Small",
      customerName: { es: "Pequeña" },
      kitchenName: "Small kitchen",
      unitPrice: "8.00",
      unitPriceDifference: null,
      available: true,
      vatClass: "general",
      category: null,
      allergens: null,
    },
    {
      id: "large",
      name: "Large",
      customerName: { es: "Grande" },
      kitchenName: "Large kitchen",
      unitPrice: "10.00",
      unitPriceDifference: "2.00",
      available: true,
      vatClass: "general",
      category: null,
      allergens: null,
    },
  ],
  offeredModifiers: [
    {
      kind: "extras",
      id: "extras",
      name: "Extras",
      customerName: { es: "Complementos" },
      kitchenName: "Kitchen extras",
      minPicks: 0,
      maxPicks: null,
      items: [
        {
          portion: "1",
          unit: {
            id: "each",
            name: { en: "Each", es: "Unidad" },
            abbreviation: { en: "ea", es: "ud" },
            hardwareUnit: null,
            precision: 0,
          },
          productId: "cheese",
          name: "Cheese",
          customerName: { es: "Queso" },
          kitchenName: "Kitchen cheese",
          price: "1.00",
          vatClass: "general",
          maxQuantity: 3,
          preselected: true,
          addAllergens: null,
          suitableFor: [],
        },
        {
          portion: "1",
          unit: {
            id: "each",
            name: { en: "Each", es: "Unidad" },
            abbreviation: { en: "ea", es: "ud" },
            hardwareUnit: null,
            precision: 0,
          },
          productId: "bacon",
          name: "Bacon",
          customerName: { es: "Bacon carta" },
          kitchenName: "Kitchen bacon",
          price: "1.50",
          vatClass: "general",
          maxQuantity: 1,
          preselected: false,
          addAllergens: null,
          suitableFor: [],
        },
      ],
    },
    {
      kind: "options",
      id: "cooked",
      name: "Cooking",
      customerName: { es: "Cocción" },
      kitchenName: "Kitchen cooking",
      defaultLabelId: "medium",
      labels: [
        {
          id: "rare",
          name: "Rare",
          customerName: { es: "Poco hecha" },
          kitchenName: "Kitchen rare",
          available: true,
        },
        {
          id: "medium",
          name: "Medium",
          customerName: { es: "Al punto" },
          kitchenName: "Kitchen medium",
          available: true,
        },
      ],
    },
  ],
};
class ModifierLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  product = product;
  initialSelections?: LineSelection;
  withNote = false;
  closes = 0;
  submitted: ModifierConfirmDetail[] = [];
  override render() {
    return html`<till-modifier-picker
        .product=${this.product}
        .initialSelections=${this.initialSelections}
        .withNote=${this.withNote}
        @wt-modifier-cancel=${() => this.closes++}
        @wt-modifier-confirm=${(event: CustomEvent<ModifierConfirmDetail>) => this.submitted.push(event.detail)}
      ></till-modifier-picker
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("modifier-leave-test-app", ModifierLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(props: Partial<ModifierLeaveApp> = {}) {
  const { el: app, host } = await mountWidget<ModifierLeaveApp>("modifier-leave-test-app", props);
  const form = app.shadowRoot!.querySelector("till-modifier-picker")!;
  await form.updateComplete;
  await modal(form).updateComplete;
  return { app, form, host };
}
function modal(form: TillModifierPicker) {
  return form.shadowRoot!.querySelector("wt-modal")!;
}
function cancel(form: TillModifierPicker) {
  form.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
}
function submit(form: TillModifierPicker) {
  form.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
}
async function input(form: TillModifierPicker, selector: string) {
  const control = form.shadowRoot!.querySelector<HTMLInputElement>(selector)!;
  await userEvent.click(page.elementLocator(control));
  await form.updateComplete;
  return control;
}
async function step(form: TillModifierPicker, direction: "inc" | "dec") {
  form
    .shadowRoot!.querySelector<HTMLElement>(`[data-test="pick-extras-cheese-${direction}"]`)!
    .click();
  await form.updateComplete;
}
async function note(form: TillModifierPicker, value: string) {
  const field = form.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("textarea")!), value);
  await form.updateComplete;
}
async function question(app: ModifierLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
const edits = {
  variant: async (form: TillModifierPicker) => {
    await input(form, 'input[value="large"]');
  },
  pick: async (form: TillModifierPicker) => {
    await input(form, "#pick-extras-bacon");
  },
  quantity: async (form: TillModifierPicker) => {
    await step(form, "inc");
  },
  answer: async (form: TillModifierPicker) => {
    await input(form, "#label-cooked-rare");
  },
  note: async (form: TillModifierPicker) => {
    await note(form, "No salt");
  },
};
for (const [name, edit] of Object.entries(edits)) {
  for (const action of ["Cancel", "Escape"]) {
    it(`modifier ${name} ${action} preserves edits on Keep and restores only this picker on Discard`, async () => {
      const { app, form } = await mount();
      await edit(form);
      if (action === "Cancel") cancel(form);
      else await userEvent.keyboard("{Escape}");
      const q = await question(app);
      expect(q.open).toBe(true);
      expect(modal(form).shadowRoot!.querySelector("dialog")!.open).toBe(true);
      expect(app.closes).toBe(0);
      expect(app.submitted).toEqual([]);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await expect.poll(() => q.open).toBe(false);
      expect(unload()).toBe(true);
      if (name === "variant")
        expect(
          form.shadowRoot!.querySelector<HTMLInputElement>('input[value="large"]')!.checked,
        ).toBe(true);
      if (name === "pick")
        expect(
          form.shadowRoot!.querySelector<HTMLInputElement>("#pick-extras-bacon")!.checked,
        ).toBe(true);
      if (name === "quantity")
        expect(
          form.shadowRoot!.querySelector('[data-test="pick-extras-cheese-count"]')!.textContent,
        ).toBe("2");
      if (name === "answer")
        expect(
          form.shadowRoot!.querySelector<HTMLInputElement>("#label-cooked-rare")!.checked,
        ).toBe(true);
      if (name === "note")
        expect(form.shadowRoot!.querySelector("wt-textarea")!.value).toBe("No salt");
      cancel(form);
      await question(app);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => app.closes).toBe(1);
      await form.updateComplete;
      expect(modal(form).open).toBe(false);
      expect(
        form.shadowRoot!.querySelector<HTMLInputElement>('input[value="small"]')!.checked,
      ).toBe(true);
      expect(form.shadowRoot!.querySelector<HTMLInputElement>("#pick-extras-bacon")!.checked).toBe(
        false,
      );
      expect(
        form.shadowRoot!.querySelector('[data-test="pick-extras-cheese-count"]')!.textContent,
      ).toBe("1");
      expect(
        form.shadowRoot!.querySelector<HTMLInputElement>("#label-cooked-medium")!.checked,
      ).toBe(true);
      expect(form.shadowRoot!.querySelector("wt-textarea")!.value).toBe("");
      expect(app.submitted).toEqual([]);
      expect(unload()).toBe(false);
      cancel(form);
      expect(app.closes).toBe(1);
    });
  }
}
it("seeded defaults and reverted normalized selections cancel directly", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  await edits.variant(form);
  await input(form, 'input[value="small"]');
  await edits.pick(form);
  await input(form, "#pick-extras-bacon");
  await step(form, "inc");
  await step(form, "dec");
  await edits.answer(form);
  await input(form, "#label-cooked-medium");
  await note(form, "  ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("Confirm commits normalized local selections without asking or accepting an old discard", async () => {
  const { app, form } = await mount();
  await edits.pick(form);
  await edits.answer(form);
  await note(form, "  No salt  ");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  submit(form);
  await expect.poll(() => q.open).toBe(false);
  expect(app.submitted).toHaveLength(1);
  expect(app.submitted[0]!.product.variantId).toBe("small");
  expect(app.submitted[0]!.extras).toEqual([
    { listId: "extras", productId: "cheese", name: "Cheese", price: "1.00", quantity: 1 },
    { listId: "extras", productId: "bacon", name: "Bacon", price: "1.50", quantity: 1 },
  ]);
  expect(app.submitted[0]!.options).toEqual([{ listId: "cooked", labelId: "rare" }]);
  expect(app.submitted[0]!.note).toBe("No salt");
  expect(unload()).toBe(false);
  oldDiscard.click();
  await app.updateComplete;
  expect(app.closes).toBe(0);
  expect(form.shadowRoot!.querySelector("wt-textarea")!.value).toBe("  No salt  ");
  await note(form, "New note");
  expect(unload()).toBe(true);
  await note(form, "No salt");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("an incomplete reopened choice stays unsaved and cannot confirm", async () => {
  const { app, form } = await mount({
    product: { ...product, variants: [] },
    initialSelections: {},
    withNote: true,
  });
  expect(unload()).toBe(false);
  await note(form, "Retain this incomplete line");
  submit(form);
  expect(app.submitted).toEqual([]);
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.closes).toBe(0);
});
it("disconnect invalidates the warning while reconnect retains the original selection baseline", async () => {
  const { app, form } = await mount();
  await edits.pick(form);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  expect(unload()).toBe(true);
  oldDiscard.click();
  await app.updateComplete;
  expect(app.closes).toBe(0);
  expect(form.shadowRoot!.querySelector<HTMLInputElement>("#pick-extras-bacon")!.checked).toBe(
    true,
  );
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("departed controls cannot edit, submit or cancel a replacement picker", async () => {
  const { app, form } = await mount();
  const events: string[] = [];
  form.addEventListener("wt-modifier-confirm", () => events.push("submit"));
  form.addEventListener("wt-modifier-cancel", () => events.push("cancel"));
  const answer = form.shadowRoot!.querySelector<HTMLInputElement>("#label-cooked-rare")!;
  const pick = form.shadowRoot!.querySelector<HTMLInputElement>("#pick-extras-bacon")!;
  const variant = form.shadowRoot!.querySelector<HTMLInputElement>('input[value="large"]')!;
  form.remove();
  for (const field of [answer, pick, variant]) {
    field.checked = true;
    field.dispatchEvent(new Event("change"));
  }
  await step(form, "inc");
  const noteField = form.shadowRoot!.querySelector("wt-textarea")!;
  noteField.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Departed" } }));
  submit(form);
  cancel(form);
  await form.updateComplete;
  expect(events).toEqual([]);
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  expect(unload()).toBe(false);
  submit(form);
  expect(app.submitted[0]!.product.variantId).toBe("small");
  expect(app.submitted[0]!.extras).toEqual([
    { listId: "extras", productId: "cheese", name: "Cheese", price: "1.00", quantity: 1 },
  ]);
  expect(app.submitted[0]!.options).toEqual([{ listId: "cooked", labelId: "medium" }]);
  expect(app.submitted[0]!.note).toBeUndefined();
});
it("background offer reorder and label changes retain an edited note and its pending decision", async () => {
  const { app, form } = await mount();
  await note(form, "Keep note");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  app.product = {
    ...product,
    variants: [...product.variants!].reverse(),
    offeredModifiers: [...product.offeredModifiers!].reverse(),
  };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(q.open).toBe(true);
  expect(form.shadowRoot!.querySelector("wt-textarea")!.value).toBe("Keep note");
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  await note(form, "");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect(app.submitted).toEqual([]);
});
it("a reopened selection compares counts by list identity and ignores insertion and offered order", async () => {
  const original = product.offeredModifiers![0]!;
  if (original.kind !== "extras") throw new Error("extras fixture");
  const other = {
    ...original,
    id: "other",
    items: original.items.filter((item) => item.productId === "cheese"),
  };
  const { app, form } = await mount({
    product: { ...product, variants: [], offeredModifiers: [other, original] },
    initialSelections: {
      extras: [
        {
          listId: "extras",
          productId: "cheese",
          name: "Recorded cheese",
          price: "5.00",
          quantity: 1,
        },
        { listId: "other", productId: "cheese", name: "Other cheese", price: "7.00", quantity: 2 },
      ],
    },
  });
  expect(unload()).toBe(false);
  await step(form, "dec");
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="pick-other-cheese-inc"]')!.click();
  await form.updateComplete;
  expect(unload()).toBe(true);
  await step(form, "inc");
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="pick-other-cheese-dec"]')!.click();
  await form.updateComplete;
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
it("a local child Confirm leaves an independent parent draft protected", async () => {
  const { app, form } = await mount();
  let parentValue = "initial";
  const parent = app.leave.coordinator.register({
    id: app,
    current: () => parentValue,
    snapshot: (value) => value,
    equal: (a, b) => a === b,
    restore: (value) => {
      parentValue = value;
    },
  });
  parentValue = "parent edit";
  parent.changed();
  await note(form, "child edit");
  submit(form);
  expect(app.submitted[0]!.note).toBe("child edit");
  expect(unload()).toBe(true);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(parentValue).toBe("parent edit");
  expect(unload()).toBe(true);
  parent.dispose();
  expect(unload()).toBe(false);
});
it("security reset invalidates a pending picker answer without a local submission", async () => {
  const { app, form } = await mount();
  await note(form, "Draft");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  app.leave.forceReset();
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  oldDiscard.click();
  expect(unload()).toBe(false);
  expect(app.closes).toBe(0);
  expect(app.submitted).toEqual([]);
});

class ModifierStoreApp extends ModifierLeaveApp {
  readonly store = new WorkingOrderStore();
  readonly menu: TillZoneMenu = {
    id: "menu",
    name: "Menu",
    isDefault: true,
    versionId: "v1",
    structure: { members: [{ kind: "product", menuItemId: "offer-dish", productId: "dish" }] },
    homeLayouts: [{ id: "home", name: "Home", tiles: [] }],
    defaultHomeLayoutId: "home",
    homeLayoutId: "home",
    layoutFallback: null,
  };
  override render() {
    return html`<till-menu-browser
        .products=${[this.product]}
        .menu=${this.menu}
        .store=${this.store}
      ></till-menu-browser>
      <till-basket .store=${this.store}></till-basket>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("modifier-store-test-app", ModifierStoreApp);
it("the menu's real picker leaves the basket untouched on Keep and Discard, while Add accepts once", async () => {
  const { el: app } = await mountWidget<ModifierStoreApp>("modifier-store-test-app", {});
  const browser = app.shadowRoot!.querySelector("till-menu-browser")!;
  await browser.updateComplete;
  const tile = [...browser.shadowRoot!.querySelectorAll("wt-button")].find((button) =>
    button.textContent?.includes("Burger"),
  )!;
  tile.click();
  await browser.updateComplete;
  let form = browser.shadowRoot!.querySelector("till-modifier-picker")!;
  await form.updateComplete;
  await modal(form).updateComplete;
  await note(form, "No salt");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(app.store.lines).toEqual([]);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(browser.shadowRoot!.querySelector("till-modifier-picker")).toBe(form);
  cancel(form);
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => browser.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
  expect(app.store.lines).toEqual([]);
  tile.click();
  await browser.updateComplete;
  form = browser.shadowRoot!.querySelector("till-modifier-picker")!;
  await form.updateComplete;
  await note(form, "  New note  ");
  submit(form);
  await browser.updateComplete;
  expect(browser.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
  expect(app.store.lines).toHaveLength(1);
  expect(app.store.lines[0]!.note).toBe("New note");
  expect(app.store.lines[0]!.product.variantId).toBe("small");
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("the basket's reopened picker keeps stored answers on Discard and commits only explicitly saved modifiers", async () => {
  const { el: app } = await mountWidget<ModifierStoreApp>("modifier-store-test-app", {
    product: { ...product, variants: [] },
  });
  app.store.addProduct(app.product, "2", {
    note: "Existing note",
    options: [{ listId: "cooked", labelId: "medium" }],
    extras: [{ listId: "extras", productId: "cheese", name: "Cheese", price: "1.00", quantity: 1 }],
  });
  const basket = app.shadowRoot!.querySelector("till-basket")!;
  await basket.updateComplete;
  basket.shadowRoot!.querySelector<HTMLElement>(".edit-modifiers")!.click();
  await basket.updateComplete;
  let form = basket.shadowRoot!.querySelector("till-modifier-picker")!;
  await form.updateComplete;
  await modal(form).updateComplete;
  expect(unload()).toBe(false);
  await edits.answer(form);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => basket.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
  expect(app.store.lines[0]!.options).toEqual([{ listId: "cooked", labelId: "medium" }]);
  expect(app.store.lines[0]!.note).toBe("Existing note");
  basket.shadowRoot!.querySelector<HTMLElement>(".edit-modifiers")!.click();
  await basket.updateComplete;
  form = basket.shadowRoot!.querySelector("till-modifier-picker")!;
  await form.updateComplete;
  await edits.answer(form);
  submit(form);
  await basket.updateComplete;
  expect(basket.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
  expect(app.store.lines[0]!.options).toEqual([{ listId: "cooked", labelId: "rare" }]);
  expect(app.store.lines[0]!.note).toBe("Existing note");
  expect(app.store.lines[0]!.quantity).toBe("2");
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
