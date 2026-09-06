import { tenantId as brandTenantId } from "@waitron/shared";
// Real-Postgres proof of `seedMedia` (Phase 2, Task 9): it reads the committed per-dish PNG tiles,
// content-addresses them into a media dir under their SHA-256, and rewrites each seeded product's
// `image` from the plain basename to the served `<sha256hex>.png` name. Real Postgres (not PGlite):
// the media step runs under RLS as `app_user` (it UPDATEs `products`, a tenant-scoped FORCE-RLS
// table), exactly as the demo scripts do; PGlite's superuser connection would bypass FORCE ROW LEVEL
// SECURITY and prove nothing about that grant (CLAUDE.md §4). Uses the shared `manifest` template
// cloned per file via `useTemplateDb`, the same pattern as `seed-catalogue.test.ts`.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { seedMedia } from "./seed-media.js";
// The exact regex the public `GET /media/:filename` route accepts — the produced names MUST pass it.
import { MEDIA_FILENAME } from "../../src/media-api.js";

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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
  return { tenantId: venue.tenantId, locationId: venue.locationId };
}

describe("seedMedia", () => {
  it("content-addresses each committed tile into the media dir and rewrites products.image", async () => {
    const { tenantId, locationId } = await provisionVenue();
    const mediaDir = await mkdtemp(join(tmpdir(), "waitron-seed-media-"));

    const { productsByImage, images } = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const { productsByImage } = await seedCatalogues(tx, brandTenantId(tenantId), {
        locationId,
        locale: LOCALE,
      });
      await seedMedia(tx, { mediaDir, productsByImage });
      // Read every product's stored image back, as app_user, keyed by product id.
      const { rows } = await tx.execute<{ id: string; image: string | null }>(
        sql`select id, image from products`,
      );
      const images = new Map(rows.map((r) => [r.id, r.image]));
      return { productsByImage, images };
    });

    expect(productsByImage.size).toBeGreaterThan(35);

    // Every seeded product's image is now a served content-hash name (NOT the plain basename), the
    // file exists in the media dir, and its bytes round-trip to the committed source tile.
    for (const [basename, productId] of productsByImage) {
      const stored = images.get(productId);
      expect(stored).toMatch(/^[0-9a-f]{64}\.png$/);
      // And it is exactly what the public /media route will serve.
      expect(MEDIA_FILENAME.test(stored!)).toBe(true);
      expect(stored).not.toBe(basename);

      const srcBytes = await readFile(join(SRC_DIR, basename));
      const expectedName = `${createHash("sha256").update(srcBytes).digest("hex")}.png`;
      expect(stored).toBe(expectedName);

      const writtenBytes = await readFile(join(mediaDir, stored!));
      expect(createHash("sha256").update(writtenBytes).digest("hex")).toBe(
        createHash("sha256").update(srcBytes).digest("hex"),
      );
    }

    // The media dir holds exactly one file per DISTINCT source hash (all 44 tiles are distinct).
    const written = (await readdir(mediaDir)).filter((f) => f.endsWith(".png"));
    const distinctHashes = new Set(
      await Promise.all(
        [...productsByImage.keys()].map(async (basename) =>
          createHash("sha256")
            .update(await readFile(join(SRC_DIR, basename)))
            .digest("hex"),
        ),
      ),
    );
    expect(written.length).toBe(distinctHashes.size);
  });

  it("creates the media dir if it does not yet exist", async () => {
    const { tenantId, locationId } = await provisionVenue();
    const base = await mkdtemp(join(tmpdir(), "waitron-seed-media-"));
    const mediaDir = join(base, "nested", "media"); // does not exist yet

    await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const { productsByImage } = await seedCatalogues(tx, brandTenantId(tenantId), {
        locationId,
        locale: LOCALE,
      });
      await seedMedia(tx, { mediaDir, productsByImage });
    });

    const written = (await readdir(mediaDir)).filter((f) => f.endsWith(".png"));
    expect(written.length).toBeGreaterThan(0);
  });
});
