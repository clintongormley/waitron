import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { uploadImage } from "./images.js";
import { mediaImageData, mediaImages } from "./schema/images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { samplePreparedImage } from "./testing/sample-image.js";

/**
 * `media_image_data` may only hold bytes for an image that exists, and it loses them when that
 * image goes.
 *
 * One writer at a time is what the venue file gives (`packages/store/src/write-queue.ts`), so no
 * case here interleaves two transactions.
 */
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, MEDIA_MIGRATIONS],
});

const photo = await samplePreparedImage({ width: 8 });
const options = { fallbackLanguage: "en" };

it("refuses image bytes for an absent image and removes the bytes with their image", async () => {
  await seedTenant(suite.db);
  const { image } = await withTransaction(suite.db, (tx) =>
    uploadImage(
      tx,
      { image: photo, names: { en: "Bread" }, altText: { en: "Loaf" }, labels: ["Food"] },
      options,
    ),
  );

  // Bytes naming no image row. `errcode` 787 is `SQLITE_CONSTRAINT_FOREIGNKEY`
  // (`packages/db/src/sql-state.ts`'s `FOREIGN_KEY_VIOLATION`); the engine reports one `code` —
  // `"ERR_SQLITE_ERROR"` — for every refusal alike, so the CLASS has to come off `errcode`.
  await expect(
    suite.db.insert(mediaImageData).values({ imageId: crypto.randomUUID(), bytes: photo.bytes }),
  ).rejects.toMatchObject({ errcode: 787, message: "FOREIGN KEY constraint failed" });

  // The accepting control in the other direction, so the case above is not passing because every
  // insert is refused.
  const [before] = await suite.db
    .select({ n: sql<number>`count(*)` })
    .from(mediaImageData)
    .where(eq(mediaImageData.imageId, image.id));
  expect(before!.n).toBe(1);

  // `on delete cascade` takes the bytes with the image.
  await suite.db.delete(mediaImages).where(eq(mediaImages.id, image.id));
  const [after] = await suite.db
    .select({ n: sql<number>`count(*)` })
    .from(mediaImageData)
    .where(eq(mediaImageData.imageId, image.id));
  expect(after!.n).toBe(0);
});
