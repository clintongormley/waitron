import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  plantStoredProduct,
  racePair,
  seedLegacySellingUnits,
  useCatalogueDb,
} from "../test/fixtures.js";
import { createCategory } from "./categories.js";
import { createCatalogue, createProduct, updateProduct } from "./operations.js";
import { readProductEditor, saveProductEditor, type ProductEditorInput } from "./product-editor.js";
import { listProductVariants, setProductVariants, type VariantWrite } from "./variants.js";

/** An Active product's or Active variant's staff name is unique across the whole venue. */
const suite = useCatalogueDb();
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);
const taken = (field: string, name: string) => ({
  code: "product.name_taken",
  params: { field, name },
});

let lunch: string, dinner: string, food: string, drinks: string, cola: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  await seedLegacySellingUnits(suite.db);
  await app(async (tx) => {
    lunch = (await createCatalogue(tx, { name: "Lunch" })).id;
    dinner = (await createCatalogue(tx, { name: "Dinner" })).id;
    food = (await createCategory(tx, { name: "Food" })).id;
    drinks = (await createCategory(tx, { name: "Drinks" })).id;
  });
  cola = await make("Cola", { catalogueId: lunch, categoryId: drinks });
});

async function make(
  name: string,
  { catalogueId = dinner, categoryId = food, active = true } = {},
): Promise<string> {
  const created = await app((tx) =>
    createProduct(tx, {
      catalogueId,
      categoryId,
      name,
      pricingUnit: "each",
      unitPrice: "2",
      vatClass: "general",
      active,
    }),
  );
  return created.id;
}

const variant = (name: string, extra: Partial<VariantWrite> = {}): VariantWrite => ({
  name,
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: null,
  available: true,
  ...extra,
});
const variants = (productId: string, inputs: VariantWrite[]) =>
  app((tx) => setProductVariants(tx, productId, inputs, "en"));

describe("create", () => {
  it.each(["Cola", "cola", "  COLA\t"])(
    "refuses an Active product named %j in another menu and category",
    async (name) => {
      await expect(make(name)).rejects.toMatchObject(taken("name", name.trim()));
    },
  );
  it("allows an Inactive duplicate", async () => {
    await make("Cola", { active: false });
  });
  it("allows an Active product whose name only an Inactive one holds", async () => {
    await make("Tonic", { active: false });
    await make("Tonic");
  });
});

describe("update", () => {
  it("refuses a rename onto another Active product's name", async () => {
    const water = await make("Water");
    await expect(app((tx) => updateProduct(tx, water, { name: "COLA" }))).rejects.toMatchObject(
      taken("name", "COLA"),
    );
  });
  it("allows a rename to another casing of its own name", async () => {
    await app((tx) => updateProduct(tx, cola, { name: "COLA" }));
  });
  it("allows saving a product unchanged", async () => {
    await app((tx) => updateProduct(tx, cola, { name: "Cola", active: true, unitPrice: "3" }));
  });
  it("does not refuse a save that keeps a name two Active products already shared", async () => {
    const twin = await plantStoredProduct(suite.db, dinner, "cola");
    await app((tx) => updateProduct(tx, twin, { name: "cola", unitPrice: "3" }));
  });
  it("refuses reactivating a product whose name became taken while it was Inactive", async () => {
    await app((tx) => updateProduct(tx, cola, { active: false }));
    await make("Cola");
    await expect(app((tx) => updateProduct(tx, cola, { active: true }))).rejects.toMatchObject(
      taken("name", "Cola"),
    );
  });
  it("refuses reactivating a product whose Active variant's name became taken", async () => {
    const lemonade = await make("Lemonade");
    await variants(lemonade, [variant("Small")]);
    await app((tx) => updateProduct(tx, lemonade, { active: false }));
    await make("small");
    await expect(app((tx) => updateProduct(tx, lemonade, { active: true }))).rejects.toMatchObject(
      taken("variants.0.name", "Small"),
    );
  });
  it("refuses reactivating a variant whose name became taken while it was Inactive", async () => {
    const lemonade = await make("Lemonade");
    const [small] = await variants(lemonade, [variant("Small", { active: false })]);
    await make("small");
    await expect(app((tx) => updateProduct(tx, small!.id, { active: true }))).rejects.toMatchObject(
      taken("name", "Small"),
    );
  });
  it("refuses a variant renamed onto its own parent's name", async () => {
    const lemonade = await make("Lemonade");
    const [small] = await variants(lemonade, [variant("Small")]);
    await expect(
      app((tx) => updateProduct(tx, small!.id, { name: "lemonade" })),
    ).rejects.toMatchObject(taken("name", "lemonade"));
  });
});

describe("rows the rule leaves to the write", () => {
  it("lets a variant of an Inactive product be renamed onto a taken name", async () => {
    const lemonade = await make("Lemonade");
    const [small] = await variants(lemonade, [variant("Small")]);
    await app((tx) => updateProduct(tx, lemonade, { active: false }));
    await app((tx) => updateProduct(tx, small!.id, { name: "Cola" }));
  });
  it("leaves an id that names no row to the write", async () => {
    await app((tx) => updateProduct(tx, crypto.randomUUID(), { name: "Cola" }));
  });
  it("keeps a variant sent by id without its Active switch as it was", async () => {
    const lemonade = await make("Lemonade");
    const [inactive] = await variants(lemonade, [variant("Cola", { active: false })]);
    await variants(lemonade, [variant("Cola", { id: inactive!.id })]);
    expect((await app((tx) => listProductVariants(tx, lemonade)))[0]!.active).toBe(false);
  });
});

describe("variant save", () => {
  it("refuses a new variant named like another product", async () => {
    const lemonade = await make("Lemonade");
    await expect(variants(lemonade, [variant("cola")])).rejects.toMatchObject(
      taken("variants.0.name", "cola"),
    );
  });
  it("refuses a variant named like its own parent", async () => {
    const lemonade = await make("Lemonade");
    await expect(
      variants(lemonade, [variant("Small"), variant(" LEMONADE ")]),
    ).rejects.toMatchObject(taken("variants.1.name", "LEMONADE"));
  });
  it("refuses two variants in one save sharing a name, naming the later", async () => {
    const lemonade = await make("Lemonade");
    await expect(variants(lemonade, [variant("Small"), variant("small")])).rejects.toMatchObject(
      taken("variants.1.name", "small"),
    );
  });
  it("refuses a renamed variant onto another product's name", async () => {
    const lemonade = await make("Lemonade");
    const [small] = await variants(lemonade, [variant("Small")]);
    await expect(variants(lemonade, [variant("Cola", { id: small!.id })])).rejects.toMatchObject(
      taken("variants.0.name", "Cola"),
    );
  });
  it("allows an Inactive variant to keep a duplicate", async () => {
    const lemonade = await make("Lemonade");
    await variants(lemonade, [variant("Cola", { active: false })]);
  });
  it("lets the variants of an Inactive product hold names freely, and never block one", async () => {
    const lemonade = await make("Lemonade", { active: false });
    await variants(lemonade, [variant("Cola"), variant("Half")]);
    await make("Half");
  });
  it("allows two variants to swap names", async () => {
    const lemonade = await make("Lemonade");
    const [small, large] = await variants(lemonade, [variant("Small"), variant("Large")]);
    await variants(lemonade, [
      variant("Large", { id: small!.id }),
      variant("Small", { id: large!.id }),
    ]);
    const names = (await app((tx) => listProductVariants(tx, lemonade))).map((v) => v.name);
    expect(names).toEqual(["Large", "Small"]);
  });
  it("allows a new variant to take the name of one the save removes", async () => {
    const lemonade = await make("Lemonade");
    await variants(lemonade, [variant("Small")]);
    await variants(lemonade, [variant("Small")]);
    const listed = await app((tx) => listProductVariants(tx, lemonade));
    expect(listed.map((v) => [v.name, v.active])).toEqual([
      ["Small", true],
      ["Small", false],
    ]);
  });
});

describe("product editor save", () => {
  const editorVariant = (name: string, id?: string) => ({
    ...(id === undefined ? {} : { id }),
    name,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: null,
    available: true,
    active: true,
  });
  const body = (name: string, named: ReturnType<typeof editorVariant>[] = []) =>
    ({
      name,
      customerName: null,
      ordering: "public",
      description: null,
      kitchenName: null,
      unitId: null,
      unitPrice: "4.00",
      active: true,
      available: true,
      vatClass: "general",
      image: null,
      variants: named,
      primaryCategoryId: null,
      modifiers: [],
      allergens: null,
      dietaryDeclarations: [],
    }) satisfies ProductEditorInput;
  const save = (productId: string | null, input: ProductEditorInput) =>
    app((tx) => saveProductEditor(tx, productId, lunch, input, "en"));

  it("refuses a new product named like another, beside its Name", async () => {
    await expect(save(null, body("cola"))).rejects.toMatchObject(taken("name", "cola"));
  });
  it("refuses a variant named like another product, beside that variant's Name", async () => {
    await expect(
      save(null, body("Lemonade", [editorVariant("Small"), editorVariant("Cola")])),
    ).rejects.toMatchObject(taken("variants.1.name", "Cola"));
  });
  it("refuses a variant named like its own product", async () => {
    await expect(save(null, body("Lemonade", [editorVariant("lemonade")]))).rejects.toMatchObject(
      taken("variants.0.name", "lemonade"),
    );
  });
  it("refuses two variants sharing a name, naming the later", async () => {
    await expect(
      save(null, body("Lemonade", [editorVariant("Small"), editorVariant("SMALL")])),
    ).rejects.toMatchObject(taken("variants.1.name", "SMALL"));
  });
  it("refuses a rename onto another product's name and writes nothing", async () => {
    const saved = await save(null, body("Lemonade", [editorVariant("Small")]));
    await expect(
      save(saved.id, body("Cola", [editorVariant("Small", saved.variants[0]!.id)])),
    ).rejects.toMatchObject(taken("name", "Cola"));
    expect((await app((tx) => readProductEditor(tx, saved.id))).name).toBe("Lemonade");
  });
  it("saves a product unchanged", async () => {
    const saved = await save(null, body("Lemonade", [editorVariant("Small")]));
    await save(saved.id, body("Lemonade", [editorVariant("Small", saved.variants[0]!.id)]));
  });
  it("lets two variants swap names", async () => {
    const saved = await save(null, body("Lemonade", [editorVariant("S"), editorVariant("L")]));
    const [s, l] = saved.variants;
    const after = await save(
      saved.id,
      body("Lemonade", [editorVariant("L", s!.id), editorVariant("S", l!.id)]),
    );
    expect(after.variants.map((v) => [v.id, v.name])).toEqual([
      [s!.id, "L"],
      [l!.id, "S"],
    ]);
  });
  it("lets the product take the name its own variant gives up", async () => {
    const saved = await save(null, body("Lemonade", [editorVariant("Pink lemonade")]));
    const after = await save(
      saved.id,
      body("Pink lemonade", [editorVariant("Pink", saved.variants[0]!.id)]),
    );
    expect([after.name, after.variants[0]!.name]).toEqual(["Pink lemonade", "Pink"]);
  });
  it("lets the product and its variant swap names", async () => {
    const saved = await save(null, body("Lemonade", [editorVariant("Pink lemonade")]));
    const after = await save(
      saved.id,
      body("Pink lemonade", [editorVariant("Lemonade", saved.variants[0]!.id)]),
    );
    expect([after.name, after.variants[0]!.name]).toEqual(["Pink lemonade", "Lemonade"]);
  });
  it("lets a new variant take the name of one the save removes", async () => {
    const saved = await save(null, body("Lemonade", [editorVariant("Small")]));
    const after = await save(saved.id, body("Lemonade", [editorVariant("Small")]));
    expect(after.variants.map((v) => [v.name, v.active])).toEqual([
      ["Small", true],
      ["Small", false],
    ]);
  });
  it("refuses saving a variant's own editor onto another product's name", async () => {
    const saved = await save(null, body("Lemonade", [editorVariant("Small")]));
    const small = saved.variants[0]!.id;
    const own = await app((tx) => readProductEditor(tx, small));
    await expect(
      app((tx) =>
        saveProductEditor(
          tx,
          small,
          lunch,
          {
            name: "cola",
            customerName: own.customerName,
            ordering: own.ordering,
            description: own.description,
            kitchenName: own.kitchenName,
            unitId: null,
            unitPrice: null,
            active: true,
            available: true,
            vatClass: null,
            image: null,
            variants: [],
            primaryCategoryId: null,
            modifiers: [],
            allergens: null,
            dietaryDeclarations: null,
          },
          "en",
        ),
      ),
    ).rejects.toMatchObject(taken("name", "cola"));
  });
});

describe("two writes started together", () => {
  it("lets one of two creates of one staff name through, and refuses the other", async () => {
    const create = (name: string) => (tx: Transaction) =>
      createProduct(tx, {
        catalogueId: dinner,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice: "2",
        vatClass: "general",
      });
    const [first, second] = await racePair(suite.db, create("Tonic"), create("tonic"));
    expect(first.status).toBe("fulfilled");
    expect(second).toMatchObject({ status: "rejected", reason: taken("name", "tonic") });
  });
});
