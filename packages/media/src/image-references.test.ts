import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, catalogues, categories, products, type Database } from "@waitron/db";
import { CATALOGUE_MIGRATIONS, categoryDetails } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mediaImages } from "./schema/images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";

/**
 * `products.image` and `category_details.image` may only name a photo that exists, and a photo one
 * of them still names cannot be deleted or renamed. The rules are triggers, not keys
 * (`packages/media/drizzle/0001_image_references.sql`, whose header carries why).
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
}

/** One image, one catalogue with a product, and one category with its details row. */
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
  return { catalogueId: menu!.id, productId: product!.id, categoryId: category!.id };
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

it("creates the eight triggers that stand in for the two foreign keys", async () => {
  const rows = await suite.db.execute<{ name: string }>(sql`
    select name from sqlite_master where type = 'trigger' and name glob '*media_image_fk*'
    order by name`);
  expect(rows.rows.map((row) => row.name)).toEqual([
    "category_details_media_image_fk_insert",
    "category_details_media_image_fk_parent_delete",
    "category_details_media_image_fk_parent_rename",
    "category_details_media_image_fk_update",
    "products_media_image_fk_insert",
    "products_media_image_fk_parent_delete",
    "products_media_image_fk_parent_rename",
    "products_media_image_fk_update",
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
});
