import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  catalogues,
  categories,
  products,
  withTransaction,
  type Database,
} from "@waitron/db";
import {
  addMember,
  CATALOGUE_MIGRATIONS,
  categoryDetails,
  createCatalogue,
  createProduct,
  createSection,
  menuVersionImages,
  menuVersions,
  previewMenu,
  publishMenu,
  readMenuStructure,
  sections,
  updateProduct,
  updateSection,
} from "@waitron/catalogue";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mediaImages } from "./schema/images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";

/**
 * `products.image`, `category_details.image`, `sections.image` and `menu_version_images.filename`
 * may only name a photo that exists, and a photo one of the first three still names cannot be
 * deleted or renamed. Nor can a photo a LIVE menu version names. The rules are triggers, not keys
 * (`packages/media/drizzle/0001_image_references.sql`, whose header carries why,
 * `0002_section_image_references.sql` for `sections.image`, and
 * `0003_published_image_references.sql` for a published version's photos).
 *
 * READING `sqlite_master` IS NOT ENOUGH, so the names are pinned AND every rule has a real
 * offending write with an ACCEPTING control in the other direction — without the control a trigger
 * that refused every write would pass all the refusal cases.
 *
 * WHAT IT DOES NOT COVER. One writer, one process: nothing here is a concurrency claim. It
 * asserts the database's refusal, not the message a caller reads — `deleteImage` checks usages
 * itself and returns them rather than reaching the delete trigger.
 */
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, MEDIA_MIGRATIONS],
});

const PRESENT = `${"a".repeat(64)}.jpg`;
const ABSENT = `${"b".repeat(64)}.jpg`;

interface Fixture {
  catalogueId: string;
  productId: string;
  categoryId: string;
  sectionId: string;
}

/** One image, one catalogue with a product, one category with its details row, and one section. */
async function fixture(db: Database): Promise<Fixture> {
  await db
    .insert(mediaImages)
    .values({ filename: PRESENT, names: { en: "Bread" }, altText: {}, labels: [] });
  const [menu] = await db.insert(catalogues).values({ name: "Lunch" }).returning({
    id: catalogues.id,
  });
  const [product] = await db
    .insert(products)
    .values({
      catalogueId: menu!.id,
      name: "Bread",
      pricingUnit: "each",
      unitPrice: 200,
      vatClass: "general",
    })
    .returning({ id: products.id });
  const [category] = await db
    .insert(categories)
    .values({ name: { en: "Bakery" } })
    .returning({ id: categories.id });
  await db.insert(categoryDetails).values({ categoryId: category!.id });
  const [section] = await db
    .insert(sections)
    .values({ internalName: "Bakery" })
    .returning({ id: sections.id });
  return {
    catalogueId: menu!.id,
    productId: product!.id,
    categoryId: category!.id,
    sectionId: section!.id,
  };
}

async function removeImages(): Promise<void> {
  await suite.db.execute(sql`delete from media_images`);
}

async function renameImages(): Promise<void> {
  await suite.db.execute(sql`update media_images set filename = ${ABSENT}`);
}

async function imageCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*) as n from media_images`);
  return rows.rows[0]!.n;
}

let ids: Fixture;
beforeEach(async () => {
  ids = await fixture(suite.db);
});

it("creates the triggers that stand in for the foreign keys", async () => {
  const rows = await suite.db.execute<{ name: string }>(sql`
    select name from sqlite_master where type = 'trigger' and name glob '*media_image_fk*'
    order by name`);
  expect(rows.rows.map((row) => row.name)).toEqual([
    "category_details_media_image_fk_insert",
    "category_details_media_image_fk_parent_delete",
    "category_details_media_image_fk_parent_rename",
    "category_details_media_image_fk_update",
    "menu_version_images_media_image_fk_insert",
    "menu_version_images_media_image_fk_parent_delete",
    "menu_version_images_media_image_fk_parent_rename",
    "products_media_image_fk_insert",
    "products_media_image_fk_parent_delete",
    "products_media_image_fk_parent_rename",
    "products_media_image_fk_update",
    "sections_media_image_fk_insert",
    "sections_media_image_fk_parent_delete",
    "sections_media_image_fk_parent_rename",
    "sections_media_image_fk_update",
  ]);
});

describe("a written image filename", () => {
  // `async`, not a thenable returned bare: drizzle's builder is thenable but is not a Promise, and
  // `expect(...).rejects` refuses anything that is not one.
  const insertProduct = async (image: string | null): Promise<void> => {
    await suite.db.insert(products).values({
      catalogueId: ids.catalogueId,
      name: "Roll",
      pricingUnit: "each",
      unitPrice: 100,
      vatClass: "general",
      image,
    });
  };

  it("is refused on a product insert unless an image carries it", async () => {
    // `errcode` is pinned once, here: a trigger raises 1811 (`SQLITE_CONSTRAINT_TRIGGER`) where a
    // real foreign key refuses an insert with 787.
    await expect(insertProduct(ABSENT)).rejects.toMatchObject({
      message: "products_media_image_fk",
      errcode: 1811,
    });
    await insertProduct(PRESENT);
    await insertProduct(null);
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from products where name = 'Roll'`,
    );
    expect(rows.rows[0]!.n).toBe(2);
  });

  it("is refused on a product update unless an image carries it", async () => {
    const update = async (image: string): Promise<void> => {
      await suite.db.execute(sql`update products set image = ${image} where id = ${ids.productId}`);
    };
    await expect(update(ABSENT)).rejects.toMatchObject({
      message: "products_media_image_fk",
    });
    await update(PRESENT);
    const rows = await suite.db.execute<{ image: string }>(
      sql`select image from products where id = ${ids.productId}`,
    );
    expect(rows.rows[0]!.image).toBe(PRESENT);
  });

  it("is refused on a category_details insert unless an image carries it", async () => {
    const [second] = await suite.db
      .insert(categories)
      .values({ name: { en: "Drinks" } })
      .returning({ id: categories.id });
    const insert = async (image: string): Promise<void> => {
      await suite.db.insert(categoryDetails).values({ categoryId: second!.id, image });
    };
    await expect(insert(ABSENT)).rejects.toMatchObject({
      message: "category_details_media_image_fk",
    });
    await insert(PRESENT);
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from category_details where image = ${PRESENT}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("is refused on a category_details update unless an image carries it", async () => {
    const update = async (image: string): Promise<void> => {
      await suite.db.execute(
        sql`update category_details set image = ${image} where category_id = ${ids.categoryId}`,
      );
    };
    await expect(update(ABSENT)).rejects.toMatchObject({
      message: "category_details_media_image_fk",
    });
    await update(PRESENT);
    const rows = await suite.db.execute<{ image: string }>(
      sql`select image from category_details where category_id = ${ids.categoryId}`,
    );
    expect(rows.rows[0]!.image).toBe(PRESENT);
  });
});

describe("a section's image", () => {
  const insert = async (image: string | null): Promise<void> => {
    await suite.db.insert(sections).values({ internalName: "Drinks", image });
  };
  const update = async (image: string): Promise<void> => {
    await suite.db.execute(sql`update sections set image = ${image} where id = ${ids.sectionId}`);
  };

  it("is refused on a sections insert unless an image carries it", async () => {
    await expect(insert(ABSENT)).rejects.toMatchObject({
      message: "sections_media_image_fk",
    });
    await insert(PRESENT);
    await insert(null);
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from sections where internal_name = 'Drinks'`,
    );
    expect(rows.rows[0]!.n).toBe(2);
  });

  it("is refused on a sections update unless an image carries it", async () => {
    await expect(update(ABSENT)).rejects.toMatchObject({ message: "sections_media_image_fk" });
    await update(PRESENT);
    const rows = await suite.db.execute<{ image: string }>(
      sql`select image from sections where id = ${ids.sectionId}`,
    );
    expect(rows.rows[0]!.image).toBe(PRESENT);
  });

  it("is checked by the section writes before the database is asked", async () => {
    const created = await withTransaction(suite.db, (tx) =>
      createSection(tx, { internalName: "Bread", image: PRESENT }),
    );
    expect(created.image).toBe(PRESENT);
    await expect(
      withTransaction(suite.db, (tx) => updateSection(tx, created.id, { image: ABSENT })),
    ).rejects.toMatchObject({ code: "menu_section.invalid", params: { field: "image" } });
    await expect(
      withTransaction(suite.db, (tx) => createSection(tx, { internalName: "X", image: ABSENT })),
    ).rejects.toMatchObject({ code: "menu_section.invalid", params: { field: "image" } });
  });
});

describe("an image a catalogue row still names", () => {
  it("cannot be deleted or renamed while a product names it, and can once the product lets go", async () => {
    await suite.db.execute(sql`update products set image = ${PRESENT} where id = ${ids.productId}`);
    await expect(removeImages()).rejects.toMatchObject({
      message: "products_media_image_fk",
    });
    await expect(renameImages()).rejects.toMatchObject({
      message: "products_media_image_fk",
    });
    await suite.db.execute(sql`update products set image = null`);
    await removeImages();
    expect(await imageCount()).toBe(0);
  });

  it("cannot be deleted or renamed while a category names it, and can once the category lets go", async () => {
    await suite.db.execute(
      sql`update category_details set image = ${PRESENT} where category_id = ${ids.categoryId}`,
    );
    await expect(removeImages()).rejects.toMatchObject({
      message: "category_details_media_image_fk",
    });
    await expect(renameImages()).rejects.toMatchObject({
      message: "category_details_media_image_fk",
    });
    await suite.db.execute(sql`update category_details set image = null`);
    await removeImages();
    expect(await imageCount()).toBe(0);
  });

  it("cannot be deleted or renamed while a section names it, and can once the section lets go", async () => {
    await suite.db.execute(sql`update sections set image = ${PRESENT} where id = ${ids.sectionId}`);
    await expect(removeImages()).rejects.toMatchObject({
      message: "sections_media_image_fk",
    });
    await expect(renameImages()).rejects.toMatchObject({
      message: "sections_media_image_fk",
    });
    await suite.db.execute(sql`update sections set image = null`);
    await removeImages();
    expect(await imageCount()).toBe(0);
  });
});

describe("an image a live menu version names", () => {
  /** A menu whose one product shows the image, published, and then the product letting it go. */
  async function publishedOnly(): Promise<{ menuId: string; productId: string }> {
    await seedTenant(suite.db);
    return withTransaction(suite.db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Lunch Menu" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Bread",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
        image: PRESENT,
      });
      const { rootSectionId } = await readMenuStructure(tx, menu.id);
      await addMember(tx, rootSectionId, { kind: "product", productId: product.id });
      await publishMenu(tx, menu.id, (await previewMenu(tx, menu.id)).hash, "person-1");
      await updateProduct(tx, product.id, { image: null });
      return { menuId: menu.id, productId: product.id };
    });
  }

  /** Publishes the menu again, now without the image, so the version naming it is no longer live. */
  async function republish(menuId: string): Promise<void> {
    await withTransaction(suite.db, async (tx) =>
      publishMenu(tx, menuId, (await previewMenu(tx, menuId)).hash, "person-1"),
    );
  }

  it("cannot be deleted while the live version names it, and can once another version is live", async () => {
    const { menuId } = await publishedOnly();
    await expect(removeImages()).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    expect(await imageCount()).toBe(1);
    await republish(menuId);
    await removeImages();
    expect(await imageCount()).toBe(0);
  });

  it("cannot be renamed while the live version names it, and can once another version is live", async () => {
    const { menuId } = await publishedOnly();
    await expect(renameImages()).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    await republish(menuId);
    await renameImages();
    const rows = await suite.db.execute<{ filename: string }>(
      sql`select filename from media_images`,
    );
    expect(rows.rows.map((row) => row.filename)).toEqual([ABSENT]);
  });

  it("is refused on a menu_version_images insert unless an image carries it", async () => {
    const [version] = await suite.db
      .insert(menuVersions)
      .values({
        menuId: ids.catalogueId,
        number: 1,
        document: {} as never,
        contentHash: "hash",
        publishedAt: new Date(),
        publishedBy: "person-1",
      })
      .returning({ id: menuVersions.id });
    const insert = async (filename: string): Promise<void> => {
      await suite.db.insert(menuVersionImages).values({ versionId: version!.id, filename });
    };
    await expect(insert(ABSENT)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    await insert(PRESENT);
    const rows = await suite.db.execute<{ filename: string }>(
      sql`select filename from menu_version_images`,
    );
    expect(rows.rows.map((row) => row.filename)).toEqual([PRESENT]);
  });

  it("can be renamed to itself while the live version names it", async () => {
    await publishedOnly();
    await suite.db.execute(sql`update media_images set filename = filename`);
    expect(await imageCount()).toBe(1);
  });
});
