/**
 * The demo's media step: committed tiles in the library, content-addressed references on products.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedMenus } from "./seed-menus.js";
import { CASA_DELGADO_ES } from "./testing/data.js";
import { DEFAULT_MAX_UPLOAD_BYTES, prepareImage, readImageBytes } from "@waitron/media";
import { seedMedia, demoMediaPath } from "./seed-media.js";
// The regex the public `GET /media/:filename` route accepts.
import { MEDIA_FILENAME } from "@waitron/shared";

import type { SeedLocale } from "./locale.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "en";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 51_000_000,
  invoiceLocale: "es-ES",
  staffLanguage: LOCALE,
});

describe("seedMedia", () => {
  it("stores committed tiles in the library and attaches content-addressed product references", async () => {
    await provisionVenue();

    const { productsByImage, images, uploaded } = await withTransaction(suite.db, async (tx) => {
      const { productsByImage } = await seedMenus(tx, {
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      const filenames = sql`select filename from media_images`;
      const { rows: before } = await tx.execute<{ filename: string }>(filenames);
      await seedMedia(tx, { productsByImage, mediaDataSet: CASA_DELGADO_ES.mediaDataSet });
      const { rows: after } = await tx.execute<{ filename: string }>(filenames);
      const existing = new Set(before.map((row) => row.filename));
      const uploaded = new Set(
        after.map((row) => row.filename).filter((name) => !existing.has(name)),
      );
      const { rows } = await tx.execute<{ id: string; image: string | null }>(
        sql`select id, image from products `,
      );
      const images = new Map(rows.map((r) => [r.id, r.image]));
      return { productsByImage, images, uploaded };
    });

    expect(productsByImage.size).toBeGreaterThan(35);

    const expectedUploads = new Set<string>();
    // Each reference names the shrunk copy of its committed tile and resolves to exactly those bytes.
    for (const [basename, productId] of productsByImage) {
      const stored = images.get(productId);
      expect(stored).toMatch(/^[0-9a-f]{64}\.webp$/);
      // And it is exactly what the public /media route will serve.
      expect(MEDIA_FILENAME.test(stored!)).toBe(true);
      expect(stored).not.toBe(basename);

      const srcBytes = await readFile(
        demoMediaPath(CASA_DELGADO_ES.mediaDataSet, basename, undefined),
      );
      const prepared = await prepareImage(srcBytes, { maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES });
      expect(stored).toBe(prepared.filename);
      expectedUploads.add(prepared.filename);

      const storedImage = await withTransaction(suite.db, async (tx) => {
        return readImageBytes(tx, stored!);
      });
      expect(storedImage?.contentType).toBe("image/webp");
      expect(storedImage!.bytes).toEqual(prepared.bytes);
    }

    expect(uploaded).toEqual(expectedUploads);
  });

  it("reuses existing image bytes when the media step runs twice", async () => {
    await provisionVenue();
    await withTransaction(suite.db, async (tx) => {
      const { productsByImage } = await seedMenus(tx, {
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      await seedMedia(tx, { productsByImage, mediaDataSet: CASA_DELGADO_ES.mediaDataSet });
      const before = await tx.execute(
        sql`select id, filename, names from media_images order by id`,
      );
      await seedMedia(tx, { productsByImage, mediaDataSet: CASA_DELGADO_ES.mediaDataSet });
      const after = await tx.execute(sql`select id, filename, names from media_images order by id`);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows.length).toBeGreaterThan(0);
    });
  });
});
