/**
 * The demo's media step: committed tiles in the library, content-addressed references on products.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedCatalogues } from "./seed-catalogue.js";
import { CASA_DELGADO_ES } from "./data-sets/casa-delgado-es.js";
import { DEFAULT_MAX_UPLOAD_BYTES, prepareImage, readImageBytes } from "@waitron/media";
import { seedMedia } from "./seed-media.js";
// The regex the public `GET /media/:filename` route accepts.
import { MEDIA_FILENAME } from "@waitron/shared";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "en";
const SRC_DIR = fileURLToPath(new URL("media", import.meta.url));

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 51_000_000,
  invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
});

describe("seedMedia", () => {
  it("stores committed tiles in the library and attaches content-addressed product references", async () => {
    const { locationId } = await provisionVenue();

    const { productsByImage, images } = await withTransaction(suite.db, async (tx) => {
      const { productsByImage } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      await seedMedia(tx, { productsByImage });
      const { rows } = await tx.execute<{ id: string; image: string | null }>(
        sql`select id, image from products `,
      );
      const images = new Map(rows.map((r) => [r.id, r.image]));
      return { productsByImage, images };
    });

    expect(productsByImage.size).toBeGreaterThan(35);

    // Each reference names the shrunk copy of its committed tile and resolves to exactly those bytes.
    for (const [basename, productId] of productsByImage) {
      const stored = images.get(productId);
      expect(stored).toMatch(/^[0-9a-f]{64}\.webp$/);
      // And it is exactly what the public /media route will serve.
      expect(MEDIA_FILENAME.test(stored!)).toBe(true);
      expect(stored).not.toBe(basename);

      const srcBytes = await readFile(join(SRC_DIR, basename));
      const prepared = await prepareImage(srcBytes, { maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES });
      expect(stored).toBe(prepared.filename);

      const storedImage = await withTransaction(suite.db, async (tx) => {
        return readImageBytes(tx, stored!);
      });
      expect(storedImage?.contentType).toBe("image/webp");
      expect(storedImage!.bytes).toEqual(prepared.bytes);
    }

    const written = await suite.db.execute<{ count: number }>(
      sql`select cast(count(*) as integer) as count from media_images`,
    );
    const distinctPhotos = new Set(
      await Promise.all(
        [...productsByImage.keys()].map(
          async (basename) =>
            (
              await prepareImage(await readFile(join(SRC_DIR, basename)), {
                maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
              })
            ).filename,
        ),
      ),
    );
    expect(written.rows[0]!.count).toBe(distinctPhotos.size);
  });

  it("reuses existing image bytes when the media step runs twice", async () => {
    const { locationId } = await provisionVenue();
    await withTransaction(suite.db, async (tx) => {
      const { productsByImage } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      await seedMedia(tx, { productsByImage });
      const before = await tx.execute(
        sql`select id, filename, names from media_images order by id`,
      );
      await seedMedia(tx, { productsByImage });
      const after = await tx.execute(sql`select id, filename, names from media_images order by id`);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows.length).toBeGreaterThan(0);
    });
  });
});
