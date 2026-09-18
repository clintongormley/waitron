import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { id, label, table, ts } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The ack OUTBOX — 1:1 with a registro, holding the AEAT-acceptance state to propagate downstream
 * (the till counts records not yet accepted by AEAT). Written atomically with the estado that
 * produces it (the drainer's persist tx / reconcile's correction tx), so an ack never disagrees
 * with the committed envios.estado/csv it reflects. `csv` rides here because consulta can never
 * return it. In-process transport only — the wire protocol is sub-project 9.
 */
export const acks = table(
  "acks",
  {
    registroId: id("registro_id")
      .primaryKey()
      .references(() => registrosFacturacion.id),
    submittedAt: ts("submitted_at").notNull(),
    csv: label("csv"),
    state: label("state").notNull(),
    deliveredAt: ts("delivered_at"),
  },
  (t) => [
    check(
      "acks_state_ck",
      sql`${t.state} in ('accepted', 'accepted_with_errors', 'rejected', 'halted')`,
    ),
  ],
);
