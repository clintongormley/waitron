import { ingredients } from "@waitron/db";

// Shared selections keep the ingredients → recipes runtime dependency acyclic.

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
  dietaryOrigin: typeof ingredients.dietaryOrigin;
  active: typeof ingredients.active;
} = {
  id: ingredients.id,
  name: ingredients.name,
  allergens: ingredients.allergens,
  dietaryOrigin: ingredients.dietaryOrigin,
  active: ingredients.active,
};
