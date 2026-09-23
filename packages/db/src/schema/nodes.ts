import { id, json, label, newId, now, table, ts } from "./columns.js";
import type { Endorsement } from "@waitron/membership";
import { locations } from "./tenants.js";

/**
 * A compute node that runs a venue's POS and operates as its SIF (#33 — the "server" of that
 * design; called `node` here because in US restaurant English "server" means a waiter, and this
 * is a machine, not a person). One node per venue today; active-active/failover (a `role` column,
 * a second node) are later specs.
 *
 * 2026-08-28 (cloud-mirror C2a): the first primary-vs-mirror split shipped, and it deliberately did
 * NOT land here as a `nodes.role`. Which role a whole deployment plays — a `primary` that writes and
 * originates, or a read-only `mirror` of it — is a fact about the DATABASE, not about a node row, so
 * it lives on the singleton `deployment.mode` (`primary`|`mirror`; packages/db/src/deployment.ts,
 * drizzle/0001_db_baseline_sql.sql), which carries no node scope. A future reader adding
 * active-active/failover must not add a `role` column here for the mirror/primary split — that
 * concept already has its flag. Deliberately regime-neutral, like `tills`: the Veri*Factu SIF
 * identity (`NúmeroInstalación`, `IdSistemaInformatico`) lives in the module-owned `registro_sif`
 * table, which the node rekey re-keys from till to node (the SIF is the node — #33).
 *
 * `filing_module`/`tax_module` are nullable and stamped at provision time from the location's
 * territory (Task D1); the authoritative per-sale value stays `sales.fiscal_backend` — these are
 * the node's recorded modules, so the running SIF knows its backend without re-resolving. Nullable
 * to keep the reshape off every existing bare-node fixture (`seedNode`, `seedNodesForSifContention`,
 * `drain-fixtures`); pre-production, so a later NOT NULL tightening is free.
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
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
  // The node's Ed25519 identity PUBLIC key (base64 SPKI DER), the membership trust anchor (design
  // §4). Nullable like filing_module/tax_module above: pre-production, and bare-node fixtures carry
  // none — a keyless node is simply not a trust anchor (readMembershipTrustSet filters nulls). The
  // PRIVATE half is sealed in the vault (apps/server/node-identity.ts), never here. Nothing carries
  // the primary's nodes row to a mirror today: the bundle carries identity and dial details only
  // (mirror-bundle.ts's header), and the row copy that used to went with the deleted replication.
  // Set at provision by setNodePublicKey. Nothing in the database refuses another writer: this
  // engine has no roles and no grants.
  publicKey: label("public_key"),
  // The primary's ENDORSEMENT of this node's public_key (design §4/§6 R2): a signed
  // (nodeId, publicKey, endorsedBy, signature) vouching that lets other members trust a document
  // this node later signs, chaining back to setup. Public data — the exact sibling of `public_key`
  // above — so it lives here, not in the secret vault (whose exact-match string-only payload cannot
  // hold it). Nullable: only a reserved STANDBY carries one; a fresh primary is self-trusted and has
  // NULL. Set at adopt by insertReservedNodeTx, which is the only writer by convention — see
  // public_key above. Read at R3 promotion to attach to the minted membership document.
  endorsement: json<Endorsement>("endorsement"),
  createdAt: ts("created_at").notNull().$defaultFn(now),
});
