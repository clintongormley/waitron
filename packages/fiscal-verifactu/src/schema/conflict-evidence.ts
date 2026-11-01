import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, json, newId, table, ts } from "@waitron/db";
import type { RespuestaLinea } from "@waitron/verifactu";
import { filingCases } from "./filing-cases.js";
import { registrosFacturacion } from "./registros.js";

export const conflictCause = enumType(["fiscal.huella_divergente", "fiscal.duplicado_anulado"]);
export type ConflictCause = (typeof fiscalConflictEvidence.$inferSelect)["cause"];

export type ConflictComparison =
  | { kind: "annulled" }
  | {
      kind: "lookup-mismatch";
      storedFingerprint: string;
      storedSystem: {
        taxId: string | null;
        softwareId: string | null;
        installation: string | null;
      } | null;
    };

export interface ConflictEvidence {
  line: RespuestaLinea;
  csv: string | null;
  comparison: ConflictComparison;
}

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
