import { describe, expect, it } from "vitest";
import { asServedDiet } from "./as-served.js";
import type { OrderLine } from "./working-order.js";
import type { DietDerivation, DietOverride, TillOptionItem, TillProduct } from "../api/client.js";

/** A minimal option item carrying only the fields `asServedDiet` reads (id + the origin overlays). */
function item(
  id: string,
  overlay: { addOrigins?: string[] | null; removeOrigins?: string[] | null },
): TillOptionItem {
  return {
    id,
    name: { en: id },
    priceDelta: "0.00",
    vatClass: null,
    maxQuantity: 1,
    addAllergens: null,
    removeAllergens: null,
    addOrigins: overlay.addOrigins ?? null,
    removeOrigins: overlay.removeOrigins ?? null,
  };
}

/** A product with one option group of `items`, a diet derivation and an optional override. */
function product(
  derivation: DietDerivation | null,
  items: TillOptionItem[],
  override?: DietOverride | null,
): TillProduct {
  return {
    id: "dish",
    descriptions: { en: "dish" },
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
    category: null,
    allergens: null,
    dietDerivation: derivation,
    ...(override === undefined ? {} : { dietOverride: override }),
    optionGroups: [
      { id: "g", name: { en: "g" }, minSelect: 0, maxSelect: 9, required: false, items },
    ],
  };
}

/** Rung-up line: the product plus the selected option ids (each resolved back to its overlay by id). */
function line(prod: TillProduct, ...selectedItemIds: string[]): OrderLine {
  return {
    product: prod,
    quantity: "1",
    ...(selectedItemIds.length === 0
      ? {}
      : {
          options: selectedItemIds.map((id) => ({
            optionGroupItemId: id,
            name: { en: id },
            priceDelta: "0.00",
          })),
        }),
  };
}

describe("asServedDiet", () => {
  it("a 'no cheese' option flips a {plant,dairy} line to vegan as-served", () => {
    // Base: plant + dairy, reviewed (not pending) ⇒ vegetarian but NOT vegan.
    const prod = product({ origins: ["plant", "dairy"], pending: false }, [
      item("no-cheese", { removeOrigins: ["dairy"] }),
    ]);
    expect(asServedDiet(line(prod)).vegan).toBe("no"); // no option: still has dairy
    const asServed = asServedDiet(line(prod, "no-cheese"));
    expect(asServed.vegan).toBe("yes");
    expect(asServed.vegetarian).toBe("yes");
  });

  it("an add-meat option downgrades a vegan line to not-vegetarian", () => {
    const prod = product({ origins: ["plant"], pending: false }, [
      item("add-bacon", { addOrigins: ["meat"] }),
    ]);
    const asServed = asServedDiet(line(prod, "add-bacon"));
    expect(asServed.vegan).toBe("no");
    expect(asServed.vegetarian).toBe("no");
    expect(asServed.contains).toEqual(["meat"]);
  });

  it("a remove over a PENDING base leaves labels unknown (never manufactures a false vegan)", () => {
    const prod = product({ origins: ["plant", "dairy"], pending: true }, [
      item("no-cheese", { removeOrigins: ["dairy"] }),
    ]);
    const asServed = asServedDiet(line(prod, "no-cheese"));
    expect(asServed.vegan).toBe("unknown");
    expect(asServed.vegetarian).toBe("unknown");
  });

  it("a null derivation folds as an unreviewed dish (pending) → labels unknown", () => {
    const prod = product(null, []);
    const asServed = asServedDiet(line(prod));
    expect(asServed.vegan).toBe("unknown");
    expect(asServed.vegetarian).toBe("unknown");
  });

  it("a stale selection (option id not on the product) contributes an empty overlay, no throw", () => {
    const prod = product({ origins: ["plant", "dairy"], pending: false }, [
      item("no-cheese", { removeOrigins: ["dairy"] }),
    ]);
    // "ghost" is not among the product's items — it must be ignored, not throw.
    const asServed = asServedDiet(line(prod, "ghost"));
    expect(asServed.vegan).toBe("no"); // dairy still present; no overlay applied
  });

  it("re-applies the staff override over the as-served derivation", () => {
    // Base plant-only (would be vegan), but the owner forces vegan:"no" and sets halal.
    const prod = product({ origins: ["plant"], pending: false }, [], {
      vegan: "no",
      halal: "yes",
    });
    const asServed = asServedDiet(line(prod));
    expect(asServed.vegan).toBe("no");
    expect(asServed.halal).toBe("yes");
  });

  it("a forced-vegan product + an add-meat option reads as-served vegan:'no' (cap, end-to-end)", () => {
    // Owner forced vegan:"yes" on the product, but the diner adds bacon. The as-served line must NOT
    // publish vegan:"yes" over a plate that now contains meat — the false positive the cap prevents.
    const prod = product({ origins: ["plant"], pending: false }, [
      item("add-bacon", { addOrigins: ["meat"] }),
    ]);
    prod.dietOverride = { vegan: "yes" };
    expect(asServedDiet(line(prod)).vegan).toBe("yes"); // no option selected → owner override stands
    const asServed = asServedDiet(line(prod, "add-bacon"));
    expect(asServed.vegan).toBe("no");
    expect(asServed.contains).toContain("meat");
  });

  it("a line with no optionGroups at all still derives (absent groups fold as no overlays)", () => {
    const prod: TillProduct = {
      id: "dish",
      descriptions: { en: "dish" },
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
      category: null,
      allergens: null,
      dietDerivation: { origins: ["plant"], pending: false },
    };
    expect(asServedDiet({ product: prod, quantity: "1" }).vegan).toBe("yes");
  });
});
