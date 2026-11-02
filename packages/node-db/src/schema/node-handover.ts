import { sql } from "drizzle-orm";
import { check, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumText, id, json, label, newId, now, table, ts } from "@waitron/db";

// Written out here rather than imported: this package does not depend on `@waitron/handover`.
export const HANDOVER_OPERATION_STATES = [
  "prepared",
  "source_stepped_down",
  "filing_relinquished",
  "source_superseded",
  "copy_accepted",
  "filing_assumed",
  "emergency_declared",
  "activated",
  "return_pending",
  "return_complete",
  "return_abandoned",
  "replaced",
  "abandoned",
] as const;

export type HandoverOperationState = (typeof HANDOVER_OPERATION_STATES)[number];

/** An operation in one of these states is closed; a box holds at most one that is not. */
export const HANDOVER_CLOSED_STATES = [
  "return_complete",
  "return_abandoned",
  "replaced",
  "abandoned",
] as const satisfies readonly HandoverOperationState[];

/** This box's progress through each handover operation it takes part in. */
export const nodeHandoverOperations = table(
  "node_handover_operations",
  {
    nodeId: id("node_id").notNull(),
    operationId: id("operation_id").notNull(),
    role: enumText("role", ["source", "destination"]).notNull(),
    scenario: enumText("scenario", ["controlled", "emergency"]).notNull(),
    // Venue `nodes` rows. Nothing in node.db establishes that they exist: node.db holds no venue
    // table, and no foreign key crosses the two files.
    sourceNodeId: id("source_node_id").notNull(),
    destinationNodeId: id("destination_node_id").notNull(),
    binding: json<Readonly<Record<string, unknown>>>("binding").notNull(),
    fingerprint: label("fingerprint").notNull(),
    state: enumText("state", HANDOVER_OPERATION_STATES).notNull(),
    waitingReason: label("waiting_reason"),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [
    primaryKey({ columns: [t.nodeId, t.operationId], name: "node_handover_operations_pk" }),
    check("node_handover_operations_role_ck", enumCheck(t.role)),
    check("node_handover_operations_scenario_ck", enumCheck(t.scenario)),
    check("node_handover_operations_state_ck", enumCheck(t.state)),
    uniqueIndex("node_handover_one_open_uq")
      .on(t.nodeId)
      .where(
        sql`${t.state} not in ('return_complete', 'return_abandoned', 'replaced', 'abandoned')`,
      ),
  ],
  /* v8 ignore stop */
);

/** What this box decided and received during handovers. Insert-only: its writer has no update. */
export const nodeHandoverEvents = table("node_handover_events", {
  eventId: id("event_id").primaryKey().$defaultFn(newId),
  nodeId: id("node_id").notNull(),
  // Null for a decision that belongs to no operation, such as carrying on as the main box.
  operationId: id("operation_id"),
  kind: label("kind").notNull(),
  detail: json<Readonly<Record<string, unknown>>>("detail").notNull(),
  envelope: label("envelope"),
  recordedAt: ts("recorded_at").notNull().$defaultFn(now),
});

/** Why this box no longer acts as the main box. Nothing clears it; the rejoin wipe removes node.db. */
export const nodeHandoverRestriction = table(
  "node_handover_restriction",
  {
    nodeId: id("node_id").primaryKey(),
    // Null for a supersession learnt from a newer membership chart alone.
    operationId: id("operation_id"),
    kind: enumText("kind", ["handed-over", "superseded"]).notNull(),
    // A venue `nodes` row. Nothing in node.db establishes that it exists: node.db holds no venue
    // table, and no foreign key crosses the two files.
    successorNodeId: id("successor_node_id").notNull(),
    membershipTerm: count("membership_term").notNull(),
    recordedAt: ts("recorded_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [check("node_handover_restriction_kind_ck", enumCheck(t.kind))],
  /* v8 ignore stop */
);
