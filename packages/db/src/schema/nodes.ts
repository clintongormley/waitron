import { id, json, label, newId, now, table, ts } from "./columns.js";
import type { Endorsement } from "@waitron/membership";
import { locations } from "./tenants.js";

/**
 * A compute node that runs a venue's POS and operates as its SIF (called `node` here because in
 * US restaurant English "server" means a waiter, and this is a machine, not a person).
 *
 * Which role a node plays — a `primary` that writes and originates, or a read-only `mirror` — lives
 * on `node_roles` (`./node-roles.ts`), keyed by node id: a `local` table, because a node holding
 * another node's copy of the database must read its own role or none. Do not add a `role` column
 * here for the mirror/primary split — that concept already has its table. Deliberately
 * regime-neutral, like `tills`: the Veri*Factu SIF identity lives in the module-owned
 * `registro_sif` table, keyed by node.
 *
 * `filing_module`/`tax_module` are stamped at provision time from the location's territory; the
 * authoritative per-sale value stays `sales.fiscal_backend` — these are the node's recorded
 * modules, so the running SIF knows its backend without re-resolving.
 */
export const nodes = table("nodes", {
  id: id("id").primaryKey().$defaultFn(newId),
  locationId: id("location_id")
    .notNull()
    /* v8 ignore start */
    .references(() => locations.id),
  /* v8 ignore stop */
  name: label("name").notNull(),
  filingModule: label("filing_module"),
  taxModule: label("tax_module"),
  // The node's Ed25519 identity PUBLIC key (base64 SPKI DER), the membership trust anchor. A keyless
  // node is simply not a trust anchor (readMembershipTrustSet filters nulls). The PRIVATE half is
  // sealed in the vault (`apps/server/src/node-identity.ts`), never here. Set at provision by
  // setNodePublicKey. Nothing in the database refuses another writer: this engine has no roles and
  // no grants.
  publicKey: label("public_key"),
  // The primary's ENDORSEMENT of this node's public_key: a signed
  // (nodeId, publicKey, endorsedBy, signature) vouching that lets other members trust a document
  // this node later signs, chaining back to setup. Public data, so it lives here, not in the secret
  // vault. Nullable: only a reserved STANDBY carries one; a fresh primary is self-trusted and has
  // NULL. Set at adopt by insertReservedNodeTx, the only writer by convention.
  endorsement: json<Endorsement>("endorsement"),
  createdAt: ts("created_at").notNull().$defaultFn(now),
});
