import { describe, expect, it } from "vitest";
import { classifySmtpFailure, type SmtpFailureContext } from "./smtp-failure.js";

const starttls: SmtpFailureContext = { encryption: "starttls", hasUser: false };
const tls: SmtpFailureContext = { encryption: "tls", hasUser: true };

describe("SMTP failure classification", () => {
  it.each([
    [{ code: "EDNS" }, starttls, "email.test_host_not_found"],
    [{ code: "ESOCKET", originalCode: "ENOTFOUND" }, tls, "email.test_host_not_found"],
    [{ code: "ECONNREFUSED" }, tls, "email.test_connection_refused"],
    [{ originalCode: "ECONNREFUSED" }, starttls, "email.test_connection_refused"],
    [
      { code: "ETLS", command: "STARTTLS", responseCode: 502 },
      starttls,
      "email.test_starttls_refused",
    ],
    [
      { code: "ETLS", command: "STARTTLS", responseCode: 454 },
      starttls,
      "email.test_starttls_refused",
    ],
    [{ code: "ERR_SSL_WRONG_VERSION_NUMBER" }, tls, "email.test_tls_refused"],
    [{ originalCode: "ERR_SSL_WRONG_VERSION_NUMBER" }, tls, "email.test_tls_refused"],
    [{ code: "EAUTH", responseCode: 535 }, tls, "email.test_login_refused"],
    [{ responseCode: 530 }, starttls, "email.test_login_required"],
    [{ code: "EDNS", responseCode: 535 }, tls, "email.test_host_not_found"],
    [{ code: "ECONNREFUSED", responseCode: 535 }, tls, "email.test_connection_refused"],
    [
      { code: "ETLS", originalCode: "CERT_HAS_EXPIRED", command: "STARTTLS", responseCode: 454 },
      starttls,
      "email.test_starttls_refused",
    ],
    [{ code: "CERT_HAS_EXPIRED", responseCode: 535 }, tls, "email.test_certificate_untrusted"],
  ] as const)("classifies structured fields %j in %j", (error, context, expected) => {
    expect(classifySmtpFailure(error, context)).toBe(expected);
    expect(classifySmtpFailure(error, { ...context, timedOut: true })).toBe("email.test_timeout");
  });

  it.each([
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "CERT_HAS_EXPIRED",
    "CERT_NOT_YET_VALID",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  ])("recognises certificate code %s without reading provider text", (code) => {
    expect(classifySmtpFailure({ code }, starttls)).toBe("email.test_certificate_untrusted");
    expect(classifySmtpFailure({ code: "ESOCKET", originalCode: code }, tls)).toBe(
      "email.test_certificate_untrusted",
    );
  });

  it.each([
    null,
    undefined,
    false,
    535,
    "EDNS",
    {},
    { code: "ETLS" },
    { code: "EAUTH" },
    { code: "ETLS", command: "AUTH", responseCode: 454 },
    { code: "ETLS", command: "STARTTLS", responseCode: 500 },
    { code: "ETLS", command: "STARTTLS", responseCode: "454" },
    { code: ["EDNS"] },
    { responseCode: "535" },
    { message: "secret-password EDNS ECONNREFUSED CERT_HAS_EXPIRED 535" },
  ])("keeps unrecognised or malformed fields private: %j", (error) => {
    expect(classifySmtpFailure(error, starttls)).toBe("email.test_refused");
  });

  it("requires the matching encryption and absent user predicates", () => {
    expect(classifySmtpFailure({ code: "ETLS", command: "STARTTLS", responseCode: 454 }, tls)).toBe(
      "email.test_refused",
    );
    expect(classifySmtpFailure({ code: "ERR_SSL_WRONG_VERSION_NUMBER" }, starttls)).toBe(
      "email.test_refused",
    );
    expect(classifySmtpFailure({ responseCode: 530 }, tls)).toBe("email.test_refused");
  });

  it("never inspects message text or serialises an error", () => {
    const error = {
      get message() {
        throw new Error("provider message must stay unread");
      },
      toJSON() {
        throw new Error("provider object must stay private");
      },
    };
    expect(classifySmtpFailure(error, starttls)).toBe("email.test_refused");
    expect(classifySmtpFailure(error, { ...tls, timedOut: true })).toBe("email.test_timeout");
  });
});
