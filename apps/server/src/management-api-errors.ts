import { createErrorBoundary } from "@waitron/server-kit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Every AppError code the management API answers, and its HTTP status. Client faults only. A code
 * absent from this table answers 400.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "venue.time_zone_not_ready": 409,
  "management_session.required": 401,
  "management_session.expired": 401,
  "password.invalid": 401,
  "password.throttled": 429,
  "totp.invalid": 401,
  "totp.required": 401,
  "google.invalid": 401,
  "google.already_linked": 409,
  "google.second_factor_required": 401,
  "account_action.invalid": 400,
  "account_action.rate_limited": 429,
  "node.read_only": 403,
  // The passkey login is a credential check, so its failures are 401 like `password.invalid`; an
  // expired challenge is a retryable timing fault, not a rejected credential.
  "passkey.not_registered": 401,
  "passkey.verification_failed": 401,
  "passkey.challenge_expired": 400,
  "passkey.already_registered": 409,
  "person.suspended": 403,
  "person.holds_more": 403,
  "person.self_deactivation": 403,
  "person.not_found": 404,
  "person.email_invalid": 400,
  "person.telephone_invalid": 400,
  "person.email_taken": 409,
  "person.email_missing": 409,
  "profile.invalid": 400,
  "person.display_name_taken": 409,
  "person.last_admin": 409,
  "person.roles_changed": 409,
  "role.not_permitted": 403,
  "role.not_found": 404,
  "person.transition_invalid": 409,
  "authorization.not_permitted": 403,
  "pin.too_short": 400,
  "password.too_short": 400,
  "management.request_invalid": 400,
  "receipt.invalid": 400,
  "image.invalid_file": 422,
  "shared.invalid_id": 400,
  "zone.not_found": 404,
  "zone.table_in_use": 409,
  "zone.order_in_progress": 409,
  "zone.transfer_pending": 409,
  "zone.profile_in_use": 409,
  "table.delivery_in_progress": 409,
  "zone.name_taken": 409,
  "table.not_found": 404,
  "table.label_taken": 409,
  "table.short_name_taken": 409,
  "table.booked": 409,
  "floor_plan.out_of_date": 409,
  "floor_plan.invalid": 400,
  "floor_plan_set.not_found": 404,
  "floor_plan_set.invalid": 400,
  "station.not_found": 404,
  "station.name_taken": 409,
  "station.is_default": 409,
  "station.screen_in_use": 409,
  "station.work_in_progress": 409,
  "station.thresholds_invalid": 400,
  "station.destination_invalid": 400,
  "course.not_found": 404,
  "course.name_taken": 409,
  "device_profile.not_found": 404,
  "device_profile.name_taken": 409,
  "device_profile.in_use": 409,
  "device_profile.invalid": 400,
  "device_profile.access_invalid": 400,
  "device_profile.admission_invalid": 400,
  "printer.not_found": 404,
  "menu.not_found": 404,
  "product.not_found": 404,
  "product.deleted": 409,
};
export const run = createErrorBoundary(STATUS, "management.failed");
/** For a route where these codes can only name an id the request body sent, never its path
 * (docs/developers/conventions-data.md, "A refusal's HTTP status says what was wrong"). */
const runBodyIds = (...codes: string[]) =>
  createErrorBoundary(
    { ...STATUS, ...Object.fromEntries(codes.map((code) => [code, 400] as const)) },
    "management.failed",
  );
// A device profile's create, copy and save, and a station's create and save, name their printers
// only in the body.
export const runBodyPrinters = runBodyIds("printer.not_found");
// A product's course is named by the body's `courseId`.
export const runProductCourse = runBodyIds("course.not_found");
// A floor-plan save names its existing tables by the body's `tables[].id`.
export const runFloorPlanSave = runBodyIds("table.not_found");
