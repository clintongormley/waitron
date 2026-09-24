import { generateSecret, generateURI, verifySync } from "otplib";

const ISSUER = "Waitron";

// In SECONDS: with the default 30-second period this accepts a token for the immediately-previous
// or immediately-next period and nothing further.
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpAuthUri(secret: string, accountName: string): string {
  return generateURI({ issuer: ISSUER, label: accountName, secret });
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return verifySync({ secret, token, epochTolerance: EPOCH_TOLERANCE_SECONDS }).valid;
  } catch {
    // Fail closed: otplib THROWS on a malformed base32 secret, a token that is not six digits, and a
    // missing or empty secret. `token`/`secret` are `string` by TYPE only.
    return false;
  }
}
