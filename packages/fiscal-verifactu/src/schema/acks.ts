import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { id, label, table, ts } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The ack OUTBOX — 1:1 with a registro, holding the AEAT-acceptance state to propagate downstream
 * (the till counts records not yet accepted by AEAT). Written atomically with the estado that
 * produces it (the drainer's persist tx / reconcile's correction tx), so an ack never disagrees
 * with the committed envios.estado/csv it reflects. `csv` rides here because consulta can never
 * return it. In-process transport only — the wire protocol is sub-project 9.
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as packages/db/src/schema/sales.ts.
export const acks = table(
  "acks",
  {
    registroId: id("registro_id")
      .primaryKey()
      /* v8 ignore start */
      .references(() => registrosFacturacion.id),
    /* v8 ignore stop */
    submittedAt: ts("submitted_at").notNull(),
    csv: label("csv"),
    state: label("state").notNull(),
    deliveredAt: ts("delivered_at"),
  },
  /* v8 ignore start */
  (t) => [
    check(
      "acks_state_ck",
      sql`${t.state} in ('accepted', 'accepted_with_errors', 'rejected', 'halted')`,
    ),
  ],
  /* v8 ignore stop */
);
