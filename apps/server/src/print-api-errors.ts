import { createErrorBoundary } from "@waitron/server-kit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * A code absent from this table answers 400. The agent joins through the device knock and its
 * client reads the HTTP status, not the code, so the knock refusals reuse the `device.*` codes.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "agent.unauthorized": 401,
  "device.pairing_closed": 403,
  "device.join_full": 429,
  "device.join_rate_limited": 429,
  "printer.not_found": 404,
  "reader.not_found": 404,
  "printer.probe_busy": 429,
  "printer.bluetooth_command_busy": 429,
  "printer.bluetooth_not_discovered": 400,
  "print_job.not_found": 404,
  "print_job.not_resendable": 409,
  "invoice_delivery.active": 409,
  "print_job.payload_expired": 409,
  "print_job.sale_payload_expired": 409,
  "print_job.own_printer_only": 409,
  "print_job.printer_unsuitable": 409,
  "printer.invalid_config": 400,
  "printer.already_registered": 409,
  "printer.office_printer": 409,
  "agent.not_found": 404,
  "station.not_found": 404,
  "venue.not_found": 409,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
};
export const run = createErrorBoundary(STATUS, "print.failed");
// An equipment label names its card reader only in the body's `id`.
export const runEquipmentLabel = createErrorBoundary(
  { ...STATUS, "reader.not_found": 400 },
  "print.failed",
);
