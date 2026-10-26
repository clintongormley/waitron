import { isValidEmail } from "./email.js";

export const PRIVACY_CONTACT_FIELDS = ["privacyNoticeUrl", "privacyEmail"] as const;
export type PrivacyContactField = (typeof PRIVACY_CONTACT_FIELDS)[number];
export type PrivacyContactProblem = "web_address" | "email" | "length";

export const PRIVACY_CONTACT_MAX_LENGTH: Readonly<Record<PrivacyContactField, number>> = {
  privacyNoticeUrl: 500,
  privacyEmail: 254,
};

const INVISIBLE = /[\s\u00ad\u200b-\u200d\u2060]/;
const WEB_PREFIX = /^https?:\/\/[^/\\]/i;

/** NFC, trimmed; an empty result is null (unset). */
export function privacyContactValue(raw: string): string | null {
  const value = raw.normalize("NFC").trim();
  return value === "" ? null : value;
}

/** What is wrong with a value `privacyContactValue` returned, or undefined. Null is fine. */
export function privacyContactProblem(
  field: PrivacyContactField,
  value: string | null,
): PrivacyContactProblem | undefined {
  if (value === null) return undefined;
  if ([...value].length > PRIVACY_CONTACT_MAX_LENGTH[field]) return "length";
  if (field === "privacyEmail") {
    return INVISIBLE.test(value) || !isValidEmail(value) ? "email" : undefined;
  }
  if (INVISIBLE.test(value) || !WEB_PREFIX.test(value)) return "web_address";
  const parsed = URL.parse(value);
  if (parsed === null || parsed.username !== "" || parsed.password !== "") return "web_address";
  return undefined;
}
