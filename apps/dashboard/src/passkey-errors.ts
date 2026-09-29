import { WebAuthnError } from "@simplewebauthn/browser";

/**
 * A `WebAuthnError`'s `.code` is a library constant (e.g. `ERROR_AUTHENTICATOR_GENERAL_ERROR`), not a
 * wire code, so `codeOf` would read it as the code and show the generic banner. `null` means not a
 * ceremony failure: the caller falls through to its server-code handling. A raw DOMException named
 * NotAllowedError or AbortError also counts as cancelled, in case one reaches the catch without the
 * library's wrapper.
 */
export function classifyPasskeyRegistrationError(
  error: unknown,
): "cancelled" | "already_registered" | "failed" | null {
  if (isCancellation(error)) return "cancelled";
  if (!(error instanceof WebAuthnError)) return null;
  if (error.name === "InvalidStateError") return "already_registered";
  return "failed";
}

/**
 * A cancellation comes first. Every other thrown `Error` is a failed sign-in, and its own `.code`, a
 * WebAuthn library constant among them, is never read as a code. Anything else returns `null` and
 * the caller passes it to `codeOf`.
 */
export function classifyPasskeySignInError(error: unknown): "cancelled" | "failed" | null {
  if (isCancellation(error)) return "cancelled";
  return error instanceof Error ? "failed" : null;
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}
