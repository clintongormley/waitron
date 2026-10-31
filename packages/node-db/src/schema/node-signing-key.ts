import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { binary, count, id, now, table, ts } from "@waitron/db";

/** This box's private signing key, sealed under the key ring with the node id bound in. */
export const nodeSigningKey = table(
  "node_signing_key",
  {
    nodeId: id("node_id").primaryKey(),
    ciphertext: binary("ciphertext").notNull(),
    iv: binary("iv").notNull(),
    authTag: binary("auth_tag").notNull(),
    keyVersion: count("key_version").notNull(),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    check("node_signing_key_key_version_ck", sql`${t.keyVersion} >= 1`),
    // The GCM standard nonce length.
    check("node_signing_key_iv_len_ck", sql`octet_length(${t.iv}) = 12`),
    // The full GCM tag; a truncated one weakens forgery resistance.
    check("node_signing_key_auth_tag_len_ck", sql`octet_length(${t.authTag}) = 16`),
  ],
);
