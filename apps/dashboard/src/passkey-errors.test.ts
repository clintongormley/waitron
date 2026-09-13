import { WebAuthnError } from "@simplewebauthn/browser";
import { describe, expect, it } from "vitest";
import { classifyPasskeyRegistrationError } from "./passkey-errors.js";

// Build a WebAuthnError the way @simplewebauthn/browser's identifyRegistrationError does: no explicit
// `name`, so the constructor takes it from the wrapped DOMException's name.
function webAuthnError(
  causeName: string,
  code: import("@simplewebauthn/browser").WebAuthnErrorCode,
): WebAuthnError {
  return new WebAuthnError({
    message: "ceremony failed",
    code,
    cause: new DOMException("x", causeName),
  });
}

describe("classifyPasskeyRegistrationError", () => {
  it("classifies a cancelled or aborted prompt as cancelled", () => {
    expect(
      classifyPasskeyRegistrationError(
        webAuthnError("NotAllowedError", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"),
      ),
    ).toBe("cancelled");
    expect(
      classifyPasskeyRegistrationError(webAuthnError("AbortError", "ERROR_CEREMONY_ABORTED")),
    ).toBe("cancelled");
    // A raw cancellation that never reached the wrapper is still cancelled.
    expect(classifyPasskeyRegistrationError(new DOMException("x", "NotAllowedError"))).toBe(
      "cancelled",
    );
  });

  it("classifies an already-registered device", () => {
    expect(
      classifyPasskeyRegistrationError(
        webAuthnError("InvalidStateError", "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"),
      ),
    ).toBe("already_registered");
  });

  it("classifies any other WebAuthn ceremony failure as failed", () => {
    expect(
      classifyPasskeyRegistrationError(
        webAuthnError("UnknownError", "ERROR_AUTHENTICATOR_GENERAL_ERROR"),
      ),
    ).toBe("failed");
    expect(
      classifyPasskeyRegistrationError(
        webAuthnError("NotSupportedError", "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG"),
      ),
    ).toBe("failed");
  });

  it("returns null for a non-ceremony failure so the caller falls through to server-code handling", () => {
    expect(classifyPasskeyRegistrationError({ code: "totp.invalid" })).toBeNull();
    expect(classifyPasskeyRegistrationError({ code: "passkey.challenge_expired" })).toBeNull();
    // startRegistration's two plain Errors carry no ceremony name → not classified here.
    expect(
      classifyPasskeyRegistrationError(new Error("WebAuthn is not supported in this browser")),
    ).toBeNull();
    expect(
      classifyPasskeyRegistrationError(new Error("Registration was not completed")),
    ).toBeNull();
  });
});
