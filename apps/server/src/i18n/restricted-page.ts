import type { HandoverOperationState } from "@waitron/node-db";
import type { SupportedLocale } from "@waitron/shared";

/** The words of the page a stepped-down box serves (`../restricted-page.ts`). */
export const RESTRICTED_PAGE_WORDS: Readonly<
  Record<
    SupportedLocale,
    {
      title: string;
      /** The body's words before and after the successor's name. */
      body: readonly [string, string];
      progress: string;
      /** The heading of the page answered when this one cannot be read. */
      failed: string;
    }
  >
> = {
  "en-GB": {
    title: "This box no longer runs the venue",
    body: [
      "It takes no sales and sends nothing to the tax agency. The box taking over the venue is ",
      ".",
    ],
    progress: "Progress",
    failed: "This page could not be shown.",
  },
  "es-ES": {
    title: "El local ya no funciona con este equipo",
    body: [
      "No hace ventas ni envía nada a Hacienda. El equipo que pasa a llevar el local es ",
      ".",
    ],
    progress: "Progreso",
    failed: "No se ha podido mostrar esta página.",
  },
};

/** Every event kind an operation records: its states, the offer's event and the final copy's. */
export type RestrictedStepKind = HandoverOperationState | "offer" | "final_state";

/** Keyed by every kind, so a new state with no wording fails the typecheck. */
export const RESTRICTED_STEP_WORDS: Readonly<
  Record<RestrictedStepKind, Readonly<Record<SupportedLocale, string>>>
> = {
  prepared: { "en-GB": "Handover begun", "es-ES": "Traspaso iniciado" },
  offer: { "en-GB": "Handover offered", "es-ES": "Traspaso ofrecido" },
  source_stepped_down: { "en-GB": "Stopped taking sales", "es-ES": "Ha dejado de vender" },
  filing_relinquished: {
    "en-GB": "Stopped sending invoice records to the tax agency",
    "es-ES": "Ha dejado de enviar registros de facturación a Hacienda",
  },
  source_superseded: {
    "en-GB": "Another box took over the venue",
    "es-ES": "Otro equipo ha pasado a llevar el local",
  },
  copy_accepted: {
    "en-GB": "Copy of the venue accepted",
    "es-ES": "Copia del local aceptada",
  },
  filing_assumed: {
    "en-GB": "Took over sending invoice records to the tax agency",
    "es-ES": "Ha pasado a enviar los registros de facturación a Hacienda",
  },
  emergency_declared: {
    "en-GB": "Emergency handover declared",
    "es-ES": "Traspaso de emergencia declarado",
  },
  activated: { "en-GB": "Started running the venue", "es-ES": "Ha empezado a llevar el local" },
  return_pending: {
    "en-GB": "Sending its invoice records",
    "es-ES": "Enviando sus registros de facturación",
  },
  return_complete: {
    "en-GB": "Invoice records sent",
    "es-ES": "Registros de facturación enviados",
  },
  return_abandoned: {
    "en-GB": "Sending its invoice records was stopped",
    "es-ES": "Se ha detenido el envío de sus registros de facturación",
  },
  replaced: {
    "en-GB": "Replaced by another handover",
    "es-ES": "Sustituido por otro traspaso",
  },
  abandoned: { "en-GB": "Handover cancelled", "es-ES": "Traspaso cancelado" },
  final_state: {
    "en-GB": "Final copy of the venue taken",
    "es-ES": "Copia final del local hecha",
  },
};
