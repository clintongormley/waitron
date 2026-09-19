import { describe, expect, it } from "vitest";
import { withTransaction, CORE_MIGRATIONS } from "@waitron/db";
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
  listImageLabels,
  listImageTranslationGaps,
  listImages,
} from "./images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";

// PGlite exercises content persistence; the real-Postgres suite covers grants and races.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, MEDIA_MIGRATIONS],
});
const photo = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

describe("image library", () => {
  it("stores bytes with required default metadata and returns the same image for duplicate bytes", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      const first = await uploadImage(
        tx,
        {
          bytes: photo,
          names: { en: "Bread" },
          altText: { en: "A loaf on a plate" },
          labels: [" Food ", "food", "Summer"],
        },
        { fallbackLanguage: "es", maxUploadBytes: 100 },
      );
      expect(first.created).toBe(true);
      expect(first.image.filename).toMatch(/^[a-f0-9]{64}\.jpg$/);
      expect(first.image.labels).toEqual(["Food", "Summer"]);
      const duplicate = await uploadImage(
        tx,
        { bytes: photo, names: { en: "Other" }, altText: { en: "Other" }, labels: [] },
        { fallbackLanguage: "es", maxUploadBytes: 100 },
      );
      expect(duplicate).toEqual({ created: false, image: first.image });
      const stored = await readImageBytes(tx, first.image.filename);
      expect(stored?.bytes).toEqual(photo);
      expect(stored?.contentType).toBe("image/jpeg");
    });
  });
});

describe("metadata, labels and references", () => {
  it("requires a default name, keeps alt text optional, and rejects bad or oversize bytes", async () => {
    const good = { bytes: photo, names: { en: "Bread" }, altText: { en: "Loaf" }, labels: [] };
    const options = { fallbackLanguage: "en", maxUploadBytes: 100 };
    for (const [input, code] of [
      [{ ...good, names: { fr: "Pain" } }, "image.translation_required"],
      [{ ...good, labels: [" "] }, "image.invalid_metadata"],
      [{ ...good, names: { en: "a".repeat(201) } }, "image.invalid_metadata"],
      [{ ...good, altText: { en: "a".repeat(2001) } }, "image.invalid_metadata"],
      [{ ...good, bytes: new Uint8Array(101) }, "image.too_large"],
      [{ ...good, bytes: new Uint8Array([1, 2, 3]) }, "media.unsupported_type"],
    ] as const) {
      await expect(
        withTransaction(suite.db, (tx) => uploadImage(tx, input as typeof good, options)),
      ).rejects.toMatchObject({ code });
    }
    await withTransaction(suite.db, async (tx) => {
      // Alt text is optional: an upload with no alt text succeeds and stores an empty map.
      const { created, image } = await uploadImage(
        tx,
        { bytes: photo, names: { en: "Bread" }, altText: {}, labels: [] },
        options,
      );
      expect(created).toBe(true);
      expect(image.altText).toEqual({});
      expect(await listImageLabels(tx)).toEqual([]);
    });
  });

  it("derives labels from current assignments, edits metadata without changing bytes, and removes unused images", async () => {
    await withTransaction(suite.db, async (tx) => {
      const first = await uploadImage(
        tx,
        {
          bytes: photo,
          names: { en: "Bread" },
          altText: { en: "Loaf" },
          labels: ["Food", "Summer  menu"],
        },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
      const second = await uploadImage(
        tx,
        {
          bytes: new Uint8Array([...photo, 4]),
          names: { en: "Cake" },
          altText: { en: "Slice" },
          labels: ["Food"],
        },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
      expect(await listImageLabels(tx)).toEqual(["Food", "Summer menu"]);
      const edited = await updateImage(
        tx,
        first.image.id,
        { names: { en: "Sourdough", fr: "Pain" }, altText: { en: "A loaf" }, labels: ["Winter"] },
        "en",
      );
      expect(edited.filename).toBe(first.image.filename);
      expect(edited.names).toEqual({ en: "Sourdough", fr: "Pain" });
      expect(await listImageLabels(tx)).toEqual(["Food", "Winter"]);
      expect(await deleteImage(tx, second.image.id)).toEqual({ deleted: true, uses: [] });
      expect(await listImageLabels(tx)).toEqual(["Winter"]);
      expect(await readImageBytes(tx, second.image.filename)).toBeNull();
    });
  });

  it("shows active and inactive product uses and blocks deletion until every use is cleared", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        { bytes: photo, names: { en: "Bread" }, altText: { en: "Loaf" }, labels: [] },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
      const menu = await tx.execute<{ id: string }>(
        sql`insert into catalogues (name) values ('Lunch') returning id`,
      );
      const inserted = await tx.execute<{
        id: string;
      }>(
        sql`insert into products (catalogue_id, name, pricing_unit, unit_price, vat_class, image, active) values (${menu.rows[0]!.id}, 'Bread', 'each', '2.00', 'general', ${image.filename}, false) returning id`,
      );
      const uses = [
        {
          kind: "product",
          id: inserted.rows[0]!.id,
          catalogueId: menu.rows[0]!.id,
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
        { bytes: photo, names: { en: "Large loaf" }, altText: { en: "Loaf" }, labels: [] },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
      const menu = await tx.execute<{ id: string }>(
        sql`insert into catalogues (name) values ('Lunch') returning id`,
      );
      // The PRODUCT carries no photo; only its variant does, which is the case a product-only scan
      // misses — the variant photo would be deletable while the variant still points at it.
      const product = await tx.execute<{ id: string }>(
        sql`insert into products (catalogue_id, name, pricing_unit, unit_price, vat_class)
          values (${menu.rows[0]!.id}, 'Bread', 'each', '2.00', 'general') returning id`,
      );
      const variant = await tx.execute<{ id: string }>(
        sql`insert into product_variants (product_id, name, unit_price, image)
          values (${product.rows[0]!.id}, 'Large', '3.00', ${image.filename}) returning id`,
      );
      const uses = [
        {
          kind: "variant",
          id: variant.rows[0]!.id,
          productId: product.rows[0]!.id,
          catalogueId: menu.rows[0]!.id,
          // The product and variant staff names, joined by `staffPresentationName`.
          name: "Bread \u00b7 Large",
          active: true,
        },
      ];
      expect(await listImageUsages(tx, image.id)).toEqual(uses);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
      // The detail read and the list read must agree: the list's count is its own SQL, so a use the
      // scan finds but the count misses would show the library a free photo that refuses to delete.
      expect((await readImage(tx, image.id)).usageCount).toBe(1);
      expect((await listImages(tx, {})).images[0]!.usageCount).toBe(1);
      await tx.execute(sql`update product_variants set image = null`);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
    });
  });

  it("reports a missing name but not missing alt text as a translation gap", async () => {
    await withTransaction(suite.db, async (tx) => {
      // Alt text is optional, so an image named in French but without French alt text is complete;
      // only a missing name in the target language is a gap that blocks a default-language change.
      await uploadImage(
        tx,
        { bytes: photo, names: { en: "Bread", fr: "Pain" }, altText: {}, labels: [] },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
      const nameless = await uploadImage(
        tx,
        {
          bytes: new Uint8Array([...photo, 7]),
          names: { en: "Cake" },
          altText: { en: "Slice" },
          labels: [],
        },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
      expect(await listImageTranslationGaps(tx, "fr")).toEqual([
        { kind: "image", id: nameless.image.id },
      ]);
    });
  });
});

describe("search and sorting", () => {
  it("ranks name words above alt words, stems translations, searches labels and combines label filters", async () => {
    await withTransaction(suite.db, async (tx) => {
      const add = async (
        marker: number,
        names: Record<string, string>,
        altText: Record<string, string>,
        labels: string[],
      ) =>
        (
          await uploadImage(
            tx,
            { bytes: new Uint8Array([...photo, marker]), names, altText, labels },
            { fallbackLanguage: "en", maxUploadBytes: 100 },
          )
        ).image;
      const alt = await add(1, { en: "Bakery" }, { en: "Breads on a plate" }, ["Food"]);
      const name = await add(2, { en: "Bread", es: "Pan recién horneado" }, { en: "A loaf" }, [
        "Food",
        "Summer menu",
      ]);
      const label = await add(3, { en: "Cake" }, { en: "A slice" }, ["Sweet", "Summer menu"]);
      const spanish = await add(4, { en: "Pears", es: "Peras maduras" }, { en: "Fruit" }, [
        "Fruit",
      ]);
      expect((await listImages(tx, { query: "bread" })).images.map((row) => row.id)).toEqual([
        name.id,
        alt.id,
      ]);
      expect(
        (await listImages(tx, { query: "bread", label: " SUMMER MENU " })).images.map(
          (row) => row.id,
        ),
      ).toEqual([name.id]);
      expect(
        (await listImages(tx, { query: '"summer menu"', sort: "name", language: "en" })).images.map(
          (row) => row.id,
        ),
      ).toEqual([name.id, label.id]);
      expect((await listImages(tx, { query: "pera" })).images.map((row) => row.id)).toEqual([
        spanish.id,
      ]);
      expect(await listImages(tx, { query: "bre" })).toEqual({ images: [], total: 0 });
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
                bytes: new Uint8Array([...photo, n]),
                names: {
                  en: ["Zulu", "Alpha", "Bravo"][n]!,
                  ...(n === 0 ? { fr: "Aardvark" } : {}),
                },
                altText: { en: "Food" },
                labels: [],
              },
              { fallbackLanguage: "en", maxUploadBytes: 100 },
            )
          ).image,
        );
      for (let n = 0; n < 3; n++)
        await tx.execute(
          sql`update media_images set created_at = ${new Date(2026, 0, n + 1)} where id = ${added[n]!.id}`,
        );
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

describe("input boundaries", () => {
  it.each([
    { query: "x".repeat(501) },
    { label: "x".repeat(101) },
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
    {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: "image/png",
    },
    {
      bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      contentType: "image/webp",
    },
  ])("serves validated $contentType bytes", async ({ bytes, contentType }) => {
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        { bytes, names: { en: "Dish" }, altText: { en: "Plate" }, labels: [] },
        { maxUploadBytes: 100 },
      );
      expect(await readImageBytes(tx, image.filename)).toEqual({ bytes, contentType });
    });
  });

  it("rejects malformed translation maps and reuses label spelling across images", async () => {
    const input = {
      bytes: photo,
      names: { en: "Dish" },
      altText: { en: "Plate" },
      labels: ["Summer menu"],
    };
    for (const names of [null, [], { zz: "unknown" }, { en: "A", "en-GB": "B" }, { en: 42 }]) {
      await expect(
        withTransaction(suite.db, (tx) =>
          uploadImage(tx, { ...input, names } as typeof input, { maxUploadBytes: 100 }),
        ),
      ).rejects.toThrow();
    }
    await withTransaction(suite.db, async (tx) => {
      await uploadImage(tx, input, { maxUploadBytes: 100 });
      const { image } = await uploadImage(
        tx,
        { ...input, bytes: new Uint8Array([...photo, 9]), labels: ["SUMMER MENU"] },
        { maxUploadBytes: 100 },
      );
      expect(image.labels).toEqual(["Summer menu"]);
      expect(await listImageLabels(tx)).toEqual(["Summer menu"]);
    });
  });
});

it("keeps a name match above repeated alt-text matches when sorting by relevance", async () => {
  await withTransaction(suite.db, async (tx) => {
    const name = await uploadImage(
      tx,
      { bytes: photo, names: { en: "Bread" }, altText: { en: "Loaf" }, labels: [] },
      { maxUploadBytes: 100 },
    );
    const alt = await uploadImage(
      tx,
      {
        bytes: new Uint8Array([...photo, 2]),
        names: { en: "Bakery" },
        altText: { en: "bread ".repeat(100) },
        labels: [],
      },
      { maxUploadBytes: 100 },
    );
    expect((await listImages(tx, { query: "bread" })).images.map((image) => image.id)).toEqual([
      name.image.id,
      alt.image.id,
    ]);
  });
});

it("sorts by the default when the requested language was disabled while retaining its translations", async () => {
  await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr"] });
    const first = await uploadImage(
      tx,
      {
        bytes: photo,
        names: { fr: "Abricot", en: "Zebra" },
        altText: { fr: "Un abricot" },
        labels: [],
      },
      { maxUploadBytes: 100 },
    );
    const second = await uploadImage(
      tx,
      {
        bytes: new Uint8Array([...photo, 8]),
        names: { fr: "Poire", en: "Apple" },
        altText: { fr: "Une poire" },
        labels: [],
      },
      { maxUploadBytes: 100 },
    );
    const result = await listImages(tx, { sort: "name", language: "en" });
    expect(result.images.map((image) => image.id)).toEqual([first.image.id, second.image.id]);
    expect(result.images[0]!.names.en).toBe("Zebra");
  });
});

it.each([
  { language: "ca", plural: "formatges", singular: "formatge" },
  { language: "eu", plural: "etxeak", singular: "etxe" },
])(
  "matches $language word forms rather than requiring an exact token",
  async ({ language, plural, singular }) => {
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        {
          bytes: photo,
          names: { en: "Photograph", [language]: plural },
          altText: { en: "A photograph" },
          labels: [],
        },
        { maxUploadBytes: 100 },
      );
      const exactToken = await tx.execute<{ matched: boolean }>(
        sql`select to_tsvector('pg_catalog.simple', ${plural}) @@ plainto_tsquery('pg_catalog.simple', ${singular}) as matched`,
      );
      expect(exactToken.rows).toEqual([{ matched: false }]);
      expect((await listImages(tx, { query: singular })).images.map((row) => row.id)).toEqual([
        image.id,
      ]);
    });
  },
);

it("maps the bundled PostgreSQL stemmers and keeps unknown dictionary languages on simple tokens", async () => {
  const mapped = await suite.db.execute<{ name: string }>(sql`
    select distinct cfgname::text as name from pg_ts_config
    where oid in (select public.media_text_config(language) from unnest(array[
      'ar','hy','eu','ca','da','nl','en','et','fi','fr','de','el','hi','hu','id','ga','it',
      'lt','ne','no','pt','ro','ru','sr','es','sv','ta','tr','yi','ja'
    ]) language) order by name
  `);
  const bundled = await suite.db.execute<{ name: string }>(
    sql`select cfgname::text as name from pg_ts_config where cfgnamespace = 'pg_catalog'::regnamespace order by name`,
  );
  expect(mapped.rows).toEqual(bundled.rows);
  const norwegian = await suite.db.execute<{ same: boolean }>(
    sql`select public.media_text_config('no') = public.media_text_config('nb') and public.media_text_config('no') = public.media_text_config('nn') as same`,
  );
  expect(norwegian.rows).toEqual([{ same: true }]);
});

it("protects an image used only by a category and releases it after clearing the reference", async () => {
  const { createCategory, updateCategory } = await import("@waitron/catalogue");
  await seedTenant(suite.db);
  await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(
      tx,
      { bytes: photo, names: { en: "Food" }, altText: { en: "Food on a plate" }, labels: [] },
      { maxUploadBytes: 100 },
    );
    const category = await createCategory(tx, {
      name: { en: "Food" },
      image: image.filename,
    });
    const menu = await tx.execute<{ id: string }>(sql`
      insert into catalogues (name) values ('Lunch') returning id
    `);
    const product = await tx.execute<{ id: string }>(sql`
      insert into products (catalogue_id, name, pricing_unit, unit_price, vat_class, image) values (${menu.rows[0]!.id}, 'Bread', 'each', 2, 'general', ${image.filename})
      returning id
    `);
    const uses = [
      {
        kind: "product" as const,
        id: product.rows[0]!.id,
        catalogueId: menu.rows[0]!.id,
        name: "Bread",
        active: true,
      },
      { kind: "category" as const, id: category.id, names: category.name },
    ];
    expect(await listImageUsages(tx, image.id)).toEqual(uses);
    expect((await readImage(tx, image.id)).usageCount).toBe(2);
    expect((await listImages(tx, {})).images[0]!.usageCount).toBe(2);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: false, uses });
    await updateCategory(tx, category.id, { image: null });
    await tx.execute(sql`update products set image = null where id = ${product.rows[0]!.id}`);
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
  });
});
