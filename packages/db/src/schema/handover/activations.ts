import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, json, table, tsString } from "../columns.js";
import { nodes } from "../nodes.js";
import type { SignedHandoverEnvelope } from "@waitron/shared";

export const handoverScenario = enumType(["controlled", "emergency"]);

/** One row for each box that took over filing. Declared `appendOnly()` in `packages/handover/src/classification.ts`. */
export const handoverActivations = table(
  "handover_activations",
  {
    operationId: id("operation_id").primaryKey(),
    scenario: handoverScenario("scenario").notNull(),
    /** A declared reference to `nodes`, and never exported: `configurationTransfer` is `none`. */
    sourceNodeId: id("source_node_id").notNull(),
    /** A declared reference to `nodes`, and never exported: `configurationTransfer` is `none`. */
    destinationNodeId: id("destination_node_id").notNull(),
    /** The signed relinquishment, or the signed declaration. */
    evidence: json<SignedHandoverEnvelope<unknown>>("evidence").notNull(),
    /** A plain id with no foreign key: `persons` is in `@waitron/identity`'s set, which is optional. */
    personId: id("person_id").notNull(),
    activatedAt: tsString("activated_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.sourceNodeId],
      foreignColumns: [nodes.id],
      name: "handover_activations_source_node_fk",
    }),
    foreignKey({
      columns: [t.destinationNodeId],
      foreignColumns: [nodes.id],
      name: "handover_activations_destination_node_fk",
    }),
    index("handover_activations_destination_idx").on(t.destinationNodeId),
    check("handover_activations_scenario_ck", enumCheck(t.scenario)),
  ],
);
