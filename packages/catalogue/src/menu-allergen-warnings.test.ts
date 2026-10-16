import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, product, type MenusFixture } from "../test/menus-fixture.js";
import { applyRecipeDerivation, createProduct, updateProduct } from "./operations.js";
import { previewMenu, publishMenu } from "./menu-publication.js";
import { queueMenuPublication } from "./menu-schedule.js";
import { listProductVariants, setProductVariants } from "./variants.js";
import { addMember } from "./sections.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const unknown = (id: string, name: string, parentName: string | null = null) => ({
  id,
  name,
  parentName,
});
const warnings = async (f: MenusFixture) => (await app((tx) => previewMenu(tx, f.lunch))).warnings;

describe("unreviewed offered allergens", () => {
  it("warns once for offered unreviewed products and their effective active variants", async () => {
    const f = await menusFixture(fx.db);
    const inactive = await app(async (tx) => {
      await updateProduct(tx, f.lemonade, { allergens: null, available: false });
      await updateProduct(tx, f.large, { available: false });
      await updateProduct(tx, f.extraLemon, { allergens: null });
      await updateProduct(tx, f.burger, { allergens: null });
      const old = await listProductVariants(tx, f.lemonade);
      const saved = await setProductVariants(
        tx,
        f.lemonade,
        [
          ...old,
          {
            name: "Reviewed",
            customerName: { en: "Guest portion" },
            kitchenName: "KITCHEN PORTION",
            image: null,
            unitPrice: null,
            available: true,
            active: true,
          },
          {
            name: "Archived",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            available: true,
            active: true,
          },
        ],
        "en",
      );
      await updateProduct(tx, saved[1]!.id, { allergens: { eggs: {} } });
      await setProductVariants(tx, f.lemonade, saved.slice(0, 2), "en");
      await addMember(tx, f.lunchRoot, product(f.lemonade));
      return saved[2]!.id;
    });
    expect(await warnings(f)).toEqual([
      {
        kind: "allergens_unreviewed",
        products: [unknown(f.lemonade, "Lemonade"), unknown(f.large, "Large", "Lemonade")],
      },
    ]);
    await app((tx) => updateProduct(tx, f.lemonade, { allergens: {} }));
    expect(await warnings(f)).toEqual([]);
    await app((tx) => updateProduct(tx, f.lemonade, { allergens: { milk: {} } }));
    await app((tx) =>
      applyRecipeDerivation(tx, f.lemonade, { allergens: { sesame: {} }, pending: true }),
    );
    expect(await warnings(f)).toEqual([
      {
        kind: "allergens_unreviewed",
        products: [
          unknown(f.lemonade, "Lemonade"),
          unknown(f.large, "Large", "Lemonade"),
          unknown(
            (await app((tx) => listProductVariants(tx, f.lemonade)))[1]!.id,
            "Reviewed",
            "Lemonade",
          ),
        ],
      },
    ]);
    await app((tx) =>
      applyRecipeDerivation(tx, f.lemonade, { allergens: { sesame: {} }, pending: false }),
    );
    expect(await warnings(f)).toEqual([]);
    expect(JSON.stringify(await warnings(f))).not.toContain(inactive);
  });

  it("does not warn for inherited reviewed values and keeps a separate unreviewed dish", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.lemonade, { allergens: { milk: {} } }));
    expect(await warnings(f)).toEqual([]);
    await app((tx) => updateProduct(tx, f.soup, { allergens: null }));
    expect(await warnings(f)).toEqual([
      { kind: "allergens_unreviewed", products: [unknown(f.soup, "Soup")] },
    ]);
  });

  it.each(["public", "staff_only", "not_sold_separately"] as const)(
    "includes offered %s dishes without adding unplaced products",
    async (ordering) => {
      const f = await menusFixture(fx.db);
      await app(async (tx) => {
        await updateProduct(tx, f.soup, { allergens: null, ordering });
        await createProduct(tx, {
          catalogueId: f.lunch,
          categoryId: null,
          name: "Unplaced",
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "reduced",
        });
      });
      expect(await warnings(f)).toEqual([
        { kind: "allergens_unreviewed", products: [unknown(f.soup, "Soup")] },
      ]);
    },
  );

  it.each(["now", "scheduled"] as const)(
    "keeps %s publishing advisory and retains the stale-hash refusal",
    async (mode) => {
      const f = await menusFixture(fx.db);
      await app((tx) => updateProduct(tx, f.soup, { allergens: null }));
      const before = await app((tx) => previewMenu(tx, f.lunch));
      expect(before.warnings).toEqual([
        { kind: "allergens_unreviewed", products: [unknown(f.soup, "Soup")] },
      ]);
      const publish = (hash: string) =>
        app((tx) =>
          mode === "now"
            ? publishMenu(tx, f.lunch, hash, "person-1")
            : queueMenuPublication(
                tx,
                f.lunch,
                hash,
                new Date("2030-01-02T10:00:00Z"),
                "person-1",
                { at: new Date("2030-01-01T10:00:00Z") },
              ),
        );
      await app((tx) => updateProduct(tx, f.soup, { allergens: {} }));
      await expect(publish(before.hash)).rejects.toMatchObject({
        code: "menu.changed_since_preview",
      });
      await app((tx) => updateProduct(tx, f.soup, { allergens: null }));
      const current = await app((tx) => previewMenu(tx, f.lunch));
      const result = await publish(current.hash);
      expect(result).toMatchObject({ number: 1 });
    },
  );
});
