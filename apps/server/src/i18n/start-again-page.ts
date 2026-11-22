import type { SupportedLocale } from "@waitron/shared";

export interface StartAgainPageWords {
  filesFound: string;
  more: (n: number) => string;
  password: string;
  choiceLegend: string;
  keepTitle: string;
  keepDetail: string;
  moveTitle: string;
  moveDetail: string;
  moveUnsent: string;
  continue: string;
  insecureForm: string;
  passwordMissing: string;
  choiceMissing: string;
  fixFields: string;
  wrongPassword: string;
  forgotten: string;
  throttled: (n: number) => string;
  filesChanged: string;
  notOffered: string;
  insecure: string;
  otherPage: string;
  busy: string;
  diskFull: string;
  moveUnavailable: string;
  notSaved: string;
  notFinished: string;
  moved: (folder: string) => string;
}

/**
 * The choice's words, kept apart from `OPERATOR_WORDS` because `moveDetail` is the one sentence on
 * the recovery page allowed to say something is removed (owner-approved exception, 2026-10-25);
 * every other string here is held by `recovery-surface.test.ts` to never suggest deleting.
 */
export const START_AGAIN_PAGE_WORDS: Readonly<Record<SupportedLocale, StartAgainPageWords>> = {
  "en-GB": {
    filesFound: "Files found:",
    more: (n) => `and ${n} more`,
    password: "Administrator password",
    choiceLegend: "What should the box do? *",
    keepTitle: "Keep everything and stop.",
    keepDetail: "Nothing is moved. This page stays until Waitron is reinstalled on this box.",
    moveTitle: "Move these files aside and finish Start again.",
    moveDetail:
      "The files are moved, unchanged, into a new folder on the box, and the rest of the interrupted setup is removed. The box then starts a new first setup, where you can recover from a backup or set up again.",
    moveUnsent:
      "If these files are a venue that has made sales, invoice records it had not yet sent to AEAT stay unsent: the box sends nothing from moved files.",
    continue: "Continue",
    insecureForm: "Open this page over the box's secure connection to choose.",
    passwordMissing: "Enter the administrator password.",
    choiceMissing: "Choose one of the two options.",
    fixFields: "Check the fields marked above. Nothing was changed.",
    wrongPassword:
      "This is not the administrator password of the interrupted setup. Nothing was changed. Check it and try again: it is the password chosen when this setup began.",
    forgotten:
      "If the password is forgotten, this page cannot go further. If you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included, unless a backup is restored afterwards.",
    throttled: (n) =>
      `Too many wrong passwords. Try again in ${n === 1 ? "1 minute" : `${n} minutes`}. Nothing was changed.`,
    filesChanged:
      "The files on the box have changed since this page was opened. Nothing was changed. Press “Retry a normal boot” to see them as they are now.",
    notOffered:
      "This choice is no longer offered. Nothing was changed. Press “Retry a normal boot” to see the current page.",
    insecure: "Open this page over the box's secure connection to choose. Nothing was changed.",
    otherPage: "This choice must be sent from this page. Nothing was changed.",
    busy: "Another Waitron program is using the box's files. Nothing was changed. Wait a moment, then press Continue again.",
    diskFull:
      "The box's disk is full, so the choice could not be saved. Nothing was moved. Press “Retry a normal boot”: as it starts, the box frees space by clearing its own temporary copies, old logs and crash reports. Then choose again. If that is not enough, the choice cannot be saved on this box; if you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included, unless a backup is restored afterwards.",
    moveUnavailable:
      "These files cannot be moved aside on this box: the system treats the folder they are in and the box's folder for moved files as separate disks, and Start again never copies these files. Nothing was changed. Keep everything and stop is still available.",
    notSaved: "The box could not save the choice. Nothing was moved. Press Continue to try again.",
    notFinished:
      "Start again could not finish. The files it found are unchanged. Press “Retry a normal boot”: the box carries on as it starts.",
    moved: (folder) =>
      `Start again has finished. The files are in ${folder}. Waitron is restarting into a new first setup; reload this page in a minute.`,
  },
  "es-ES": {
    filesFound: "Archivos encontrados:",
    more: (n) => `y ${n} más`,
    password: "Contraseña de administrador",
    choiceLegend: "¿Qué debe hacer el servidor? *",
    keepTitle: "Conservarlo todo y parar.",
    keepDetail:
      "No se mueve nada. Esta página sigue hasta que se reinstale Waitron en este servidor.",
    moveTitle: "Apartar estos archivos y terminar «Empezar de nuevo».",
    moveDetail:
      "Los archivos se mueven, sin cambios, a una carpeta nueva del servidor, y se quita el resto de la configuración interrumpida. Después el servidor empieza una configuración inicial nueva, donde puedes recuperar desde una copia de seguridad o configurar de nuevo.",
    moveUnsent:
      "Si estos archivos son un local que ha vendido, los registros de facturas que aún no había enviado a la AEAT se quedan sin enviar: el servidor no envía nada desde archivos apartados.",
    continue: "Continuar",
    insecureForm: "Abre esta página con la conexión segura del servidor para elegir.",
    passwordMissing: "Introduce la contraseña de administrador.",
    choiceMissing: "Elige una de las dos opciones.",
    fixFields: "Revisa los campos marcados arriba. No se ha cambiado nada.",
    wrongPassword:
      "No es la contraseña de administrador de la configuración interrumpida. No se ha cambiado nada. Revísala y vuelve a intentarlo: es la contraseña que se eligió al empezar esta configuración.",
    forgotten:
      "Si se ha olvidado la contraseña, esta página no puede seguir. Si reinstalas Waitron, el servidor empieza de cero, pero se pierde todo lo que contiene, también estos archivos, salvo que después se restaure una copia de seguridad.",
    throttled: (n) =>
      `Demasiadas contraseñas incorrectas. Vuelve a intentarlo dentro de ${n === 1 ? "1 minuto" : `${n} minutos`}. No se ha cambiado nada.`,
    filesChanged:
      "Los archivos del servidor han cambiado desde que se abrió esta página. No se ha cambiado nada. Pulsa «Reintentar un arranque normal» para verlos como están ahora.",
    notOffered:
      "Esta opción ya no está disponible. No se ha cambiado nada. Pulsa «Reintentar un arranque normal» para ver la página actual.",
    insecure:
      "Abre esta página con la conexión segura del servidor para elegir. No se ha cambiado nada.",
    otherPage: "Esta elección debe enviarse desde esta página. No se ha cambiado nada.",
    busy: "Otro programa de Waitron está usando los archivos del servidor. No se ha cambiado nada. Espera un momento y vuelve a pulsar «Continuar».",
    diskFull:
      "El disco del servidor está lleno, así que no se ha podido guardar la elección. No se ha movido nada. Pulsa «Reintentar un arranque normal»: al arrancar, el servidor libera espacio descartando sus propias copias temporales, registros antiguos e informes de fallos. Después vuelve a elegir. Si no basta, la elección no se puede guardar en este servidor; si reinstalas Waitron, el servidor empieza de cero, pero se pierde todo lo que contiene, también estos archivos, salvo que después se restaure una copia de seguridad.",
    moveUnavailable:
      "Estos archivos no se pueden apartar en este servidor: el sistema trata la carpeta donde están y la carpeta del servidor para archivos apartados como discos distintos, y «Empezar de nuevo» nunca copia estos archivos. No se ha cambiado nada. Puedes elegir «Conservarlo todo y parar».",
    notSaved:
      "El servidor no ha podido guardar la elección. No se ha movido nada. Pulsa «Continuar» para volver a intentarlo.",
    notFinished:
      "«Empezar de nuevo» no ha podido terminar. Los archivos que encontró no han cambiado. Pulsa «Reintentar un arranque normal»: el servidor continúa al arrancar.",
    moved: (folder) =>
      `«Empezar de nuevo» ha terminado. Los archivos están en ${folder}. Waitron se está reiniciando en una configuración inicial nueva; recarga esta página dentro de un minuto.`,
  },
};
