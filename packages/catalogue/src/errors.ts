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
    /** Nothing throws this any more: deleting a category cascades instead of being refused. Kept
     * registered because a shipped code is never removed, only left unthrown. */
    "category.in_use": { children: number; products: number; routes: number };
    /** The three `modifier.*` codes below are no longer thrown by anything: the option-group model
     * that raised them is gone, and Extras and Options refuse under their own `extras.*` /
     * `options.*` codes. Kept registered because a shipped code is never removed, only left
     * unthrown — the posture `category.in_use` above takes. */
    "modifier.invalid": { field: string };
    "modifier.not_found": { modifierId: string };
    "modifier.in_use": { modifierId: string; dependency: string };
    /** A unit precision must be a whole number from zero through three. */
    "unit.precision_invalid": Record<string, never>;
    /** A quantity is malformed, non-positive, too precise, or past nine integer digits. */
    "quantity.invalid": { reason: "format" | "positive" | "precision" | "limit" };
    /** A unit id names no unit. */
    "unit.not_found": { unitId: string };
    /** A unit cannot be deleted while products retain real assignments to it; each product carries
     * its id and availability so a caller can list them and link to each product's editor. */
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
    /** An image upload carried no file part in the multipart body. Thrown by the server route. */
    "media.missing": Record<string, never>;
    /**
     * The uploaded bytes are not an accepted image type (JPEG/PNG/WEBP). `detected` names the type
     * when it is recognisable (e.g. `"gif"`); it carries a fact about the bytes, never the bytes.
     */
    "media.unsupported_type": { detected?: string };
    /**
     * The uploaded image exceeds `maxUploadBytes`. Thrown by the server route. Facts, not bytes.
     * `size` is the true `file.size` when the precise per-file check rejects it, but a LOWER BOUND
     * (the raw-body ceiling that was exceeded) when the coarse `bodyLimit` middleware rejects the
     * stream before the file is measured — so a consumer must not render it as "your file was N bytes".
     */
    "media.too_large": { size: number; limit: number };
    /** A location-menu write names no catalogue. The trust-boundary check returns 404 before
     * the foreign-key backstop would reject the missing reference with 23503. */
    "catalogue.not_found": { catalogueId: string };
    /** A menu offer operation names no active item; menuId is present when the route supplies it. */
    "menu_item.not_found": { menuId?: string; menuItemId: string };
    /** A menu offer was asked for a variant. A variant follows its parent onto every menu the
     * parent is on (spec §15.5) and is never offered on its own. */
    "menu_item.variant_not_allowed": { productId: string };
    /** A variant field is malformed or a submitted variant identity is duplicated. */
    "product.variant_invalid": { field: string };
    /** A submitted variant identity is not a variant of the product or, in a menu's variant
     * overrides, not an Active one. */
    "product.variant_not_found": { variantId: string };
    /** A variant could not be removed while menu offers still published it. Nothing throws it
     * now: removing a variant makes it Inactive and is always allowed (spec §15.6). Kept
     * registered because a shipped code is never removed. */
    "product.variant_in_use": { variantId: string; menuItemIds: string[] };
    /** A product is Inactive or Unavailable, or its menu path is disabled. */
    "product.unavailable": { productId: string };
    /** A product with Active variants cannot be sold from a menu offer without selecting one; the
     * bare-`productId` path does not throw it. */
    "product.variant_required": { productId: string };
    /** A selected variant is disabled or absent from the menu offer. */
    "product.variant_unavailable": { variantId: string };
    /** A product-editor field is missing or malformed. */
    "product.invalid": { field: string };
    "product.not_found": { productId: string };
    /** A product's variant COUNT was not allowed: exactly one variant was refused. Nothing throws
     * it now — a product may have one variant (spec §15.1). Kept registered because a shipped code
     * is never removed. */
    "product.variant_count_invalid": { minimum: number };
    "menu_section.not_found": { menuId?: string; sectionId: string };
    /**
     * An option group's AUTHORING config was refused. Nothing throws it any more — the option-group
     * model it belonged to is gone, and an options list's own authoring refusals are
     * `options.invalid` below. Kept registered because a shipped code is never removed, only left
     * unthrown. `reason` was always a stable CODE a translator renders, never prose, and no ids or
     * offending numbers were carried (the no-leak discipline). `options.*` names the DOMAIN CONCEPT,
     * never the throwing package. A CLIENT request fault → mapped to 400 by the server's catalogue
     * STATUS map. Never renamed once shipped.
     */
    "options.group_invalid": { reason: string };
    /**
     * An option ITEM's AUTHORING config was refused — the item-level sibling of
     * `options.group_invalid` above, and unthrown for the same reason. An extras item's own bounds
     * are refused as `extras.invalid` below. Kept registered because a shipped code is never
     * removed, only left unthrown. Never renamed once shipped.
     */
    "options.item_invalid": { reason: string };
    /**
     * An options list's authoring body is malformed: a missing or blank staff name, a name map with a
     * non-text entry, an unknown key, a bad label id, or a `defaultLabelId` naming no label of the
     * list. `field` is the dotted path of the offending value (`"name"`, `"labels.0.kitchenName"`),
     * so the editor can put the refusal beside the input that caused it. It also covers a structurally
     * bad ORDER-time selection list — not an array, an unknown key, a non-string id, or an answer for
     * a list that was never offered — where `field` names the offending path in that body
     * (`"optionSelections"`, `"listId"`). A CLIENT request fault. Thrown by
     * `parseOptionListInput` / `validateOptionSelections` (option-contract.ts) and by `writeLabels`
     * (options.ts), which refuses a body label id that another list holds.
     */
    "options.invalid": { field: string };
    /** An options list id names no list. */
    "options.not_found": { optionListId: string };
    /**
     * An options list's customer-facing name — its own, or one of its labels' — has no text in the
     * venue's default content language. `field` is the dotted path of the offending map
     * (`"customerName"`, `"labels.2.customerName"`), the same paths `parseOptionListInput` reports,
     * because one save submits a translated map for the list AND one per label and a refusal naming
     * only the language cannot be placed beside an input. The kind-specific counterpart of
     * `content.translation_required`: `validateNames` (options.ts) asks `findContentTranslationGap`
     * (content-languages.ts) which of the maps has the gap — that function RETURNS the map's index
     * and the language rather than throwing anything — and `validateNames` throws this code with
     * that map's field path. Nothing on the options path throws `content.translation_required`
     * itself. A CLIENT request fault.
     */
    "options.translation_required": { field: string; language: string };
    /** Registered because Task 2 Step 7 of
     * `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md` names it, in the
     * `dependency: string` shape that step declares and the sibling `modifier.in_use` above already
     * has. NOTHING throws it: the design has a list delete cascade its product attachments rather
     * than refuse (spec 2026-09-18-one-product-model-design.md §2.3). It stays registered unthrown,
     * because a shipped code is never removed. */
    "options.in_use": { optionListId: string; dependency: string };
    /**
     * An order line answered an active options list with nothing, or with a label that list does not
     * carry or has withdrawn. Every active list a dish asks must be answered with one available
     * label, so this is the order-time counterpart of `options.invalid`: the body's SHAPE was fine
     * and its CONTENT is not orderable. Carries only the list's id — the caller knows which dish it
     * was asking about. Thrown by `validateOptionSelections` (option-contract.ts).
     */
    "options.label_required": { optionListId: string };
    /**
     * An extras list's authoring body is malformed: a missing or blank staff name, a name map with a
     * non-text entry, an unknown key, a bad id, a pick bound that is not a whole number or leaves
     * `maxPicks` below `minPicks`, a `maxQuantity` below one, or a malformed price. `field` is the
     * dotted path of the offending value (`"maxPicks"`, `"items.1.maxQuantity"`), so the editor can
     * put the refusal beside the input that caused it. It also covers a structurally bad ORDER-time
     * selection body — not an array, an unknown key, a non-string id, a pick naming a product the
     * list does not carry, or an answer for a list that was never offered — where `field` names the
     * offending path in that body (`"extraSelections"`, `"listId"`, `"productId"`). And it covers a
     * malformed PER-MENU publication body — not an array, an unknown key, a bad list or product id,
     * one list published twice, one product overridden twice within a list, a malformed price, or a
     * non-boolean `available` — where `field` is that body's own dotted path, rooted at `"lists"`
     * (`"lists.0.listId"`, `"lists.0.items.1.productId"`). A CLIENT request fault.
     *
     * Thrown by `parseExtraListInput`, `parseMenuExtraPublications` and `validateExtraSelections`
     * (extra-contract.ts); and by `assertProductsExist`, `writeItems` and `assertProductsOffered`
     * (extras.ts), which refuse an item naming no `products` row, an item id another list or another
     * transaction already holds, and a menu override naming a product its list does not offer.
     */
    "extras.invalid": { field: string };
    /** An extras list id names no list. */
    "extras.not_found": { extraListId: string };
    /** Registered in the `dependency: string` shape the sibling `modifier.in_use` above already has.
     * NOTHING throws it: the design has a list delete cascade its attachments rather than refuse
     * (spec 2026-09-18-one-product-model-design.md §3.5). It stays registered unthrown, because a
     * shipped code is never removed. */
    "extras.in_use": { extraListId: string; dependency: string };
    /**
     * An order line's answer to an extras list breaks one of that list's COUNTS: fewer picks than
     * `minPicks`, more than `maxPicks`, or a quantity above one item's `maxQuantity`. The body's
     * SHAPE was fine and its CONTENT is not orderable, which is what separates this from
     * `extras.invalid` — the same split `options.label_required` has from `options.invalid`. Carries
     * only the list's id, under the same qualified name its `extras.*` and `options.*` siblings use:
     * the caller knows which dish it was asking about. Thrown by `validateExtraSelections`
     * (extra-contract.ts).
     */
    "extras.limit_exceeded": { extraListId: string };
    /**
     * An extras list's customer-facing name has no text in the venue's default content language.
     * `field` is the dotted path of the offending map (`"customerName"`), matching the paths
     * `parseExtraListInput` reports. The sibling of `options.translation_required`; an extras list
     * holds ONE such map (its items name products and carry no names), so the path is always
     * `"customerName"` today. Thrown by `validateNames` (extras.ts), which asks
     * `findContentTranslationGap` (content-languages.ts) — that function RETURNS which map has the
     * gap rather than throwing it, though it does throw `content.translation_invalid` for a value
     * that is not text — and attaches the field path.
     */
    "extras.translation_required": { field: string; language: string };
    /**
     * A product cannot be removed while something still names it — an extras list item, or one menu
     * offer's repriced copy of that item, today.
     * Registered ahead of a thrower: no route deletes a product, and nothing outside test fixtures
     * deletes a `products` row, so there is no path to refuse from. Searched on 2026-09-19:
     * `grep -rn 'app\.delete(' apps/server/src --include="*.ts"` lists every DELETE route and none
     * of them is products; `grep -rn '\.delete(products)' packages apps --include="*.ts"` and
     * `grep -rn 'delete from products' packages apps --include="*.ts"` find only test files,
     * fixtures, and the comments — this one among them — that quote the commands. The dashboard's
     * `#deleteProduct` (apps/dashboard/src/screens/catalogue-screen.ts) sets `active: false`
     * through the product editor rather than deleting anything. What refuses today is the database:
     * `extra_list_items.product_id` and `menu_item_extra_items.product_id` are both
     * `ON DELETE RESTRICT` (schema/extras.ts).
     */
    "product.in_use": { productId: string; dependency: string };
  }
}
