import type { FilingCaseView, FilingOverviewAnswer } from "../src/filing-overview-types.js";

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
    filing: true,
    awaitingCertificate: false,
    ...over,
  };
}
