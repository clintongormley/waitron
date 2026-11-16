import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { binary, count, id, label, table, ts } from "@waitron/db";

export const box = table(
  "box",
  {
    nodeId: id("node_id").primaryKey(),
    recoveryKeyVerifier: label("recovery_key_verifier"),
    recoveryKeyName: label("recovery_key_name"),
    recoveryKeyChangedAt: ts("recovery_key_changed_at"),
    signingKeyCiphertext: binary("signing_key_ciphertext"),
    signingKeyIv: binary("signing_key_iv"),
    signingKeyAuthTag: binary("signing_key_auth_tag"),
    signingKeyVersion: count("signing_key_version"),
    signingKeyChangedAt: ts("signing_key_changed_at"),
    mode: label("mode").$type<"primary" | "mirror">(),
    singletonRole: label("singleton_role").$type<"primary" | "secondary">(),
    roleChangedAt: ts("role_changed_at"),
    mirrorOriginUrl: label("mirror_origin_url"),
    mirrorBoxHostname: label("mirror_box_hostname"),
    mirrorBoxCaPem: label("mirror_box_ca_pem"),
    // No venue foreign key crosses node.db; adopting checks the origin's membership.
    mirrorOriginNodeId: id("mirror_origin_node_id"),
    mirrorAdoptedAt: ts("mirror_adopted_at"),
    // The joining flow verifies this venue node and its public key before pinning them.
    primaryNodeId: id("primary_node_id"),
    primaryPublicKey: label("primary_public_key"),
    primaryPinnedAt: ts("primary_pinned_at"),
  },
  (t) => [
    check(
      "box_recovery_key_group_ck",
      sql`(${t.recoveryKeyVerifier} is null and ${t.recoveryKeyName} is null and ${t.recoveryKeyChangedAt} is null) or (${t.recoveryKeyVerifier} is not null and ${t.recoveryKeyName} is not null and ${t.recoveryKeyChangedAt} is not null)`,
    ),
    check(
      "box_signing_key_group_ck",
      sql`(${t.signingKeyCiphertext} is null and ${t.signingKeyIv} is null and ${t.signingKeyAuthTag} is null and ${t.signingKeyVersion} is null and ${t.signingKeyChangedAt} is null) or (${t.signingKeyCiphertext} is not null and ${t.signingKeyIv} is not null and ${t.signingKeyAuthTag} is not null and ${t.signingKeyVersion} is not null and ${t.signingKeyChangedAt} is not null)`,
    ),
    check("box_signing_key_version_ck", sql`${t.signingKeyVersion} >= 1`),
    check("box_signing_key_iv_len_ck", sql`octet_length(${t.signingKeyIv}) = 12`),
    check("box_signing_key_auth_tag_len_ck", sql`octet_length(${t.signingKeyAuthTag}) = 16`),
    check(
      "box_role_group_ck",
      sql`(${t.mode} is null and ${t.singletonRole} is null and ${t.roleChangedAt} is null) or (${t.mode} is not null and ${t.singletonRole} is not null and ${t.roleChangedAt} is not null)`,
    ),
    check("box_mode_ck", sql`${t.mode} in ('primary', 'mirror')`),
    check("box_singleton_role_ck", sql`${t.singletonRole} in ('primary', 'secondary')`),
    check("box_role_valid_ck", sql`not (${t.mode} = 'mirror' and ${t.singletonRole} = 'primary')`),
    check(
      "box_mirror_group_ck",
      sql`(${t.mirrorOriginUrl} is null and ${t.mirrorBoxHostname} is null and ${t.mirrorBoxCaPem} is null and ${t.mirrorOriginNodeId} is null and ${t.mirrorAdoptedAt} is null) or (${t.mirrorOriginUrl} is not null and ${t.mirrorBoxHostname} is not null and ${t.mirrorBoxCaPem} is not null and ${t.mirrorOriginNodeId} is not null and ${t.mirrorAdoptedAt} is not null)`,
    ),
    check(
      "box_primary_key_group_ck",
      sql`(${t.primaryNodeId} is null and ${t.primaryPublicKey} is null and ${t.primaryPinnedAt} is null) or (${t.primaryNodeId} is not null and ${t.primaryPublicKey} is not null and ${t.primaryPinnedAt} is not null)`,
    ),
  ],
);
