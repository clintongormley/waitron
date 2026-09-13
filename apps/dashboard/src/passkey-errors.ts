import { WebAuthnError } from "@simplewebauthn/browser";

/**
 * Classify a passkey-registration failure by its WebAuthn ceremony outcome, so the profile screen and
 * the login screen's first-sign-in offer react to `startRegistration` identically.
 *
 * `startRegistration` reports a ceremony failure as a `WebAuthnError` whose `.name` is the underlying
 * DOMException name and whose `.code` is a library constant (e.g. `ERROR_AUTHENTICATOR_GENERAL_ERROR`),
 * NOT a wire code — so routing it through `codeOf` would read that constant as the code and degrade
 * every ceremony failure to the generic banner. Classifying here keeps a passkey-specific message on
 * every one of them.
 *
 * Returns:
 * - `"cancelled"` — the person dismissed or aborted the prompt (NotAllowedError/AbortError). Not a
 *   failure; the caller shows nothing. A raw DOMException with those names counts too, in case one
 *   ever reaches the catch without the library's wrapper.
 * - `"already_registered"` — this device already holds a passkey (InvalidStateError).
 * - `"failed"` — any other WebAuthn ceremony failure; the caller shows a passkey-specific message.
 * - `null` — not a ceremony failure (a server `{ code }` rejection, or one of `startRegistration`'s two
 *   plain Errors that carry no ceremony name), so the caller falls through to its server-code handling.
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
