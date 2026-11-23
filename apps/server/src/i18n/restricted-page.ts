import type { ReturnState } from "../return-records.js";
import type { SupportedLocale } from "@waitron/shared";

/** The words of the page a stepped-down box serves (`../restricted-page.ts`). */
export const RESTRICTED_PAGE_WORDS: Readonly<
  Record<
    SupportedLocale,
    {
      title: string;
      openDashboard: string;
      progress: string;
      /** The heading of the page answered when this one cannot be read. */
      failed: string;
    }
  >
> = {
  "en-GB": {
    title: "This box no longer runs the venue",
    openDashboard: "Open the dashboard on the new main box.",
    progress: "Progress",
    failed: "This page could not be shown.",
  },
  "es-ES": {
    title: "El local ya no funciona con este servidor",
    openDashboard: "Abrir el panel en el nuevo servidor principal.",
    progress: "Progreso",
    failed: "No se ha podido mostrar esta página.",
  },
};

/** The page a box answers between closing its handover gate and restarting (`../handover-gate.ts`). */
export const STANDING_DOWN_PAGE_WORDS: Readonly<
  Record<SupportedLocale, { title: string; body: string; restarting: string }>
> = {
  "en-GB": {
    title: "This box is standing down",
    body: "Another box now runs the venue.",
    restarting: "Restarting…",
  },
  "es-ES": {
    title: "Este servidor se está retirando",
    body: "Otro servidor lleva ahora el local.",
    restarting: "Reiniciando…",
  },
};

/**
 * Each shown in place of the return's line: once this box has saved the main box's reset order,
 * and once a start could not set the records aside (`../replaced-reset.ts`'s `set_aside_refused`).
 * The refused line wins because the start that wrote that phase did not reset.
 */
export const RESTRICTED_RESET_WORDS: Readonly<
  Record<SupportedLocale, { ordered: string; setAsideRefused: string }>
> = {
  "en-GB": {
    ordered: "The main box asked this box to wipe itself. It restarts shortly as a new box.",
    setAsideRefused:
      "This box was asked to wipe itself but could not set its records aside, so nothing on it was changed. The venue runs on the new main box; you can switch this one off.",
  },
  "es-ES": {
    ordered:
      "El servidor principal ha pedido a este servidor que se borre. En breve se reinicia como un servidor nuevo.",
    setAsideRefused:
      "Se pidió a este servidor que se borrara, pero no ha podido apartar sus registros, así que no se ha cambiado nada en él. El local funciona con el nuevo servidor principal; puedes apagar este.",
  },
};

/** The successor's role, after its address, where this box knows it is the main box (the waiting page's Carry on, `../carry-on.ts`). */
export const RESTRICTED_MAIN_BOX_WORDS: Readonly<Record<SupportedLocale, string>> = {
  "en-GB": "main box",
  "es-ES": "servidor principal",
};

/** The page's one line while the return needs the person; a confirmed return needs nothing. */
export const RESTRICTED_RETURN_WORDS: Readonly<
  Record<SupportedLocale, Readonly<Record<Exclude<ReturnState, "confirmed">, string>>>
> = {
  "en-GB": {
    waiting:
      "This box is still sending its invoice records to the main box. Keep it switched on and connected; it keeps trying by itself.",
    sending:
      "This box is still sending its invoice records to the main box. Keep it switched on and connected; it keeps trying by itself.",
    "needs-attention":
      "The main box did not accept this box's invoice records. Keep this box switched on; it tries again by itself.",
    clock:
      "The main box's clock is behind this box's invoice records. Check the time on both boxes; the return tries again by itself.",
    clash:
      "The return stopped: some payments on this box differ from the main box's. Keep both boxes switched on with their data. Once the main box accepts the difference, switch this box off and on.",
    "record-clash":
      "The return stopped: an invoice record on this box clashes with one on the main box. Carry on selling on the main box, and keep this box's data.",
  },
  "es-ES": {
    waiting:
      "Este servidor aún está enviando sus registros de facturación al servidor principal. Mantenlo encendido y conectado; lo sigue intentando por sí mismo.",
    sending:
      "Este servidor aún está enviando sus registros de facturación al servidor principal. Mantenlo encendido y conectado; lo sigue intentando por sí mismo.",
    "needs-attention":
      "El servidor principal no ha aceptado los registros de facturación de este servidor. Mantenlo encendido; lo vuelve a intentar por sí mismo.",
    clock:
      "El reloj del servidor principal va por detrás de los registros de facturación de este servidor. Comprueba la hora de ambos servidores; la devolución se vuelve a intentar por sí misma.",
    clash:
      "La devolución se ha detenido: algunos pagos de este servidor no coinciden con los del servidor principal. Mantén ambos servidores encendidos con sus datos. Cuando el servidor principal acepte la diferencia, apaga y enciende este servidor.",
    "record-clash":
      "La devolución se ha detenido: un registro de facturación de este servidor choca con uno del servidor principal. Sigue vendiendo con el servidor principal y conserva los datos de este servidor.",
  },
};
