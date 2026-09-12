import { tenantId as brandTenantId } from "@waitron/shared";
// Real PostgreSQL checks the demo writes image bytes and product references as app_user.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { seedCatalogues } from "./seed-catalogue.js";
import { readImageBytes } from "@waitron/media";
import { seedMedia } from "./seed-media.js";
// The exact regex the public `GET /media/:filename` route accepts — the produced names MUST pass it.
import { MEDIA_FILENAME } from "@waitron/media";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";
const SRC_DIR = fileURLToPath(new URL("media", import.meta.url));

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same local-counter shape the sibling tests use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(51_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a fresh chained venue (as the owner) and return the ids the seed needs. */
async function provisionVenue(): Promise<{ tenantId: string; locationId: string }> {
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
    { db: suite.admin, modules: ALL_MODULES },
  );
  return { tenantId: venue.tenantId, locationId: venue.locationId };
}

describe("seedMedia", () => {
  it("stores committed tiles in the library and attaches content-addressed product references", async () => {
    const { tenantId, locationId } = await provisionVenue();

    const { productsByImage, images } = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const { productsByImage } = await seedCatalogues(tx, brandTenantId(tenantId), {
        locationId,
        locale: LOCALE,
      });
      await seedMedia(tx, { tenantId, productsByImage });
      // Read every product's stored image back, as app_user, keyed by product id.
      const { rows } = await tx.execute<{ id: string; image: string | null }>(
        sql`select id, image from products where tenant_id = ${tenantId}`,
      );
      const images = new Map(rows.map((r) => [r.id, r.image]));
      return { productsByImage, images };
    });

    expect(productsByImage.size).toBeGreaterThan(35);

    // Each reference retains the source hash and resolves to the committed bytes.
    for (const [basename, productId] of productsByImage) {
      const stored = images.get(productId);
      expect(stored).toMatch(/^[0-9a-f]{64}\.png$/);
      // And it is exactly what the public /media route will serve.
      expect(MEDIA_FILENAME.test(stored!)).toBe(true);
      expect(stored).not.toBe(basename);

      const srcBytes = await readFile(join(SRC_DIR, basename));
      const expectedName = `${createHash("sha256").update(srcBytes).digest("hex")}.png`;
      expect(stored).toBe(expectedName);

      const storedImage = await withTenant(suite.admin, tenantId, async (tx) => {
        await asAppUser(tx);
        return readImageBytes(tx, tenantId, stored!);
      });
      expect(storedImage?.contentType).toBe("image/png");
      const writtenBytes = storedImage!.bytes;
      expect(createHash("sha256").update(writtenBytes).digest("hex")).toBe(
        createHash("sha256").update(srcBytes).digest("hex"),
      );
    }

    const written = await suite.admin.execute<{ count: number }>(
      sql`select count(*)::int as count from media_images where tenant_id = ${tenantId}`,
    );
    const distinctHashes = new Set(
      await Promise.all(
        [...productsByImage.keys()].map(async (basename) =>
          createHash("sha256")
            .update(await readFile(join(SRC_DIR, basename)))
            .digest("hex"),
        ),
      ),
    );
    expect(written.rows[0]!.count).toBe(distinctHashes.size);
  });

  it("reuses existing image bytes when the media step runs twice", async () => {
    const { tenantId, locationId } = await provisionVenue();
    await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const { productsByImage } = await seedCatalogues(tx, brandTenantId(tenantId), {
        locationId,
        locale: LOCALE,
      });
      await seedMedia(tx, { tenantId, productsByImage });
      const before = await tx.execute(
        sql`select id, filename, names, alt_text from media_images where tenant_id = ${tenantId} order by id`,
      );
      await seedMedia(tx, { tenantId, productsByImage });
      const after = await tx.execute(
        sql`select id, filename, names, alt_text from media_images where tenant_id = ${tenantId} order by id`,
      );
      expect(after.rows).toEqual(before.rows);
      expect(after.rows.length).toBeGreaterThan(0);
    });
  });
});
