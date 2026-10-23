import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { ReceiptLogoRasters } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { saveImage } from "./image-edits.js";
import { readImage, updateImage, uploadImage } from "./images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { samplePreparedImage } from "./testing/sample-image.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS, MEDIA_MIGRATIONS],
});
const photoA = await samplePreparedImage({ width: 19 });
const photoB = await samplePreparedImage({ width: 21 });
const replacement = await samplePreparedImage({ width: 23 });
const R1: ReceiptLogoRasters = {
  "58mm": { widthDots: 8, heightDots: 1, data: "/w==" },
  "80mm": { widthDots: 16, heightDots: 1, data: "/w8=" },
};
const R2: ReceiptLogoRasters = {
  "58mm": { widthDots: 8, heightDots: 1, data: "AA==" },
  "80mm": { widthDots: 16, heightDots: 1, data: "AAA=" },
};
const reframed = { x: 7500, y: 5000, zoom: 200 };
const storedAt = "2026-10-23T00:00:00Z";

async function upload(tx: Transaction, image: typeof photoA, name: string) {
  return (await uploadImage(tx, { image, names: { en: name } }, { fallbackLanguage: "en" })).image;
}

async function addTheme(tx: Transaction, id: string, document: string) {
  await tx.execute(
    sql`insert into custom_themes (id, name, name_key, theme, updated_at) values (${id}, ${id}, ${id.toLowerCase()}, ${document}, ${storedAt})`,
  );
}

async function stored(tx: Transaction, id: string) {
  const [row] = await tx.all<{ theme: string; updated_at: string }>(
    sql`select theme, updated_at from custom_themes where id = ${id}`,
  );
  return row!;
}

async function threeThemes(tx: Transaction) {
  const a = await upload(tx, photoA, "Logo");
  const b = await upload(tx, photoB, "Other");
  const day = JSON.stringify({ mode: "warm", logo: { light: a.filename }, printedLogo: R1 });
  const dusk = JSON.stringify({ logo: { light: b.filename, dark: a.filename }, printedLogo: R1 });
  await addTheme(tx, "Day", day);
  await addTheme(tx, "Dusk", dusk);
  await addTheme(tx, "Broken", "{broken");
  return { a, day, dusk };
}

async function expectOnlyDayRedrawn(tx: Transaction, day: string, dusk: string) {
  const dayRow = await stored(tx, "Day");
  expect(JSON.parse(dayRow.theme)).toEqual({ ...JSON.parse(day), printedLogo: R2 });
  expect(dayRow.updated_at).toBe(storedAt);
  expect((await stored(tx, "Dusk")).theme).toBe(dusk);
  expect((await stored(tx, "Broken")).theme).toBe("{broken");
}

it("a reframe rewrites the dots of every theme whose light image it is", async () => {
  await withTransaction(suite.db, async (tx) => {
    const { a, day, dusk } = await threeThemes(tx);
    await saveImage(
      tx,
      a.id,
      { names: a.names, expectedRevision: a.revision, framing: reframed },
      null,
      R2,
      "en",
    );
    await expectOnlyDayRedrawn(tx, day, dusk);
  });
});

it("a replaced source rewrites them too", async () => {
  await withTransaction(suite.db, async (tx) => {
    const { a, day, dusk } = await threeThemes(tx);
    await saveImage(
      tx,
      a.id,
      { names: a.names, expectedRevision: a.revision, framing: a.framing },
      replacement,
      R2,
      "en",
    );
    await expectOnlyDayRedrawn(tx, day, dusk);
  });
});

it("a name-only edit draws nothing", async () => {
  await withTransaction(suite.db, async (tx) => {
    const { a, day } = await threeThemes(tx);
    await updateImage(tx, a.id, { names: { en: "New" } });
    expect((await stored(tx, "Day")).theme).toBe(day);
  });
});

it("refuses a pixel change without dots while a theme's light image is the image", async () => {
  const { a, day } = await withTransaction(suite.db, threeThemes);
  await expect(
    withTransaction(suite.db, (tx) =>
      saveImage(
        tx,
        a.id,
        { names: a.names, expectedRevision: a.revision, framing: reframed },
        null,
        undefined,
        "en",
      ),
    ),
  ).rejects.toThrow("Receipt logo requires both printable pictures");
  await withTransaction(suite.db, async (tx) => {
    expect((await stored(tx, "Day")).theme).toBe(day);
    expect((await readImage(tx, a.id)).revision).toBe(a.revision);
  });
});

it("saves a pixel change without dots when only a dark logo is the image", async () => {
  await withTransaction(suite.db, async (tx) => {
    const { a, dusk } = await threeThemes(tx);
    await tx.execute(sql`delete from custom_themes where id = 'Day'`);
    const saved = await saveImage(
      tx,
      a.id,
      { names: a.names, expectedRevision: a.revision, framing: reframed },
      null,
      undefined,
      "en",
    );
    expect(saved.framing).toEqual(reframed);
    expect((await stored(tx, "Dusk")).theme).toBe(dusk);
  });
});
