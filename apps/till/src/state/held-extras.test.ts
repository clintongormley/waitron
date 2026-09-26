import { describe, expect, it } from "vitest";
import { deriveExtraSelections } from "./held-extras.js";
import type { OfferedModifier } from "../api/client.js";

/** One offered product, with its three names DIFFERENT so a reader of the wrong one fails. */
function item(productId: string, staff: string, price: string) {
  return {
    productId,
    name: staff,
    customerName: { es: `${staff} para el cliente` },
    kitchenName: `${staff} cocina`,
    price,
    vatClass: "general" as const,
    maxQuantity: 3,
    preselected: false,
    addAllergens: null,
    suitableFor: [],
  };
}

const toppings: OfferedModifier = {
  kind: "extras",
  id: "list-toppings",
  name: "Toppings",
  customerName: { es: "Toppings para el cliente" },
  kitchenName: "Toppings cocina",
  minPicks: 0,
  maxPicks: null,
  items: [item("p-bacon", "Bacon", "1.50"), item("p-cheese", "Queso", "1.00")],
};

const sauces: OfferedModifier = {
  kind: "extras",
  id: "list-sauces",
  name: "Salsas",
  customerName: { es: "Salsas para el cliente" },
  kitchenName: "Salsas cocina",
  minPicks: 1,
  maxPicks: 1,
  items: [item("p-ali", "Alioli", "0.40")],
};

const cooked: OfferedModifier = {
  kind: "options",
  id: "list-cooked",
  name: "Punto",
  customerName: { es: "Punto para el cliente" },
  kitchenName: "Punto cocina",
  defaultLabelId: null,
  labels: [
    {
      id: "label-medium",
      name: "Al punto",
      customerName: { es: "Al punto para el cliente" },
      kitchenName: "AP",
      available: true,
    },
  ],
};

/** One child line as a held order hands it back: values, and the list the pick was taken from. */
function held(
  listId: string | null,
  productId: string | null,
  name: string,
  price: string,
  quantity: number,
) {
  return {
    productId,
    name,
    descriptions: { es: `${name} cliente` },
    kitchenName: null,
    price,
    quantity,
    listId,
  };
}

describe("deriveExtraSelections", () => {
  it("names the list the pick was taken from", () => {
    const result = deriveExtraSelections(
      [toppings, cooked, sauces],
      [held("list-sauces", "p-ali", "Alioli", "0.40", 1)],
    );
    expect(result).toEqual({
      extras: [
        { listId: "list-sauces", productId: "p-ali", name: "Alioli", price: "0.40", quantity: 1 },
      ],
      notOffered: [],
    });
  });

  it("keeps the price and the count the ORDER froze, not the price the offer shows today", () => {
    const { extras } = deriveExtraSelections(
      [toppings],
      [held("list-toppings", "p-bacon", "Bacon", "1.10", 2)],
    );
    expect(extras).toEqual([
      { listId: "list-toppings", productId: "p-bacon", name: "Bacon", price: "1.10", quantity: 2 },
    ]);
  });

  it("keeps the list the pick came from when two offered lists carry the same product", () => {
    // Owner decision (plan D10): a held pick carries its list, so the second list is not guessed
    // away; before, the first offered list won.
    const alsoBacon: OfferedModifier = {
      ...sauces,
      items: [item("p-bacon", "Bacon", "2.00")],
    };
    const { extras } = deriveExtraSelections(
      [toppings, alsoBacon],
      [held("list-sauces", "p-bacon", "Bacon", "2.00", 1)],
    );
    expect(extras[0]!.listId).toBe("list-sauces");
  });

  it("sets aside a pick whose own list no longer offers it, even where another list does", () => {
    const result = deriveExtraSelections(
      [toppings, sauces],
      [held("list-sauces", "p-bacon", "Bacon", "1.50", 2)],
    );
    expect(result.extras).toEqual([]);
    expect(result.notOffered).toEqual([
      { productId: "p-bacon", name: "Bacon", price: "1.50", quantity: 2 },
    ]);
  });

  it("sets aside a pick whose list the dish no longer offers", () => {
    const result = deriveExtraSelections(
      [sauces],
      [held("list-toppings", "p-bacon", "Bacon", "1.50", 2)],
    );
    expect(result.extras).toEqual([]);
    expect(result.notOffered).toHaveLength(1);
  });

  it("sets aside a child line that names no product, or no list", () => {
    const result = deriveExtraSelections(
      [toppings],
      [held("list-toppings", null, "Bacon", "1.50", 1), held(null, "p-bacon", "Bacon", "1.50", 1)],
    );
    expect(result.extras).toEqual([]);
    expect(result.notOffered).toEqual([
      { productId: null, name: "Bacon", price: "1.50", quantity: 1 },
      { productId: "p-bacon", name: "Bacon", price: "1.50", quantity: 1 },
    ]);
  });

  it("matches a picked product and its list whatever case their ids arrive in", () => {
    const { extras } = deriveExtraSelections(
      [toppings],
      [held("LIST-TOPPINGS", "P-BACON", "Bacon", "1.50", 1)],
    );
    expect(extras[0]).toMatchObject({ listId: "list-toppings", productId: "p-bacon" });
  });

  it("answers nothing for a dish that offers nothing, and for a line that picked nothing", () => {
    expect(
      deriveExtraSelections([], [held("list-toppings", "p-bacon", "Bacon", "1.50", 1)]).notOffered,
    ).toHaveLength(1);
    expect(deriveExtraSelections([toppings], undefined)).toEqual({ extras: [], notOffered: [] });
  });
});
