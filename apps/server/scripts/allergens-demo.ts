// Authors EU 1169/2011 Annex II allergen declarations on catalogue products in a throwaway venue
// directory, reads them back as the till does, and prints an allergen matrix and a single-dish lookup.
//
// A reviewed product with no allergens (`{}`) is allergen-free; `allergens = null` is PENDING — never
// reviewed, and never to be shown as safe (design D4).
//
// Run it: pnpm --filter @waitron/server demo:allergens
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locations, openVenueDatabase, tenants, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  ALLERGEN_CODES,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";

const SETS = ["core", "catalogue"];

interface Venue {
  locationId: string;
}

/**
 * Drizzle inserts, not raw SQL: `locations.id` comes from `$defaultFn`, which raw SQL does not run
 * (`packages/db/src/schema/columns.ts`).
 */
async function seedVenue(db: Database): Promise<Venue> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "50000000K", legalName: "Deli Demo SL" });
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Sala principal",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  return { locationId: loc!.id };
}

/** `apps/*` is out of the english-only guard's scope, so the Spanish menu names are fine here. */
function label(p: AvailableProduct): string {
  return p.name || `product ${p.id}`;
}

function reviewState(p: AvailableProduct): "pending" | "none" | "declared" {
  if (p.allergens === null) return "pending";
  return Object.keys(p.allergens).length === 0 ? "none" : "declared";
}

/** `?` (unreviewed) and `-` (confirmed absent) are deliberately different glyphs. `*` flags a source. */
function cell(p: AvailableProduct, code: string): string {
  if (p.allergens === null) return "?";
  const decl = p.allergens[code] as { presence: string; source?: string } | undefined;
  if (decl === undefined) return "-";
  if (decl.presence === "contains") return decl.source === undefined ? "YES" : "YES*";
  return "may";
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function printMatrix(products: AvailableProduct[]): void {
  const columns = ALLERGEN_CODES.filter((code) =>
    products.some((p) => p.allergens !== null && p.allergens[code] !== undefined),
  );
  const nameWidth = Math.max("Product".length, ...products.map((p) => label(p).length));
  const colWidth = columns.map((code) => Math.max(code.length, "YES*".length));
  const statusWidth = "reviewed: none".length;

  const header = [
    pad("Product", nameWidth),
    ...columns.map((code, i) => pad(code, colWidth[i]!)),
    pad("review", statusWidth),
  ].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const p of products) {
    const state = reviewState(p);
    const status =
      state === "pending" ? "PENDING" : state === "none" ? "reviewed: none" : "reviewed";
    const row = [
      pad(label(p), nameWidth),
      ...columns.map((code, i) => pad(cell(p, code), colWidth[i]!)),
      pad(status, statusWidth),
    ].join(" | ");
    console.log(row);
  }

  console.log("");
  console.log("Legend:  YES = contains   YES* = contains (specific source; see lookup)");
  console.log(
    "         may = may contain   -  = reviewed, allergen absent   ?  = NOT yet reviewed",
  );
  console.log("A `?` row is PENDING review — never treat it as allergen-free.");
}

function printOperatorLookup(p: AvailableProduct): void {
  console.log(`Operator allergen lookup — "${label(p)}"`);

  if (p.allergens === null) {
    console.log("  Review status: PENDING — allergens have NOT been reviewed for this product.");
    console.log(
      "  Do NOT treat as allergen-free. Ask the kitchen before serving an allergy guest.",
    );
    return;
  }

  const entries = Object.entries(p.allergens);
  if (entries.length === 0) {
    console.log("  Review status: reviewed — no declarable EU Annex II allergens.");
    return;
  }

  console.log("  Review status: reviewed.");
  const contains = entries.filter(([, d]) => d.presence === "contains");
  const mayContain = entries.filter(([, d]) => d.presence === "may_contain");

  console.log("  Contains:");
  if (contains.length === 0) console.log("    (none)");
  for (const [code, d] of contains) {
    console.log(`    - ${code}${d.source === undefined ? "" : ` (from ${d.source})`}`);
  }

  console.log("  May contain:");
  if (mayContain.length === 0) console.log("    (none)");
  for (const [code] of mayContain) {
    console.log(`    - ${code}`);
  }
}

async function main(): Promise<void> {
  const venueDir = await mkdtemp(join(tmpdir(), "allergens-demo-"));
  const sets = manifestSets().filter((set) => SETS.includes(set.name));
  await applyMigrations(venueDir, migrationOptionsFor(sets, null));
  const store = await openVenueDatabase(venueDir);
  const db = store.venue;
  try {
    const venue = await seedVenue(db);

    await withTransaction(db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const comida = await createCategory(tx, { name: { en: "Comida" } });
      const postres = await createCategory(tx, { name: { en: "Postres" } });

      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: comida.id,
        name: "Empanada de trigo",
        pricingUnit: "each",
        unitPrice: "3.50",
        vatClass: "reduced",
        allergens: {
          gluten: { presence: "contains", source: "wheat" },
          eggs: { presence: "contains" },
        },
      });

      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: postres.id,
        name: "Tarta de la casa",
        pricingUnit: "each",
        unitPrice: "4.20",
        vatClass: "reduced",
        allergens: {
          milk: { presence: "contains" },
          nuts: { presence: "may_contain" },
        },
      });

      // Reviewed, no declarable allergens: not the same as pending.
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: comida.id,
        name: "Ensalada de la huerta",
        pricingUnit: "each",
        unitPrice: "5.90",
        vatClass: "reduced",
        allergens: {},
      });

      // Allergens unset: never reviewed, so PENDING.
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: comida.id,
        name: "Sopa del día",
        pricingUnit: "each",
        unitPrice: "4.50",
        vatClass: "reduced",
      });

      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    });

    const products = await withTransaction(db, async (tx) => {
      return (await listAvailableProducts(tx, venue.locationId)).products;
    });

    console.log("allergens-demo: allergens authored on the catalogue, read back for the till");
    console.log("");
    console.log("(a) Allergen matrix (product x allergen)");
    console.log("");
    printMatrix(products);
    console.log("");
    console.log("(b) Operator lookup for a single dish");
    console.log("");
    // The product whose `contains` carries a source, which the lookup spells out.
    const lookup = products.find((p) => label(p) === "Empanada de trigo") ?? products[0];
    if (lookup !== undefined) printOperatorLookup(lookup);
  } finally {
    await store.close();
    await rm(venueDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("allergens-demo: failed");
  console.error(error);
  process.exit(1);
});
