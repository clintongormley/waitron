export interface ReadmeFileWords {
  readonly holds: string;
  readonly use: string;
  /** Recipients this file alone has; listed under "Who else receives it" only when the file is. */
  readonly sentTo?: readonly string[];
  /** What the box itself keeps or deletes; listed under "How long it is kept" only when the file is. */
  readonly kept?: readonly string[];
}

export interface ReadmeWords {
  readonly title: string;
  readonly prepared: string;
  readonly filesHeading: string;
  readonly files: Readonly<Record<string, ReadmeFileWords>>;
  readonly machineReadable: string;
  readonly originHeading: string;
  readonly origin: string;
  readonly sentToHeading: string;
  readonly backup: string;
  readonly keptHeading: string;
  readonly decides: string;
  readonly rightsHeading: string;
  readonly rights: string;
  readonly ask: string;
  readonly notice: string;
  readonly unnamedVenue: string;
}

export const PERSONAL_DATA_README_WORDS: Record<"en" | "es", ReadmeWords> = {
  en: {
    title: "Your data held by {venue}",
    prepared: "Prepared for {name} on {date}.",
    filesHeading: "What each file holds",
    files: {
      "profile.json": {
        holds:
          "your name, contact details, language, role and account status, and any device profile set to let you in or keep you out.",
        use: "Used to run the venue, contact you and decide what you may do.",
        sentTo: [
          "A manager or admin can download a configuration export that holds your name, contact details, language, role and account status, and any device profile set to let you in or keep you out, including after you leave; they protect it with a passphrase they choose.",
        ],
        kept: [
          "Your profile stays on the box after your account is disabled: nothing in the box deletes it.",
        ],
      },
      "sign-in.json": {
        holds:
          "how you sign in: whether you have a PIN, a password, an authenticator app or a Google login (never the secrets themselves), your passkeys, how many recovery codes you have, your sign-ins, the account emails issued to you and any setup you started but did not finish.",
        use: "Used to keep your account secure.",
        sentTo: [
          "Account emails (invitations, password resets and email-change codes) are sent through the email service the venue set up, when it has one.",
          "If you link a Google login, the box asks Google to confirm who you are each time you link or use it, and keeps Google's identifier for your account; this file says only whether one is linked.",
        ],
        kept: [
          "When your account is disabled, your PIN, password, passkeys, authenticator app, recovery codes and Google login are deleted from the box.",
          "Your sign-in sessions stay on the box after they end.",
          "The record of an account email that was used or has expired is deleted when another of the same kind is issued to you; an unfinished Google link is deleted the next time anyone starts a Google sign-in after it has expired.",
        ],
      },
    },
    machineReadable: "The .json files are a machine-readable copy you can take to another service.",
    originHeading: "Where it came from",
    origin:
      "You or the venue's managers entered your details, or they were imported when the box was set up; the rest was recorded automatically as you used Waitron.",
    sentToHeading: "Who else receives it",
    backup:
      "If the venue has set up backups, they hold a copy of the whole database, this data included, wherever the venue keeps them.",
    keptHeading: "How long it is kept",
    decides: "Ask the venue how long it keeps your data and why; its privacy notice may say.",
    rightsHeading: "Your rights",
    rights:
      "You may ask the venue to correct or delete your data, to limit its use, or to give you another copy in a form you can take to another service, and you may object to its use. It must answer within one month; if it needs longer, up to two more months, it must tell you so, and why, within that first month. You may also complain to a data-protection authority.",
    ask: "Contact {venue} to ask.",
    notice: "Its privacy notice: {url}",
    unnamedVenue: "the venue",
  },
  es: {
    title: "Tus datos en {venue}",
    prepared: "Preparado para {name} el {date}.",
    filesHeading: "Qué contiene cada archivo",
    files: {
      "profile.json": {
        holds:
          "tu nombre, tus datos de contacto, tu idioma, tu rol y el estado de tu cuenta, y los perfiles de dispositivo configurados para dejarte entrar o impedírtelo.",
        use: "Sirve para gestionar el local, contactarte y decidir qué puedes hacer.",
        sentTo: [
          "Un gerente o un administrador puede descargar una exportación de la configuración que contiene tu nombre, tus datos de contacto, tu idioma, tu rol, el estado de tu cuenta y los perfiles de dispositivo configurados para dejarte entrar o impedírtelo, también después de que te vayas; la protege con una contraseña que elige esa persona.",
        ],
        kept: [
          "Tu perfil se queda en el servidor Waitron del local después de que se deshabilite tu cuenta: nada en el servidor lo borra.",
        ],
      },
      "sign-in.json": {
        holds:
          "cómo accedes: si tienes PIN, contraseña, aplicación de autenticación o inicio de sesión con Google (nunca los secretos), tus passkeys, cuántos códigos de recuperación tienes, tus sesiones, los correos de cuenta generados para ti y cualquier configuración que empezaste sin terminar.",
        use: "Sirve para mantener tu cuenta segura.",
        sentTo: [
          "Los correos de cuenta (invitaciones, restablecimientos de contraseña y códigos de cambio de correo) se envían a través del servicio de correo que configuró el local, si tiene uno.",
          "Si vinculas un inicio de sesión con Google, el servidor Waitron del local pide a Google que confirme quién eres cada vez que lo vinculas o lo usas, y guarda el identificador de Google de tu cuenta; este archivo solo dice si hay uno vinculado.",
        ],
        kept: [
          "Cuando se deshabilita tu cuenta, se borran del servidor Waitron del local tu PIN, tu contraseña, tus passkeys, la aplicación de autenticación, los códigos de recuperación y el inicio de sesión con Google.",
          "Tus sesiones se quedan en el servidor Waitron del local aunque hayan terminado.",
          "El registro de un correo de cuenta ya usado o caducado se borra cuando se genera para ti otro del mismo tipo; una vinculación con Google sin terminar se borra la próxima vez que alguien empieza un inicio de sesión o una vinculación con Google después de que caduque.",
        ],
      },
    },
    machineReadable:
      "Los archivos .json son una copia legible por máquina que puedes llevar a otro servicio.",
    originHeading: "De dónde salen",
    origin:
      "Tus datos los introdujiste tú o los gerentes del local, o se importaron al configurar el servidor Waitron del local; el resto se registró automáticamente mientras usabas Waitron.",
    sentToHeading: "Quién más los recibe",
    backup:
      "Si el local tiene copias de seguridad, estas guardan una copia de toda la base de datos, incluidos estos datos, allí donde el local las tenga.",
    keptHeading: "Cuánto tiempo se guardan",
    decides:
      "Pregunta al local cuánto tiempo guarda tus datos y por qué; su aviso de privacidad puede indicarlo.",
    rightsHeading: "Tus derechos",
    rights:
      "Puedes pedir al local que corrija o borre tus datos, que limite su uso o que te dé otra copia en un formato que puedas llevar a otro servicio, y puedes oponerte a su uso. Debe responder en el plazo de un mes; si necesita más tiempo, hasta dos meses más, debe decírtelo, y por qué, dentro de ese primer mes. También puedes reclamar ante una autoridad de protección de datos.",
    ask: "Contacta con {venue} para pedirlo.",
    notice: "Su aviso de privacidad: {url}",
    unnamedVenue: "el local",
  },
};
