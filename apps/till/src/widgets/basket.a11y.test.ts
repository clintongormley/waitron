import { afterEach, describe, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./basket.js";
import type { TillBasket } from "./basket.js";
import type { TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const jamon: TillProduct = {
  id: "jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-basket a11y (%s theme)", (theme) => {
  it("an empty basket has no violations", async () => {
    const store = new WorkingOrderStore();
    const { host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    await expectNoA11yViolations(host);
  });

  it("a populated basket (with remove controls) has no violations", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    store.addProduct(jamon, "0.320");
    const { host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    await expectNoA11yViolations(host);
  });

  it("a retrieved basket marking a line and a pick as not offered has no violations", async () => {
    const store = new WorkingOrderStore();
    store.loadFrom("held-1", [
      {
        product: cafe,
        quantity: "2",
        notOffered: true,
        notOfferedExtras: [{ productId: "p-milk", name: "Leche", price: "0.75", quantity: 2 }],
      },
    ]);
    const { host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    await expectNoA11yViolations(host);
  });

  it("a line with the note editor OPEN has no violations (order-line customisation)", async () => {
    const steak: TillProduct = {
      ...cafe,
      id: "steak",
      name: "Filete",
      customerName: { es: "Filete para el cliente" },
      unitPrice: "18.00",
    };
    const store = new WorkingOrderStore();
    store.addProduct(steak, "1", { note: "no butter" });
    const { el, host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    // Open the inline editor so the note textarea and its sub-row are in the tree when scanned.
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="line-note-button-0"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("a line with picks, an answer and the Modifiers control has no violations", async () => {
    const bacon = {
      productId: "p-bacon",
      name: "Bacon",
      customerName: { es: "Bacon carta" },
      kitchenName: "Bacon KDS",
      price: "1.50",
      vatClass: "general" as const,
      maxQuantity: 3,
      preselected: false,
      addAllergens: { milk: { presence: "contains" as const } },
      suitableFor: ["halal" as const],
    };
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      customerName: { es: "Hamburguesa carta" },
      unitPrice: "10.00",
      allergens: { gluten: { presence: "contains" } },
      offeredModifiers: [
        {
          kind: "extras",
          id: "list-extras",
          name: "Extras",
          customerName: { es: "Extras carta" },
          kitchenName: "Extras KDS",
          minPicks: 0,
          maxPicks: null,
          items: [bacon],
        },
      ],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", {
      extras: [
        { listId: "list-extras", productId: "p-bacon", name: "Bacon", price: "1.50", quantity: 2 },
      ],
      options: [{ listId: "list-cut", labelId: "label-fino" }],
      optionSnapshots: [
        {
          listName: { es: "Cortar" },
          listCustomerName: { es: "Cortar carta" },
          listKitchenName: "Cortar KDS",
          labelName: { es: "Fino" },
          labelCustomerName: { es: "Fino carta" },
          labelKitchenName: "Fino KDS",
        },
      ],
    });
    const { host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    await expectNoA11yViolations(host);
  });

  it("a basket with diet & contains badges (dietary-classification, Task 7) has no violations", async () => {
    const store = new WorkingOrderStore();
    const salad: TillProduct = {
      ...cafe,
      id: "salad",
      name: "Ensalada",
      customerName: { es: "Ensalada para el cliente" },
      dietDerivation: { origins: ["plant"], pending: false },
    };
    const meat: TillProduct = {
      ...cafe,
      id: "meat",
      name: "Chuleta",
      customerName: { es: "Chuleta para el cliente" },
      dietDerivation: { origins: ["meat"], pending: false },
    };
    const mystery: TillProduct = {
      ...cafe,
      id: "mystery",
      name: "Plato del día",
      customerName: { es: "Plato del día para el cliente" },
      dietDerivation: { origins: [], pending: true },
    };
    store.addProduct(salad, "1");
    store.addProduct(meat, "1");
    store.addProduct(mystery, "1");
    const { host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    await expectNoA11yViolations(host);
  });
});
