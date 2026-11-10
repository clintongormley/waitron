import type { ConflictCause } from "./conflict-types.js";
import type { FilingCaseCause } from "./schema/filing-cases.js";
import type { EnvioState } from "./handover-summary.js";

/** Types only: the dashboard screen imports this file, so it must pull in no database code. */

export interface FilingProgress {
  counts: Record<EnvioState, number>;
  /** The generation time of the oldest record still `pendiente` or `enviando`. */
  oldestWaitingGeneratedAt: string | null;
  lastConfirmedAt: string | null;
}

export interface InvoiceIdView {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
}

export interface SystemView {
  taxId: string | null;
  softwareId: string | null;
  installation: string | null;
}

/** AEAT's reply line for a record, as stored. */
export interface ReplyLineView {
  IDFactura: InvoiceIdView;
  EstadoRegistro: string | null;
  CodigoErrorRegistro: number | null;
  DescripcionErrorRegistro: string | null;
  RegistroDuplicado: {
    EstadoRegistroDuplicado: string | null;
    CodigoErrorRegistro: number | null;
    DescripcionErrorRegistro: string | null;
  } | null;
}

export interface ComparisonView {
  kind: "annulled" | "lookup-mismatch";
  storedFingerprint: string | null;
  storedSystem: SystemView | null;
}

export interface ReplyEvidenceView {
  line: ReplyLineView;
  comparison: ComparisonView;
}

export interface LookupEvidenceView {
  invoice: InvoiceIdView;
  state: string;
  fingerprint: string | null;
  system: SystemView | null;
}

export interface ConflictObservationView extends ReplyEvidenceView {
  attempt: number;
  cause: ConflictCause;
  recordedAt: string;
}

export interface LookupObservationView extends LookupEvidenceView {
  recordedAt: string;
}

export interface FilingCaseView {
  /** A case is named by its record everywhere; no case id leaves the read model. */
  registroId: string;
  cause: FilingCaseCause;
  openedAt: string;
  evidence: { codigo: number | null; mensaje: string | null; csv: string | null };
  record: {
    tipoRegistro: string;
    idEmisorFactura: string;
    numSerieFactura: string;
    fechaExpedicionFactura: string;
    tipoFactura: string | null;
    importeTotal: string | null;
    cuotaTotal: string | null;
    huella: string;
    anteriorHuella: string | null;
    fechaHoraHusoGenRegistro: string;
    numeroInstalacion: string;
  };
  submission: {
    estado: string;
    codigoError: string | null;
    mensajeError: string | null;
    enviadoEn: string | null;
  } | null;
  conflicts: ConflictObservationView[];
  lookups: LookupObservationView[];
  /** How many held records name this case as the one holding them. */
  heldBehind: number;
}

export interface ActiveConflictView {
  invoiceNumber: string;
  installationName: string;
  cause: ConflictCause;
  observedAt: string;
  evidence: ReplyEvidenceView | LookupEvidenceView | null;
}

export interface FilingOverview {
  readAt: string;
  progress: FilingProgress;
  /** The newest open cases first, at most the read's limit. */
  cases: FilingCaseView[];
  totalCases: number;
  heldWithoutCase: number;
  activeConflicts: ActiveConflictView[];
}

/** The answer of `GET /management-api/fiscal-filing`. */
export interface FilingOverviewAnswer extends FilingOverview {
  filing: boolean;
  awaitingCertificate: boolean;
}
