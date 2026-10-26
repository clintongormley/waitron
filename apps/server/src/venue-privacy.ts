import type { PrivacyContact } from "@waitron/provisioning";
import {
  AppError,
  PRIVACY_CONTACT_FIELDS,
  privacyContactProblem,
  privacyContactValue,
} from "@waitron/shared";
import "./errors.js";

/** The changed fields of a privacy contact request, each checked; throws `venue.detail_invalid`. */
export function privacyContactRequest(body: unknown): Partial<PrivacyContact> {
  const invalid = (field: string, reason: string) =>
    new AppError("venue.detail_invalid", { field, reason });
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw invalid("body", "type");
  const keys = Object.keys(body);
  if (keys.length === 0) throw invalid("body", "required");
  if (keys.some((key) => !(PRIVACY_CONTACT_FIELDS as readonly string[]).includes(key)))
    throw invalid("body", "unknown_field");
  const changes: Partial<PrivacyContact> = {};
  for (const field of PRIVACY_CONTACT_FIELDS) {
    if (!(field in body)) continue;
    const raw = (body as Record<string, unknown>)[field];
    if (typeof raw !== "string") throw invalid(field, "type");
    const value = privacyContactValue(raw);
    const problem = privacyContactProblem(field, value);
    if (problem !== undefined) throw invalid(field, problem);
    changes[field] = value;
  }
  return changes;
}
