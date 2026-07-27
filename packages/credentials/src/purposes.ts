import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * What each purpose's payload must contain — FIELD NAMES ONLY, as plain data. This is the one place
 * this package comes close to knowing about a provider, and the line it does not cross is an
 * import: `"secretKey"` is a string here, and a Stripe key only to the host that reads it. Nothing
 * in `@waitron/payments` or `@waitron/fiscal-verifactu` is referenced, so this package stays a leaf
 * (eslint enforces it) while still rejecting a typo at provisioning time rather than at 3am.
 *
 * `fiscal.aeat` is PROVISIONAL: whether an FNMT sello de entidad certificate can be exported for
 * unattended server use at all is unverified (getting-to-production.md §4). Because the payload is
 * an opaque blob, learning the real answer changes this list — not a migration.
 */
export const PURPOSES = {
  "payments.stripe": ["secretKey", "webhookSecret", "successUrl", "cancelUrl"],
  /**
   * `certKind` is `"sello"` or `"representante"` — validated by the READER, not here: this package
   * declares field names and never their vocabularies, which is the line that keeps it a leaf.
   * It exists because `SOAP_ENDPOINTS_SELLO` is a different AEAT host from `SOAP_ENDPOINTS`, so the
   * endpoint depends on the certificate's kind and nothing else knows it.
   *
   * Still PROVISIONAL — the FNMT export question remains unresolved. Also note the cost of editing
   * this list: `rotate` re-runs `validatePayload`, so a row sealed under an older list aborts a
   * rotation sweep, and a read returns a payload missing the new field. The host validates what it
   * reads for exactly that reason (see the server design §5.1); adding a field remains cheap only
   * while nothing is provisioned.
   */
  "fiscal.aeat": ["pfxBase64", "passphrase", "certKind"],
} as const satisfies Record<string, readonly string[]>;

export type Purpose = keyof typeof PURPOSES;

export function isPurpose(value: string): value is Purpose {
  return Object.prototype.hasOwnProperty.call(PURPOSES, value);
}

/**
 * EXACT field match, both directions. Rejecting extras is not pedantry: a mistyped `webhook_secret`
 * shows up as a missing `webhookSecret` AND an unexpected `webhook_secret`, and an implementation
 * that only checked for missing fields would report half the truth to an operator who is certain
 * they set it.
 *
 * `missing` and `expected` are field names THIS PACKAGE declares in `PURPOSES` — safe to echo
 * verbatim. The unexpected fields' own NAMES are never echoed, only their count: a field name here
 * is arbitrary caller input, not this package's data, and an operator who piped a raw secret in as a
 * bare JSON key by mistake (`{"sk_live_51LEAKED": "x"}`) would otherwise have it land straight in an
 * AppError's params — the same class of leak `credentials.key_version_invalid`'s `value` was.
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
