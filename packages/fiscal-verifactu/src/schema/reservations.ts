import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, json, label, nodes, now, table, ts } from "@waitron/db";

// Retained join evidence never makes a name free; outside consumption governs takeover.
export const fiscalReservations = table(
  "fiscal_reservations",
  {
    eventKey: label("event_key").primaryKey(),
    allocationKey: label("allocation_key").notNull(),
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id),
    sourceNodeId: id("source_node_id")
      .notNull()
      .references(() => nodes.id),
    taxpayerNif: label("taxpayer_nif").notNull(),
    softwareId: label("software_id").notNull(),
    environment: label("environment").notNull(),
    installationIdentity: label("installation_identity").notNull(),
    evidence: json<unknown>("evidence").notNull(),
    bases: json<readonly { readonly code: string; readonly purpose: string }[]>("bases").notNull(),
    establishedAt: ts("established_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("fiscal_reservations_allocation_uq").on(t.allocationKey),
    uniqueIndex("fiscal_reservations_identity_uq").on(
      t.taxpayerNif,
      t.softwareId,
      t.environment,
      t.installationIdentity,
    ),
  ],
);
