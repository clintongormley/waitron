// Browser-safe: the remedy route answers these codes with these statuses, and the Fiscal filing
// page's case dialog words each one. A 400 here is what the route's error boundary answers for a
// code it does not list.
export const REMEDY_REFUSALS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "management_session.proof_required": 400,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "fiscal.remedy_disabled": 409,
  "fiscal.remedy_invalid": 400,
  "fiscal.remedy_request_invalid": 400,
  "fiscal.remedy_amount_changed": 400,
  "fiscal.remedy_class_changed": 400,
  "fiscal.remedy_issuer_changed": 400,
  "fiscal.remedy_printed_fact_changed": 400,
  "filing_case.not_found": 400,
  "filing_case.action_mismatch": 409,
  "filing_case.already_resolved": 409,
  "fiscal.record_already_corrected": 409,
  "fiscal.chain_handed_over": 409,
  "node.read_only": 409,
  "clock.behind_chain": 409,
  "clock.unconfirmed": 409,
  "clock.unusable": 409,
  "venue.time_zone_not_ready": 409,
  "storage.disk_full": 507,
} as const;

export type RemedyRefusal = keyof typeof REMEDY_REFUSALS;
