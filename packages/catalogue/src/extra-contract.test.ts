import { describe, expect, it } from "vitest";
import {
  parseExtraListInput,
  parseMenuExtraPublications,
  validateExtraSelections,
  type ExtraList,
  type ExtraListItem,
} from "./extra-contract.js";
import { resolveExtraPrice } from "./extras.js";

const breadsId = "11111111-1111-4111-8111-111111111111";
const saucesId = "22222222-2222-4222-8222-222222222222";
const sourdoughItemId = "33333333-3333-4333-8333-333333333333";
const ryeItemId = "44444444-4444-4444-8444-444444444444";
const aioliItemId = "55555555-5555-4555-8555-555555555555";
const sourdoughProductId = "66666666-6666-4666-8666-666666666666";
const ryeProductId = "77777777-7777-4777-8777-777777777777";
const aioliProductId = "88888888-8888-4888-8888-888888888888";
const unknownProductId = "99999999-9999-4999-8999-999999999999";

// An extras list carries no name, VAT, allergen or dietary field of its own: an item names a product
// and the product supplies those. Fixtures therefore differ only in the three names of the LIST.
const sourdough = {
  id: sourdoughItemId,
  productId: sourdoughProductId,
  maxQuantity: 1,
  preselected: true,
  price: null,
};
const rye = {
  id: ryeItemId,
  productId: ryeProductId,
  maxQuantity: 2,
  preselected: false,
  price: "1.50",
};

const breadsBody = {
  name: "Bread",
  customerName: { en: "Choose your bread", es: "Elige tu pan" },
  kitchenName: "BRD",
  minPicks: 1,
  maxPicks: 1,
  active: true,
  items: [sourdough, rye],
};

/** A list as it comes back from storage: every item carries an id. */
function breads(overrides: Partial<ExtraList> = {}): ExtraList {
  return {
    id: breadsId,
    name: "Bread",
    customerName: { en: "Choose your bread", es: "Elige tu pan" },
    kitchenName: "BRD",
    minPicks: 1,
    maxPicks: 1,
    active: true,
    items: [{ ...sourdough }, { ...rye }],
    ...overrides,
  };
}

const sauces: ExtraList = {
  id: saucesId,
  name: "Sauce",
  customerName: { en: "Any sauce?" },
  kitchenName: "SCE",
  minPicks: 0,
  maxPicks: null,
  active: true,
  items: [
    {
      id: aioliItemId,
      productId: aioliProductId,
      maxQuantity: 3,
      preselected: false,
      price: "0.80",
    },
  ],
};

describe("extra list authoring contract", () => {
  it("keeps item order and every field, defaulting the optional ones", () => {
    const parsed = parseExtraListInput({
      name: "Bread",
      customerName: { en: "Choose your bread", es: "Elige tu pan" },
      kitchenName: "BRD",
      minPicks: 1,
      maxPicks: 1,
      items: [
        { id: sourdoughItemId, productId: sourdoughProductId, preselected: true },
        { id: ryeItemId, productId: ryeProductId, maxQuantity: 2, price: "1.5" },
      ],
    });
    expect(parsed).toEqual({
      name: "Bread",
      customerName: { en: "Choose your bread", es: "Elige tu pan" },
      kitchenName: "BRD",
      minPicks: 1,
      maxPicks: 1,
      active: true,
      items: [
        {
          id: sourdoughItemId,
          productId: sourdoughProductId,
          maxQuantity: 1,
          preselected: true,
          price: null,
        },
        {
          id: ryeItemId,
          productId: ryeProductId,
          maxQuantity: 2,
          preselected: false,
          price: "1.50",
        },
      ],
    });
  });

  it("defaults minPicks to zero and maxPicks to uncapped", () => {
    const parsed = parseExtraListInput({
      name: "Sauce",
      items: [{ productId: aioliProductId }],
    });
    expect(parsed.minPicks).toBe(0);
    expect(parsed.maxPicks).toBeNull();
    expect(parsed.customerName).toBeNull();
    expect(parsed.kitchenName).toBeNull();
  });

  it("refuses a list whose staff name is blank", () => {
    expect(() => parseExtraListInput({ ...breadsBody, name: "  " })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "name" } }),
    );
  });

  it("refuses an unknown key on the list and on an item", () => {
    expect(() => parseExtraListInput({ ...breadsBody, vatClass: "general" })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "extraList.vatClass" } }),
    );
    expect(() =>
      parseExtraListInput({ ...breadsBody, items: [{ ...sourdough, addAllergens: [] }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "items.0.addAllergens" },
      }),
    );
  });

  it("refuses minPicks above maxPicks, naming maxPicks", () => {
    expect(() => parseExtraListInput({ ...breadsBody, minPicks: 2, maxPicks: 1 })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "maxPicks" } }),
    );
  });

  it("accepts minPicks equal to maxPicks — the exactly-one-bread shape", () => {
    const parsed = parseExtraListInput({ ...breadsBody, minPicks: 1, maxPicks: 1 });
    expect(parsed.minPicks).toBe(1);
    expect(parsed.maxPicks).toBe(1);
  });

  it("refuses a negative minPicks", () => {
    expect(() => parseExtraListInput({ ...breadsBody, minPicks: -1 })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "minPicks" } }),
    );
  });

  it("refuses a fractional pick bound", () => {
    expect(() => parseExtraListInput({ ...breadsBody, maxPicks: 1.5 })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "maxPicks" } }),
    );
  });

  it("refuses a pick bound above what the column can hold", () => {
    // `min_picks`, `max_picks` and `max_quantity` are PostgreSQL `integer` columns (schema/extras.ts),
    // so a value above 2147483647 that the contract lets through reaches the driver as
    // `22003 value out of range for type integer`, carrying no field for an editor to show.
    expect(() =>
      parseExtraListInput({ ...breadsBody, minPicks: 99999999999, maxPicks: null }),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "minPicks" } }),
    );
    expect(() => parseExtraListInput({ ...breadsBody, maxPicks: 99999999999 })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "maxPicks" } }),
    );
  });

  it("refuses a maxQuantity above what the column can hold, naming the offending item", () => {
    expect(() =>
      parseExtraListInput({
        ...breadsBody,
        items: [sourdough, { ...rye, maxQuantity: 99999999999 }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.1.maxQuantity" } }),
    );
  });

  it("refuses a maxQuantity below one, naming the offending item", () => {
    expect(() =>
      parseExtraListInput({ ...breadsBody, items: [sourdough, { ...rye, maxQuantity: 0 }] }),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.1.maxQuantity" } }),
    );
  });

  it("refuses an item naming no product", () => {
    expect(() =>
      parseExtraListInput({ ...breadsBody, items: [{ ...sourdough, productId: "sourdough" }] }),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.0.productId" } }),
    );
  });

  it("refuses the same product twice in one list", () => {
    expect(() =>
      parseExtraListInput({
        ...breadsBody,
        items: [sourdough, { ...rye, productId: sourdoughProductId }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.1.productId" } }),
    );
  });

  it("refuses a malformed price, and keeps a blank one as inherit-the-product", () => {
    expect(() =>
      parseExtraListInput({ ...breadsBody, items: [{ ...sourdough, price: "1.5.0" }] }),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.0.price" } }),
    );
    expect(parseExtraListInput({ ...breadsBody, items: [sourdough] }).items[0]!.price).toBeNull();
  });

  it("refuses items that are not an array", () => {
    expect(() => parseExtraListInput({ ...breadsBody, items: {} })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items" } }),
    );
  });

  it("refuses an active list with no items, because it cannot be answered", () => {
    expect(() =>
      parseExtraListInput({ ...breadsBody, minPicks: 0, maxPicks: null, items: [] }),
    ).toThrowError(expect.objectContaining({ code: "extras.invalid", params: { field: "items" } }));
  });

  it("refuses a customer name whose key is not a language", () => {
    expect(() => parseExtraListInput({ ...breadsBody, customerName: { zz: "Pan" } })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "customerName" } }),
    );
  });

  it("refuses a non-boolean active flag and a non-boolean preselected", () => {
    expect(() => parseExtraListInput({ ...breadsBody, active: "yes" })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "active" } }),
    );
    expect(() =>
      parseExtraListInput({ ...breadsBody, items: [{ ...sourdough, preselected: "yes" }] }),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.0.preselected" } }),
    );
  });

  it("refuses a duplicate item id", () => {
    expect(() =>
      parseExtraListInput({ ...breadsBody, items: [sourdough, { ...rye, id: sourdoughItemId }] }),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.1.id" } }),
    );
  });

  it("lower-cases an item id and its product id", () => {
    const lettersItem = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const lettersProduct = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";
    const parsed = parseExtraListInput({
      ...breadsBody,
      items: [
        { ...sourdough, id: lettersItem.toUpperCase(), productId: lettersProduct.toUpperCase() },
      ],
    });
    expect(parsed.items[0]!.id).toBe(lettersItem);
    expect(parsed.items[0]!.productId).toBe(lettersProduct);
  });
});

describe("extra selections at order time", () => {
  it("accepts picks and returns them in list and item order", () => {
    expect(
      validateExtraSelections(
        [breads(), sauces],
        [
          { listId: saucesId, picks: [{ productId: aioliProductId, quantity: 2 }] },
          { listId: breadsId, picks: [{ productId: ryeProductId, quantity: 1 }] },
        ],
      ),
    ).toEqual([
      { listId: breadsId, picks: [{ productId: ryeProductId, quantity: 1 }] },
      { listId: saucesId, picks: [{ productId: aioliProductId, quantity: 2 }] },
    ]);
  });

  it("asks nothing of a list that is not active", () => {
    expect(validateExtraSelections([breads({ active: false })], [])).toEqual([]);
  });

  it("accepts an unanswered optional list", () => {
    expect(validateExtraSelections([sauces], [])).toEqual([{ listId: saucesId, picks: [] }]);
  });

  it("refuses fewer picks than minPicks, carrying the list id", () => {
    expect(() => validateExtraSelections([breads()], [])).toThrowError(
      expect.objectContaining({ code: "extras.limit_exceeded", params: { extraListId: breadsId } }),
    );
  });

  it("refuses more picks than maxPicks, counting a quantity of two as two picks", () => {
    expect(() =>
      validateExtraSelections(
        [breads()],
        [{ listId: breadsId, picks: [{ productId: ryeProductId, quantity: 2 }] }],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "extras.limit_exceeded", params: { extraListId: breadsId } }),
    );
  });

  it("refuses a quantity above the item's own maxQuantity", () => {
    const uncapped = breads({ minPicks: 0, maxPicks: null });
    expect(() =>
      validateExtraSelections(
        [uncapped],
        [{ listId: breadsId, picks: [{ productId: ryeProductId, quantity: 3 }] }],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "extras.limit_exceeded", params: { extraListId: breadsId } }),
    );
  });

  it("refuses an order-time quantity above the contract's shared ceiling, as a shape fault", () => {
    // A count the LIST refuses is `extras.limit_exceeded`; a number above the ceiling `whole` holds
    // every integer in this contract to is a bad shape, so it is refused with a field path like any
    // other malformed value. That ceiling is the contract's, not this field's own: `minPicks`,
    // `maxPicks` and `maxQuantity` are `integer` columns (schema/extras.ts) and an order-time
    // `quantity` is not a column at all — the child `working_order_lines` row an extra is designed to
    // become holds its quantity as `numeric(12, 3)` (packages/db/src/schema/orders.ts:164,
    // columns.ts:73).
    expect(() =>
      validateExtraSelections(
        [breads({ minPicks: 0, maxPicks: null })],
        [{ listId: breadsId, picks: [{ productId: ryeProductId, quantity: 99999999999 }] }],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "quantity" } }),
    );
  });

  it("accepts a quantity equal to the item's maxQuantity", () => {
    expect(
      validateExtraSelections(
        [sauces],
        [{ listId: saucesId, picks: [{ productId: aioliProductId, quantity: 3 }] }],
      ),
    ).toEqual([{ listId: saucesId, picks: [{ productId: aioliProductId, quantity: 3 }] }]);
  });

  it("refuses a pick naming a product the list does not offer", () => {
    expect(() =>
      validateExtraSelections(
        [breads()],
        [{ listId: breadsId, picks: [{ productId: unknownProductId, quantity: 1 }] }],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "productId" } }),
    );
  });

  it("refuses the same product picked twice in one answer", () => {
    expect(() =>
      validateExtraSelections(
        [sauces],
        [
          {
            listId: saucesId,
            picks: [
              { productId: aioliProductId, quantity: 1 },
              { productId: aioliProductId, quantity: 1 },
            ],
          },
        ],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "productId" } }),
    );
  });

  it("refuses two answers for the same list, and an answer for a list not offered", () => {
    expect(() =>
      validateExtraSelections(
        [breads()],
        [
          { listId: breadsId, picks: [{ productId: ryeProductId, quantity: 1 }] },
          { listId: breadsId, picks: [{ productId: sourdoughProductId, quantity: 1 }] },
        ],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "listId" } }),
    );
    expect(() =>
      validateExtraSelections(
        [breads()],
        [{ listId: saucesId, picks: [{ productId: aioliProductId, quantity: 1 }] }],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "listId" } }),
    );
  });

  it("refuses an answer for a list that is not active", () => {
    expect(() =>
      validateExtraSelections(
        [breads({ active: false })],
        [{ listId: breadsId, picks: [{ productId: ryeProductId, quantity: 1 }] }],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "listId" } }),
    );
  });

  it("refuses selections that are not an array, and an entry with an unknown key", () => {
    expect(() => validateExtraSelections([breads()], { listId: breadsId })).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "extraSelections" } }),
    );
    expect(() =>
      validateExtraSelections([breads()], [{ listId: breadsId, picks: [], note: "extra crispy" }]),
    ).toThrowError(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "extraSelections.note" },
      }),
    );
  });

  it("refuses a pick whose quantity is not a whole number above zero", () => {
    for (const quantity of [0, -1, 1.5, "2"]) {
      expect(() =>
        validateExtraSelections(
          [sauces],
          [{ listId: saucesId, picks: [{ productId: aioliProductId, quantity }] }],
        ),
      ).toThrowError(
        expect.objectContaining({ code: "extras.invalid", params: { field: "quantity" } }),
      );
    }
  });

  it("refuses picks that are not an array", () => {
    expect(() => validateExtraSelections([sauces], [{ listId: saucesId, picks: {} }])).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field: "picks" } }),
    );
  });
});

describe("resolveExtraPrice", () => {
  const item: ExtraListItem = {
    id: ryeItemId,
    productId: ryeProductId,
    maxQuantity: 1,
    preselected: false,
    price: "1.50",
  };

  it("takes the menu price over the item price over the product's own", () => {
    expect(resolveExtraPrice(item, { unitPrice: "3.00" })).toBe("1.50");
    expect(resolveExtraPrice({ ...item, price: null }, { unitPrice: "3.00" })).toBe("3.00");
    expect(resolveExtraPrice(item, { unitPrice: "3.00" }, "1.00")).toBe("1.00");
    expect(resolveExtraPrice({ ...item, price: null }, { unitPrice: "3.00" }, "1.00")).toBe("1.00");
  });

  it("falls through a menu price that is absent or null", () => {
    expect(resolveExtraPrice(item, { unitPrice: "3.00" }, null)).toBe("1.50");
    expect(resolveExtraPrice(item, { unitPrice: "3.00" }, undefined)).toBe("1.50");
  });

  it("keeps a zero price rather than falling through it", () => {
    expect(resolveExtraPrice({ ...item, price: "0.00" }, { unitPrice: "3.00" })).toBe("0.00");
    expect(resolveExtraPrice(item, { unitPrice: "3.00" }, "0.00")).toBe("0.00");
  });
});

describe("parseMenuExtraPublications", () => {
  const refuses = (value: unknown, field: string) =>
    expect(() => parseMenuExtraPublications(value)).toThrowError(
      expect.objectContaining({ code: "extras.invalid", params: { field } }),
    );

  it("lower-cases both ids, defaults availability, and keeps each item's own position", () => {
    expect(
      parseMenuExtraPublications([
        {
          listId: breadsId.toUpperCase(),
          items: [
            { productId: sourdoughProductId.toUpperCase(), price: "1.5" },
            { productId: ryeProductId, available: false },
          ],
        },
      ]),
    ).toEqual([
      {
        listId: breadsId,
        items: [
          {
            productId: sourdoughProductId,
            price: "1.50",
            available: true,
            field: "lists.0.items.0",
          },
          {
            productId: ryeProductId,
            price: null,
            available: false,
            field: "lists.0.items.1",
          },
        ],
      },
    ]);
  });

  it("refuses a body, a published list or an override that is the wrong shape", () => {
    refuses({ listId: breadsId }, "lists");
    refuses(["not an object"], "lists.0");
    refuses([{ listId: breadsId, items: "none" }], "lists.0.items");
    refuses([{ listId: breadsId, items: ["not an object"] }], "lists.0.items.0");
  });

  it("refuses a duplicate list and a duplicate product, naming the second of the pair", () => {
    refuses(
      [
        { listId: breadsId, items: [] },
        { listId: breadsId, items: [] },
      ],
      "lists.1.listId",
    );
    refuses(
      [
        {
          listId: breadsId,
          items: [{ productId: ryeProductId }, { productId: ryeProductId.toUpperCase() }],
        },
      ],
      "lists.0.items.1.productId",
    );
  });
});
