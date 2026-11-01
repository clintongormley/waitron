import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, json, newId, table, ts } from "@waitron/db";
import { filingCases } from "./filing-cases.js";
import { registrosFacturacion } from "./registros.js";

import { CONFLICT_CAUSES, type ConflictEvidence } from "../conflict-types.js";
export type { ConflictCause, ConflictComparison, ConflictEvidence } from "../conflict-types.js";

export const conflictCause = enumType(CONFLICT_CAUSES);

export const fiscalConflictEvidence = table(
  "fiscal_conflict_evidence",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    registroId: id("registro_id")
      .notNull()
      .references(() => registrosFacturacion.id),
    caseId: id("case_id")
      .notNull()
      .references(() => filingCases.id),
    attempt: count("attempt").notNull(),
    cause: conflictCause("cause").notNull(),
    evidence: json<ConflictEvidence>("evidence").notNull(),
    recordedAt: ts("recorded_at").notNull(),
  },
  (t) => [
    uniqueIndex("fiscal_conflict_evidence_attempt_uq").on(t.registroId, t.attempt, t.cause),
    check("fiscal_conflict_evidence_attempt_ck", sql`${t.attempt} > 0`),
    check("fiscal_conflict_evidence_cause_ck", enumCheck(t.cause)),
  ],
);
