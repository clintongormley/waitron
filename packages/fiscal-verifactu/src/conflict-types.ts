import type { RespuestaLinea } from "@waitron/verifactu";

export const CONFLICT_CAUSES = ["fiscal.huella_divergente", "fiscal.duplicado_anulado"] as const;
export type ConflictCause = (typeof CONFLICT_CAUSES)[number];

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

export interface ConflictRef {
  registroId: string;
  caseId: string;
  sifId: string;
}

export interface ActiveConflict extends ConflictRef {
  installationIdentity: string;
  invoiceIdentity: string;
  observedAt: string;
  evidence: ConflictEvidence | null;
  cause: ConflictCause;
  evidenceId: string | null;
}
