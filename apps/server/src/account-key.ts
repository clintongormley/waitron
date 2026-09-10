import { createHmac } from "node:crypto";
import type { KeyRing } from "@waitron/credentials";
import { AppError } from "@waitron/shared";

const ACCOUNT_KEY_BYTES = 32;

/** Resolve the venue-wide account key. Mirrors receive the primary's explicit value; a fresh
 * primary derives its initial value from its vault key and persists it with the trading config. */
export function resolveAccountKey(env: Record<string, string | undefined>, ring: KeyRing): Buffer {
  const encoded = env.WAITRON_ACCOUNT_KEY;
  if (encoded === undefined || encoded === "") {
    return createHmac("sha256", ring.current.key).update("waitron.account-key.v1").digest();
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== ACCOUNT_KEY_BYTES || key.toString("base64") !== encoded) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_ACCOUNT_KEY",
      reason: "expected_32_base64_bytes",
    });
  }
  return key;
}

export function accountPurposeKey(accountKey: Buffer, purpose: string): Buffer {
  return createHmac("sha256", accountKey).update(`waitron.${purpose}.v1`).digest();
}
