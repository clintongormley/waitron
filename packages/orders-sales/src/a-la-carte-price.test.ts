import { products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { FrozenOffer, MenuDocument } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { aLaCarteUnitCents, setMenuALaCartePrices } from "./a-la-carte-price.js";

describe("aLaCarteUnitCents", () => {
  const offer = {
    productId: "dish",
    unitPrice: "8.00",
    variants: [{ id: "large", unitPrice: "11.50" }],
  } as unknown as FrozenOffer;
  const own = { dishCents: 500, variantCents: 700 };

  it("answers the holding menu's price for a product it sells", () => {
    expect(aLaCarteUnitCents(offer, null, own)).toBe(800);
  });

  it("answers the menu's price of a listed variant", () => {
    expect(aLaCarteUnitCents(offer, "large", own)).toBe(1150);
  });

  it("answers the variant's own price when the menu does not list the product", () => {
    expect(aLaCarteUnitCents(undefined, "small", own)).toBe(700);
  });

  it("answers the variant's own price when the menu lists the dish but not the variant", () => {
    expect(aLaCarteUnitCents(offer, "small", own)).toBe(700);
  });

  it("answers the dish's own price when the variant has none", () => {
    expect(aLaCarteUnitCents(undefined, "small", { dishCents: 500, variantCents: null })).toBe(500);
  });
});

describe("setMenuALaCartePrices", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  async function seedDishes() {
    return withTransaction(suite.db, async (tx) => {
      const product = async (name: string, unitPrice: number | null, parentId?: string) => {
        const [row] = await tx
          .insert(products)
          .values({ name, unitPrice, vatClass: "reduced", parentId })
          .returning({ id: products.id });
        return row!.id;
      };
      const flan = await product("Flan", 500);
      const tortilla = await product("Tortilla", 600);
      const small = await product("Small", null, tortilla);
      const large = await product("Large", 900, tortilla);
      return { flan, tortilla, small, large };
    });
  }

  it("prices each set-menu line from its holding menu or its own price, and leaves a la carte lines null", async () => {
    const ids = await seedDishes();
    const holding = {
      offers: { flan: { productId: ids.flan, unitPrice: "8.00", variants: [] } },
    } as unknown as MenuDocument;
    const other = { offers: {} } as unknown as MenuDocument;
    const prices = await withTransaction(suite.db, (tx) =>
      setMenuALaCartePrices(tx, [
        { productId: ids.flan, variantId: null },
        { holding, productId: ids.flan, variantId: null },
        { holding, productId: ids.tortilla, variantId: ids.small },
        { holding, productId: ids.tortilla, variantId: ids.large },
        { holding: other, productId: ids.flan, variantId: null },
      ]),
    );
    expect(prices).toEqual([null, 800, 600, 900, 500]);
  });

  it("answers null for a line that came from no set-menu copy", async () => {
    const prices = await withTransaction(suite.db, (tx) =>
      setMenuALaCartePrices(tx, [{ productId: crypto.randomUUID(), variantId: null }]),
    );
    expect(prices).toEqual([null]);
  });

  it("refuses to price a set-menu dish whose product row is missing", async () => {
    const holding = { offers: {} } as unknown as MenuDocument;
    await expect(
      withTransaction(suite.db, (tx) =>
        setMenuALaCartePrices(tx, [{ holding, productId: crypto.randomUUID(), variantId: null }]),
      ),
    ).rejects.toThrow("has no price of its own");
  });
});
