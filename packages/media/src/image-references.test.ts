import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, catalogues, products, withTransaction, type Database } from "@waitron/db";
import {
  activateDueMenuPublications,
  addMember,
  cancelMenuPublication,
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createProduct,
  createSectionIn,
  menuVersionImages,
  menuPublications,
  menuScheduledPublications,
  menuVersions,
  previewMenu,
  publishMenu,
  queueMenuPublication,
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
 * `products.image`, `sections.image` and `menu_version_images.filename` may only name a photo
 * that exists, and a photo one of the first two still names cannot be deleted or renamed. Nor can a
 * photo a LIVE menu version or a queued edition names. The rules are triggers, not keys
 * (`packages/media/drizzle/0001_image_references.sql`, whose header carries why,
 * `0002_section_image_references.sql` for `sections.image`,
 * `0003_published_image_references.sql` for a published version's photos, and
 * `0008_queued_edition_image_references.sql` for a queued edition's).
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
  sectionId: string;
}

/** One image, one catalogue with a product, and one section. */
async function fixture(db: Database): Promise<Fixture> {
  await db.insert(mediaImages).values({ filename: PRESENT, names: { en: "Bread" } });
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
  const [section] = await db
    .insert(sections)
    .values({ internalName: "Bakery", ownerMenuId: menu!.id })
    .returning({ id: sections.id });
  return {
    catalogueId: menu!.id,
    productId: product!.id,
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

it("gives category_details no image column and no trigger naming it", async () => {
  const cols = await suite.db.execute<{ name: string }>(
    sql`select name from pragma_table_info('category_details')`,
  );
  expect(cols.rows.map((c) => c.name).sort()).toEqual(["category_id", "color", "parent_id"]);
  const triggers = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'trigger' and name like 'category_details_media_image_fk_%'`,
  );
  expect(triggers.rows).toEqual([]);
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
});

describe("a section's image", () => {
  const insert = async (image: string | null): Promise<void> => {
    await suite.db
      .insert(sections)
      .values({ internalName: "Drinks", image, ownerMenuId: ids.catalogueId });
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
      createSectionIn(tx, ids.sectionId, { internalName: "Bread", image: PRESENT }),
    );
    expect(created.image).toBe(PRESENT);
    await expect(
      withTransaction(suite.db, (tx) => updateSection(tx, created.id, { image: ABSENT })),
    ).rejects.toMatchObject({ code: "menu_section.invalid", params: { field: "image" } });
    await expect(
      withTransaction(suite.db, (tx) =>
        createSectionIn(tx, ids.sectionId, { internalName: "X", image: ABSENT }),
      ),
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

/** A menu whose one product shows the image, published, and then the product letting it go. */
async function publishedOnly(): Promise<{ menuId: string; productId: string }> {
  await seedTenant(suite.db);
  return withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Lunch Menu" });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Toast",
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

describe("an image a live menu version names", () => {
  /** Publishes the menu again, now without the image, so the version naming it is no longer live. */
  async function republish(menuId: string): Promise<void> {
    await withTransaction(suite.db, async (tx) =>
      publishMenu(tx, menuId, (await previewMenu(tx, menuId)).hash, "person-1"),
    );
  }

  it("a stale preview publish changes no versions, live pointer or frozen image references", async () => {
    const { menuId, productId } = await publishedOnly();
    const old = await withTransaction(suite.db, (tx) => previewMenu(tx, menuId));
    await suite.db.insert(mediaImages).values({ filename: ABSENT, names: { en: "New toast" } });
    await withTransaction(suite.db, (tx) => updateProduct(tx, productId, { image: ABSENT }));
    const next = await withTransaction(suite.db, (tx) => previewMenu(tx, menuId));
    expect(next.hash).not.toBe(old.hash);
    expect(next.live).toEqual(old.live);
    const beforeVersions = await suite.db.select().from(menuVersions);
    const beforePointers = await suite.db.select().from(menuPublications);
    const beforeImages = await suite.db.select().from(menuVersionImages);
    await expect(
      withTransaction(suite.db, (tx) => publishMenu(tx, menuId, old.hash, "person-1")),
    ).rejects.toMatchObject({ code: "menu.changed_since_preview" });
    expect(await suite.db.select().from(menuVersions)).toEqual(beforeVersions);
    expect(await suite.db.select().from(menuPublications)).toEqual(beforePointers);
    expect(await suite.db.select().from(menuVersionImages)).toEqual(beforeImages);
    await withTransaction(suite.db, (tx) => publishMenu(tx, menuId, next.hash, "person-1"));
    expect(await suite.db.select().from(menuVersions)).toHaveLength(beforeVersions.length + 1);
    expect((await suite.db.select().from(menuVersionImages)).map((row) => row.filename)).toEqual(
      expect.arrayContaining([PRESENT, ABSENT]),
    );
  });

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

describe("an image a queued menu edition names", () => {
  const RENAMED = `${"c".repeat(64)}.jpg`;
  const HOUR = 60 * 60 * 1000;

  async function removeImage(filename: string): Promise<void> {
    await suite.db.execute(sql`delete from media_images where filename = ${filename}`);
  }
  async function renameImage(filename: string): Promise<void> {
    await suite.db.execute(
      sql`update media_images set filename = ${RENAMED} where filename = ${filename}`,
    );
  }
  async function filenames(): Promise<string[]> {
    const rows = await suite.db.execute<{ filename: string }>(
      sql`select filename from media_images order by filename`,
    );
    return rows.rows.map((row) => row.filename);
  }

  /**
   * Toast switches to `ABSENT`, the edition is queued to go live an hour after `at`, and the
   * product lets the photo go again, so only the queued edition names it.
   */
  async function queueWithAbsent(menuId: string, productId: string, at: Date): Promise<string> {
    return withTransaction(suite.db, async (tx) => {
      await updateProduct(tx, productId, { image: ABSENT });
      const { hash } = await previewMenu(tx, menuId);
      const { versionId } = await queueMenuPublication(
        tx,
        menuId,
        hash,
        new Date(at.getTime() + HOUR),
        "manager-ana",
        { at },
      );
      await updateProduct(tx, productId, { image: null });
      return versionId;
    });
  }

  /** "Lunch Menu" live with Toast showing `PRESENT`, and `ABSENT` in the library. */
  async function liveWithAbsentInLibrary(): Promise<{ menuId: string; productId: string }> {
    const ids = await publishedOnly();
    await suite.db.insert(mediaImages).values({ filename: ABSENT, names: { en: "New toast" } });
    return ids;
  }

  it("cannot be deleted or renamed while queued, and the live version still holds its own", async () => {
    const { menuId, productId } = await liveWithAbsentInLibrary();
    await queueWithAbsent(menuId, productId, new Date());
    await expect(removeImage(ABSENT)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    await expect(renameImage(ABSENT)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    await expect(removeImage(PRESENT)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    expect(await filenames()).toEqual([PRESENT, ABSENT]);
  });

  it("can be renamed and deleted once the queued edition is cancelled", async () => {
    const { menuId, productId } = await liveWithAbsentInLibrary();
    const versionId = await queueWithAbsent(menuId, productId, new Date());
    await withTransaction(suite.db, (tx) =>
      cancelMenuPublication(tx, menuId, versionId, "manager-luis"),
    );
    await renameImage(ABSENT);
    expect(await filenames()).toEqual([PRESENT, RENAMED]);
    await removeImage(RENAMED);
    expect(await filenames()).toEqual([PRESENT]);
  });

  it("is held through the pointer once activated, and the superseded version's photo is free", async () => {
    const { menuId, productId } = await liveWithAbsentInLibrary();
    const at = new Date();
    await queueWithAbsent(menuId, productId, at);
    const { activated } = await withTransaction(suite.db, (tx) =>
      activateDueMenuPublications(tx, new Date(at.getTime() + 2 * HOUR)),
    );
    expect(activated).toHaveLength(1);
    await expect(removeImage(ABSENT)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    await removeImage(PRESENT);
    expect(await filenames()).toEqual([ABSENT]);
  });

  it("is held while due but not yet marked activated", async () => {
    const { menuId, productId } = await liveWithAbsentInLibrary();
    const versionId = await queueWithAbsent(menuId, productId, new Date(Date.now() - 2 * HOUR));
    const [row] = await suite.db
      .select({ state: menuScheduledPublications.state })
      .from(menuScheduledPublications)
      .where(sql`${menuScheduledPublications.versionId} = ${versionId}`);
    expect(row).toEqual({ state: "queued" });
    await expect(removeImage(ABSENT)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    expect(await filenames()).toEqual([PRESENT, ABSENT]);
  });
});
