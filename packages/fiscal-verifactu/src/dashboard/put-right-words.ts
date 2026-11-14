import type { RemedyRefusal } from "../remedy-refusals.js";
import type { AeatCertificateKey } from "./strings.js";

/** The case dialog's sentence for each refusal the remedy route can give. */
// refused.not_sent and .record_invalid call their codes a fault in Waitron because the dialog sends
// only a description, after refusing a blank one and any descriptionProblem; .fingerprint checks the
// record the server just built, and .setup a registration that is only ever replaced in the same
// transaction (registro-sif.ts, allocation.ts).
export const REFUSAL_WORDS: Record<RemedyRefusal, AeatCertificateKey> = {
  "management_session.required": "fiscal_filing.refused.signed_out",
  "management_session.expired": "fiscal_filing.refused.signed_out",
  "management_session.proof_required": "fiscal_filing.refused.fresh_sign_in",
  "person.suspended": "fiscal_filing.refused.admin",
  "authorization.not_permitted": "fiscal_filing.refused.admin",
  "fiscal.remedy_disabled": "fiscal_filing.put_right.none.not-yet",
  "fiscal.remedy_invalid": "fiscal_filing.refused.changed",
  "fiscal.remedy_request_invalid": "fiscal_filing.refused.not_sent",
  "fiscal.remedy_amount_changed": "fiscal_filing.refused.not_sent",
  "fiscal.remedy_class_changed": "fiscal_filing.refused.not_sent",
  "fiscal.remedy_issuer_changed": "fiscal_filing.refused.not_sent",
  "fiscal.remedy_printed_fact_changed": "fiscal_filing.refused.not_sent",
  "filing_case.not_found": "fiscal_filing.refused.changed",
  "filing_case.action_mismatch": "fiscal_filing.refused.changed",
  "filing_case.already_resolved": "fiscal_filing.refused.changed",
  "fiscal.record_already_corrected": "fiscal_filing.refused.changed",
  "fiscal.chain_handed_over": "fiscal_filing.refused.not_main",
  "node.read_only": "fiscal_filing.refused.not_main",
  "clock.behind_chain": "fiscal_filing.refused.clock_behind",
  "clock.unconfirmed": "fiscal_filing.refused.clock_unconfirmed",
  "clock.unusable": "fiscal_filing.refused.clock_unusable",
  "venue.time_zone_not_ready": "fiscal_filing.refused.time_zone",
  "storage.disk_full": "fiscal_filing.refused.disk_full",
  "fiscal.record_invalid": "fiscal_filing.refused.record_invalid",
  "fiscal.fingerprint_mismatch": "fiscal_filing.refused.fingerprint",
  "chain.append_contention": "fiscal_filing.refused.try_again",
  "sif.not_registered": "fiscal_filing.refused.setup",
  "venue.time_zone_invalid": "fiscal_filing.refused.time_zone",
  "venue.time_zone_target_invalid": "fiscal_filing.refused.time_zone",
};

export function refusalKey(code: string): AeatCertificateKey | undefined {
  return Object.hasOwn(REFUSAL_WORDS, code) ? REFUSAL_WORDS[code as RemedyRefusal] : undefined;
}
