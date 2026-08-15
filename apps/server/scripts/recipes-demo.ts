// Self-contained, human-checkable demonstration of the recipes → allergen-inheritance seam: an
// ingredient's EU 1169/2011 Annex II declaration flows onto every product whose recipe uses it, the
// derived floor unions with the product's own manual overlay (add-only), and a single unreviewed
// ingredient forces the whole product PENDING — end-to-end and headless.
//
// Modelled on `allergens-demo.ts` (in-memory PGlite, self-migrating, tsx-run) rather than
// `catalogue-demo.ts` (real Postgres): this demo never writes a fiscal record, so it needs neither a
// real backend nor the RLS-as-deployment-role proof that forces catalogue-demo onto a real server.
// `CORE_MIGRATIONS` alone suffices — it creates the catalogue tables, the `products.allergens`
// published column plus its `manual_allergens`/`recipe_derivation` overlays, and (0038/0039) the
// `ingredients` and `recipe_lines` tables read and written here.
//
// It:
//   1. boots an in-memory PGlite and applies `CORE_MIGRATIONS`;
//   2. seeds a tenant + location as the PGlite superuser (which bypasses RLS) — `app_user` holds no
//      INSERT on `tenants`, deliberately (a running POS cannot create tenants);
//   3. as the application role (`withTenant` sets the tenant GUC, `asAppUser` drops to the RLS-bound
//      role, exactly as the running POS does), walks the six-step story below, reading the PUBLISHED
//      `products.allergens` column back after each mutation and asserting it matches.
//
// The story (design D4 — floor ∪ manual, add-only, with PENDING contagion):
//   3. setProductRecipe(bocadillo, [alioli, pan])            → {eggs, gluten}         (inherited floor)
//   4. updateProduct(bocadillo, { may_contain nuts })        → {eggs, gluten, nuts}   (floor ∪ manual)
//   5. setProductRecipe(bocadillo, [alioli, pan, misterio])  → null                   (PENDING contagion)
//   6. updateIngredient(misterio, { contains fish })         → not null, republished  (propagation)
//
// `apps/*` is out of the english-only guard's scope, so the Spanish names (alioli, pan, misterio,
// bocadillo) are fine here.
//
// Run it:
//   pnpm --filter @waitron/server demo:recipes
//   # or: pnpm --filter @waitron/server exec tsx scripts/recipes-demo.ts
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  asAppUser,
  createPgliteDb,
  products,
  runMigrations,
  withTenant,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { createCatalogue, createProduct, updateProduct } from "@waitron/catalogue";
import type { ProductAllergens } from "@waitron/catalogue";
import { createIngredient, setProductRecipe, updateIngredient } from "@waitron/recipes";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";

const LOCALE = "es-ES";

interface Venue {
  tenantId: TenantId;
  locationId: string;
}

/**
 * Seeds tenant → location as the PGlite superuser (which bypasses RLS), exactly as the package's own
 * fixtures do. Only these two rows are needed: this demo rings no sale, so no till / node / series.
 */
async function seedVenue(db: Database): Promise<Venue> {
  const t = await db.execute<{ id: string }>(
    sql`insert into tenants (country, tax_id, legal_name) values ('ES', '50000000K', 'Deli Demo SL') returning id`,
  );
  const tenantId = brandTenantId(t.rows[0]!.id);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Sala principal', array['es-ES'], 'Venta en establecimiento') returning id`);
  return { tenantId, locationId: loc.rows[0]!.id };
}

/** Read the PUBLISHED declaration straight off the `products.allergens` column — the surface the till
 * sells from — after each recipe/manual change, as a Drizzle select. Returns null for a PENDING
 * product (and also for a missing id, but the ids here are all real). */
async function readPublished(tx: Transaction, productId: string): Promise<ProductAllergens | null> {
  const [row] = await tx
    .select({ allergens: products.allergens })
    .from(products)
    .where(eq(products.id, productId));
  return row?.allergens ?? null;
}

/** Render a published declaration for the console: `PENDING (null)` when unreviewed, else the codes
 * with their presence, sorted so the line is stable regardless of map insertion order. */
function format(a: ProductAllergens | null): string {
  if (a === null) return "PENDING (null)";
  const parts = Object.entries(a)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([code, d]) => `${code}: ${d.presence}${d.source === undefined ? "" : ` (${d.source})`}`);
  return `{ ${parts.join(", ")} }`;
}

/** The sorted allergen codes of a published declaration, or the sentinel `["<pending>"]` for null —
 * so the expectation checks below compare code SETS and the pending state in one shape. */
function codes(a: ProductAllergens | null): string[] {
  return a === null ? ["<pending>"] : Object.keys(a).sort((x, y) => x.localeCompare(y));
}

/** Print the actual published declaration, compare its code set to what the step expects, and THROW
 * on any mismatch — a demo that silently diverged from its own narration would be worse than none. */
function expect(actual: ProductAllergens | null, expected: string[]): void {
  console.log(`  products.allergens = ${format(actual)}`);
  console.log(`  expected codes     = { ${expected.join(", ")} }`);
  const got = codes(actual);
  const want = [...expected].sort((x, y) => x.localeCompare(y));
  const ok = got.length === want.length && got.every((c, i) => c === want[i]);
  console.log(`  ${ok ? "OK" : "MISMATCH"}`);
  if (!ok) {
    throw new Error(`recipes-demo: expected { ${want.join(", ")} }, got { ${got.join(", ")} }`);
  }
}

async function main(): Promise<void> {
  const db = await createPgliteDb();
  try {
    await runMigrations(db, CORE_MIGRATIONS);
    const venue = await seedVenue(db);

    // The whole story runs in one application-role transaction: every op takes `tx` and runs under
    // the tenant GUC `withTenant` set, and each read below sees the writes above it.
    await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);

      console.log("recipes-demo: allergen inheritance from ingredients to a product, end-to-end");
      console.log("");

      // Step 1 — three ingredients: two reviewed, one deliberately UNREVIEWED (allergens omitted →
      // null). The unreviewed one is what makes the product go PENDING in step 5.
      const alioli = await createIngredient(tx, {
        name: "alioli",
        allergens: { eggs: { presence: "contains" } },
      });
      const pan = await createIngredient(tx, {
        name: "pan",
        allergens: { gluten: { presence: "contains", source: "wheat" } },
      });
      const misterio = await createIngredient(tx, { name: "misterio" }); // allergens omitted → null

      console.log("Step 1 — ingredients (raw materials):");
      console.log(`  alioli   → ${format(alioli.allergens)}`);
      console.log(`  pan      → ${format(pan.allergens)}`);
      console.log(`  misterio → ${format(misterio.allergens)}  (unreviewed on purpose)`);
      console.log("");

      // Step 2 — a product with NO manual allergens of its own. Its declaration is whatever its
      // recipe derives (nothing, yet).
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const bocadillo = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        descriptions: { [LOCALE]: "bocadillo" },
        pricingUnit: "each",
        unitPrice: "5.50",
        vatClass: "reduced",
        // allergens omitted — no manual overlay; the recipe drives the published column.
      });
      console.log(`Step 2 — product "bocadillo" created with no manual allergens`);
      console.log(`  ${format(bocadillo.allergens)}`);
      console.log("");

      // Step 3 — give it a recipe of the two REVIEWED ingredients. The published declaration is now
      // the derived floor: eggs (from alioli) ∪ gluten (from pan).
      console.log("Step 3 — setProductRecipe(bocadillo, [alioli, pan])  → inherited floor");
      await setProductRecipe(tx, bocadillo.id, [alioli.id, pan.id]);
      expect(await readPublished(tx, bocadillo.id), ["eggs", "gluten"]);
      console.log("");

      // Step 4 — add a MANUAL declaration on the product itself ("may contain nuts — shared slicer").
      // The published column is add-only: the manual overlay UNIONS with the derived floor, it never
      // subtracts. Result: eggs ∪ gluten ∪ nuts.
      console.log(
        'Step 4 — updateProduct(bocadillo, { allergens: "may_contain nuts (shared slicer)" })',
      );
      await updateProduct(tx, bocadillo.id, {
        allergens: { nuts: { presence: "may_contain", source: "shared slicer" } },
      });
      expect(await readPublished(tx, bocadillo.id), ["eggs", "gluten", "nuts"]);
      console.log("");

      // Step 5 — add the UNREVIEWED ingredient to the recipe. A single unreviewed ingredient poisons
      // the whole derivation: the product publishes PENDING (null), never "allergen-free". This is the
      // contagion rule — the manual `nuts` does NOT rescue it.
      console.log(
        "Step 5 — setProductRecipe(bocadillo, [alioli, pan, misterio])  → PENDING contagion",
      );
      await setProductRecipe(tx, bocadillo.id, [alioli.id, pan.id, misterio.id]);
      expect(await readPublished(tx, bocadillo.id), ["<pending>"]);
      console.log("");

      // Step 6 — review the mystery ingredient. Tagging it (contains fish) propagates through every
      // product whose recipe uses it: bocadillo republishes, no longer PENDING, and the newly-known
      // fish joins the floor → eggs ∪ gluten ∪ fish, still ∪ the manual nuts.
      console.log(
        "Step 6 — updateIngredient(misterio, { allergens: { contains fish } })  → propagation",
      );
      await updateIngredient(tx, misterio.id, {
        allergens: { fish: { presence: "contains" } },
      });
      expect(await readPublished(tx, bocadillo.id), ["eggs", "fish", "gluten", "nuts"]);
      console.log("");

      console.log(
        "recipes-demo: all six steps matched — allergen inheritance is end-to-end green.",
      );
    });
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("recipes-demo: failed");
  console.error(error);
  process.exit(1);
});
