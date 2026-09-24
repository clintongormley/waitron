import { sql } from "drizzle-orm";
import { check, primaryKey } from "drizzle-orm/sqlite-core";
import { binary, count, label, nowIso, table, tsString } from "@waitron/db";

/**
 * The credentials for one purpose, sealed. The row carries no plaintext, not even field names:
 * `ciphertext` covers the whole JSON object. A reader of the table still learns which purposes are
 * provisioned, when, on which key version, and each payload's length — GCM ciphertext is as long as
 * its plaintext, so `fiscal.aeat`'s row reveals the certificate's approximate size.
 */
export const tenantCredentials = table(
  "tenant_credentials",
  {
    /** A stable identifier, not a description: renaming a purpose orphans every row under the old
     * name. `PURPOSES` in ../purposes.ts is the authority on which values are legal. */
    purpose: label("purpose").notNull(),
    /** AES-256-GCM over the UTF-8 JSON payload, with the AAD bound to `purpose`. */
    ciphertext: binary("ciphertext").notNull(),
    /** 12 bytes, fresh per write. Never reused: GCM's security collapses if an (key, iv) pair
     * encrypts two different plaintexts. */
    iv: binary("iv").notNull(),
    authTag: binary("auth_tag").notNull(),
    /** Which key ring member sealed THIS row. Reads select the key by this value rather than
     * assuming the current one, which is what lets a half-finished `rotate` keep serving both
     * halves instead of becoming an outage. */
    keyVersion: count("key_version").notNull(),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.purpose], name: "tenant_credentials_pk" }),
    check("tenant_credentials_key_version_ck", sql`${t.keyVersion} >= 1`),
    // 12 bytes is the GCM standard nonce length, and the only length `cipher.ts` ever writes. A row
    // with a different length did not come from this code path.
    check("tenant_credentials_iv_len_ck", sql`octet_length(${t.iv}) = 12`),
    // 16 bytes is the full GCM tag. A truncated tag weakens forgery resistance, so the column
    // refuses one rather than trusting every future writer to pass the right option.
    check("tenant_credentials_auth_tag_len_ck", sql`octet_length(${t.authTag}) = 16`),
    check("tenant_credentials_purpose_ck", sql`length(${t.purpose}) > 0`),
  ],
);
