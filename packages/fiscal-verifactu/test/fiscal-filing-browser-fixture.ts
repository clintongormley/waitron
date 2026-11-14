import type {
  FilingCaseView,
  FilingOverviewAnswer,
  IdentityChangeView,
  NotIssuedHereView,
  RecordWarningView,
  ReplyMismatchView,
} from "../src/filing-overview-types.js";

export const OURS = "a".repeat(64);
export const PREVIOUS = "b".repeat(64);
export const THEIRS = "c".repeat(64);

export function conflictCase(registroId: string, openedAt: string): FilingCaseView {
  return {
    registroId,
    cause: "fiscal.huella_divergente",
    openedAt,
    evidence: { codigo: 3000, mensaje: "Registro de facturación duplicado.", csv: null },
    record: {
      tipoRegistro: "alta",
      idEmisorFactura: "B12345678",
      numSerieFactura: "T1/41",
      fechaExpedicionFactura: "2026-11-03",
      tipoFactura: "F2",
      importeTotal: "12.10",
      cuotaTotal: "2.10",
      descripcionOperacion: "Venta en establecimiento",
      huella: OURS,
      anteriorHuella: PREVIOUS,
      fechaHoraHusoGenRegistro: "2026-11-03T12:00:00+01:00",
      numeroInstalacion: "BOX-01",
    },
    submission: {
      estado: "rechazado",
      codigoError: "3000",
      mensajeError: "Registro de facturación duplicado.",
      enviadoEn: "2026-11-03T11:01:00.000Z",
    },
    conflicts: [
      {
        attempt: 1,
        cause: "fiscal.huella_divergente",
        recordedAt: "2026-11-03T11:02:00.000Z",
        line: {
          IDFactura: {
            IDEmisorFactura: "B12345678",
            NumSerieFactura: "T1/41",
            FechaExpedicionFactura: "03-11-2026",
          },
          EstadoRegistro: "Incorrecto",
          CodigoErrorRegistro: 3000,
          DescripcionErrorRegistro: "Registro de facturación duplicado.",
          RegistroDuplicado: null,
        },
        comparison: { kind: "lookup-mismatch", storedFingerprint: THEIRS, storedSystem: null },
      },
    ],
    lookups: [],
    heldBehind: 3,
  };
}

export const NOT_ISSUED_HERE: NotIssuedHereView = {
  seriesCode: "T0",
  recordedAt: "2026-11-04T10:15:00.000Z",
  invoice: {
    IDEmisorFactura: "B12345678",
    NumSerieFactura: "T0/12",
    FechaExpedicionFactura: "28-10-2026",
  },
  state: "Correcto",
  fingerprint: THEIRS,
  system: { taxId: "B87654321", softwareId: "XX", installation: "ELSEWHERE-7" },
};

export const IDENTITY_CHANGE: IdentityChangeView = {
  installationName: "BOX-02",
  earlierInstallationName: "BOX-01",
  lastHeldInvoice: { numSerieFactura: "T1/40", fechaExpedicionFactura: "2026-11-02" },
  activatedAt: "2026-11-03T08:00:00.000Z",
};

export const REPLY_MISMATCH: ReplyMismatchView = {
  detectedAt: "2026-11-09T18:20:00.000Z",
  csv: "A-YZ3K7QW2",
  sent: [
    {
      numSerieFactura: "T1/50",
      fechaExpedicionFactura: "2026-11-09",
      tipoRegistro: "alta",
      estado: "pendiente",
    },
    {
      numSerieFactura: "T1/51",
      fechaExpedicionFactura: "2026-11-09",
      tipoRegistro: "alta",
      estado: "detenido",
    },
  ],
  lines: [
    {
      numSerieFactura: "T1/50",
      fechaExpedicionFactura: "09-11-2026",
      tipoOperacion: "Alta",
      estado: "Incorrecto",
      codigo: 1100,
      mensaje: "Valor o tipo incorrecto del campo.",
    },
  ],
};

export const TOTALS_WARNING: RecordWarningView = {
  detectedAt: "2026-11-08T13:05:00.000Z",
  kind: "totals",
  fields: ["CuotaTotal", "ImporteTotal"],
  codes: ["CUOTA_TOTAL_MISMATCH", "IMPORTE_TOTAL_MISMATCH"],
  record: {
    numSerieFactura: "T1/47",
    fechaExpedicionFactura: "2026-11-08",
    tipoRegistro: "alta",
    estado: "aceptado",
  },
};

export const FLAGGED_WARNING: RecordWarningView = {
  detectedAt: "2026-11-07T20:40:00.000Z",
  kind: "flagged",
  fields: ["Desglose[0].ClaveRegimen"],
  codes: ["CLAVE_REGIMEN_REQUIRED"],
  record: {
    numSerieFactura: "T1/44",
    fechaExpedicionFactura: "2026-11-07",
    tipoRegistro: "alta",
    estado: "aceptado",
  },
};

export function overview(over: Partial<FilingOverviewAnswer> = {}): FilingOverviewAnswer {
  return {
    readAt: "2026-11-10T09:30:00.000Z",
    progress: {
      counts: {
        pendiente: 4,
        enviando: 1,
        aceptado: 120,
        aceptado_con_errores: 2,
        rechazado: 5,
        detenido: 3,
        retenido: 6,
      },
      oldestWaitingGeneratedAt: "2026-11-10T08:00:00.000Z",
      lastConfirmedAt: "2026-11-10T09:00:00.000Z",
    },
    cases: [conflictCase("rec-1", "2026-11-03T11:02:00.000Z")],
    totalCases: 1,
    heldWithoutCase: 7,
    warnings: {
      replyMismatches: [REPLY_MISMATCH],
      recordWarnings: [TOTALS_WARNING, FLAGGED_WARNING],
      total: 3,
    },
    activeConflicts: [
      {
        source: "record",
        invoiceNumber: "T1/41",
        installationName: "BOX-01",
        cause: "fiscal.huella_divergente",
        observedAt: "2026-11-03T11:02:00.000Z",
        evidence: {
          invoice: {
            IDEmisorFactura: "B12345678",
            NumSerieFactura: "T1/41",
            FechaExpedicionFactura: "03-11-2026",
          },
          state: "Correcto",
          fingerprint: THEIRS,
          system: null,
        },
      },
    ],
    missingHistory: { notIssuedHere: [NOT_ISSUED_HERE], identityChanges: [IDENTITY_CHANGE] },
    filing: true,
    awaitingCertificate: false,
    ...over,
  };
}
