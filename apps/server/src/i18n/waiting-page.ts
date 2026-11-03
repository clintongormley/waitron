import type { SupportedLocale } from "@waitron/shared";

/** The words of the page's "Carry on as the main box" form and its answers. */
export interface CarryOnWords {
  heading: string;
  /** The words around the other box's name. */
  intro: readonly [string, string];
  email: string;
  password: string;
  totp: string;
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
  failed: string;
  /** The refusal's words around the successor's name. */
  knownHandover: readonly [string, string];
  back: string;
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
      intro: [
        "Only if ",
        " is switched off: sign in, and this box takes sales and sends records to the tax agency again until it next starts. When it starts again, it asks again.",
      ],
      email: "Email",
      password: "Password",
      totp: "Authenticator code",
      switchedOff: ["", " is switched off"],
      noOtherRecovery: "No other recovery of this venue is in progress",
      action: "Carry on as the main box",
      emailMissing: "Enter your email.",
      passwordMissing: "Enter your password.",
      totpMissing: "Enter the code from your authenticator app.",
      statementMissing: "Tick this to confirm it.",
      fixFields: "Correct the highlighted fields to continue.",
      signInRefused:
        "That email and password do not match an account here. Check them and try again.",
      totpRequired: "Enter your password again and the code from your authenticator app.",
      notPermitted:
        "Your role does not let you choose which box runs the venue. Sign in here as an administrator to carry on.",
      throttled: (minutes) =>
        `Too many incorrect attempts. Wait ${minutes === 1 ? "a minute" : `${minutes} minutes`} and try again.`,
      insecure: "To carry on as the main box, open this page at its https:// address.",
      failed: "Nothing was changed, because something went wrong. Try again.",
      knownHandover: [
        "This box has already handed over to ",
        ". It cannot carry on as the main box.",
      ],
      back: "Back to this box's status",
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
      intro: [
        "Solo si ",
        " está apagado: inicia sesión, y este equipo vuelve a hacer ventas y a enviar registros a Hacienda hasta que se vuelva a iniciar. Cuando se inicie de nuevo, volverá a preguntar.",
      ],
      email: "Correo electrónico",
      password: "Contraseña",
      totp: "Código del autenticador",
      switchedOff: ["", " está apagado"],
      noOtherRecovery: "No hay ninguna otra recuperación de este local en curso",
      action: "Seguir como equipo principal",
      emailMissing: "Introduce tu correo electrónico.",
      passwordMissing: "Introduce tu contraseña.",
      totpMissing: "Introduce el código de tu aplicación de autenticación.",
      statementMissing: "Marca esta casilla para confirmarlo.",
      fixFields: "Corrige los campos marcados para continuar.",
      signInRefused:
        "Ese correo electrónico y esa contraseña no coinciden con ninguna cuenta de aquí. Revísalos y vuelve a intentarlo.",
      totpRequired:
        "Vuelve a introducir tu contraseña y el código de tu aplicación de autenticación.",
      notPermitted:
        "Tu función no te permite elegir qué equipo lleva el local. Inicia sesión aquí como administrador para seguir.",
      throttled: (minutes) =>
        `Demasiados intentos incorrectos. Espera ${minutes === 1 ? "un minuto" : `${minutes} minutos`} y vuelve a intentarlo.`,
      insecure: "Para seguir como equipo principal, abre esta página en su dirección https://.",
      failed: "No se ha cambiado nada, porque algo ha fallado. Vuelve a intentarlo.",
      knownHandover: [
        "Este equipo ya ha pasado el local a ",
        ". No puede seguir como equipo principal.",
      ],
      back: "Volver al estado de este equipo",
      carriedOnTitle: "Este equipo sigue como equipo principal",
      carriedOnBody:
        "Está empezando a hacer ventas de nuevo. Esta página se vuelve a cargar en unos segundos.",
    },
  },
};
