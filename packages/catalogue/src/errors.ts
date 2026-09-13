// A bare side-effect import so TypeScript augments the real "@waitron/shared" module.
import "@waitron/shared";

/** @waitron/catalogue's contribution to the shared error registry — DOMAIN-CONCEPT prefixes. */
declare module "@waitron/shared" {
  interface ErrorParams {
    "category.not_found": { categoryId: string };
    "category.parent_cycle": Record<string, never>;
    "category.image_not_found": Record<string, never>;
    "category.membership_invalid": Record<string, never>;
    "category.primary_required": Record<string, never>;
    "category.in_use": { children: number; products: number; routes: number };
    "modifier.invalid": { field: string };
    "modifier.not_found": { modifierId: string };
    "modifier.in_use": { modifierId: string; dependency: string };
    /** A unit precision must be a whole number from zero through three. */
    "unit.precision_invalid": Record<string, never>;
    /** A quantity is malformed, non-positive, too precise, or outside numeric(12,3). */
    "quantity.invalid": { reason: "format" | "positive" | "precision" | "limit" };
    /** A unit id is absent from the caller's tenant. */
    "unit.not_found": { unitId: string };
    /** A unit cannot be deleted while products retain real assignments to it; each product carries
     * its id and availability so a caller can list them and link to each product's editor. */
    "unit.in_use": {
      products: { id: string; name: Record<string, string>; available: boolean }[];
    };
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
    /** An option's allergen overlay adds and removes the same EU-14 code — a contradiction. */
    "allergen.add_remove_conflict": { code: string };
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
     * the composite FK backstop would reject the missing reference with 23503. Composite FKs also
     * reject tenant-inconsistent references; catalogue existence alone does not check that. */
    "catalogue.not_found": { catalogueId: string };
    /** A menu offer operation names no active item; menuId is present when the route supplies it. */
    "menu_item.not_found": { menuId?: string; menuItemId: string };
    /** A variant field is malformed or a submitted variant identity is duplicated. */
    "product.variant_invalid": { field: string };
    /** A submitted variant identity does not belong to the product. */
    "product.variant_not_found": { variantId: string };
    /** A variant cannot be removed while menu offers still publish it. */
    "product.variant_in_use": { variantId: string; menuItemIds: string[] };
    /** A product or its menu path is disabled. */
    "product.unavailable": { productId: string };
    /** A product with variants cannot be sold without selecting one. */
    "product.variant_required": { productId: string };
    /** A selected variant is disabled or absent from the menu offer. */
    "product.variant_unavailable": { variantId: string };
    /** A product-editor field is missing or malformed. */
    "product.invalid": { field: string };
    "product.not_found": { productId: string };
    "menu_section.not_found": { menuId?: string; sectionId: string };
    /**
     * An option group's AUTHORING config violated one of its DB invariants (ordering modifiers, Task
     * 11): the select bounds must satisfy `max_select >= min_select >= 0`, and a `required` group must
     * carry `min_select >= 1`. Thrown by `createOptionGroup` / `updateOptionGroup` BEFORE the write, so
     * the dashboard editor gets a clean 4xx rather than the opaque 500 the `option_groups_select_ck` /
     * `option_groups_required_ck` CHECK constraints (catalogue.ts) would raise as a backstop. `reason`
     * is a stable CODE a translator renders, never prose — `"select_bounds"` (max < min, or min < 0) or
     * `"required_without_min"` (required with min_select < 1) — matching the `reason`-code shape the
     * sale-time `options.selection_invalid` (apps/server) uses. No ids: on a create there is no group id
     * yet, and the offending numbers are request echo, not carried (the no-leak discipline). `options.*`
     * names the DOMAIN CONCEPT (a menu-option group), never the throwing package, beside the sale-time
     * `options.selection_invalid`. A CLIENT request fault → mapped to
     * 400 by the server's catalogue STATUS map. Never renamed once shipped.
     */
    "options.group_invalid": { reason: string };
    /**
     * An option ITEM's AUTHORING config violated one of its DB invariants (per-option quantity): its
     * `max_quantity` must be an integer >= 1 (1 = no per-option quantity). Thrown by
     * `createOptionGroupItem` / `updateOptionGroupItem` BEFORE the write, so the dashboard editor gets a
     * clean 4xx rather than the opaque 500 the `option_group_items_qty_ck` CHECK (catalogue.ts) would
     * raise as a backstop. `reason` is a stable CODE a translator renders, never prose —
     * `"max_quantity"` names the offending field, matching the `reason`-code shape of the sibling
     * group-level `options.group_invalid`. No ids/values: the offending number is request echo, not
     * carried (the no-leak discipline). `options.*` names the DOMAIN CONCEPT (a menu-option item),
     * never the throwing package, beside `options.group_invalid` / `options.selection_invalid`. A
     * CLIENT request fault → mapped to 400 by the server's catalogue STATUS map. Never renamed once
     * shipped.
     */
    "options.item_invalid": { reason: string };
  }
}
