// A bare side-effect import so TypeScript augments the real "@waitron/shared" module.
import "@waitron/shared";
// Type-only, so it adds no runtime edge back to the module that side-effect-imports this file.
import type { ProductUsingUnit } from "./unit-types.js";
import type { MemberRef } from "./section-types.js";

/** @waitron/catalogue's contribution to the shared error registry — DOMAIN-CONCEPT prefixes. */
declare module "@waitron/shared" {
  interface ErrorParams {
    "category.not_found": { categoryId: string };
    /** A category's name is blank once trimmed. */
    "category.invalid": { field: "name" };
    "category.parent_cycle": Record<string, never>;
    "category.membership_invalid": Record<string, never>;
    /**
     * A category delete names somewhere its products or subcategories cannot go: the category being
     * deleted, or, for `childrenTo`, a category below it.
     */
    "category.reassign_invalid": { field: "productsTo" | "childrenTo" };
    /** A sale line's classification snapshot names a category that does not exist, holds
     * an empty name, repeats a category in its chain, or ends at a category that is not the
     * product's main reporting category. */
    "sale_classification.invalid": {
      productId: string;
      reason: "unknown_id" | "empty_name" | "repeated_id" | "wrong_leaf";
    };
    /** A unit precision must be a whole number from zero through three. */
    "unit.precision_invalid": Record<string, never>;
    /** A quantity is malformed, non-positive, too precise, or past nine integer digits. */
    "quantity.invalid": { reason: "format" | "positive" | "precision" | "limit" };
    /** A unit id names no unit. */
    "unit.not_found": { unitId: string };
    /** A unit cannot be deleted while products are assigned to it. */
    "unit.in_use": { products: ProductUsingUnit[] };
    /** A unit's name or abbreviation has no text in the venue's default content language. */
    "unit.translation_required": { field: "name" | "abbreviation"; language: string };
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
    /** `detected` names the type when it is recognisable: a fact about the bytes, never the
     * bytes. */
    "media.unsupported_type": { detected?: string };
    /** A location-menu write, or a read or write of a menu's structure, names no menu. */
    "catalogue.not_found": { catalogueId: string };
    /** The menu's working state no longer hashes to what its preview showed, so nothing was
     * published. */
    "menu.changed_since_preview": { menuId: string };
    /** An order line was priced against a menu version that is not live; `liveVersionId` is null
     * when the menu has no live version among the ones the order may sell from. */
    "menu.version_changed": { menus: { menuId: string; liveVersionId: string | null }[] };
    /** The id names no home layout, or, where `menuId` is given, none of that menu's. */
    "menu.layout_not_found": { layoutId: string; menuId?: string };
    /** A menu's default home layout cannot be deleted; another must be made the default first. */
    "menu.default_layout_required": { layoutId: string };
    /** A home tile names a product or section the menu's working structure does not reach
     * (D13). */
    "menu.shortcut_unreachable": { layoutId: string; ref: MemberRef };
    /** A menu offer operation names no item the menu's structure reaches; menuId is present when
     * the route supplies it. */
    "menu_item.not_found": { menuId?: string; menuItemId: string };
    /** A variant follows its parent onto every menu and is never offered on its
     * own. */
    "menu_item.variant_not_allowed": { productId: string };
    /** A variant field is malformed or a submitted variant identity is duplicated. */
    "product.variant_invalid": { field: string };
    /** A submitted variant identity is not a variant of the product or, in a menu's variant
     * overrides, not an Active one. */
    "product.variant_not_found": { variantId: string };
    /** A product is Inactive or Unavailable, or its menu path is disabled. */
    "product.unavailable": { productId: string };
    /** A line ordered a product on its own whose published offer is `not_sold_separately`. It
     * still sells as an extra on another dish. */
    "product.not_sold_separately": { productId: string };
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
    /** `memberId` names a member the section's list does not hold. */
    "menu_section.not_found": { sectionId: string; memberId?: string };
    /** A section write's value is malformed; `field` names it. */
    "menu_section.invalid": { field: string };
    /** A section's customer names have no text in the venue's default content language. */
    "menu_section.translation_required": { field: string; language: string };
    /** Holding the child would let a section reach itself. */
    "menu_section.member_cycle": { sectionId: string; childSectionId: string };
    /** The list already holds that product or that section. */
    "menu_section.member_duplicate": { sectionId: string };
    /** `sectionId` is a list a menu owns, which the write refused. */
    "menu_section.not_library": { sectionId: string };
    /** A member reference or selection names nothing the write can use. */
    "menu_section.membership_invalid": Record<string, never>;
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
  }
}
