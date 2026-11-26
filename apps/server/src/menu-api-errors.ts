import { createErrorBoundary } from "@waitron/server-kit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "shared.invalid_decimal": 400,
  "shared.decimal_overflow": 400,
  "menu.not_found": 404,
  "set_menu.not_found": 404,
  "set_menu.invalid": 400,
  "set_menu.dishes_only": 409,
  "set_menu.dish_sold_by_measure": 409,
  "set_menu.wrong_place": 409,
  "set_menu.not_publishable": 409,
  "menu.name_taken": 409,
  "category.not_found": 404,
  "category.invalid": 400,
  "category.parent_cycle": 409,
  "menu_item.not_found": 404,
  "menu_item.has_variants": 400,
  "product.not_found": 404,
  "product.invalid": 400,
  "menu_section.not_found": 404,
  "menu_section.invalid": 400,
  "menu_section.translation_required": 400,
  "menu_section.membership_invalid": 400,
  // 409: the body was well formed, and what the stored lists hold refused it.
  "menu_section.member_cycle": 409,
  "menu_section.member_duplicate": 409,

  // Routes that can name a wrong role only in the body answer 400 through runBodyIds.
  "menu_section.wrong_role": 409,
  // The working menu no longer matches the preview the publish was asked from.
  "menu.changed_since_preview": 409,
  "menu.deleted": 409,
  "menu.delete_default": 409,
  "menu_period.delete_replacement": 409,
  "menu.clashes_unresolved": 409,
  "menu_publication.overtakes_queued": 409,
  "menu_publication.not_found": 404,
  "menu_publication.not_queued": 409,
  "menu_publication.time_past": 400,
  "menu_publication.unchanged": 409,
  "menu_publication.time_skipped": 400,
  "menu_publication.time_repeated": 400,
  "menu_patch.invalid": 400,
  "menu_patch.not_published": 409,
  "menu_patch.base_changed": 409,
  "menu_patch.declarations_changed": 409,
  "menu_patch.unchanged": 409,
  "time_zone.unreadable": 500,
  "menu.reset_required": 500,
  "menu.shortcut_unreachable": 400,
  // The product editor refuses a course this venue does not have.
  "course.not_found": 400,
  "allergen.invalid_code": 400,
  "allergen.kinds_required": 400,
  "allergen.invalid_kind": 400,
  "diet.invalid_contains_tag": 400,
  "diet.invalid_label": 400,
  "diet.add_remove_conflict": 400,
  "options.invalid": 400,
  "options.translation_required": 400,
  "options.not_found": 404,
  "extras.invalid": 400,
  "extras.translation_required": 400,
  "extras.not_found": 404,
  // Raised on the till surface (a diner's picks), never by a route here.
  "extras.limit_exceeded": 400,
  "extras.product_has_variants": 400,
  "product.offered_as_extra": 409,
  "category.name_taken": 409,
  "category.contents_changed": 409,
  "product.name_taken": 409,
  "product.deleted": 409,
  "product.on_live_menu": 409,
};
export const run = createErrorBoundary(STATUS, "menu.failed");
/** For a route where these codes are raised by what the request body or query string names
 * (docs/developers/conventions-data.md, "A refusal's HTTP status says what was wrong"). On the
 * member add and replace routes `set_menu.not_found` also comes from an inactive set menu owning
 * the list in the path. */
const runBodyIds = (...codes: string[]) =>
  createErrorBoundary(
    { ...STATUS, ...Object.fromEntries(codes.map((code) => [code, 400] as const)) },
    "menu.failed",
  );
// A product create names its menu and its category in the body.
export const runCreateProduct = runBodyIds("menu.not_found", "category.not_found");
export const runBodyMenu = runBodyIds("menu.not_found");
export const runBodyCategory = runBodyIds("category.not_found");
export const runBodyProduct = runBodyIds("product.not_found");
// A folder move or delete names its products and folders in the body.
export const runFolder = runBodyIds("category.not_found", "product.not_found");
export const runBodySection = runBodyIds("menu_section.not_found", "menu_section.wrong_role");
export const runBodySetMenu = runBodyIds("set_menu.not_found");
export const runStructureSave = runBodyIds(
  "menu_section.not_found",
  "menu_section.wrong_role",
  "set_menu.not_found",
  "product.not_found",
);
