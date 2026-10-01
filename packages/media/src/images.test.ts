import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  withTransaction,
  CORE_MIGRATIONS,
  catalogues,
  products,
  type Transaction,
} from "@waitron/db";
import { CATALOGUE_MIGRATIONS, writeContentLanguages } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import {
  uploadImage,
  readImageBytes,
  updateImage,
  deleteImage,
  readImage,
  listImageUsages,
  listImageTranslationGaps,
  listImages,
} from "./images.js";
import { datedImagePageQuery } from "./image-page-query.js";
import { mediaImageData, mediaImages } from "./schema/images.js";
import type { PreparedImage } from "./prepare.js";
import { samplePreparedImage } from "./testing/sample-image.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, MEDIA_MIGRATIONS],
});
/** A photo ready to store. A different width is a different photo (`testing/sample-image.ts`). */
const prepare = (width: number): Promise<PreparedImage> => samplePreparedImage({ width });
const photo = await prepare(8);

describe("image library", () => {
  it("does not read the same image row again when counting its uses", async () => {
    await withTransaction(suite.db, async (tx) => {
      const image = await uploadImage(
        tx,
        { image: photo, names: { en: "Bread" } },
        { fallbackLanguage: "en" },
      );
      const selects = vi.spyOn(tx, "select");
      expect((await readImage(tx, image.image.id)).usageCount).toBe(0);
      expect(selects).toHaveBeenCalledTimes(4);
      selects.mockRestore();
    });
  });

  it("stores a prepared photo with required default metadata and reuses it for a repeat upload", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      const first = await uploadImage(
        tx,
        {
          image: photo,
          names: { en: "Bread" },
        },
        { fallbackLanguage: "es" },
      );
      expect(first.created).toBe(true);
      expect(first.image.filename).toBe(photo.filename);
      expect(first.image.filename).toMatch(/^[a-f0-9]{64}\.webp$/);
      // Prepared again from the same upload, not the same object: the reuse rests on prepareImage
      // giving identical bytes for identical input.
      const duplicate = await uploadImage(
        tx,
        { image: await prepare(8), names: { en: "Other" } },
        { fallbackLanguage: "es" },
      );
      expect(duplicate).toEqual({ created: false, image: first.image });
      const stored = await readImageBytes(tx, first.image.filename);
      expect(stored?.bytes).toEqual(photo.bytes);
      expect(stored?.contentType).toBe("image/webp");
    });
  });
});

describe("unknown images and other refusals", () => {
  it("refuses an id that names no image when reading it, listing its uses or deleting it", async () => {
    const imageId = crypto.randomUUID();
    for (const call of [
      (tx: Transaction): Promise<unknown> => readImage(tx, imageId),
      (tx: Transaction) => listImageUsages(tx, imageId),
      (tx: Transaction) => deleteImage(tx, imageId),
    ]) {
      await expect(withTransaction(suite.db, call)).rejects.toMatchObject({
        code: "image.not_found",
        params: { imageId },
      });
    }
  });

  it("reports an edit to an unknown id as not found, ahead of any fault in the edit itself", async () => {
    const imageId = crypto.randomUUID();
    for (const names of [{ en: "Bread" }, { fr: "Pain" }] as Record<string, string>[]) {
      await expect(
        withTransaction(suite.db, (tx) => updateImage(tx, imageId, { names }, "en")),
      ).rejects.toMatchObject({ code: "image.not_found", params: { imageId } });
    }
  });

  it("passes a database failure during the translation check through unchanged", async () => {
    // Every malformed map is refused before the translation check, so a database failure is what
    // reaches its re-throw. The table is dropped inside the transaction, which rolls it back.
    await expect(
      withTransaction(suite.db, async (tx) => {
        await tx.execute(sql`drop table content_languages`);
        return uploadImage(tx, { image: photo, names: { en: "Bread" } });
      }),
    ).rejects.toThrow("no such table: content_languages");
  });
});

describe("metadata and references", () => {
  it("requires a default name", async () => {
    const good = { image: photo, names: { en: "Bread" } };
    const options = { fallbackLanguage: "en" };
    for (const [input, code] of [
      [{ ...good, names: { fr: "Pain" } }, "image.translation_required"],
      [{ ...good, names: { en: "a".repeat(201) } }, "image.invalid_metadata"],
    ] as const) {
      await expect(
        withTransaction(suite.db, (tx) => uploadImage(tx, input as typeof good, options)),
      ).rejects.toMatchObject({ code });
    }
  });

  it("edits metadata without changing bytes, and removes unused images", async () => {
    await withTransaction(suite.db, async (tx) => {
      const first = await uploadImage(
        tx,
        {
          image: photo,
          names: { en: "Bread" },
        },
        { fallbackLanguage: "en" },
      );
      const second = await uploadImage(
        tx,
        {
          image: await prepare(13),
          names: { en: "Cake" },
        },
        { fallbackLanguage: "en" },
      );
      const edited = await updateImage(
        tx,
        first.image.id,
        { names: { en: "Sourdough", fr: "Pain" } },
        "en",
      );
      expect(edited.filename).toBe(first.image.filename);
      expect(edited.names).toEqual({ en: "Sourdough", fr: "Pain" });
      expect(await deleteImage(tx, second.image.id)).toEqual({ deleted: true, uses: [] });
      expect(await readImageBytes(tx, second.image.filename)).toBeNull();
    });
  });

  it("shows active and inactive product uses and blocks deletion until every use is cleared", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        { image: photo, names: { en: "Bread" } },
        { fallbackLanguage: "en" },
      );
      // Through the table definitions, not raw SQL: `id`, `created_at` and `updated_at` are
      // JavaScript generators (`$defaultFn`), never a column DEFAULT, so a raw insert that names
      // neither is refused with `NOT NULL constraint failed`.
      const [menu] = await tx.insert(catalogues).values({ name: "Lunch" }).returning({
        id: catalogues.id,
      });
      // `unit_price` counts whole cents, so 200 is the 2.00 this fixture means.
      const [inserted] = await tx
        .insert(products)
        .values({
          catalogueId: menu!.id,
          name: "Bread",
          pricingUnit: "each",
          unitPrice: 200,
          vatClass: "general",
          image: image.filename,
          active: false,
        })
        .returning({ id: products.id });
      const uses = [
        {
          kind: "product",
          id: inserted!.id,
          catalogueId: menu!.id,
          name: "Bread",
          active: false,
        },
      ];
      expect(await listImageUsages(tx, image.id)).toEqual(uses);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
      expect((await readImage(tx, image.id)).usageCount).toBe(1);
      await tx.execute(sql`update products set image = null`);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
    });
  });

  it("blocks deletion of a photo a product VARIANT uses, and releases it when cleared", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        { image: photo, names: { en: "Large loaf" } },
        { fallbackLanguage: "en" },
      );
      const [menu] = await tx.insert(catalogues).values({ name: "Lunch" }).returning({
        id: catalogues.id,
      });
      // The PRODUCT carries no photo; only its variant does, which is the case a product-only scan
      // misses — the variant photo would be deletable while the variant still points at it.
      const [product] = await tx
        .insert(products)
        .values({
          catalogueId: menu!.id,
          name: "Bread",
          pricingUnit: "each",
          unitPrice: 200,
          vatClass: "general",
        })
        .returning({ id: products.id });
      // A variant is a `products` row with a `parent_id`.
      const [variant] = await tx
        .insert(products)
        .values({
          catalogueId: menu!.id,
          parentId: product!.id,
          name: "Large",
          unitPrice: 300,
          image: image.filename,
        })
        .returning({ id: products.id });
      const uses = [
        {
          kind: "variant",
          id: variant!.id,
          productId: product!.id,
          catalogueId: menu!.id,
          // The variant's own staff name, which is how `staffPresentationName` names a variant.
          name: "Large",
          active: true,
        },
      ];
      expect(await listImageUsages(tx, image.id)).toEqual(uses);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
      // The detail read and the list read must agree: the list's count is its own SQL, so a use the
      // scan finds but the count misses would show the library a free photo that refuses to delete.
      expect((await readImage(tx, image.id)).usageCount).toBe(1);
      expect((await listImages(tx, {})).images[0]!.usageCount).toBe(1);
      await tx.execute(sql`update products set image = null where id = ${variant!.id}`);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
    });
  });

  it("counts no use for a variant that shows its parent's photo", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        { image: photo, names: { en: "Loaf" } },
        { fallbackLanguage: "en" },
      );
      const [menu] = await tx.insert(catalogues).values({ name: "Lunch" }).returning({
        id: catalogues.id,
      });
      const [product] = await tx
        .insert(products)
        .values({
          catalogueId: menu!.id,
          name: "Bread",
          pricingUnit: "each",
          unitPrice: 200,
          vatClass: "general",
          image: image.filename,
        })
        .returning({ id: products.id });
      // No photo of its own: it borrows the parent's, which is the parent's use, not its own.
      await tx
        .insert(products)
        .values({ catalogueId: menu!.id, parentId: product!.id, name: "Large", unitPrice: 300 });
      const uses = [
        { kind: "product", id: product!.id, catalogueId: menu!.id, name: "Bread", active: true },
      ];
      expect(await listImageUsages(tx, image.id)).toEqual(uses);
      expect((await readImage(tx, image.id)).usageCount).toBe(1);
      expect((await listImages(tx, {})).images[0]!.usageCount).toBe(1);
    });
  });

  it("reports a variant inactive when it is removed or its product is Inactive", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        { image: photo, names: { en: "Loaf" } },
        { fallbackLanguage: "en" },
      );
      const [menu] = await tx.insert(catalogues).values({ name: "Lunch" }).returning({
        id: catalogues.id,
      });
      const catalogueId = menu!.id;
      const top = { catalogueId, pricingUnit: "each", unitPrice: 200, vatClass: "general" };
      await tx.insert(products).values([
        { ...top, id: "p-on", name: "Bread", image: image.filename },
        { ...top, id: "p-off", name: "Cake", active: false },
      ]);
      // Every variant id sorts BEFORE its product's, so the products-first order is the reader's.
      await tx.insert(products).values([
        { catalogueId, id: "a-kept", parentId: "p-on", name: "Large", image: image.filename },
        {
          catalogueId,
          id: "a-of-inactive",
          parentId: "p-off",
          name: "Slice",
          image: image.filename,
        },
        {
          catalogueId,
          id: "a-removed",
          parentId: "p-on",
          name: "Small",
          active: false,
          image: image.filename,
        },
      ]);
      const variant = (id: string, productId: string, name: string, active: boolean) => ({
        kind: "variant",
        id,
        productId,
        catalogueId,
        name,
        active,
      });
      expect(await listImageUsages(tx, image.id)).toEqual([
        { kind: "product", id: "p-on", catalogueId, name: "Bread", active: true },
        variant("a-kept", "p-on", "Large", true),
        variant("a-of-inactive", "p-off", "Slice", false),
        variant("a-removed", "p-on", "Small", false),
      ]);
    });
  });

  it("reports a missing name as a translation gap", async () => {
    await withTransaction(suite.db, async (tx) => {
      await uploadImage(
        tx,
        { image: photo, names: { en: "Bread", fr: "Pain" } },
        { fallbackLanguage: "en" },
      );
      const nameless = await uploadImage(
        tx,
        {
          image: await prepare(16),
          names: { en: "Cake" },
        },
        { fallbackLanguage: "en" },
      );
      expect(await listImageTranslationGaps(tx, "fr")).toEqual([
        { kind: "image", id: nameless.image.id },
      ]);
    });
  });
});

describe("search and sorting", () => {
  it("pages a date-sorted library list in SQL", async () => {
    await withTransaction(suite.db, async (tx) => {
      const added = [];
      for (const index of [0, 1, 2, 3]) {
        added.push(
          (
            await uploadImage(
              tx,
              {
                image: await prepare(180 + index),
                names: { en: `Photo ${index}` },
              },
              { fallbackLanguage: "en" },
            )
          ).image,
        );
        await tx
          .update(mediaImages)
          .set({ createdAt: new Date(2026, 0, index + 1) })
          .where(eq(mediaImages.id, added[index]!.id));
      }
      const result = await listImages(tx, {
        sort: "date",
        direction: "desc",
        offset: 1,
        limit: 1,
      });
      expect(result.total).toBe(4);
      expect(result.images.map((image) => image.id)).toEqual([added[2]!.id]);

      const statement = datedImagePageQuery(tx, "desc", 1, 1).toSQL();
      expect(statement.sql).toMatch(/order by .*created_at.*desc.*id.*asc/);
      expect(statement.sql).toMatch(/limit \? offset \?/);
      expect(statement.params).toEqual([1, 1]);
      const ascending = datedImagePageQuery(tx, "asc", 2, 3).toSQL();
      expect(ascending.sql).toMatch(/order by .*created_at.*asc.*id.*asc/);
      expect(ascending.params).toEqual([3, 2]);
    });
  });

  it("matches a finished word whole, and treats a query as text", async () => {
    await withTransaction(suite.db, async (tx) => {
      await uploadImage(tx, { image: photo, names: { en: "Bread" } }, { fallbackLanguage: "en" });
      expect(await listImages(tx, { query: "bre " })).toEqual({ images: [], total: 0 });
      expect((await listImages(tx, { query: "'; drop table products; --" })).total).toBe(0);
    });
  });

  it("sorts by name using the requested translation then site default, date in either direction and stable pages", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      const added = [];
      for (let n = 0; n < 3; n++)
        added.push(
          (
            await uploadImage(
              tx,
              {
                image: await prepare(9 + n),
                names: {
                  en: ["Zulu", "Alpha", "Bravo"][n]!,
                  ...(n === 0 ? { fr: "Aardvark" } : {}),
                },
              },
              { fallbackLanguage: "en" },
            )
          ).image,
        );
      // Through the table, so the `ts` column's own mapping writes the ISO string: a raw
      // `tx.execute` with a `Date` as its first bound value wrote nothing and raised nothing, which
      // left the date ordering below to the id tiebreak.
      for (let n = 0; n < 3; n++)
        await tx
          .update(mediaImages)
          .set({ createdAt: new Date(2026, 0, n + 1) })
          .where(eq(mediaImages.id, added[n]!.id));
      const ids = (result: Awaited<ReturnType<typeof listImages>>) =>
        result.images.map((image) => image.id);
      expect(ids(await listImages(tx))).toEqual([added[2]!.id, added[1]!.id, added[0]!.id]);
      expect(ids(await listImages(tx, { sort: "date", direction: "asc" }))).toEqual(
        added.map((image) => image.id),
      );
      expect(ids(await listImages(tx, { sort: "name", language: "de" }))).toEqual([
        added[1]!.id,
        added[2]!.id,
        added[0]!.id,
      ]);
      expect(
        ids(await listImages(tx, { sort: "name", language: "de", direction: "desc" })),
      ).toEqual([added[0]!.id, added[2]!.id, added[1]!.id]);
      expect(ids(await listImages(tx, { sort: "name", language: "fr" }))).toEqual(
        added.map((image) => image.id),
      );
      const first = await listImages(tx, { limit: 2 });
      const second = await listImages(tx, { offset: 2, limit: 2 });
      expect(first.total).toBe(3);
      expect(second.total).toBe(3);
      expect([...ids(first), ...ids(second)]).toEqual(ids(await listImages(tx)));
      expect(first.images[0]).not.toHaveProperty("bytes");
      expect(await listImages(tx, { offset: 9 })).toEqual({ images: [], total: 3 });
    });
  });
});

describe("a word still being typed", () => {
  const NAMES = [
    "Chicken",
    "Grilled chicken",
    "Chicken wings",
    "Chicken, grilled",
    "Chi tea",
    "Pan-fried fish",
  ];
  const found = async (tx: Transaction, query: string): Promise<string[]> =>
    (await listImages(tx, { query, limit: 100, fallbackLanguage: "en" })).images
      .map((image) => image.names.en!)
      .sort();

  it.each<[string, string[]]>([
    ["chick", ["Chicken", "Chicken wings", "Chicken, grilled", "Grilled chicken"]],
    // A space, a closing quote or punctuation after the last word finishes it.
    ["chick ", []],
    ["chick,", []],
    ['"chick"', []],
    // Only the LAST word is a prefix.
    ["chi wings", []],
    ["wings chi", ["Chicken wings"]],
    // An exclusion is always a whole word: "-chi" hides "Chi tea" and nothing that starts with chi.
    ["-chi", ["Chicken", "Chicken wings", "Chicken, grilled", "Grilled chicken", "Pan-fried fish"]],
    // An unclosed quote is a phrase still being typed: its words stay together and its last word
    // is a prefix, so "Chicken, grilled" — both words, the other way round — is not found.
    ['"grilled chi', ["Grilled chicken"]],
    ['"grilled chi"', []],
    ['"grill chi', []],
    // A word with punctuation inside is a phrase of its parts, and its last part is the prefix.
    ["pan-fr", ["Pan-fried fish"]],
  ])("answers %j with %j", async (query, expected) => {
    await withTransaction(suite.db, async (tx) => {
      for (const [index, name] of NAMES.entries())
        await uploadImage(
          tx,
          { image: await prepare(300 + index), names: { en: name } },
          { fallbackLanguage: "en" },
        );
      expect(await found(tx, query)).toEqual(expected);
    });
  });

  it("ranks a whole-word match above a match on the start of a longer word", async () => {
    const low = "00000000-0000-4000-8000-000000000001";
    const high = "00000000-0000-4000-8000-000000000002";
    await withTransaction(suite.db, async (tx) => {
      // The id tie-break alone would list the prefix-only match, which has the lower id, first.
      for (const [id, filename, name] of [
        [low, `${"b".repeat(64)}.webp`, "Chicken"],
        [high, `${"c".repeat(64)}.webp`, "Chick peas"],
      ] as const) {
        await tx.insert(mediaImages).values({ id, filename, names: { en: name } });
      }
      const ids = async (query: string) =>
        (await listImages(tx, { query, fallbackLanguage: "en" })).images.map((image) => image.id);
      expect(await ids("chick")).toEqual([high, low]);
      // With the whole word in both, the tie-break decides again.
      expect(await ids("chick OR chicken")).toEqual([low, high]);
    });
  });
});

describe("input boundaries", () => {
  it.each([
    { query: "x".repeat(501) },
    { offset: -1 },
    { offset: 0.5 },
    { limit: 0 },
    { limit: 101 },
    { limit: NaN },
    { sort: "random" },
    { direction: "sideways" },
  ])("rejects invalid search options %j", async (options) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        listImages(tx, options as Parameters<typeof listImages>[1]),
      ),
    ).rejects.toMatchObject({ code: "image.invalid_query" });
  });

  it.each([
    { extension: "jpg", contentType: "image/jpeg" },
    { extension: "png", contentType: "image/png" },
    { extension: "webp", contentType: "image/webp" },
  ])("serves a stored .$extension row as $contentType", async ({ extension, contentType }) => {
    // Uploads store WebP only; .jpg and .png rows still arrive through configuration transfer,
    // which copies a bundle's bytes unchanged.
    const bytes = new Uint8Array([1, 2, 3]);
    const filename = `${"a".repeat(64)}.${extension}`;
    await withTransaction(suite.db, async (tx) => {
      const [row] = await tx
        .insert(mediaImages)
        .values({ filename, names: { en: "Dish" } })
        .returning({ id: mediaImages.id });
      await tx.insert(mediaImageData).values({ imageId: row!.id, bytes });
      expect(await readImageBytes(tx, filename)).toEqual({ bytes, contentType });
    });
  });

  it("rejects malformed translation maps", async () => {
    const input = { image: photo, names: { en: "Dish" } };
    for (const names of [null, [], { zz: "unknown" }, { en: "A", "en-GB": "B" }, { en: 42 }]) {
      await expect(
        withTransaction(suite.db, (tx) => uploadImage(tx, { ...input, names } as typeof input, {})),
      ).rejects.toThrow();
    }
  });
});

it("sorts accented names alphabetically in both directions across pages", async () => {
  // `Éclair` sorts between `Bread` and `Zest`; under a code-point comparison the lowercased
  // `éclair` (U+00E9) would sort after `zest`.
  await withTransaction(suite.db, async (tx) => {
    for (const [index, name] of ["Zest", "Éclair", "Apple", "Bread"].entries()) {
      await uploadImage(
        tx,
        {
          image: await prepare(109 + index),
          names: { en: name },
        },
        { fallbackLanguage: "en" },
      );
    }
    for (const direction of ["asc", "desc"] as const) {
      const query = {
        sort: "name" as const,
        direction,
        limit: 2,
        fallbackLanguage: "en",
      };
      const first = await listImages(tx, query);
      const second = await listImages(tx, { ...query, offset: 2 });
      expect(first.total).toBe(4);
      const expected = ["Apple", "Bread", "Éclair", "Zest"];
      expect([...first.images, ...second.images].map((image) => image.names.en)).toEqual(
        direction === "asc" ? expected : expected.reverse(),
      );
    }
  });
});

it("sorts by the default when the requested language was disabled while retaining its translations", async () => {
  await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr"] });
    const first = await uploadImage(
      tx,
      {
        image: photo,
        names: { fr: "Abricot", en: "Zebra" },
      },
      {},
    );
    const second = await uploadImage(
      tx,
      {
        image: await prepare(17),
        names: { fr: "Poire", en: "Apple" },
      },
      {},
    );
    const result = await listImages(tx, { sort: "name", language: "en" });
    expect(result.images.map((image) => image.id)).toEqual([first.image.id, second.image.id]);
    expect(result.images[0]!.names.en).toBe("Zebra");
  });
});

it("protects an image used by sections, a menu's own list among them, and counts each use", async () => {
  const { createSection, updateSection, sections } = await import("@waitron/catalogue");
  await seedTenant(suite.db);
  await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(tx, { image: photo, names: { en: "Drinks" } }, {});
    const drinks = await createSection(tx, {
      internalName: "Drinks (internal)",
      names: { en: "Drinks (customer)" },
      image: image.filename,
    });
    const [menu] = await tx.insert(catalogues).values({ name: "Lunch" }).returning({
      id: catalogues.id,
    });
    const [root] = await tx
      .insert(sections)
      .values({
        internalName: "Lunch root",
        role: "menu_root",
        ownerMenuId: menu!.id,
        image: image.filename,
      })
      .returning({ id: sections.id });
    const uses = [
      { kind: "section" as const, id: drinks.id, internalName: "Drinks (internal)" },
      { kind: "section" as const, id: root!.id, internalName: "Lunch root" },
    ].sort((a, b) => a.id.localeCompare(b.id));
    expect(await listImageUsages(tx, image.id)).toEqual(uses);
    expect((await readImage(tx, image.id)).usageCount).toBe(2);
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(2);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    await updateSection(tx, drinks.id, { image: null });
    await tx.update(sections).set({ image: null }).where(eq(sections.id, root!.id));
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
  });
});

it("protects an image only a live menu version names, and releases it once another version is live", async () => {
  const {
    addMember,
    createCatalogue,
    createProduct,
    previewMenu,
    publishMenu,
    readMenuStructure,
    updateProduct,
  } = await import("@waitron/catalogue");
  await seedTenant(suite.db);
  const publish = async (tx: Transaction, menuId: string) =>
    publishMenu(tx, menuId, (await previewMenu(tx, menuId)).hash, "person-1");
  await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(tx, { image: photo, names: { en: "Lemonade" } }, {});
    const menu = await createCatalogue(tx, { name: "Lunch Menu" });
    const lemonade = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Lemonade",
      pricingUnit: "each",
      unitPrice: "3.00",
      vatClass: "reduced",
      image: image.filename,
    });
    const { rootSectionId } = await readMenuStructure(tx, menu.id);
    await addMember(tx, rootSectionId, { kind: "product", productId: lemonade.id });
    const first = await publish(tx, menu.id);
    // The working state lets go; the live version still shows the photo.
    await updateProduct(tx, lemonade.id, { image: null });
    const uses = [
      {
        kind: "menu_version" as const,
        id: first.versionId,
        menuId: menu.id,
        menuName: "Lunch Menu",
        number: 1,
      },
    ];
    expect(await listImageUsages(tx, image.id)).toEqual(uses);
    expect((await readImage(tx, image.id)).usageCount).toBe(1);
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(1);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    await publish(tx, menu.id);
    expect(await listImageUsages(tx, image.id)).toEqual([]);
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(0);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
  });
});

it("protects the photo of a product a live menu version offers only as an extra", async () => {
  const {
    addMember,
    createCatalogue,
    createExtraList,
    createProduct,
    menuItems,
    previewMenu,
    publishMenu,
    readMenuStructure,
    setMenuItemExtraLists,
    updateProduct,
    writeProductModifiers,
  } = await import("@waitron/catalogue");
  await seedTenant(suite.db);
  const publish = async (tx: Transaction, menuId: string) =>
    publishMenu(tx, menuId, (await previewMenu(tx, menuId)).hash, "person-1");
  await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(tx, { image: photo, names: { en: "Lemon" } }, {});
    const menu = await createCatalogue(tx, { name: "Lunch Menu" });
    const make = (name: string, photoName: string | null) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "reduced",
        ...(photoName === null ? {} : { image: photoName }),
      });
    const lemonade = await make("Lemonade", null);
    const lemon = await make("Extra lemon", image.filename);
    const list = await createExtraList(
      tx,
      { name: "Extras", minPicks: 0, maxPicks: 1, items: [{ productId: lemon.id, price: "0.40" }] },
      "en",
    );
    await writeProductModifiers(tx, lemonade.id, [{ kind: "extras", id: list.id }]);
    const { rootSectionId } = await readMenuStructure(tx, menu.id);
    await addMember(tx, rootSectionId, { kind: "product", productId: lemonade.id });
    const [offer] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.productId, lemonade.id));
    await setMenuItemExtraLists(tx, offer!.id, [{ listId: list.id, items: [] }]);
    const first = await publish(tx, menu.id);
    // The working state lets go; the live version still shows the photo.
    await updateProduct(tx, lemon.id, { image: null });
    const uses = [
      {
        kind: "menu_version" as const,
        id: first.versionId,
        menuId: menu.id,
        menuName: "Lunch Menu",
        number: 1,
      },
    ];
    expect(await listImageUsages(tx, image.id)).toEqual(uses);
    expect((await readImage(tx, image.id)).usageCount).toBe(1);
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(1);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    await publish(tx, menu.id);
    expect(await listImageUsages(tx, image.id)).toEqual([]);
    expect((await readImage(tx, image.id)).usageCount).toBe(0);
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(0);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
  });
});

describe("relevance scores and tie-breaks", () => {
  const add = async (tx: Transaction, width: number, names: Record<string, string>) =>
    uploadImage(tx, { image: await prepare(width), names }, {});
  const ids = async (tx: Transaction, options: Parameters<typeof listImages>[1]) =>
    (await listImages(tx, options)).images.map((image) => image.id);

  it("scores an image by its best-matching OR group, not its first or last", async () => {
    await withTransaction(suite.db, async (tx) => {
      // Groups score 1, 3, no match and 1.
      const best = await add(tx, 200, { en: "Rye bread toast crust seed" });
      // Only the third group matches, at 2.
      const single = await add(tx, 201, { en: "Oat flax" });
      expect(await ids(tx, { query: "crust OR rye bread toast OR oat flax OR seed" })).toEqual([
        best.image.id,
        single.image.id,
      ]);
    });
  });

  it("breaks a name or date tie by ascending id in both directions", async () => {
    const low = "00000000-0000-4000-8000-000000000001";
    const high = "00000000-0000-4000-8000-000000000002";
    const createdAt = new Date(2026, 0, 1);
    await withTransaction(suite.db, async (tx) => {
      // The higher id is stored first, so storage order alone would list it first.
      for (const [id, filename] of [
        [high, `${"b".repeat(64)}.webp`],
        [low, `${"c".repeat(64)}.webp`],
      ] as const) {
        await tx.insert(mediaImages).values({ id, filename, names: { en: "Bread" }, createdAt });
      }
      for (const sort of ["name", "date"] as const) {
        for (const direction of ["asc", "desc"] as const) {
          expect(await ids(tx, { sort, direction })).toEqual([low, high]);
        }
      }
    });
  });

  it("sorts an image with no name in the listing's default language as an empty name", async () => {
    await withTransaction(suite.db, async (tx) => {
      // No stored language settings, so each call's fallback is the default it validates against.
      const english = await uploadImage(
        tx,
        { image: await prepare(200), names: { en: "Bread" } },
        { fallbackLanguage: "en" },
      );
      const french = await uploadImage(
        tx,
        { image: await prepare(201), names: { fr: "Abricot" } },
        { fallbackLanguage: "fr" },
      );
      const options = { sort: "name", fallbackLanguage: "fr" } as const;
      expect(await ids(tx, { ...options, direction: "asc" })).toEqual([
        english.image.id,
        french.image.id,
      ]);
      expect(await ids(tx, { ...options, direction: "desc" })).toEqual([
        french.image.id,
        english.image.id,
      ]);
    });
  });
});
