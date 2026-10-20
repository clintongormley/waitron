import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { createProduct, updateProduct } from "./operations.js";
import { createExtraList } from "./extras.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { setProductVariants } from "./variants.js";
import { readOfferedModifiers } from "./offered-modifiers.js";
import { menuStatus, previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import { menuVersions } from "./schema/publication.js";
import { writeContentLanguages } from "./content-languages.js";
import { newCustomerPresentation } from "./new-customer-text.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

async function sourceFixture(variant: boolean) {
  const f = await menusFixture(fx.db);
  const extraId = await app(async (tx) => {
    const parent = await createProduct(tx, {
      catalogueId: f.lunch,
      categoryId: null,
      unitId: null,
      name: "Staff topping",
      customerName: { en: "Guest topping", fr: "FR side" },
      kitchenName: "PREP TOP",
      unitPrice: "0.50",
      vatClass: "reduced",
    });
    const [child] = variant
      ? await setProductVariants(
          tx,
          parent.id,
          [
            {
              name: "Staff portion",
              customerName: { es: "Portion", fr: "FR portion" },
              kitchenName: "PREP PORTION",
              image: null,
              unitPrice: null,
              available: true,
            },
          ],
          "en",
        )
      : [];
    const productId = child?.id ?? parent.id;
    const list = await createExtraList(
      tx,
      {
        name: "Staff extras",
        items: [{ productId }],
      },
      "en",
    );
    await writeProductModifiers(tx, f.lemonade, [{ kind: "extras", id: list.id }]);
    return productId;
  });
  return { ...f, extraId };
}

async function publish(menuId: string) {
  const preview = await app((tx) => previewMenu(tx, menuId));
  return app((tx) => publishMenu(tx, menuId, preview.hash, "person-1"));
}

async function liveExtra(menuId: string, productId: string) {
  const live = (await app((tx) => readLiveDocuments(tx, [menuId]))).get(menuId)!;
  return Object.values(live.document.offers)
    .flatMap((offer) => offer.offeredModifiers)
    .flatMap((list) => (list.kind === "extras" ? list.items : []))
    .find((item) => item.productId === productId)!;
}

describe("extras presentation sources", () => {
  it.each([false, true])(
    "keeps raw parent and relative-variant facts in new offers (variant %s)",
    async (variant) => {
      const f = await sourceFixture(variant);
      const offered = await app((tx) =>
        readOfferedModifiers(tx, [{ productId: f.lemonade, menuItemId: null }]),
      );
      const list = offered.get(f.lemonade)![0]!;
      expect(list.kind).toBe("extras");
      if (list.kind !== "extras") throw new Error("Expected the attached extras list");
      expect(list.items[0]!.productId).toBe(f.extraId);
      expect(list.items[0]!.presentation).toEqual({
        name: "Staff topping",
        customerName: { en: "Guest topping", fr: "FR side" },
        kitchenName: "PREP TOP",
        variantName: variant ? "Staff portion" : null,
        variantCustomerName: variant ? { es: "Portion", fr: "FR portion" } : null,
        variantKitchenName: variant ? "PREP PORTION" : null,
      });
    },
  );

  it("keeps absent customer and kitchen names raw instead of storing display fallbacks", async () => {
    const f = await sourceFixture(false);
    await app((tx) => updateProduct(tx, f.extraId, { customerName: null, kitchenName: null }));
    await publish(f.lunch);
    const extra = await liveExtra(f.lunch, f.extraId);
    expect(extra.presentation).toEqual({
      name: "Staff topping",
      customerName: null,
      kitchenName: null,
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
    });
    expect(
      newCustomerPresentation(extra.presentation, "es", {
        languages: ["en", "es"],
        defaultLanguage: "es",
      }),
    ).toBe("Staff topping");
  });

  it("resolves a new default from the frozen pair without borrowing a third language or today's catalogue", async () => {
    const f = await sourceFixture(true);
    await publish(f.lunch);
    const rows = await fx.db
      .select()
      .from(menuVersions)
      .orderBy(asc(menuVersions.menuId), asc(menuVersions.number));
    await app(async (tx) => {
      await writeContentLanguages(tx, { languages: ["en", "es", "fr"], defaultLanguage: "es" });
      await updateProduct(tx, f.extraId, {
        name: "Renamed portion",
        customerName: { es: "New portion" },
      });
    });
    const extra = await liveExtra(f.lunch, f.extraId);
    expect(extra).toHaveProperty("presentation");
    expect(
      newCustomerPresentation(extra.presentation, "es", {
        languages: ["en", "es", "fr"],
        defaultLanguage: "es",
      }),
    ).toBe("Staff topping (Portion)");
    expect(
      newCustomerPresentation(extra.presentation, "fr", {
        languages: ["en", "es", "fr"],
        defaultLanguage: "es",
      }),
    ).toBe("FR side (FR portion)");
    expect(
      await fx.db
        .select()
        .from(menuVersions)
        .orderBy(asc(menuVersions.menuId), asc(menuVersions.number)),
    ).toEqual(rows);
  });

  it("reports source changes even when the composed names stay identical, preserving earlier versions until publish", async () => {
    const f = await sourceFixture(true);
    await app((tx) => updateProduct(tx, f.extraId, { customerName: null }));
    await publish(f.lunch);
    const before = await liveExtra(f.lunch, f.extraId);
    const rows = await fx.db
      .select()
      .from(menuVersions)
      .orderBy(asc(menuVersions.menuId), asc(menuVersions.number));
    await app((tx) => updateProduct(tx, f.extraId, { customerName: { en: "Staff portion" } }));
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.changes).toContainEqual(
      expect.objectContaining({ kind: "product_changed", productId: f.extraId, fields: ["names"] }),
    );
    expect((await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch)!.state).toBe("changed");
    expect(await liveExtra(f.lunch, f.extraId)).toEqual(before);
    expect(
      await fx.db
        .select()
        .from(menuVersions)
        .orderBy(asc(menuVersions.menuId), asc(menuVersions.number)),
    ).toEqual(rows);
    await publish(f.lunch);
    const after = await liveExtra(f.lunch, f.extraId);
    expect(after.customerName).toEqual(before.customerName);
    expect(after.name).toBe(before.name);
    expect(after.kitchenName).toBe(before.kitchenName);
    expect(after).toHaveProperty("presentation.variantCustomerName", { en: "Staff portion" });
    expect(
      (await fx.db.select().from(menuVersions).where(eq(menuVersions.id, rows[0]!.id)))[0],
    ).toEqual(rows[0]);
    expect(
      (
        await fx.db
          .select({ text: products.customerName })
          .from(products)
          .where(eq(products.id, f.extraId))
      )[0]!.text,
    ).toEqual({ en: "Staff portion" });
  });
});
