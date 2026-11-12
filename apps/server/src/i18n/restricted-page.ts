import type { ReturnState } from "../return-records.js";
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

/** Every event kind a source operation records: its states, the offer's event and the final copy's. */
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

export const RESTRICTED_RETURN_WORDS: Readonly<
  Record<SupportedLocale, Readonly<Record<ReturnState, string>>>
> = {
  "en-GB": {
    waiting:
      "This box is waiting to return its invoice records to the main box. Keep its data. Do not reset this box. Refresh this page to check again.",
    sending:
      "This box is returning its invoice records to the main box. Do not reset this box. Refresh this page to check again.",
    "needs-attention":
      "The return could not be confirmed. Keep this box running with its data intact while it retries. Do not reset this box. Refresh this page to check again.",
    clock:
      "The main box cannot accept invoice records dated ahead of its clock. Keep both boxes running while the return retries. Check the clocks on both boxes. Do not reset this box. Refresh this page to check again.",
    clash:
      "The main box found differing returned facts. This return has stopped. Keep both boxes running with their data intact. Some payment differences can be specifically accepted through the main box's internal API; other differences cannot be accepted there. After accepting a payment difference, switch this box off and on to retry. Resetting this box deletes its venue data, including sale lines and local backups; this return is not confirmed.",
    "record-clash":
      "The return stopped because an invoice record clashes with one on the main box. This box's data has been left as it was. Continue using the main box and keep this box's data if you still need it. Resetting this box deletes its venue data, including sale lines and local backups; this return is not confirmed.",
    confirmed:
      "The main box has accounted for this return. For any accepted differences, it kept its own payment facts. Resetting this box deletes its venue data, including sale lines and local backups. Those are not included in this return.",
  },
  "es-ES": {
    waiting:
      "Este equipo está esperando para devolver sus registros de facturación al equipo principal. Conserva sus datos. No restablezcas este equipo. Actualiza esta página para comprobar el estado.",
    sending:
      "Este equipo está devolviendo sus registros de facturación al equipo principal. No restablezcas este equipo. Actualiza esta página para comprobar el estado.",
    "needs-attention":
      "No se ha podido confirmar la devolución. Mantén este equipo encendido y conserva sus datos mientras vuelve a intentarlo. No restablezcas este equipo. Actualiza esta página para comprobar el estado.",
    clock:
      "El equipo principal no puede aceptar registros de facturación adelantados respecto a su reloj. Mantén ambos equipos encendidos mientras se vuelve a intentar la devolución. Comprueba los relojes de ambos equipos. No restablezcas este equipo. Actualiza esta página para comprobar el estado.",
    clash:
      "El equipo principal ha encontrado diferencias en los datos devueltos. La devolución se ha detenido. Mantén ambos equipos encendidos y conserva sus datos. Algunas diferencias de pago pueden ser aceptadas expresamente mediante la API interna del principal; las demás diferencias no se pueden aceptar allí. Después de aceptar una diferencia de pago, apaga y enciende este equipo para reintentarlo. Restablecer este equipo borra sus datos del local, incluidas las líneas de venta y las copias de seguridad locales; esta devolución no está confirmada.",
    "record-clash":
      "La devolución se ha detenido porque un registro de facturación entra en conflicto con uno del equipo principal. Los datos de este equipo se han dejado como estaban. Sigue usando el equipo principal y conserva los datos de este equipo si aún los necesitas. Restablecer este equipo borra sus datos del local, incluidas las líneas de venta y las copias de seguridad locales; esta devolución no está confirmada.",
    confirmed:
      "El principal ha dado por resuelta esta devolución. Para las diferencias aceptadas, ha conservado sus propios datos de pago. Restablecer este equipo borra sus datos del local, incluidas las líneas de venta y las copias de seguridad locales. Esos datos no se incluyen en esta devolución.",
  },
};
