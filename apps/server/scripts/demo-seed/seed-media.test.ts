/**
 * The demo's media step: committed tiles in the library, content-addressed references on products.
 *
 * SQLite has no roles, and every call below runs on the one handle. Nothing now checks who
 * may write the image library.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { seedCatalogues } from "./seed-catalogue.js";
import { DEFAULT_MAX_UPLOAD_BYTES, prepareImage, readImageBytes } from "@waitron/media";
import { seedMedia } from "./seed-media.js";
// The exact regex the public `GET /media/:filename` route accepts — the produced names MUST pass it.
import { MEDIA_FILENAME } from "@waitron/media";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";
const SRC_DIR = fileURLToPath(new URL("media", import.meta.url));

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// One NIF per provisioned venue. `useVenueDb`'s per-test reset empties every data table, so the
// counter no longer keeps two tests apart; it keeps two `provisionVenue` calls within a test apart.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(51_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a fresh chained venue (as the owner) and return the ids the seed needs. */
async function provisionVenue(): Promise<{ locationId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Casa Delgado SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  return { locationId: venue.locationId };
}

describe("seedMedia", () => {
  it("stores committed tiles in the library and attaches content-addressed product references", async () => {
    const { locationId } = await provisionVenue();

    const { productsByImage, images } = await withTransaction(suite.db, async (tx) => {
      const { productsByImage } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
      });
      await seedMedia(tx, { productsByImage });
      // Read every product's stored image back, keyed by product id.
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
      });
      await seedMedia(tx, { productsByImage });
      const before = await tx.execute(
        sql`select id, filename, names, alt_text from media_images order by id`,
      );
      await seedMedia(tx, { productsByImage });
      const after = await tx.execute(
        sql`select id, filename, names, alt_text from media_images order by id`,
      );
      expect(after.rows).toEqual(before.rows);
      expect(after.rows.length).toBeGreaterThan(0);
    });
  });
});
