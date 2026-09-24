import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * What each purpose's payload must contain — FIELD NAMES ONLY, as plain data. `"secretKey"` is a
 * string here and a Stripe key only to the host that reads it: this package imports no provider,
 * so it stays a leaf (`eslint.config.js` enforces it) while still rejecting a typo at provisioning
 * time.
 */
export const PURPOSES = {
  /** Outbound account email. `url` is an SMTP connection URL (and may contain credentials); `from`
   * is the RFC 5322 sender shown to recipients. */
  "email.smtp": ["url", "from"],
  "payments.stripe": ["secretKey", "webhookSecret", "successUrl", "cancelUrl"],
  /** SumUp Cloud API. `affiliateAppId`/`affiliateKey` come from the developer portal's Affiliate
   * Keys page and carry our `payment_ref` to SumUp as the client-supplied lookup key; a merchant
   * without one seals the literal `-` in both, and the host then omits the affiliate block. */
  "payments.sumup": ["apiKey", "merchantCode", "affiliateAppId", "affiliateKey"],
  /**
   * `certKind` is `"sello"` or `"representante"` — validated by the READER, not here: this package
   * declares field names and never their vocabularies. The AEAT endpoint depends on it
   * (`SOAP_ENDPOINTS_SELLO` versus `SOAP_ENDPOINTS`).
   *
   * Editing a provisioned purpose's fields blocks `rotate` whenever its row needs re-sealing, until
   * it is re-provisioned (see `rotateCredentials`).
   */
  "fiscal.aeat": ["pfxBase64", "passphrase", "certKind"],
  /** DEPRECATED: nothing seals or reads it any more. Kept because a purpose name is never deleted
   * or renamed. */
  "sync.mirror_token": ["token"],
  /** The node's own Ed25519 membership identity PRIVATE key. */
  "membership.node_key": ["privateKey"],
  /**
   * The owner's S3-compatible bucket the venue's database streams to. `venueId` names the venue's
   * folder in it. An absent `endpoint` (Amazon itself) or `prefix` is sealed as `-`, the same
   * convention `payments.sumup`'s affiliate fields use, because every field must be non-empty.
   */
  "backup.stream": [
    "venueId",
    "endpoint",
    "region",
    "bucket",
    "prefix",
    "accessKeyId",
    "secretAccessKey",
  ],
} as const satisfies Record<string, readonly string[]>;

export type Purpose = keyof typeof PURPOSES;

export function isPurpose(value: string): value is Purpose {
  return Object.prototype.hasOwnProperty.call(PURPOSES, value);
}

/**
 * EXACT field match, both directions: a mistyped `webhook_secret` shows up as a missing
 * `webhookSecret` AND an unexpected field.
 *
 * `missing` and `expected` are names `PURPOSES` declares, safe to echo. Unexpected fields are only
 * COUNTED: their names are caller input, and a secret pasted in as a JSON key
 * (`{"sk_live_51LEAKED": "x"}`) must never reach an AppError's params.
 */
export function validatePayload(
  purpose: Purpose,
  value: Record<string, unknown>,
): asserts value is Record<string, string> {
  const expected = PURPOSES[purpose] as readonly string[];
  const actual = Object.keys(value);
  const missing = expected.filter((f) => !actual.includes(f));
  const unexpectedCount = actual.filter((f) => !expected.includes(f)).length;
  if (missing.length > 0 || unexpectedCount > 0) {
    throw new AppError("credentials.invalid_payload", {
      purpose,
      missing,
      unexpectedCount,
      expected: [...expected],
    });
  }
  for (const field of expected) {
    const v = value[field];
    if (typeof v !== "string" || v === "") {
      throw new AppError("credentials.invalid_field", { purpose, field });
    }
  }
}
