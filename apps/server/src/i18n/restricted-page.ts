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
      "This box is still sending its invoice records and working hours to the main box. Keep it switched on and connected; it keeps trying by itself.",
    sending:
      "This box is still sending its invoice records and working hours to the main box. Keep it switched on and connected; it keeps trying by itself.",
    "needs-attention":
      "This box cannot yet confirm that the main box holds all the invoice records and working hours this box holds. Keep this box switched on; it tries again by itself.",
    clock:
      "The main box's clock is behind some invoice records this box holds. Check the time on both boxes; the return tries again by itself.",
    clash:
      "The return stopped: some payments on this box differ from the main box's. Keep both boxes switched on with their data. Once the main box accepts the difference, switch this box off and on.",
    "record-clash":
      "The return stopped: an invoice record on this box clashes with one on the main box. Carry on selling on the main box, and keep this box's data.",
    "hours-refused":
      "This box's invoice records have reached the main box, but the main box could not store some of its working hours. Carry on with the main box. Before this box is wiped, download its data below.",
  },
  "es-ES": {
    waiting:
      "Este servidor aún está enviando sus registros de facturación y horas trabajadas al servidor principal. Mantenlo encendido y conectado; lo sigue intentando por sí mismo.",
    sending:
      "Este servidor aún está enviando sus registros de facturación y horas trabajadas al servidor principal. Mantenlo encendido y conectado; lo sigue intentando por sí mismo.",
    "needs-attention":
      "Este servidor aún no puede confirmar que el servidor principal tenga todos los registros de facturación y horas trabajadas que tiene este servidor. Mantén este servidor encendido; lo vuelve a intentar por sí mismo.",
    clock:
      "El reloj del servidor principal va por detrás de algunos registros de facturación que tiene este servidor. Comprueba la hora de ambos servidores; la devolución se vuelve a intentar por sí misma.",
    clash:
      "La devolución se ha detenido: algunos pagos de este servidor no coinciden con los del servidor principal. Mantén ambos servidores encendidos con sus datos. Cuando el servidor principal acepte la diferencia, apaga y enciende este servidor.",
    "record-clash":
      "La devolución se ha detenido: un registro de facturación de este servidor choca con uno del servidor principal. Sigue vendiendo con el servidor principal y conserva los datos de este servidor.",
    "hours-refused":
      "Los registros de facturación de este servidor han llegado al servidor principal, pero el servidor principal no ha podido guardar algunas de sus horas trabajadas. Sigue con el servidor principal. Antes de que se borre este servidor, descarga sus datos aquí abajo.",
  },
};

/**
 * The download section of the restricted page (`../restricted-page.ts`) and the waiting page
 * (`../waiting-start.ts`), posted to `../old-box-data-page.ts`.
 */
export interface RestrictedDownloadWords {
  heading: string;
  /** After an emergency switch, or a restriction naming no operation. */
  emergency: string;
  /** After a planned handover. */
  planned: string;
  /** On the waiting page, where this box has heard nothing from a box that may have taken over. */
  waiting: string;
  email: string;
  password: string;
  totp: string;
  action: string;
  insecure: string;
  wipeUnderWay: string;
  otherPage: string;
  busy: string;
  signInRefused: string;
  /** The secondary button that signs in with a passkey instead of the email and password. */
  passkeyAction: string;
  passkeyRefused: string;
  passkeyExpired: string;
  /** Shown by the page's script when the browser's passkey request is cancelled or fails. */
  passkeyCancelled: string;
  totpRequired: string;
  notPermitted: string;
  throttled: (minutes: number) => string;
  emailMissing: string;
  passwordMissing: string;
  fixFields: string;
  failed: string;
}

export const RESTRICTED_DOWNLOAD_WORDS: Readonly<Record<SupportedLocale, RestrictedDownloadWords>> =
  {
    "en-GB": {
      email: "Email",
      password: "Password",
      totp: "Authenticator code",
      throttled: (minutes) =>
        `Too many incorrect attempts. Wait ${minutes === 1 ? "a minute" : `${minutes} minutes`} and try again. Nothing was changed.`,
      emailMissing: "Enter your email.",
      passwordMissing: "Enter your password.",
      fixFields: "Correct the highlighted fields to continue.",
      failed:
        "Nothing was changed: this is a fault in Waitron or this box. Try again. If it fails again, switch this box off and on, then try once more.",
      heading: "Download this box's data",
      emergency:
        "This box may hold data that the new main box does not have. To keep it, download it here before this box is wiped.",
      planned: "Download the invoice records this box holds that the new main box does not.",
      waiting:
        "If another box took over running the venue while this box was off or out of reach, this box may hold data that box does not have. To keep it, download it here before this box is wiped.",
      action: "Download",
      insecure: "To download this box's data, open this page at its https:// address.",
      wipeUnderWay: "This box is being wiped, so its data can no longer be downloaded.",
      otherPage: "The download must be asked for on this page. Nothing was changed.",
      busy: "This box is already making the file. Try again in a minute.",
      signInRefused:
        "That email and password do not match an account on this box. This box knows the accounts as they were when it last ran the venue. Nothing was changed.",
      passkeyAction: "Sign in with a passkey",
      passkeyRefused:
        "That passkey could not sign you in. This box knows the passkeys as they were when it last ran the venue. Try again, or use your email and password. Nothing was changed.",
      passkeyExpired: "The passkey request expired. Try again. Nothing was changed.",
      passkeyCancelled:
        "The passkey sign-in did not finish. Try again, or use your email and password.",
      totpRequired: "Enter your password again and the code from your authenticator app.",
      notPermitted:
        "This account cannot download this box's data. Sign in here with an administrator's account, or one with Manage boxes. Nothing was changed.",
    },
    "es-ES": {
      email: "Correo electrónico",
      password: "Contraseña",
      totp: "Código del autenticador",
      throttled: (minutes) =>
        `Demasiados intentos incorrectos. Espera ${minutes === 1 ? "un minuto" : `${minutes} minutos`} y vuelve a intentarlo. No se ha cambiado nada.`,
      emailMissing: "Introduce tu correo electrónico.",
      passwordMissing: "Introduce tu contraseña.",
      fixFields: "Corrige los campos marcados para continuar.",
      failed:
        "No se ha cambiado nada: es un fallo de Waitron o de este servidor. Vuelve a intentarlo. Si vuelve a fallar, apaga y enciende este servidor y después inténtalo otra vez.",
      heading: "Descargar los datos de este servidor",
      emergency:
        "Este servidor puede tener datos que el nuevo servidor principal no tiene. Para conservarlos, descárgalos aquí antes de borrarlo.",
      planned:
        "Descarga los registros de facturación que tiene este servidor y que el nuevo servidor principal no tiene.",
      waiting:
        "Si otro servidor pasó a llevar el local mientras este estaba apagado o sin conexión, este servidor puede tener datos que ese no tiene. Para conservarlos, descárgalos aquí antes de borrarlo.",
      action: "Descargar",
      insecure:
        "Para descargar los datos de este servidor, abre esta página en su dirección https://.",
      wipeUnderWay: "Este servidor se está borrando, así que ya no se pueden descargar sus datos.",
      otherPage: "La descarga debe pedirse en esta página. No se ha cambiado nada.",
      busy: "Este servidor ya está creando el archivo. Vuelve a intentarlo en un minuto.",
      signInRefused:
        "Ese correo electrónico y esa contraseña no coinciden con ninguna cuenta de este servidor. Este servidor conoce las cuentas tal como estaban la última vez que llevó el local. No se ha cambiado nada.",
      passkeyAction: "Entrar con passkey",
      passkeyRefused:
        "Esa passkey no ha podido iniciar tu sesión. Este servidor conoce las passkeys tal como estaban la última vez que llevó el local. Vuelve a intentarlo o usa tu correo electrónico y tu contraseña. No se ha cambiado nada.",
      passkeyExpired:
        "La solicitud de passkey ha caducado. Vuelve a intentarlo. No se ha cambiado nada.",
      passkeyCancelled:
        "El inicio de sesión con passkey no ha terminado. Vuelve a intentarlo o usa tu correo electrónico y tu contraseña.",
      totpRequired:
        "Vuelve a introducir tu contraseña y el código de tu aplicación de autenticación.",
      notPermitted:
        "Esta cuenta no puede descargar los datos de este servidor. Inicia sesión aquí con la cuenta de un administrador o con una que tenga Gestionar servidores. No se ha cambiado nada.",
    },
  };
