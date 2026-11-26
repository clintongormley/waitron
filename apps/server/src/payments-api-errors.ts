import { createErrorBoundary } from "@waitron/server-kit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const STATUS: Record<string, ContentfulStatusCode> = {
  "fiscal.fingerprint_mismatch": 409,
  "fiscal.chain_handed_over": 409,
  "venue.time_zone_not_ready": 409,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "payment.provider_unknown": 409,
  "payment.provider_credential_rejected": 409,
  "payment.credential_environment_mismatch": 409,
  "payment.provider_merchant_ambiguous": 409,
  "payment.provider_in_use": 409,
  "payment.provider_disabled": 409,
  "payment.test_providers_prepare_only": 409,
  "module.disabled": 409,
  "settings.out_of_date": 409,
  "settings.invalid": 500,
  "payment.pairing_refused": 400,
  "reader.provider_disconnected": 409,
  "reader.not_found": 404,
  "reader.not_listed": 400,
  "reader.reference_unknown": 400,
  "reader.payment_in_progress": 409,
  "reader.unpair_failed": 502,
  "reader.unpair_in_progress": 409,
  "reader.removed_while_adding": 409,
  "reader.unpair_unsupported": 409,
  "device.not_found": 404,
  "device.binding_invalid": 400,
  "device.equipment_held": 409,
  "device_profile.not_found": 404,
  "device_profile.invalid": 400,
  "payment.not_stuck": 409,
  "payment.hold_not_found": 404,
  "payment.hold_already_recorded": 409,
  "payment.resolve_unsupported": 409,
  "payment.outcome_unknown": 409,
  "bill.payment_not_found": 404,
  "tender.refund_not_found": 404,
  "tender.refund_not_stuck": 409,
  "tender.refund_outcome_unconfirmed": 409,
  "tender.attestation_contradicted": 409,
  "bill.refund_not_found": 404,
  "bill.refund_not_stuck": 409,
  "bill.refund_outcome_unconfirmed": 409,
  "bill.attestation_contradicted": 409,
  "bill.payment_not_stuck": 409,
  "bill.payment_outcome_unconfirmed": 409,
  "payment.not_refundable": 409,
  "payment.refund_exceeds_capture": 409,
  "sale.number_reused": 409,
  "clock.unconfirmed": 409,
  "clock.unusable": 409,
  "pin.invalid": 401,
  "pin.throttled": 429,
};
export const run = createErrorBoundary(STATUS, "payments.failed");
// The provider routes name their provider in the address.
export const runPathProvider = createErrorBoundary(
  { ...STATUS, "payment.provider_unknown": 404 },
  "payments.failed",
);
// Connect names its provider in the address and refuses the credential the body carries.
export const runConnect = createErrorBoundary(
  {
    ...STATUS,
    "payment.provider_unknown": 404,
    "payment.provider_credential_rejected": 400,
    "payment.credential_environment_mismatch": 400,
  },
  "payments.failed",
);
// Pairing and adoption name their provider only in the body's `providerId`.
export const runBodyProvider = createErrorBoundary(
  { ...STATUS, "payment.provider_unknown": 400 },
  "payments.failed",
);
// A device's reader and a profile's reader list name their readers only in the body's `readerId`
// and `readerIds`.
export const runBodyReaders = createErrorBoundary(
  { ...STATUS, "reader.not_found": 400 },
  "payments.failed",
);
