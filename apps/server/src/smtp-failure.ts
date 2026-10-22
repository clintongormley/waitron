export type SmtpTestCode =
  | "email.test_host_not_found"
  | "email.test_connection_refused"
  | "email.test_starttls_refused"
  | "email.test_tls_refused"
  | "email.test_certificate_untrusted"
  | "email.test_login_refused"
  | "email.test_login_required"
  | "email.test_timeout"
  | "email.test_refused";

export type SmtpFailureContext = {
  encryption: "starttls" | "tls";
  hasUser: boolean;
  timedOut?: boolean;
};

export function classifySmtpFailure(error: unknown, context: SmtpFailureContext): SmtpTestCode {
  if (context.timedOut) return "email.test_timeout";
  const fields = typeof error === "object" && error !== null ? error : {};
  const code = "code" in fields ? fields.code : undefined;
  const originalCode = "originalCode" in fields ? fields.originalCode : undefined;
  const command = "command" in fields ? fields.command : undefined;
  const reply = "responseCode" in fields ? fields.responseCode : undefined;
  const hasCode = (expected: string) => code === expected || originalCode === expected;
  if (hasCode("EDNS") || hasCode("ENOTFOUND")) return "email.test_host_not_found";
  if (hasCode("ECONNREFUSED")) return "email.test_connection_refused";
  if (
    context.encryption === "starttls" &&
    code === "ETLS" &&
    command === "STARTTLS" &&
    (reply === 502 || reply === 454)
  )
    return "email.test_starttls_refused";
  if (context.encryption === "tls" && hasCode("ERR_SSL_WRONG_VERSION_NUMBER")) {
    return "email.test_tls_refused";
  }
  if (
    [
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "CERT_HAS_EXPIRED",
      "CERT_NOT_YET_VALID",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    ].some(hasCode)
  )
    return "email.test_certificate_untrusted";
  if (reply === 535) return "email.test_login_refused";
  if (reply === 530 && !context.hasUser) return "email.test_login_required";
  return "email.test_refused";
}
