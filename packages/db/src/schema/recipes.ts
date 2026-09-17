import { index, pgEnum, unique } from "drizzle-orm/pg-core";
import { products, type AllergenMap } from "./catalogue.js";
import { flag, id, json, label, table, ts } from "./columns.js";

/** A single dietary origin per ingredient. NULL = not yet categorised (a diet-PENDING ingredient,
 * contagious up a recipe — the diet analogue of `allergens IS NULL`). Drives BOTH the contains-tags
 * and the vegan/vegetarian derivation (see @waitron/catalogue `dietary.ts`). */
export const dietaryOrigin = pgEnum("dietary_origin", [
  "plant",
  "meat",
  "fish",
  "shellfish",
  "dairy",
  "egg",
  "honey",
  "other_animal",
]);

/** A raw material / prep item. Carries its own EU-1169 allergen declaration (the same shape as
 * `products.allergens`); NULL = not yet reviewed (a PENDING ingredient, contagious up a recipe).
 * Deactivate via `active`, never DELETE — it may be referenced by `recipe_lines`. */
export const ingredients = table("ingredients", {
  id: id("id").primaryKey().defaultRandom(),
  name: label("name").notNull(),
  allergens: json<AllergenMap>("allergens"),
  dietaryOrigin: dietaryOrigin("dietary_origin"),
  active: flag("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** The flat composition: which ingredients a product is made of. No quantity this slice (allergen
 * presence is qualitative). One row per (product, ingredient). */
export const recipeLines = table(
  "recipe_lines",
  {
    id: id("id").primaryKey().defaultRandom(),
    productId: id("product_id")
      .notNull()
      .references(() => products.id),
    ingredientId: id("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("recipe_lines_product_id_idx").on(t.productId),
    index("recipe_lines_ingredient_id_idx").on(t.ingredientId),
    unique("recipe_lines_product_ingredient_key").on(t.productId, t.ingredientId),
  ],
);
