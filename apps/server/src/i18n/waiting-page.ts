import type { SupportedLocale } from "@waitron/shared";

/** The words of the page's "Carry on as the main box" form and its answers. */
export interface CarryOnWords {
  heading: string;
  bucketMain: string;
  openMain: string;
  /** The words around the other box's name. */
  intro: readonly [string, string];
  email: string;
  password: string;
  totp: string;
  recoveryCode: string;
  /** The first statement's words around the other box's name. */
  switchedOff: readonly [string, string];
  noOtherRecovery: string;
  action: string;
  emailMissing: string;
  passwordMissing: string;
  totpMissing: string;
  statementMissing: string;
  fixFields: string;
  signInRefused: string;
  totpRequired: string;
  notPermitted: string;
  throttled: (minutes: number) => string;
  insecure: string;
  /** In place of the form when it could not be drawn. */
  unavailable: string;
  failed: string;
  /** The refusal's words around the successor's name. */
  knownHandover: readonly [string, string];
  back: string;
  knownTitle: string;
  restartingTitle: string;
  restarting: string;
  /** A stepdown or a shutdown began after the decision was recorded. */
  restartingAfterRecord: string;
  peerAnsweredTitle: string;
  peerAnswered: string;
  carriedOnTitle: string;
  carriedOnBody: string;
}

/** The words of the page a box serves while it waits for its peers (`../waiting-page.ts`). */
export const WAITING_PAGE_WORDS: Readonly<
  Record<
    SupportedLocale,
    {
      /** The title's words before and after the other box's name. */
      title: readonly [string, string];
      /** The body's words around the other box's name. */
      body: readonly [string, string];
      /** Named when the check said which boxes it waited for and none could be named. */
      otherBox: string;
      carryOn: CarryOnWords;
    }
  >
> = {
  "en-GB": {
    title: ["This box is waiting for ", ""],
    body: [
      "It will not take sales or send anything to the tax agency until it knows whether ",
      " has taken over. It checks again every 15 seconds.",
    ],
    otherBox: "the other box",
    carryOn: {
      heading: "Carry on as the main box",
      bucketMain:
        "Another box has published a newer signed backup for this venue. This box cannot carry on as the main box. Open the other box to use the venue; keep this box waiting, or switch it off.",
      openMain: "Open the other box",
      intro: [
        "Only if ",
        " is switched off. This box starts taking sales again, but stops if its backup confirms that another box has taken over. It asks the other box again at its next restart.",
      ],
      email: "Email",
      password: "Password",
      totp: "Authenticator code",
      recoveryCode: "Or one of your recovery codes",
      switchedOff: ["", " is switched off"],
      noOtherRecovery: "No other recovery of this venue is in progress",
      action: "Carry on as the main box",
      emailMissing: "Enter your email.",
      passwordMissing: "Enter your password.",
      totpMissing: "Enter the code from your authenticator app, or one of your recovery codes.",
      statementMissing: "Tick this to confirm it.",
      fixFields: "Correct the highlighted fields to continue.",
      signInRefused:
        "That email and password do not match an account here. Check them and try again. Nothing was changed.",
      totpRequired:
        "Enter your password again and the code from your authenticator app, or one of your recovery codes.",
      notPermitted:
        "Your role does not let you choose which box runs the venue. Sign in here as an administrator to carry on. Nothing was changed.",
      throttled: (minutes) =>
        `Too many incorrect attempts. Wait ${minutes === 1 ? "a minute" : `${minutes} minutes`} and try again. Nothing was changed.`,
      insecure: "To carry on as the main box, open this page at its https:// address.",
      unavailable:
        "The form to carry on as the main box could not be shown. Reload this page to try again.",
      failed: "Nothing was changed, because something went wrong. Try again.",
      knownHandover: [
        "This box has already handed over to ",
        ". It cannot carry on as the main box.",
      ],
      back: "Back to this box's status",
      knownTitle: "This box has already handed over",
      restartingTitle: "This box is restarting",
      restarting:
        "Another box has taken over, or this box is shutting down, so it did not carry on. Nothing was recorded. Open this page again in a minute.",
      restartingAfterRecord:
        "Your decision was recorded, but another box has taken over, or this box is shutting down, so it did not carry on. Open this page again in a minute.",
      peerAnsweredTitle: "The other box answered",
      peerAnswered:
        "It answered before you carried on, so this box is starting normally. Nothing was recorded. This page reloads in a few seconds.",
      carriedOnTitle: "This box is carrying on as the main box",
      carriedOnBody: "It is starting to take sales again. This page reloads in a few seconds.",
    },
  },
  "es-ES": {
    title: ["Este equipo está esperando a ", ""],
    body: [
      "No hará ventas ni enviará nada a Hacienda hasta saber si ",
      " ha pasado a llevar el local. Vuelve a comprobarlo cada 15 segundos.",
    ],
    otherBox: "otro equipo",
    carryOn: {
      heading: "Seguir como equipo principal",
      bucketMain:
        "Otro equipo ha publicado una copia de seguridad firmada más reciente para este local. Este equipo no puede seguir como principal. Abre el otro equipo para usar el local; deja este equipo esperando o apágalo.",
      openMain: "Abrir el otro equipo",
      intro: [
        "Solo si ",
        " está apagado. Este equipo vuelve a aceptar ventas, pero se detiene si la copia de seguridad confirma que otro equipo ha pasado a llevar el local. Vuelve a preguntar al reiniciarse.",
      ],
      email: "Correo electrónico",
      password: "Contraseña",
      totp: "Código del autenticador",
      recoveryCode: "O uno de tus códigos de recuperación",
      switchedOff: ["", " está apagado"],
      noOtherRecovery: "No hay ninguna otra recuperación de este local en curso",
      action: "Seguir como equipo principal",
      emailMissing: "Introduce tu correo electrónico.",
      passwordMissing: "Introduce tu contraseña.",
      totpMissing:
        "Introduce el código de tu aplicación de autenticación o uno de tus códigos de recuperación.",
      statementMissing: "Marca esta casilla para confirmarlo.",
      fixFields: "Corrige los campos marcados para continuar.",
      signInRefused:
        "Ese correo electrónico y esa contraseña no coinciden con ninguna cuenta de aquí. Revísalos y vuelve a intentarlo. No se ha cambiado nada.",
      totpRequired:
        "Vuelve a introducir tu contraseña y el código de tu aplicación de autenticación o uno de tus códigos de recuperación.",
      notPermitted:
        "Tu función no te permite elegir qué equipo lleva el local. Inicia sesión aquí como administrador para seguir. No se ha cambiado nada.",
      throttled: (minutes) =>
        `Demasiados intentos incorrectos. Espera ${minutes === 1 ? "un minuto" : `${minutes} minutos`} y vuelve a intentarlo. No se ha cambiado nada.`,
      insecure: "Para seguir como equipo principal, abre esta página en su dirección https://.",
      unavailable:
        "No se ha podido mostrar el formulario para seguir como equipo principal. Vuelve a cargar esta página para intentarlo.",
      failed: "No se ha cambiado nada, porque algo ha fallado. Vuelve a intentarlo.",
      knownHandover: [
        "Este equipo ya ha pasado el local a ",
        ". No puede seguir como equipo principal.",
      ],
      back: "Volver al estado de este equipo",
      knownTitle: "Este equipo ya ha pasado el local",
      restartingTitle: "Este equipo se está reiniciando",
      restarting:
        "Otro equipo ha pasado a llevar el local, o este equipo se está apagando, así que no ha seguido. No se ha registrado nada. Vuelve a abrir esta página dentro de un minuto.",
      restartingAfterRecord:
        "Tu decisión se ha registrado, pero otro equipo ha pasado a llevar el local, o este equipo se está apagando, así que no ha seguido. Vuelve a abrir esta página dentro de un minuto.",
      peerAnsweredTitle: "El otro equipo ha respondido",
      peerAnswered:
        "Respondió antes de que siguieras, así que este equipo se inicia con normalidad. No se ha registrado nada. Esta página se vuelve a cargar en unos segundos.",
      carriedOnTitle: "Este equipo sigue como equipo principal",
      carriedOnBody:
        "Está empezando a hacer ventas de nuevo. Esta página se vuelve a cargar en unos segundos.",
    },
  },
};
