import { WebAuthnError } from "@simplewebauthn/browser";

/**
 * A `WebAuthnError`'s `.code` is a library constant (e.g. `ERROR_AUTHENTICATOR_GENERAL_ERROR`), not a
 * wire code, so `codeOf` would read it as the code and show the generic banner. `null` means not a
 * ceremony failure: the caller falls through to its server-code handling.
 */
export function classifyPasskeyRegistrationError(
  error: unknown,
): "cancelled" | "already_registered" | "failed" | null {
  if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError"))
    return "cancelled";
  if (!(error instanceof WebAuthnError)) return null;
  if (error.name === "InvalidStateError") return "already_registered";
  return "failed";
}
