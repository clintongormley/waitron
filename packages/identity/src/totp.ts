import { authenticator } from "otplib";

const ISSUER = "Waitron";

authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpAuthUri(secret: string, accountName: string): string {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.check(token, secret);
  } catch {
    // Fail closed. Probed against otplib@12.0.1: a malformed base32 STRING ("!!!not-base32!!!")
    // and a non-numeric token ("not-a-code") do NOT throw — otplib returns false for both. What
    // throws is a non-string secret (null/undefined) reaching the base32 decoder, a TypeError; the
    // catch guards that boundary since the params are only string by TYPE, not at runtime.
    return false;
  }
}
