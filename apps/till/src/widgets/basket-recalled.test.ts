import { draftSnapshot, partyDraftSnapshot } from "./test-helpers.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { Draft, DraftLine, RecalledDraftLine, TillMenuOffer } from "../api/client.js";
import { DraftSync } from "../state/draft-sync.js";
import { fromDraftLine, toDraftLineInput } from "../state/draft-lines.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { TillBasket } from "./basket.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

type LiveModifier = TillMenuOffer["offeredModifiers"][number];

const options: LiveModifier = {
  kind: "options",
  id: "doneness",
  name: "Doneness",
  customerName: { en: "Customer doneness" },
  kitchenName: "Kitchen doneness",
  defaultLabelId: null,
  publishedDefaultLabelId: null,
  labels: ["Rare", "Medium"].map((name) => ({
    id: name.toLowerCase(),
    name,
    customerName: { en: `Customer ${name}` },
    kitchenName: `Kitchen ${name}`,
    available: true,
  })),
};
const extras: LiveModifier = {
  kind: "extras",
  id: "toppings",
  name: "Toppings",
  customerName: { en: "Customer toppings" },
  kitchenName: "Kitchen toppings",
  minPicks: 0,
  maxPicks: null,
  items: [
    {
      productId: "cheese",
      name: "Cheese",
      customerName: { en: "Customer cheese" },
      image: null,
      available: true,
      kitchenName: "Kitchen cheese",
      price: "9.00",
      vatClass: "general",
      portion: "1",
      unit: {
        id: "each",
        name: { en: "Each" },
        abbreviation: { en: "ea" },
        precision: 0,
        hardwareUnit: null,
      },
      maxQuantity: 3,
      preselected: false,
      addAllergens: null,
      suitableFor: [],
    },
  ],
};

function offer(modifiers: LiveModifier[]): TillMenuOffer {
  return {
    id: "offer-burger",
    menuId: "menu",
    productId: "burger",
    grossPrice: null,
    unitPrice: "99.00",
    available: false,
    image: null,
    description: null,
    menuName: "Menu",
    placements: [[]],
    name: "Live burger",
    customerName: null,
    kitchenName: null,
    unit: {
      id: "each",
      name: { en: "Each" },
      abbreviation: { en: "ea" },
      precision: 0,
      hardwareUnit: null,
    },
    vatClass: "general",
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId: null,
    offeredModifiers: modifiers,
    variants: [],
  };
}

function source(): RecalledDraftLine {
  const line: RecalledDraftLine["source"]["line"] = {
    id: "sent-burger",
    name: "Recorded burger",
    productId: "burger",
    parentProductId: null,
    menuItemId: "offer-burger",
    lineNo: 7,
    parentLineNo: null,
    quantity: "2.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "7.50",
    listUnitPriceGross: "10.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    stationId: null,
    movable: true,
    groupId: "group",
    note: null,
    listId: null,
    optionSnapshots: [
      {
        listName: { en: "Doneness" },
        listCustomerName: { en: "Customer doneness" },
        listKitchenName: "Kitchen doneness",
        labelName: { en: "Rare" },
        labelCustomerName: { en: "Customer Rare" },
        labelKitchenName: "Kitchen Rare",
      },
    ],
  };
  return {
    id: "reference",
    sourceLineId: line.id,
    source: {
      line,
      extras: [
        {
          ...line,
          id: "sent-cheese",
          name: "Recorded cheese",
          productId: "cheese",
          menuItemId: null,
          lineNo: 8,
          parentLineNo: 7,
          quantity: "4.000",
          unitPriceGross: "0.75",
          listUnitPriceGross: "1.00",
          listId: "toppings",
          optionSnapshots: undefined,
        },
      ],
      netAmount: "17.25",
    },
    quantity: "2.000",
    note: null,
    courseId: null,
    makeAt: null,
    noMerge: true,
    unavailable: false,
    slot: 0,
    joinGroupId: "group",
    afterGroupId: null,
  };
}

function storeWith(modifiers: LiveModifier[], wire = source()): WorkingOrderStore {
  const store = new WorkingOrderStore();
  store.loadFrom("draft", [fromDraftLine(wire, new Map([["offer-burger", offer(modifiers)]]))]);
  return store;
}

async function openPicker(store: WorkingOrderStore) {
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  const edit = el.shadowRoot!.querySelector<HTMLElement>(".edit-modifiers");
  expect(edit).not.toBeNull();
  await userEvent.click(edit!);
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
  await picker.updateComplete;
  return { el, picker };
}

afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
});

describe("recalled source modifier editor", () => {
  it("offers live choices without replacing the recorded dish, price or unavailable state", () => {
    const store = storeWith([options]);
    expect(store.lines[0]?.product).toMatchObject({
      id: "burger",
      name: "Recorded burger",
      unitPrice: "7.50",
      offeredModifiers: [options],
    });
    expect(store.total).toBe("17.25");
    expect(toDraftLineInput(store.lines[0]!)).not.toHaveProperty("options");
    expect(toDraftLineInput(store.lines[0]!)).not.toHaveProperty("extras");
  });

  it("does not offer choices belonging to a replacement product on the same menu item", () => {
    const live = { ...offer([options]), productId: "different-burger" };
    const line = fromDraftLine(source(), new Map([[live.id, live]]));
    expect(line.product.offeredModifiers).toBeUndefined();
    expect(line.product.name).toBe("Recorded burger");
  });

  it("reopens frozen options and changing one leaves unoffered extras on the bill", async () => {
    const store = storeWith([options]);
    const { el, picker } = await openPicker(store);
    expect(
      picker.shadowRoot!.querySelector<HTMLInputElement>("#label-doneness-rare")!.checked,
    ).toBe(true);
    await userEvent.click(
      picker.shadowRoot!.querySelector<HTMLInputElement>("#label-doneness-medium")!,
    );
    await picker.updateComplete;
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    const wire = toDraftLineInput(store.lines[0]!);
    expect(wire).toMatchObject({ options: [{ listId: "doneness", labelId: "medium" }] });
    expect(wire).not.toHaveProperty("extras");
    expect(el.shadowRoot!.textContent).toContain("Recorded cheese");
    expect(store.total).toBe("17.25");
  });

  it("reopens recorded extra counts and editing them leaves retired options untouched", async () => {
    const store = storeWith([extras]);
    const { el, picker } = await openPicker(store);
    expect(picker.initialSelections?.extras).toEqual([
      {
        listId: "toppings",
        productId: "cheese",
        name: "Recorded cheese",
        price: "0.75",
        quantity: 2,
      },
    ]);
    const add = picker.shadowRoot!.querySelector<HTMLElement>(
      '[data-test="pick-toppings-cheese-inc"]',
    );
    expect(add).not.toBeNull();
    await userEvent.click(add!);
    await picker.updateComplete;
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    const wire = toDraftLineInput(store.lines[0]!);
    expect(wire).toMatchObject({
      extras: [{ listId: "toppings", picks: [{ productId: "cheese", quantity: 3 }] }],
    });
    expect(wire).not.toHaveProperty("options");
    expect(el.shadowRoot!.textContent).toContain("Doneness: Rare");
  });

  it("does not turn unchanged derived answers into replacement intent", async () => {
    const wire = source();
    wire.source.line.optionSnapshots!.push({
      ...wire.source.line.optionSnapshots![0]!,
      listName: { en: "Retired list" },
    });
    const store = storeWith([options], wire);
    const { el, picker } = await openPicker(store);
    picker.dispatchEvent(
      new CustomEvent("wt-modifier-confirm", {
        detail: {
          product: picker.product,
          options: [{ listId: "doneness", labelId: "rare" }],
          extras: [],
        },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(toDraftLineInput(store.lines[0]!)).not.toHaveProperty("options");
    expect(toDraftLineInput(store.lines[0]!)).not.toHaveProperty("extras");
    expect(el.shadowRoot!.textContent).toContain("Retired list: Rare");
  });

  it("keeps the recorded price of a retained extra when its count changes", async () => {
    const store = storeWith([extras]);
    const { el, picker } = await openPicker(store);
    await userEvent.click(
      picker.shadowRoot!.querySelector<HTMLElement>('[data-test="pick-toppings-cheese-inc"]')!,
    );
    await picker.updateComplete;
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    expect(store.lines[0]?.extras).toEqual([
      {
        listId: "toppings",
        productId: "cheese",
        name: "Recorded cheese",
        price: "0.75",
        quantity: 3,
      },
    ]);
  });

  it("shows stored extra prices without a fresh-sale total in the recalled picker", async () => {
    const store = storeWith([extras]);
    const { picker } = await openPicker(store);
    expect(picker.shadowRoot!.querySelector(".option-name")!.textContent).toContain(
      "Recorded cheese",
    );
    expect(picker.shadowRoot!.querySelector(".option-delta")!.textContent).toContain("0.75");
    expect(picker.shadowRoot!.querySelector(".running")).toBeNull();
  });

  it("uses the live price for a genuinely new extra and keeps the existing pick", async () => {
    const live: LiveModifier = {
      ...extras,
      items: [
        ...extras.items,
        { ...extras.items[0]!, productId: "bacon", name: "Bacon", price: "2.50" },
      ],
    };
    const store = storeWith([live]);
    const { el, picker } = await openPicker(store);
    await userEvent.click(
      picker.shadowRoot!.querySelector<HTMLElement>('[data-test="pick-toppings-bacon-inc"]')!,
    );
    await picker.updateComplete;
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    expect(store.lines[0]?.extras).toEqual([
      {
        listId: "toppings",
        productId: "cheese",
        name: "Recorded cheese",
        price: "0.75",
        quantity: 2,
      },
      { listId: "toppings", productId: "bacon", name: "Bacon", price: "2.50", quantity: 1 },
    ]);
    expect(toDraftLineInput(store.lines[0]!)).toMatchObject({
      extras: [
        {
          listId: "toppings",
          picks: [
            { productId: "cheese", quantity: 2 },
            { productId: "bacon", quantity: 1 },
          ],
        },
      ],
    });
  });

  it("does not change a source while a command owns the edit lock", () => {
    const store = storeWith([options]);
    const unlock = store.lockEdits();
    try {
      store.patchRecalledLineModifiers(0, { options: [{ listId: "doneness", labelId: "medium" }] });
      expect(toDraftLineInput(store.lines[0]!)).not.toHaveProperty("options");
      expect(store.lines[0]?.optionSnapshots?.[0]?.labelName).toEqual({ en: "Rare" });
    } finally {
      unlock();
    }
    store.patchRecalledLineModifiers(0, { options: [{ listId: "doneness", labelId: "medium" }] });
    expect(toDraftLineInput(store.lines[0]!)).toMatchObject({
      options: [{ listId: "doneness", labelId: "medium" }],
    });
  });

  it("labels only missing source extras as not offered", async () => {
    const wire = source();
    wire.source.extras.push({
      ...wire.source.extras[0]!,
      id: "retired-extra",
      name: "Retired extra",
      productId: "retired",
      listId: "old-list",
    });
    const store = storeWith([extras], wire);
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(store.lines[0]?.extras).toEqual([
      {
        listId: "toppings",
        productId: "cheese",
        name: "Recorded cheese",
        price: "0.75",
        quantity: 2,
      },
    ]);
    expect(store.lines[0]?.notOfferedExtras).toEqual([
      {
        productId: "retired",
        name: "Retired extra",
        price: "0.75",
        quantity: 2,
      },
    ]);
    const rows = [...el.shadowRoot!.querySelectorAll(".option")];
    expect(
      rows
        .find((row) => row.textContent?.includes("Recorded cheese"))!
        .querySelector(".not-offered"),
    ).toBeNull();
    expect(
      rows.find((row) => row.textContent?.includes("Retired extra"))!.querySelector(".not-offered"),
    ).not.toBeNull();
    expect(toDraftLineInput(store.lines[0]!)).not.toHaveProperty("extras");
  });

  it("refreshes displayed live extras from the saved family after their edit is acknowledged", () => {
    const store = storeWith([extras]);
    const line = store.lines[0]!;
    const changed = source();
    changed.source.extras[0]!.name = "Saved cheese";
    const snapshot = fromDraftLine(changed, new Map([["offer-burger", offer([extras])]]));
    store.refreshRecalledLine(line, snapshot);
    expect(line.extras?.[0]).toMatchObject({ name: "Saved cheese", price: "0.75", quantity: 2 });
    expect(line.notOfferedExtras).toBeUndefined();
  });

  it("keeps choices for the recorded variant without offering a variant change", async () => {
    const live = offer([options]);
    live.variants = [
      { ...live, id: "double", name: "Live double", pricingUnit: "each", menuPrice: null },
    ];
    const wire = source();
    wire.source.line.productId = "double";
    wire.source.line.parentProductId = "burger";
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [fromDraftLine(wire, new Map([[live.id, live]]))]);
    const { picker } = await openPicker(store);
    expect(picker.shadowRoot!.querySelector('[name="product-variant"]')).toBeNull();
    expect(picker.product?.name).toBe("Recorded burger");
    expect(picker.product?.unitPrice).toBe("7.50");
  });

  it("offers no choices for a variant the live dish no longer holds", () => {
    const wire = source();
    wire.source.line.productId = "retired-variant";
    wire.source.line.parentProductId = "burger";
    const line = fromDraftLine(wire, new Map([["offer-burger", offer([options])]]));
    expect(line.product.offeredModifiers).toBeUndefined();
  });

  it("filters unavailable live choices while keeping the frozen answer", async () => {
    const live = offer([options]);
    live.offeredModifiers = [
      {
        ...options,
        labels: options.labels.map((label) => ({ ...label, available: label.id !== "rare" })),
      },
    ];
    const store = new WorkingOrderStore();
    store.loadFrom("draft", [fromDraftLine(source(), new Map([[live.id, live]]))]);
    const { el, picker } = await openPicker(store);
    expect(picker.shadowRoot!.querySelector("#label-doneness-rare")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Doneness: Rare");
  });

  it("uses the source quantity for an extra's count while a quantity increase waits to save", async () => {
    const store = storeWith([extras]);
    store.setLineQuantity(0, "3");
    const { picker } = await openPicker(store);
    expect(picker.initialSelections?.extras?.[0]?.quantity).toBe(2);
  });

  it("keeps earlier pending option intent when only extras change on the next opening", async () => {
    const store = storeWith([options, extras]);
    const { el, picker } = await openPicker(store);
    await userEvent.click(
      picker.shadowRoot!.querySelector<HTMLInputElement>("#label-doneness-medium")!,
    );
    await picker.updateComplete;
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".edit-modifiers")!);
    await el.updateComplete;
    const second = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
    await second.updateComplete;
    expect(
      second.shadowRoot!.querySelector<HTMLInputElement>("#label-doneness-medium")!.checked,
    ).toBe(true);
    await userEvent.click(
      second.shadowRoot!.querySelector<HTMLElement>('[data-test="pick-toppings-cheese-inc"]')!,
    );
    await second.updateComplete;
    await userEvent.click(second.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    expect(toDraftLineInput(store.lines[0]!)).toMatchObject({
      options: [{ listId: "doneness", labelId: "medium" }],
      extras: [{ listId: "toppings", picks: [{ productId: "cheese", quantity: 3 }] }],
    });
  });

  it("records an explicit empty extras replacement without clearing frozen options", async () => {
    const store = storeWith([extras]);
    const { el, picker } = await openPicker(store);
    for (let count = 2; count > 0; count--) {
      await userEvent.click(
        picker.shadowRoot!.querySelector<HTMLElement>('[data-test="pick-toppings-cheese-dec"]')!,
      );
      await picker.updateComplete;
    }
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    expect(toDraftLineInput(store.lines[0]!)).toMatchObject({ extras: [] });
    expect(toDraftLineInput(store.lines[0]!)).not.toHaveProperty("options");
    expect(store.lines[0]?.optionSnapshots?.[0]?.labelName).toEqual({ en: "Rare" });
  });

  it.each(["options", "extras"] as const)(
    "consumes saved %s intent while keeping a later edit of the other kind",
    async (first) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const draft = (line: DraftLine, revision = 1): Draft => ({
        id: "draft",
        partyId: "party",
        billId: "bill",
        ownerId: "ana",
        ownerName: "Ana",
        revision,
        lines: [line],
        takenOverFrom: null,
      });
      let answer!: (saved: Draft) => void;
      const api = {
        listDrafts: vi.fn(async () => Promise.resolve([draft(source())]).then(partyDraftSnapshot)),
        saveDraft: vi.fn(() =>
          Promise.resolve(
            new Promise<Draft>((resolve) => {
              answer = resolve;
            }),
          ).then(draftSnapshot),
        ),
        takeOverDraft: vi.fn(),
      };
      const sync = new DraftSync({
        api,
        partyId: "party",
        billId: "bill",
        personId: "ana",
        onRefused: vi.fn(),
        rebuild: (lines) => lines.map((line) => fromDraftLine(line, new Map())),
        requestLimitMs: 5000,
      });
      try {
        await sync.load();
        const optionEdit = { options: [{ listId: "doneness", labelId: "medium" }] };
        const extraEdit = {
          extras: [
            { listId: "toppings", productId: "cheese", name: "Cheese", price: "0.75", quantity: 3 },
          ],
        };
        sync.store.patchRecalledLineModifiers(0, first === "options" ? optionEdit : extraEdit);
        const saving = sync.flush();
        await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
        sync.store.patchRecalledLineModifiers(0, first === "options" ? extraEdit : optionEdit);
        const saved = source();
        saved.source.line.optionSnapshots![0]!.labelName = { en: "Saved medium" };
        saved.source.extras[0]!.name = "Saved cheese";
        answer(draft(saved, 2));
        expect(await saving).toBe("saved");
        const wire = toDraftLineInput(sync.store.lines[0]!);
        expect(wire).not.toHaveProperty(first);
        if (first === "options") {
          expect(wire).toMatchObject({
            extras: [{ listId: "toppings", picks: [{ productId: "cheese", quantity: 3 }] }],
          });
          expect(sync.store.lines[0]?.optionSnapshots?.[0]?.labelName).toEqual({
            en: "Saved medium",
          });
        } else {
          expect(wire).toMatchObject({ options: [{ listId: "doneness", labelId: "medium" }] });
          expect(sync.store.lines[0]?.notOfferedExtras?.[0]?.name).toBe("Saved cheese");
        }
      } finally {
        sync.drop();
      }
    },
  );
});
