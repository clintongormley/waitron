import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, id, json, table, ts } from "./columns.js";
import type { RecoveryPackPartRecord } from "../recovery-packs.js";

/**
 * One row per recovery pack a node has made: what each part held and the checks the Backups card
 * compares against now, never a key, code, label or fingerprint (`insertRecoveryPack` refuses one).
 */
export const recoveryPacks = table(
  "recovery_packs",
  {
    // No foreign key to `nodes`: a `local` table holds none into a venue table
    // (`scripts/two-file-foreign-keys.test.ts`). The writer takes the id from the box's own trading
    // configuration.
    nodeId: id("node_id").notNull(),
    number: count("number").notNull(),
    madeAt: ts("made_at").notNull(),
    // Null for setup's first pack, made before any administrator session. No foreign key to
    // `persons` (a `state` table): the make route's `authorizeManager` establishes the person
    // exists when the row is written, and nothing ensures they still exist later, so every reader
    // treats a missing person as "no name".
    madeBy: id("made_by"),
    // Set once, when the browser that asked for the pack confirms it received the PDF whole.
    receivedAt: ts("received_at"),
    parts: json<RecoveryPackPartRecord[]>("parts").notNull(),
  },
  (t) => [uniqueIndex("recovery_packs_node_number_uq").on(t.nodeId, t.number)],
);
