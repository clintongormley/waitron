import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, json, newId, table, ts } from "@waitron/db";
import type { LookupConflictEvidence } from "../conflict-types.js";
import { filingCases } from "./filing-cases.js";
import { registrosFacturacion } from "./registros.js";

export const fiscalLookupConflicts = table(
  "fiscal_lookup_conflicts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    registroId: id("registro_id")
      .notNull()
      .references(() => registrosFacturacion.id),
    caseId: id("case_id")
      .notNull()
      .references(() => filingCases.id),
    evidence: json<LookupConflictEvidence>("evidence").notNull(),
    recordedAt: ts("recorded_at").notNull(),
  },
  (t) => [uniqueIndex("fiscal_lookup_conflicts_registro_uq").on(t.registroId)],
);
