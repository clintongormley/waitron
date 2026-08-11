import { generateSecret, generateURI, verifySync } from "otplib";

const ISSUER = "Waitron";

// otplib v13 replaced v12's period-counted `window` with `epochTolerance` in SECONDS. With the
// default 30-second period, `epochTolerance: 30` accepts a token minted for the immediately-previous
// or immediately-next period and nothing further — identical to v12's `authenticator.options =
// { window: 1 }`. Proven against otplib@13.4.1 at a fixed epoch E (30s period): a token minted at
// E-30 / E / E+30 all verify `{ valid: true }` with delta -1 / 0 / +1, while a token minted at E-60
// returns `{ valid: false }`, and E-30 with `epochTolerance: 0` also returns `{ valid: false }`.
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
    // Fail closed. Unlike v12 — which returned false for a malformed base32 string or a non-numeric
    // token and only threw on a non-string secret — otplib v13 validates inputs with guardrails that
    // THROW. Probed against otplib@13.4.1, verifySync throws on: a malformed base32 secret
    // ("!!!not-base32!!!" -> `Invalid Base32 string`), a token that is not six digits ("not-a-code"
    // -> `Token must be 6 digits, got 10`), and a missing/null/undefined/empty secret (-> `Secret is
    // required`). Only a well-formed-but-wrong six-digit token ("000000") returns `{ valid: false }`
    // WITHOUT throwing. `token`/`secret` are `string` by TYPE only — a value from an untyped boundary
    // (a loosely-typed DB row, JSON, `any`) can reach this at runtime — so the catch must swallow
    // every guardrail throw and fail closed, never surfacing it to a caller.
    return false;
  }
}
