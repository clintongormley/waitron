import type { ConflictCause } from "./conflict-types.js";
import type { EnvioState, FilingCaseCause } from "./filing-states.js";

/** Type-only imports: the browser bundle must take no database code from this file. */

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
  /** `record`: one of this box's own records. `series`: AEAT holds an invoice under one of this
   * box's live series that this box did not issue. */
  source: "record" | "series";
  invoiceNumber: string;
  installationName: string;
  cause: ConflictCause;
  observedAt: string;
  evidence: ReplyEvidenceView | LookupEvidenceView | null;
}

/** AEAT holds this invoice under a series this box has retired, and this box did not issue it. */
export interface NotIssuedHereView extends LookupObservationView {
  seriesCode: string;
}

/** A new fiscal identity activated other than by a handover, after an earlier one with records. */
export interface IdentityChangeView {
  installationName: string;
  earlierInstallationName: string;
  /** The earlier identity's record with the highest chain position that this box holds. */
  lastHeldInvoice: { numSerieFactura: string; fechaExpedicionFactura: string };
  /** A label only: no clock reading decides which changes are listed or their order. */
  activatedAt: string;
}

export interface MissingHistory {
  notIssuedHere: NotIssuedHereView[];
  identityChanges: IdentityChangeView[];
}

export interface FilingOverview {
  readAt: string;
  progress: FilingProgress;
  /** The newest open cases first, at most the read's limit. */
  cases: FilingCaseView[];
  totalCases: number;
  heldWithoutCase: number;
  activeConflicts: ActiveConflictView[];
  /** Scoped to the venue's taxpayer and this database's environment; empty when either is unset. */
  missingHistory: MissingHistory;
}

/** The answer of `GET /management-api/fiscal-filing`. */
export interface FilingOverviewAnswer extends FilingOverview {
  filing: boolean;
  awaitingCertificate: boolean;
}
