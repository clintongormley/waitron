import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { binary, count, id, label, now, table, ts } from "@waitron/db";

/**
 * This box's link to the other box of its pair: the main box `streams` its copy to the spare's
 * store, and the spare `serves` that store. The store's secret key is sealed under the key ring
 * with both node ids bound in.
 */
export const nodePairLink = table(
  "node_pair_link",
  {
    nodeId: id("node_id").primaryKey(),
    role: label("role").$type<"streams" | "serves">().notNull(),
    state: label("state").$type<"pending" | "streaming" | "awaiting_copy" | "copied">().notNull(),
    // The other box, a venue `nodes` row. Nothing establishes that the row exists, and nothing
    // notices one that is missing: node.db holds no venue table, no foreign key crosses the two
    // files, and the readers return the id as stored.
    peerNodeId: id("peer_node_id").notNull(),
    peerPublicKey: label("peer_public_key").notNull(),
    storeUrl: label("store_url").notNull(),
    venueId: label("venue_id").notNull(),
    accessKeyId: label("access_key_id").notNull(),
    // Sealed rather than hashed: the store speaks S3 (versitygw, plan fact 13), and S3's request
    // signature needs the plain secret on both sides.
    secretCiphertext: binary("secret_ciphertext").notNull(),
    secretIv: binary("secret_iv").notNull(),
    secretAuthTag: binary("secret_auth_tag").notNull(),
    keyVersion: count("key_version").notNull(),
    // The key ring version handed to the spare, so a ring changed by hand can be noticed (plan D7).
    ringVersion: count("ring_version").notNull(),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    check("node_pair_link_role_ck", sql`${t.role} in ('streams', 'serves')`),
    check(
      "node_pair_link_state_ck",
      sql`(${t.role} = 'streams' and ${t.state} in ('pending', 'streaming')) or (${t.role} = 'serves' and ${t.state} in ('awaiting_copy', 'copied'))`,
    ),
    check("node_pair_link_key_version_ck", sql`${t.keyVersion} >= 1`),
    // The GCM standard nonce length.
    check("node_pair_link_secret_iv_len_ck", sql`octet_length(${t.secretIv}) = 12`),
    // The full GCM tag; a truncated one weakens forgery resistance.
    check("node_pair_link_secret_auth_tag_len_ck", sql`octet_length(${t.secretAuthTag}) = 16`),
  ],
);
