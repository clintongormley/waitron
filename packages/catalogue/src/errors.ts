// A bare side-effect import so TypeScript augments the real "@waitron/shared" module.
import "@waitron/shared";
// Type-only, so it adds no runtime edge back to the module that side-effect-imports this file.
import type { ProductUsingUnit } from "./unit-types.js";

/** @waitron/catalogue's contribution to the shared error registry — DOMAIN-CONCEPT prefixes. */
declare module "@waitron/shared" {
  interface ErrorParams {
    "category.not_found": { categoryId: string };
    "category.parent_cycle": Record<string, never>;
    "category.image_not_found": Record<string, never>;
    /** A category colour is neither null nor a lower-case `#rrggbb` string. */
    "category.color_invalid": Record<string, never>;
    "category.membership_invalid": Record<string, never>;
    "category.primary_required": Record<string, never>;
    /** Not thrown: deleting a category cascades instead. Kept because a shipped code is never
     * removed. */
    "category.in_use": { children: number; products: number; routes: number };
    /** The three `modifier.*` codes below are not thrown: Extras and Options refuse under their own
     * `extras.*` / `options.*` codes. Kept because a shipped code is never removed. */
    "modifier.invalid": { field: string };
    "modifier.not_found": { modifierId: string };
    "modifier.in_use": { modifierId: string; dependency: string };
    /** A unit precision must be a whole number from zero through three. */
    "unit.precision_invalid": Record<string, never>;
    /** A quantity is malformed, non-positive, too precise, or past nine integer digits. */
    "quantity.invalid": { reason: "format" | "positive" | "precision" | "limit" };
    /** A unit id names no unit. */
    "unit.not_found": { unitId: string };
    /** A unit cannot be deleted while products are assigned to it. */
    "unit.in_use": { products: ProductUsingUnit[] };
    /** Content configuration requires distinct languages and an enabled default. */
    "content.languages_invalid": Record<string, never>;
    /** A translation map contains a non-text value. */
    "content.translation_invalid": Record<string, never>;
    /** Required content has no text in the configured default language. */
    "content.translation_required": { language: string };
    /** Required content needs translating before the default can change. */
    "content.default_missing": { language: string; count: number };
    /** A key in a product's allergen declaration is not one of the EU-14 codes. */
    "allergen.invalid_code": { code: string };
    /** An allergen's presence is not "contains" | "may_contain". */
    "allergen.invalid_presence": { code: string; presence: string };
    /** An allergen's optional `source` is present but is not a string. */
    "allergen.invalid_source": { code: string };
    /** A direct dietary declaration is not one of the supported suitability labels. */
    "diet.declaration_invalid": Record<string, never>;
    /** A supplied dietary origin is not one of the `DIETARY_ORIGINS`. */
    "diet.invalid_origin": { origin: string };
    /** A supplied diet label (`vegan`/`vegetarian`/…) is not an accepted value for `field`. */
    "diet.invalid_label": { field: string; value: string };
    /** A diet override both adds and removes the same contains-tag — a contradiction. */
    "diet.add_remove_conflict": { tag: string };
    /** Not thrown (`packages/media` refuses as `image.invalid_metadata`). Kept because a shipped
     * code is never removed. */
    "media.missing": Record<string, never>;
    /** `detected` names the type when it is recognisable: a fact about the bytes, never the
     * bytes. */
    "media.unsupported_type": { detected?: string };
    /** Not thrown (`packages/media` refuses as `image.too_large`). Kept because a shipped code is
     * never removed. */
    "media.too_large": { size: number; limit: number };
    /** A location-menu write names no catalogue. */
    "catalogue.not_found": { catalogueId: string };
    /** A menu offer operation names no active item; menuId is present when the route supplies it. */
    "menu_item.not_found": { menuId?: string; menuItemId: string };
    /** A variant follows its parent onto every menu (spec §15.5) and is never offered on its
     * own. */
    "menu_item.variant_not_allowed": { productId: string };
    /** A variant field is malformed or a submitted variant identity is duplicated. */
    "product.variant_invalid": { field: string };
    /** A submitted variant identity is not a variant of the product or, in a menu's variant
     * overrides, not an Active one. */
    "product.variant_not_found": { variantId: string };
    /** Not thrown: removing a variant makes it Inactive and is always allowed (spec §15.6). Kept
     * because a shipped code is never removed. */
    "product.variant_in_use": { variantId: string; menuItemIds: string[] };
    /** A product is Inactive or Unavailable, or its menu path is disabled. */
    "product.unavailable": { productId: string };
    /** A product with Active variants was sold as itself: a dish line from a menu offer that named
     * no variant, a dish line on the plain `productId` path or an extras pick (neither can name a
     * variant), or a raised quantity on a held line whose product has gained one since. */
    "product.variant_required": { productId: string };
    /** A selected variant is disabled or absent from the menu offer. */
    "product.variant_unavailable": { variantId: string };
    /**
     * A save would leave a product with at least one Active variant while an extras list offers it.
     * `extraLists` is every such list. `field` is `variants.<i>.active` of the first variant a
     * parent's save leaves Active, or `active` on a variant's own save.
     */
    "product.offered_as_extra": { field: string; extraLists: { id: string; name: string }[] };
    /** A product-editor field is missing or malformed. */
    "product.invalid": { field: string };
    "product.not_found": { productId: string };
    /** Not thrown: a product may have one variant (spec §15.1). Kept because a shipped code is
     * never removed. */
    "product.variant_count_invalid": { minimum: number };
    "menu_section.not_found": { menuId?: string; sectionId: string };
    /** Not thrown: options-list authoring refuses as `options.invalid`. Kept because a shipped code
     * is never removed. */
    "options.group_invalid": { reason: string };
    /** Not thrown. Kept because a shipped code is never removed. */
    "options.item_invalid": { reason: string };
    /**
     * An options list's authoring body, or an ORDER-time selection list, is refused. `field` is the
     * dotted path of the offending value (`"labels.0.kitchenName"`, `"listId"`), so the editor can
     * put the refusal beside the input that caused it.
     */
    "options.invalid": { field: string };
    /** An options list id names no list. */
    "options.not_found": { optionListId: string };
    /**
     * An options list's customer-facing name — its own, or one of its labels' — has no text in the
     * venue's default content language. Unlike `content.translation_required` it carries `field`
     * (`"labels.2.customerName"`), because one save submits several translated maps and a refusal
     * naming only the language cannot be placed beside an input.
     */
    "options.translation_required": { field: string; language: string };
    /** Not thrown: deleting a list cascades its product attachments. Kept because a shipped code is
     * never removed. */
    "options.in_use": { optionListId: string; dependency: string };
    /**
     * An order line answered an active options list with nothing, or with a label that list does not
     * carry or has withdrawn: the body's SHAPE was fine and its CONTENT is not orderable.
     */
    "options.label_required": { optionListId: string };
    /**
     * An extras list's authoring body, an ORDER-time selection body, or a PER-MENU publication body
     * is refused. `field` is the dotted path of the offending value in that body (`"maxPicks"`,
     * `"items.1.maxQuantity"`, `"lists.0.listId"`), so the editor can put the refusal beside the
     * input that caused it.
     */
    "extras.invalid": { field: string };
    /** An extras list id names no list. */
    "extras.not_found": { extraListId: string };
    /** Not thrown: deleting a list cascades its attachments. Kept because a shipped code is never
     * removed. */
    "extras.in_use": { extraListId: string; dependency: string };
    /**
     * An order line's answer to an extras list breaks one of that list's COUNTS (`minPicks`,
     * `maxPicks`, an item's `maxQuantity`): the body's SHAPE was fine and its CONTENT is not
     * orderable.
     */
    "extras.limit_exceeded": { extraListId: string };
    /** The extras sibling of `options.translation_required`. */
    "extras.translation_required": { field: string; language: string };
    /**
     * An extras list save names a product with at least one Active variant, Available or not; the
     * till never offers such a product as an extra. `field` is `items.<i>.productId` of the first.
     */
    "extras.product_has_variants": { field: string; productId: string };
    /** Not thrown. Kept because a shipped code is never removed. */
    "product.in_use": { productId: string; dependency: string };
  }
}
