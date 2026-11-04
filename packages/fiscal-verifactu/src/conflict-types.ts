import type { EstadoRegistroConsulta, IDFactura, RespuestaLinea } from "@waitron/verifactu";

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

export interface LookupConflictEvidence {
  source: "consulta";
  invoice: IDFactura;
  reference: string | null;
  state: EstadoRegistroConsulta;
  fingerprint: string | null;
  system: { taxId: string | null; softwareId: string | null; installation: string | null } | null;
}

export type ActiveConflictEvidence = ConflictEvidence | LookupConflictEvidence;

export interface ConflictRef {
  registroId: string;
  caseId: string;
  sifId: string;
}

export interface LookupConflictRef {
  lookupId: string;
  sifId: string;
  registroId?: never;
  caseId?: never;
}
export type RecoveryConflictRef = ConflictRef | LookupConflictRef;

export type ActiveConflict = RecoveryConflictRef & {
  installationIdentity: string;
  invoiceIdentity: string;
  observedAt: string;
  evidence: ActiveConflictEvidence | null;
  cause: ConflictCause;
  evidenceId: string | null;
};
