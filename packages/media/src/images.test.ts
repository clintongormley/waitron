import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTransaction, CORE_MIGRATIONS, catalogues, products } from "@waitron/db";
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
import { mediaImages } from "./schema/images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";

// One real migrated SQLite venue database, carrying the core, catalogue and media sets. There is no
// second target, and no grant or race coverage anywhere: the suite that held those was
// `images.pg.test.ts`, deleted with the PostgreSQL harness — `image-data.test.ts`'s header lists
// exactly what went with it and which parts have counterparts.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, MEDIA_MIGRATIONS],
});
const photo = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

// WHAT THE STORAGE SWITCH TOOK OUT OF THIS FILE.
//
// ONE CASE IS GONE. "maps the bundled PostgreSQL stemmers and keeps unknown dictionary languages on
// simple tokens" held that `media_text_config(language)` returned a real text-search configuration
// for each of thirty languages, that the set it could return was exactly PostgreSQL's bundled list,
// and that `no`, `nb` and `nn` all resolved to the same one. It asked `pg_ts_config` — a PostgreSQL
// catalogue — about a stored SQL function, and neither survives: `grep -rn "media_text_config"
// packages/media` finds no definition, and `packages/media/drizzle/*.sql` creates no function at
// all. Nothing holds the property now, and nothing needs to: there is no language-to-dictionary
// mapping left to get wrong, because there are no dictionaries. Recover the case with
// `git show aabdde6a8^:packages/media/src/images.test.ts` if the engine ever regains them.
//
// STEMMING IS GONE, AND WITH IT THREE MORE CASES. The "matches 'ca'/'eu' word forms" pair is
// deleted outright, and two assertions are deleted from the search case below (the `bread` query
// expecting the alt-text row "Breads on a plate" to rank second, and the `pera` query expecting the
// Spanish name "Peras maduras"). PostgreSQL ran each translation through the snowball dictionary for
// its own language — `media_text_config` mapped thirty language codes, Basque and Catalan among
// them — so a singular found a plural in any of them. `listImages` now matches whole lowercased
// tokens in JavaScript (`packages/media/src/images.ts`, `searchTokens`), so a plural in the text is
// found only by that plural. The `ca`/`eu` pair could not have been narrowed in any case: its
// control was `to_tsvector`/`plainto_tsquery`, PostgreSQL statements with no SQLite spelling.
//
// WHAT WOULD RECOVER IT, so the next reader does not re-derive it: this SQLite does ship one
// stemmer. `select sqlite_compileoption_used('ENABLE_FTS5')` returns 1 on the bundled SQLite
// 3.53.4 under node v26.7.0, and an FTS5 table tokenized `porter unicode61` stems `Breads`→`bread`,
// `Peras`→`pera` and `formatges`→`formatge` — measured 2026-09-22, reading the stored terms back
// through `fts5vocab`. It is the ENGLISH porter algorithm, so the Spanish and Catalan hits are its
// `-s`/`-es` rule landing by luck, not per-language stemming; the Basque `etxeak`→`etxe` of the
// deleted `eu` case it does NOT make (measured the same way: `etxeak` stores as `etxeak`, the query
// `etxe` stems to `etx`, and the match is false). Taking it would mean an FTS5 virtual table and
// triggers to keep it in step, which is a migration change and a product decision about search
// quality, not a conversion. Recover any deleted case with
// `git show aabdde6a8^:packages/media/src/images.test.ts`.

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
      // Through the table definitions, not raw SQL: `id`, `created_at` and `updated_at` are
      // JavaScript generators now (`$defaultFn`), never a column DEFAULT, so a raw insert that
      // names neither is refused with `NOT NULL constraint failed`.
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
        { bytes: photo, names: { en: "Large loaf" }, altText: { en: "Loaf" }, labels: [] },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
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
      await tx.execute(sql`update products set image = null where id = ${variant!.id}`);
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
    });
  });

  it("counts no use for a variant that shows its parent's photo", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        { bytes: photo, names: { en: "Loaf" }, altText: { en: "Loaf" }, labels: [] },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
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
      // No photo of its own: it borrows the parent's (V11), which is the parent's use, not its own.
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
  // Two assertions deleted here with the stemmer (see the file header): `query: "bread"` expected
  // `[name.id, alt.id]`, the alt-text row matching through "Breads"; and `query: "pera"` expected
  // the Spanish name "Peras maduras". The name-above-alt RANKING those two rode on is still pinned,
  // by "keeps a name match above repeated alt-text matches when sorting by relevance" below, which
  // needs no stemmer. `alt` and `spanish` stay seeded as negative controls: they are the rows the
  // label and phrase queries must leave out.
  it("searches labels, matches a quoted phrase and combines a label filter", async () => {
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
      await add(1, { en: "Bakery" }, { en: "Breads on a plate" }, ["Food"]);
      const name = await add(2, { en: "Bread", es: "Pan recién horneado" }, { en: "A loaf" }, [
        "Food",
        "Summer menu",
      ]);
      const label = await add(3, { en: "Cake" }, { en: "A slice" }, ["Sweet", "Summer menu"]);
      await add(4, { en: "Pears", es: "Peras maduras" }, { en: "Fruit" }, ["Fruit"]);
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
      // Through the table, so the `ts` column's own mapping writes the ISO string. The raw
      // statement this replaces bound a `Date`, which this driver cannot bind: measured
      // 2026-09-22, inside the transaction it changed nothing and raised nothing, leaving two of
      // the three images sharing an upload millisecond — so the date ordering below was decided by
      // the uuid tiebreak rather than by the dates this test sets.
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

it("sorts accented names alphabetically in both directions across pages", async () => {
  // Lifted from `name-sort.pg.test.ts`, which was the only place asserting that `Éclair` sorts
  // between `Bread` and `Zest` rather than after `Zest`. That file needed a PostgreSQL container
  // and was deleted with the harness on 2026-09-22; recover it with
  // `git show aabdde6a8^:packages/media/src/name-sort.pg.test.ts`. The
  // `collate pg_catalog."und-x-icu"` that produced it has no SQLite counterpart: the engine ships
  // `BINARY`, `NOCASE` and `RTRIM`, and under a code-point comparison the lowercased `éclair`
  // (U+00E9) sorts after `zest`. `Intl.Collator` is the ICU that `und` named, which is why the
  // ordering moved into JavaScript rather than into the query.
  await withTransaction(suite.db, async (tx) => {
    for (const [index, name] of ["Zest", "Éclair", "Apple", "Bread"].entries()) {
      await uploadImage(
        tx,
        {
          bytes: new Uint8Array([...photo, 100 + index]),
          names: { en: name },
          altText: { en: name },
          labels: ["Food"],
        },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
    }
    for (const direction of ["asc", "desc"] as const) {
      const query = {
        sort: "name" as const,
        direction,
        limit: 2,
        label: "Food",
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
    const [menu] = await tx.insert(catalogues).values({ name: "Lunch" }).returning({
      id: catalogues.id,
    });
    const [product] = await tx
      .insert(products)
      .values({
        catalogueId: menu!.id,
        name: "Bread",
        pricingUnit: "each",
        unitPrice: 2,
        vatClass: "general",
        image: image.filename,
      })
      .returning({ id: products.id });
    const uses = [
      {
        kind: "product" as const,
        id: product!.id,
        catalogueId: menu!.id,
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
    await tx.update(products).set({ image: null }).where(eq(products.id, product!.id));
    expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
  });
});
