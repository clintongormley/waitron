import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Endorsement } from "@waitron/membership";
import { locations, tenants } from "./tenants.js";

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
 * drizzle/0001_db_baseline_sql.sql), which carries no tenant/node scope. A future reader adding
 * active-active/failover must not add a `role` column here for the mirror/primary split — that
 * concept already has its flag. Deliberately regime-neutral, like `tills`: the Veri*Factu SIF
 * identity (NúmeroInstalación, IdSistemaInformatico) lives in the module-owned `registro_sif`
 * table, which the node rekey re-keys from till to node (the SIF is the node — #33).
 *
 * `filing_module`/`tax_module` are nullable and stamped at provision time from the location's
 * territory (Task D1); the authoritative per-sale value stays `sales.fiscal_backend` — these are
 * the node's recorded modules, so the running SIF knows its backend without re-resolving. Nullable
 * to keep the reshape off every existing bare-node fixture (`seedNode`, `seedNodesForSifContention`,
 * `drain-fixtures`); pre-production, so a later NOT NULL tightening is free.
 */
export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    filingModule: text("filing_module"),
    taxModule: text("tax_module"),
    // The node's Ed25519 identity PUBLIC key (base64 SPKI DER), the membership trust anchor (design
    // §4). Nullable like filing_module/tax_module above: pre-production, and bare-node fixtures carry
    // none — a keyless node is simply not a trust anchor (readMembershipTrustSet filters nulls). The
    // PRIVATE half is sealed in the vault (apps/server/node-identity.ts), never here. This column rides
    // adoptVenue's verbatim node-row copy, so a mirror inherits the primary's anchor with no bundle
    // change. Set owner-role at provision (setNodePublicKey); app_user holds SELECT only.
    publicKey: text("public_key"),
    // The primary's ENDORSEMENT of this node's public_key (design §4/§6 R2): a signed
    // (nodeId, publicKey, endorsedBy, signature) vouching that lets other members trust a document
    // this node later signs, chaining back to setup. Public data — the exact sibling of `public_key`
    // above — so it lives here, not in the secret vault (whose exact-match string-only payload cannot
    // hold it). Nullable: only a reserved STANDBY carries one; a fresh primary is self-trusted and has
    // NULL. Set owner-role at adopt (insertReservedNodeTx); app_user holds SELECT only. Read at R3
    // promotion to attach to the minted membership document.
    endorsement: jsonb("endorsement").$type<Endorsement>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Composite target so fiscal/commercial tables can carry a tenant-consistent (tenant_id,
    // node_id) FK — the same role invoice_series_tenant_id_key plays for `sales`.
    unique("nodes_tenant_id_key").on(t.tenantId, t.id),
    index("nodes_tenant_id_idx").on(t.tenantId),
  ],
);
