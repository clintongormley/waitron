import { createErrorBoundary } from "@waitron/server-kit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { STATUS as TILL_STATUS } from "./till-api-errors.js";
import { SESSION_STATUS } from "./till-session.js";

/**
 * CLIENT faults only: a code absent here takes the boundary's 400 default. A code this surface does
 * not throw itself is mapped to the status its own surface gives it.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "device.unauthorized": 401,
  ...SESSION_STATUS,
  "device.forbidden_station": 403,
  "device.forbidden_action": 403,
  "device_profile.not_approved": 403,
  "device_profile.not_admitted": 403,
  "device_profile.incompatible": 400,
  "device.payment_in_progress": 409,
  "device_zones.invalid": 400,
  "device_zones.changed": 409,
  // The knock's own refusals. `pairing_closed` is a 403 rather than a 401: the door is shut, not
  // the caller unknown, and the device's next step is a person, not a credential.
  "device.pairing_closed": 403,
  "device.join_full": 429,
  "device.join_rate_limited": 429,
  "device.join_stale": 409,
  // A wrong number denies the request (the row is already gone), so this is a plain request fault.
  "device.join_mismatch": 400,
  "join_request.not_found": 404,
  "kitchen_screen.invalid": 400,
  "kitchen_screen.not_allowed": 400,
  "kitchen_screen.zone_not_allowed": 400,
  // A conflict the operator resolves by renaming the device.
  "device.name_taken": 409,
  "device.binding_invalid": 400,
  "device.equipment_held": 409,
  "reader.payment_in_progress": 409,
  "device_profile.not_found": 404,
  "device.not_found": 404,
  "station.not_found": 404,
  "station.not_allowed": 400,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "ticket.invalid_transition": 409,
  "ticket_item.not_found": 404,
  "ticket.item_held": 409,
  "kitchen_notice.not_found": 404,
  "ticket.pass_context_changed": 409,
};
/**
 * The pass levers run the till's Fire, Ready and Away, so they answer its codes as the till does.
 * On a lever `kitchen_screen.zone_not_allowed` means the order or party the path names is outside
 * this pass's zones: 403.
 */
export const LEVER_STATUS: Record<string, ContentfulStatusCode> = {
  ...TILL_STATUS,
  ...STATUS,
  "kitchen_screen.zone_not_allowed": 403,
};
export const run = createErrorBoundary(STATUS, "device.failed");
/** A device's edit names its profiles and made-here stations only in the body
 * (docs/developers/conventions-data.md, "A refusal's HTTP status says what was wrong"). */
export const runDeviceEdit = createErrorBoundary(
  { ...STATUS, "device_profile.not_found": 400, "station.not_found": 400 },
  "device.failed",
);
/** A kitchen screen's move names its dishes and destination station only in the body
 * (docs/developers/conventions-data.md, "A refusal's HTTP status says what was wrong"). */
export const runDeviceStationMove = createErrorBoundary(
  { ...LEVER_STATUS, "tab.line_not_found": 400, "station.not_found": 400 },
  "device.failed",
);
