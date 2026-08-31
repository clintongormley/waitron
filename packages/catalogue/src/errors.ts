// A bare side-effect import so TypeScript augments the real "@waitron/shared" module.
import "@waitron/shared";

/** @waitron/catalogue's contribution to the shared error registry — DOMAIN-CONCEPT prefixes. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A key in a product's allergen declaration is not one of the EU-14 codes. */
    "allergen.invalid_code": { code: string };
    /** An allergen's presence is not "contains" | "may_contain". */
    "allergen.invalid_presence": { code: string; presence: string };
    /** An allergen's optional `source` is present but is not a string. */
    "allergen.invalid_source": { code: string };
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
    /**
     * A catalogue id supplied to a location-menu write (add-member / set-default) names no catalogue
     * VISIBLE to the current tenant — it is absent, or another tenant's (RLS hides it). Thrown at the
     * trust boundary as the CLEAN error in front of the data layer: both `locations.catalogue_id` and
     * `location_catalogues.catalogue_id` carry tenant-consistent composite FKs (0078 / 0074), so a
     * foreign id is `23503`-rejected there too — this guard turns that opaque 500 into a uniform 404.
     */
    "catalogue.not_found": { catalogueId: string };
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
     * `options.selection_invalid` / `options.unsupported_product`. A CLIENT request fault → mapped to
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
