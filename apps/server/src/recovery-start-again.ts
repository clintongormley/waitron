import type { StartAgainSurvey, StartAgainUnit } from "@waitron/provisioning";
import type { SupportedLocale } from "@waitron/shared";
import { escapeHtml } from "./recovery-surface.js";

export interface StartAgainPageText {
  filesFound: string;
  more: (n: number) => string;
  password: string;
  choiceLegend: string;
  keepTitle: string;
  keepDetail: string;
  moveTitle: string;
  moveDetail: string;
  moveUnsent: string;
  moveFloor: (time: string) => string;
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
 * The choice's words, kept apart from `OPERATOR_TEXT` because `moveDetail` is the one sentence on
 * the recovery page allowed to say something is removed (owner-approved exception, 2026-10-25);
 * every other string here is held by `recovery-surface.test.ts` to never suggest deleting.
 */
export const START_AGAIN_PAGE_TEXT: Readonly<Record<SupportedLocale, StartAgainPageText>> = {
  "en-GB": {
    filesFound: "Files found:",
    more: (n) => `and ${n} more`,
    password: "Administrator password",
    choiceLegend: "What should the box do? *",
    keepTitle: "Keep everything and stop.",
    keepDetail: "Nothing is moved. This page stays until Waitron is reinstalled on this box.",
    moveTitle: "Move these files aside and finish Start again.",
    moveDetail:
      "The files are moved, unchanged, into a new folder on the box, and the rest of the interrupted setup is removed. The box then starts a new first setup, where you can recover from a backup or set up again. Its invoice series names are never used again.",
    moveUnsent:
      "If these files are a venue that has made sales, invoice records it had not yet sent to AEAT stay unsent: the box sends nothing from moved files.",
    moveFloor: (time) =>
      `These files carry a time later than the box's clock, so a new setup can start invoice series names only from ${time}.`,
    continue: "Continue",
    insecureForm: "Open this page over the box's secure connection to choose.",
    passwordMissing: "Enter the administrator password.",
    choiceMissing: "Choose one of the two options.",
    fixFields: "Check the fields marked above. Nothing was changed.",
    wrongPassword:
      "This is not the administrator password of the interrupted setup. Nothing was changed. Check it and try again: it is the password chosen when this setup began.",
    forgotten:
      "If the password is forgotten, this page cannot go further. If you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included.",
    throttled: (n) =>
      `Too many wrong passwords. Try again in ${n === 1 ? "1 minute" : `${n} minutes`}. Nothing was changed.`,
    filesChanged:
      "The files on the box have changed since this page was opened. Nothing was changed. Press Retry to see them as they are now.",
    notOffered:
      "This choice is no longer offered. Nothing was changed. Press Retry to see the current page.",
    insecure: "Open this page over the box's secure connection to choose. Nothing was changed.",
    otherPage: "This choice must be sent from this page. Nothing was changed.",
    busy: "Another Waitron program is using the box's files. Nothing was changed. Wait a moment, then press Continue again.",
    diskFull:
      "The box's disk is full, so the choice could not be saved. Nothing was moved. Press Retry: as it starts, the box frees space by clearing its own temporary copies, old logs and crash reports. Then choose again. If that is not enough, the choice cannot be saved on this box; if you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included.",
    moveUnavailable:
      "These files cannot be moved aside on this box: the system treats the folder they are in and the box's folder for moved files as separate disks, and Start again never copies files. Nothing was changed. Keep everything and stop is still available.",
    notSaved: "The box could not save the choice. Nothing was moved. Press Continue to try again.",
    notFinished:
      "Start again could not finish. The files it found are unchanged. Press Retry: the box carries on as it starts.",
    moved: (folder) =>
      `Start again has finished. The files are in ${folder}. Waitron is restarting into a new first setup; reload this page in a minute.`,
  },
  "es-ES": {
    filesFound: "Archivos encontrados:",
    more: (n) => `y ${n} más`,
    password: "Contraseña de administrador",
    choiceLegend: "¿Qué debe hacer el equipo? *",
    keepTitle: "Conservarlo todo y parar.",
    keepDetail:
      "No se mueve nada. Esta página sigue hasta que se reinstale Waitron en este equipo.",
    moveTitle: "Apartar estos archivos y terminar «Empezar de nuevo».",
    moveDetail:
      "Los archivos se mueven, sin cambios, a una carpeta nueva del equipo, y se quita el resto de la configuración interrumpida. Después el equipo empieza una configuración inicial nueva, donde puedes recuperar desde una copia de seguridad o configurar de nuevo. Sus nombres de serie de facturas no se vuelven a usar.",
    moveUnsent:
      "Si estos archivos son un local que ha vendido, los registros de facturas que aún no había enviado a la AEAT se quedan sin enviar: el equipo no envía nada desde archivos apartados.",
    moveFloor: (time) =>
      `Estos archivos llevan una hora posterior a la del reloj del equipo, así que una configuración nueva solo puede empezar nombres de serie de facturas a partir de ${time}.`,
    continue: "Continuar",
    insecureForm: "Abre esta página con la conexión segura del equipo para elegir.",
    passwordMissing: "Introduce la contraseña de administrador.",
    choiceMissing: "Elige una de las dos opciones.",
    fixFields: "Revisa los campos marcados arriba. No se ha cambiado nada.",
    wrongPassword:
      "No es la contraseña de administrador de la configuración interrumpida. No se ha cambiado nada. Revísala y vuelve a intentarlo: es la contraseña que se eligió al empezar esta configuración.",
    forgotten:
      "Si se ha olvidado la contraseña, esta página no puede seguir. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que hay en él, también estos archivos.",
    throttled: (n) =>
      `Demasiadas contraseñas incorrectas. Vuelve a intentarlo dentro de ${n === 1 ? "1 minuto" : `${n} minutos`}. No se ha cambiado nada.`,
    filesChanged:
      "Los archivos del equipo han cambiado desde que se abrió esta página. No se ha cambiado nada. Pulsa «Reintentar un arranque normal» para verlos como están ahora.",
    notOffered:
      "Esta opción ya no está disponible. No se ha cambiado nada. Pulsa «Reintentar un arranque normal» para ver la página actual.",
    insecure:
      "Abre esta página con la conexión segura del equipo para elegir. No se ha cambiado nada.",
    otherPage: "Esta elección debe enviarse desde esta página. No se ha cambiado nada.",
    busy: "Otro programa de Waitron está usando los archivos del equipo. No se ha cambiado nada. Espera un momento y vuelve a pulsar «Continuar».",
    diskFull:
      "El disco del equipo está lleno, así que no se ha podido guardar la elección. No se ha movido nada. Pulsa «Reintentar un arranque normal»: al arrancar, el equipo libera espacio descartando sus propias copias temporales, registros antiguos e informes de fallos. Después vuelve a elegir. Si no basta, la elección no se puede guardar en este equipo; si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que hay en él, también estos archivos.",
    moveUnavailable:
      "Estos archivos no se pueden apartar en este equipo: el sistema trata la carpeta donde están y la carpeta del equipo para archivos apartados como discos distintos, y «Empezar de nuevo» nunca copia archivos. No se ha cambiado nada. Puedes elegir «Conservarlo todo y parar».",
    notSaved:
      "El equipo no ha podido guardar la elección. No se ha movido nada. Pulsa «Continuar» para volver a intentarlo.",
    notFinished:
      "«Empezar de nuevo» no ha podido terminar. Los archivos que encontró no han cambiado. Pulsa «Reintentar un arranque normal»: el equipo continúa al arrancar.",
    moved: (folder) =>
      `«Empezar de nuevo» ha terminado. Los archivos están en ${folder}. Waitron se está reiniciando en una configuración inicial nueva; recarga esta página dentro de un minuto.`,
  },
};

export type StartAgainMessage =
  | {
      kind:
        | "passwordMissing"
        | "choiceMissing"
        | "wrongPassword"
        | "filesChanged"
        | "notOffered"
        | "insecure"
        | "otherPage"
        | "busy"
        | "diskFull"
        | "moveUnavailable"
        | "notSaved"
        | "notFinished";
    }
  | { kind: "throttled"; minutes: number }
  | { kind: "moved"; folder: string };

type Choice = Extract<StartAgainSurvey, { kind: "choice" }>;

const MAX_LISTED = 50;

/** The unit's top path first (a folder with a trailing `/`), then a database's side files. */
function unitLines(unit: StartAgainUnit): string[] {
  const top = unit.entries.find((entry) => entry.path === unit.path);
  const head = `${unit.root}/${unit.path}${top?.type === "folder" ? "/" : ""}`;
  const sides = unit.pieces
    .filter((piece) => piece !== unit.path)
    .map((piece) => `${unit.root}/${piece}`);
  return [head, ...sides];
}

function foundList(survey: Choice, text: StartAgainPageText): string {
  const lines = survey.units.flatMap(unitLines);
  const shown = lines.slice(0, MAX_LISTED);
  if (lines.length > MAX_LISTED) shown.push(text.more(lines.length - MAX_LISTED));
  return `<p>${escapeHtml(text.filesFound)}</p>
<ul>
${shown.map((line) => `<li>${escapeHtml(line)}</li>`).join("\n")}
</ul>
`;
}

/** `YYYY-MM-DD HH:MM UTC`, the form `moveFloor` names. */
function utcMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function bottomText(message: StartAgainMessage, text: StartAgainPageText): string {
  switch (message.kind) {
    case "passwordMissing":
    case "choiceMissing":
      return text.fixFields;
    case "wrongPassword":
      return text.forgotten;
    case "throttled":
      return `${text.throttled(message.minutes)} ${text.forgotten}`;
    case "moved":
      return text.moved(message.folder);
    default:
      return text[message.kind];
  }
}

/**
 * The found files and, over a secure request, the choice form. Placed between the action
 * paragraph and the Retry form. The password box is the page's one native text field: the page
 * loads no script, so no field primitive can run on it (A1098 Q1).
 */
export function renderStartAgainSection(input: {
  survey: Choice;
  locale: SupportedLocale;
  secure: boolean;
  now: Date;
  message?: StartAgainMessage;
  chosen?: "keep" | "move";
}): string {
  const { survey, locale, secure, now, message, chosen } = input;
  const text = START_AGAIN_PAGE_TEXT[locale];
  const list = foundList(survey, text);
  const bottom =
    message === undefined
      ? ""
      : `<p id="start-again-message">${escapeHtml(bottomText(message, text))}</p>\n`;
  if (message?.kind === "moved") return `${list}${bottom}`;
  if (!secure) return `${list}<p>${escapeHtml(text.insecureForm)}</p>\n${bottom}`;

  const passwordError =
    message?.kind === "passwordMissing"
      ? text.passwordMissing
      : message?.kind === "wrongPassword"
        ? text.wrongPassword
        : null;
  const choiceError = message?.kind === "choiceMissing" ? text.choiceMissing : null;
  const passwordInvalid =
    passwordError === null
      ? ""
      : ' aria-invalid="true" aria-describedby="start-again-password-error"';
  const choiceInvalid = choiceError === null ? "" : ' aria-describedby="start-again-choice-error"';
  const checked = (value: "keep" | "move") => (chosen === value ? " checked" : "");
  const floor =
    survey.noteFloorMs !== null && survey.noteFloorMs > now.getTime()
      ? `<p>${escapeHtml(text.moveFloor(utcMinute(survey.noteFloorMs)))}</p>\n`
      : "";
  const fieldError = (id: string, value: string | null) =>
    value === null ? "" : `<p id="${id}">${escapeHtml(value)}</p>\n`;

  return `${list}<form method="post" action="/recovery-api/start-again">
<p><label for="start-again-password">${escapeHtml(text.password)} *</label></p>
<p><input type="password" id="start-again-password" name="password" autocomplete="current-password" required${passwordInvalid}></p>
${fieldError("start-again-password-error", passwordError)}<fieldset${choiceInvalid}>
<legend>${escapeHtml(text.choiceLegend)}</legend>
<p><label><input type="radio" name="choice" value="keep" required${checked("keep")}> <strong>${escapeHtml(text.keepTitle)}</strong></label></p>
<p>${escapeHtml(text.keepDetail)}</p>
<p><label><input type="radio" name="choice" value="move" required${checked("move")}> <strong>${escapeHtml(text.moveTitle)}</strong></label></p>
<p>${escapeHtml(text.moveDetail)}</p>
<p>${escapeHtml(text.moveUnsent)}</p>
${floor}</fieldset>
${fieldError("start-again-choice-error", choiceError)}<input type="hidden" name="listed" value="${escapeHtml(survey.digest)}">
${bottom}<button type="submit">${escapeHtml(text.continue)}</button>
</form>
`;
}
