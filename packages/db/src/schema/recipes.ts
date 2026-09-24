import { check, index, unique } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, flag, id, json, label, newId, now, table, ts } from "./columns.js";
import { products, type AllergenMap } from "./catalogue.js";

/** A single dietary origin per ingredient. NULL = not yet categorised (a diet-PENDING ingredient,
 * contagious up a recipe — the diet analogue of `allergens IS NULL`). Drives BOTH the contains-tags
 * and the vegan/vegetarian derivation (see @waitron/catalogue `dietary.ts`). */
export const dietaryOrigin = enumType([
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
export const ingredients = table(
  "ingredients",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    allergens: json<AllergenMap>("allergens"),
    dietaryOrigin: dietaryOrigin("dietary_origin"),
    active: flag("active").notNull().default(true),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [check("ingredients_dietary_origin_ck", enumCheck(t.dietaryOrigin))],
);

/** The flat composition: which ingredients a product is made of. No quantity (allergen presence
 * is qualitative). */
export const recipeLines = table(
  "recipe_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    productId: id("product_id")
      .notNull()
      /* v8 ignore start */
      .references(() => products.id),
    /* v8 ignore stop */
    ingredientId: id("ingredient_id")
      .notNull()
      /* v8 ignore start */
      .references(() => ingredients.id),
    /* v8 ignore stop */
    createdAt: ts("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("recipe_lines_product_id_idx").on(t.productId),
    index("recipe_lines_ingredient_id_idx").on(t.ingredientId),
    unique("recipe_lines_product_ingredient_key").on(t.productId, t.ingredientId),
  ],
);
