import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, json, label, nodes, now, table, ts } from "@waitron/db";
import type { FiscalAllocation, RecoveryApproval } from "../allocation-envelope.js";
import { registroSif } from "./sif.js";

export interface ActivationResult {
  readonly activationEventId: string;
  readonly sifId: string;
  readonly series: readonly {
    readonly id: string;
    readonly code: string;
    readonly purpose: string;
  }[];
}

// This is local evidence of a committed activation; outside consumption remains authoritative.
export const fiscalAllocations = table(
  "fiscal_allocations",
  {
    eventKey: label("event_key").primaryKey(),
    allocationKey: label("allocation_key").notNull(),
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id),
    sifId: id("sif_id")
      .notNull()
      .references(() => registroSif.id),
    taxpayerNif: label("taxpayer_nif").notNull(),
    softwareId: label("software_id").notNull(),
    environment: label("environment").notNull(),
    installationIdentity: label("installation_identity").notNull(),
    allocation: json<FiscalAllocation>("allocation").notNull(),
    approval: json<RecoveryApproval>("approval").notNull(),
    bases: json<readonly { readonly code: string; readonly purpose: string }[]>("bases").notNull(),
    result: json<ActivationResult>("result").notNull(),
    activatedAt: ts("activated_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("fiscal_allocations_allocation_uq").on(t.allocationKey),
    uniqueIndex("fiscal_allocations_identity_uq").on(
      t.taxpayerNif,
      t.softwareId,
      t.environment,
      t.installationIdentity,
    ),
  ],
);
