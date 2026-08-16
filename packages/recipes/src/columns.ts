import { sql } from "drizzle-orm";
import { ingredients } from "@waitron/db";

/**
 * Shared column selections and value helpers for the recipes package. A LEAF module: it imports only
 * the `ingredients` table (from `@waitron/db`) and drizzle's `sql`, and nothing in the package's own
 * runtime graph. Both `ingredients.ts` and `recipes.ts` import from here, so the constants live in one
 * place without either file having to value-import the other — which is what would close the
 * `ingredients → recipes` runtime edge into a cycle.
 */

/** The tenant scope as an insertable value — reads the GUC the caller set via withTenant. */
export const CURRENT_TENANT = sql`current_tenant_id()`;

/**
 * The `ingredients` columns projected into the {@link Ingredient} shape. The type is annotated
 * explicitly (rather than inferred): as an EXPORTED const under `declaration: true`, an inferred type
 * naming the drizzle column classes is not portably nameable across the `@waitron/db` package boundary
 * (TS2742). Referencing each column through the imported `ingredients` binding names it via the public
 * `@waitron/db` entry point instead.
 */
export const INGREDIENT_COLUMNS: {
  id: typeof ingredients.id;
  name: typeof ingredients.name;
  allergens: typeof ingredients.allergens;
  active: typeof ingredients.active;
} = {
  id: ingredients.id,
  name: ingredients.name,
  allergens: ingredients.allergens,
  active: ingredients.active,
};
