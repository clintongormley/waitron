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

/** One child line as a held order hands it back: values, and no list id anywhere. */
function held(productId: string | null, name: string, price: string, quantity: number) {
  return {
    productId,
    name,
    descriptions: { es: `${name} cliente` },
    kitchenName: null,
    price,
    quantity,
  };
}

describe("deriveExtraSelections", () => {
  it("names the offered list that carries the picked product", () => {
    const result = deriveExtraSelections(
      [toppings, cooked, sauces],
      [held("p-ali", "Alioli", "0.40", 1)],
    );
    expect(result).toEqual({
      extras: [
        { listId: "list-sauces", productId: "p-ali", name: "Alioli", price: "0.40", quantity: 1 },
      ],
      notOffered: [],
    });
  });

  it("keeps the price and the count the ORDER froze, not the price the offer shows today", () => {
    const { extras } = deriveExtraSelections([toppings], [held("p-bacon", "Bacon", "1.10", 2)]);
    expect(extras).toEqual([
      { listId: "list-toppings", productId: "p-bacon", name: "Bacon", price: "1.10", quantity: 2 },
    ]);
  });

  it("takes the first offered list when two carry the same product", () => {
    // The server refuses this pairing whichever list the till names, so the till picks
    // deterministically.
    const alsoBacon: OfferedModifier = {
      ...sauces,
      id: "list-sauces",
      items: [item("p-bacon", "Bacon", "2.00")],
    };
    const { extras } = deriveExtraSelections(
      [toppings, alsoBacon],
      [held("p-bacon", "Bacon", "1.50", 1)],
    );
    expect(extras[0]!.listId).toBe("list-toppings");
  });

  it("sets aside a pick no offered list carries any more, rather than sending a refusable one", () => {
    const result = deriveExtraSelections([sauces], [held("p-bacon", "Bacon", "1.50", 2)]);
    expect(result.extras).toEqual([]);
    expect(result.notOffered).toEqual([
      { productId: "p-bacon", name: "Bacon", price: "1.50", quantity: 2 },
    ]);
  });

  it("sets aside a child line that names no product at all", () => {
    const result = deriveExtraSelections([toppings], [held(null, "Bacon", "1.50", 1)]);
    expect(result.extras).toEqual([]);
    expect(result.notOffered).toEqual([
      { productId: null, name: "Bacon", price: "1.50", quantity: 1 },
    ]);
  });

  it("matches a picked product whatever case its id arrives in", () => {
    const { extras } = deriveExtraSelections([toppings], [held("P-BACON", "Bacon", "1.50", 1)]);
    expect(extras[0]).toMatchObject({ listId: "list-toppings", productId: "p-bacon" });
  });

  it("answers nothing for a dish that offers nothing, and for a line that picked nothing", () => {
    expect(
      deriveExtraSelections([], [held("p-bacon", "Bacon", "1.50", 1)]).notOffered,
    ).toHaveLength(1);
    expect(deriveExtraSelections([toppings], undefined)).toEqual({ extras: [], notOffered: [] });
  });
});
