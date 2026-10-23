import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, customThemes, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { deleteImage, listImages, listImageUsages, readImage, uploadImage } from "./images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { samplePreparedImage } from "./testing/sample-image.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS, MEDIA_MIGRATIONS],
});
const photoA = await samplePreparedImage({ width: 19 });
const photoB = await samplePreparedImage({ width: 21 });

async function upload(tx: Transaction, image: typeof photoA, name: string) {
  return (await uploadImage(tx, { image, names: { en: name } }, { fallbackLanguage: "en" })).image;
}

async function addTheme(tx: Transaction, name: string, logo: unknown): Promise<string> {
  const [row] = await tx
    .insert(customThemes)
    .values({ name, nameKey: name.toLowerCase(), theme: { logo } })
    .returning();
  return row!.id;
}

async function counts(tx: Transaction, imageId: string): Promise<[number, number]> {
  const listed = (await listImages(tx, {})).images.find((image) => image.id === imageId);
  return [(await readImage(tx, imageId)).usageCount, listed!.usageCount];
}

it("lists and counts a theme's logo, light or dark, once per theme", async () => {
  await withTransaction(suite.db, async (tx) => {
    const a = await upload(tx, photoA, "Logo");
    const b = await upload(tx, photoB, "Other");
    const zest = await addTheme(tx, "Zest", { light: a.filename });
    const bar = await addTheme(tx, "Bar", { light: a.filename, dark: a.filename });
    const night = await addTheme(tx, "Night", { light: b.filename, dark: a.filename });
    expect(await listImageUsages(tx, a.id)).toEqual([
      { kind: "theme_logo", id: bar, name: "Bar" },
      { kind: "theme_logo", id: night, name: "Night" },
      { kind: "theme_logo", id: zest, name: "Zest" },
    ]);
    expect(await counts(tx, a.id)).toEqual([3, 3]);
    expect(await listImageUsages(tx, b.id)).toEqual([
      { kind: "theme_logo", id: night, name: "Night" },
    ]);
    expect(await counts(tx, b.id)).toEqual([1, 1]);
  });
});

it("refuses to delete an image a theme names, and frees it when no theme does", async () => {
  await withTransaction(suite.db, async (tx) => {
    const a = await upload(tx, photoA, "Logo");
    const b = await upload(tx, photoB, "Other");
    const zest = await addTheme(tx, "Zest", { light: a.filename });
    const bar = await addTheme(tx, "Bar", { light: a.filename, dark: a.filename });
    const night = await addTheme(tx, "Night", { light: b.filename, dark: a.filename });
    expect(await deleteImage(tx, a.id)).toEqual({
      deleted: false,
      uses: [
        { kind: "theme_logo", id: bar, name: "Bar" },
        { kind: "theme_logo", id: night, name: "Night" },
        { kind: "theme_logo", id: zest, name: "Zest" },
      ],
    });
    await tx.update(customThemes).set({ theme: { logo: null } });
    await tx.delete(customThemes).where(eq(customThemes.id, zest));
    expect(await deleteImage(tx, a.id)).toEqual({ deleted: true, uses: [] });
  });
});

it("a stored document that cannot be read holds no use", async () => {
  await withTransaction(suite.db, async (tx) => {
    const a = await upload(tx, photoA, "Logo");
    const documents = [
      "{broken",
      "[1]",
      JSON.stringify({ logo: a.filename }),
      '{"logo":{"light":7}}',
    ];
    for (const [index, document] of documents.entries()) {
      await tx.execute(
        sql`insert into custom_themes (id, name, name_key, theme, updated_at) values (${`t${index}`}, ${`Theme ${index}`}, ${`theme ${index}`}, ${document}, '2026-10-23T00:00:00Z')`,
      );
    }
    expect(await listImageUsages(tx, a.id)).toEqual([]);
    expect(await counts(tx, a.id)).toEqual([0, 0]);
  });
});
