import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { products, type AllergenMap } from "./catalogue.js";

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
export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    allergens: jsonb("allergens").$type<AllergenMap>(),
    dietaryOrigin: dietaryOrigin("dietary_origin"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("ingredients_tenant_id_idx").on(t.tenantId)],
).enableRLS();

/** The flat composition: which ingredients a product is made of. No quantity this slice (allergen
 * presence is qualitative). One row per (product, ingredient). */
export const recipeLines = pgTable(
  "recipe_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("recipe_lines_product_id_idx").on(t.productId),
    index("recipe_lines_ingredient_id_idx").on(t.ingredientId),
    unique("recipe_lines_product_ingredient_key").on(t.productId, t.ingredientId),
  ],
).enableRLS();
