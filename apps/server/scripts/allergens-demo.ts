// Self-contained, human-checkable demonstration of the allergens seam: EU 1169/2011 Annex II
// declarations authored on catalogue products and read back for the till, end-to-end and
// headless. Modelled on `daily-close-demo.ts` (a throwaway venue directory, self-migrating,
// tsx-run) rather than on the real-database demo it sat beside — this demo never writes a fiscal
// record, so it needs no fiscal backend, no AEAT and no SIF registration. Two migration sets
// carry everything it touches — `core` the `tenants` and `locations` rows it seeds, `catalogue`
// the catalogue tables and the `products.allergens` column it reads back.
//
// SQLite has no roles and no grants: nothing below demonstrates who may write. What this demo
// does show is the allergen seam itself, which is what its name says.
//
// It:
// 1. makes a throwaway venue directory under the OS temp dir, applies the `core` and `catalogue`
//    migration sets to it through `applyMigrations` (the entry point `dev-setup.ts` also uses),
//    and removes the directory when it finishes;
// 2. seeds a tenant + location with plain drizzle inserts;
// 3. seeds ONE catalogue with four products carrying VARIED allergen states, then assigns the
//    catalogue to the location:
//    - "Empanada de trigo" → contains gluten (source: wheat) + eggs — a `contains` with a SOURCE
//    - "Tarta de la casa" → contains milk, MAY contain nuts — a `may_contain`
//    - "Ensalada de la huerta"→ {} — reviewed, no declarable allergens — the empty-but-reviewed
//      case
//    - "Sopa del día" → allergens unset (null) — NOT yet reviewed → PENDING
// 4. reads the sellable products back with `listAvailableProducts`, exactly as the till does, and
//    prints (a) an allergen matrix (product × allergen) and (b) a single-product
//    operator-lookup view.
//
// The load-bearing distinction (design D4): a reviewed product with no allergens ({}) is allergen-FREE,
// while a product with `allergens = null` is PENDING — never yet reviewed, and must NEVER be shown as
// safe. Both the matrix and the lookup render `null` distinctly as PENDING, and `{}` distinctly as
// "reviewed: none".
//
// Run it:
//   pnpm --filter @waitron/server demo:allergens
//   # or: pnpm --filter @waitron/server exec tsx scripts/allergens-demo.ts
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

/** The migration sets this demo applies, in manifest order — core carries `tenants`/`locations`,
 * catalogue the products and their allergen columns. */
const SETS = ["core", "catalogue"];

interface Venue {
  locationId: string;
}

/**
 * Seeds tenant → location. Only these two rows are needed: this demo rings no sale, so no till /
 * node / series.
 *
 * Drizzle inserts rather than the raw SQL that was here: `locations.id` no longer carries a SQL
 * DEFAULT — the value comes from `$defaultFn(newId)`, which drizzle's insert builder runs and raw
 * SQL does not (`packages/db/src/schema/columns.ts`) — and `invoice_locales` is a JSON array in a
 * text column, not the PostgreSQL `array['es-ES']` this used to write.
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

/** The product's staff-facing name, or a stable fallback when it is blank. `apps/*` is out of the
 * english-only guard's scope, so the Spanish menu names are fine here. */
function label(p: AvailableProduct): string {
  return p.name || `product ${p.id}`;
}

/** Three review states, kept distinct — the whole point of the demo (design D4). */
function reviewState(p: AvailableProduct): "pending" | "none" | "declared" {
  if (p.allergens === null) return "pending";
  return Object.keys(p.allergens).length === 0 ? "none" : "declared";
}

/** One matrix cell: `?` for a PENDING (unreviewed) product, `-` for a reviewed-absent allergen,
 * `YES`/`YES*` for `contains` (a `*` flags a specific source, spelled out in the lookup below), and
 * `may` for `may_contain`. `?` and `-` are deliberately different glyphs: unknown vs confirmed-absent. */
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

/** (a) The allergen matrix: products down the side, the allergens ANY product declares across the top,
 * plus a trailing review-status column so PENDING and reviewed-none can never be confused. */
function printMatrix(products: AvailableProduct[]): void {
  // Columns are the Annex-II codes some product actually declares, in the taxonomy's canonical order.
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

/** (b) The single-product operator lookup — what a till shows when staff tap one dish. Renders the
 * PENDING state distinctly, so an unreviewed product is a warning, never an "all clear". */
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
  // A throwaway venue directory: the two SQLite files plus their write-ahead sidecars, removed at
  // the end. The migrate goes through `applyMigrations`, which takes the DIRECTORY and opens it
  // itself; `openVenueDatabase` then hands back the venue handle every write below takes.
  const venueDir = await mkdtemp(join(tmpdir(), "allergens-demo-"));
  const sets = manifestSets().filter((set) => SETS.includes(set.name));
  await applyMigrations(venueDir, migrationOptionsFor(sets, null));
  const store = await openVenueDatabase(venueDir);
  const db = store.venue;
  try {
    const venue = await seedVenue(db);

    // Author the catalogue in one transaction, exactly as the running POS does.
    await withTransaction(db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const comida = await createCategory(tx, { name: { en: "Comida" } });
      const postres = await createCategory(tx, { name: { en: "Postres" } });

      // 1. `contains` WITH a source — the richest declaration.
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

      // 2. a `may_contain` (cross-contamination) alongside a plain `contains`.
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

      // 3. reviewed, but no declarable allergens — the empty map. NOT the same as pending.
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: comida.id,
        name: "Ensalada de la huerta",
        pricingUnit: "each",
        unitPrice: "5.90",
        vatClass: "reduced",
        allergens: {},
      });

      // 4. allergens left UNSET (null) — never reviewed → PENDING.
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

    // The read the till performs: sellable products at the location, with their allergens.
    // `listAvailableProducts` orders by (catalogue.name, created_at, id); all four share both a
    // catalogue and a created_at, so the print order falls to the random-uuid id tiebreak, not
    // seed order. Order is immaterial here — the matrix labels each row's review state explicitly.
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
    // The richest product (a `contains` with a specific source) — proves the source survives the
    // db round-trip. The matrix above already shows the PENDING product distinctly.
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
