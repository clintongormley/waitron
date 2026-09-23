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
 * This is what survived `images.pg.test.ts`, which was deleted 2026-09-22 with the PostgreSQL test
 * harness (recover it with `git show aabdde6a8^:packages/media/src/images.pg.test.ts`). What went,
 * and why, so nobody reads this file as the whole of it:
 *
 *  - Its constraint and index listing, read out of `pg_constraint` and `pg_indexes`: DELETED. The
 *    keys it named are now either in the drizzle schema (`media_image_data_image_fk`, the primary
 *    key, the filename unique) or pinned by name in `image-references.test.ts`
 *    (`products_media_image_fk`, `category_details_media_image_fk`, carried as triggers — see
 *    `packages/media/drizzle/0001_image_references.sql`). Its `media_images_search_idx`, a GIN
 *    index over `media_search_vector(...)`, describes an engine #489 replaced.
 *  - Its two "absent image filename is refused" cases: covered, with an accepting control each, by
 *    `image-references.test.ts`.
 *  - Its four two-connection cases, which held one backend's transaction open and polled
 *    `pg_blocking_pids` until the other was seen waiting: DELETED. One writer at a time is what the
 *    venue file gives (`packages/store/src/write-queue.ts`), so there is no interleave to stage —
 *    and both OUTCOMES they asserted have sequential counterparts already: `deleteImage` reporting
 *    a committed use instead of deleting is `images.test.ts`'s product and category usage cases,
 *    and an attachment after the deletion being refused is `image-references.test.ts`.
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
  // (`packages/db/src/sql-state.ts`'s `FOREIGN_KEY_VIOLATION`), where this used to be `23503`; the
  // engine reports one `code` — `"ERR_SQLITE_ERROR"` — for every refusal alike, so the CLASS has
  // to come off `errcode`. The message is the engine's own and does not name the key, which is the
  // one part of PostgreSQL's `media_image_data_image_fk` text that located the rule.
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
