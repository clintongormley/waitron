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
          "The record of an account email that was used or has expired is deleted when another of the same kind is issued to you; an unfinished Google link is deleted the next time anyone starts a Google sign-in or link after it has expired.",
        ],
      },
      "employment.json": {
        holds:
          "your employment contracts: the contract type, contracted minutes per week, start and end dates and pay rate.",
        use: "Used to manage your employment and pay; your contracted minutes are the baseline for overtime.",
        sentTo: [
          "A manager or admin can download a configuration export that holds your employment contracts, pay rate included, including after you leave.",
        ],
        kept: ["Nothing in the box deletes an employment contract."],
      },
      "rota.json": {
        holds:
          "your shifts (their times, location and the state of the rota each is on), the availability recorded for you, and the shift swaps you asked for or were offered, with the other person's name and who decided them.",
        use: "Used to plan the rota.",
        sentTo: [
          "A manager or admin can download a configuration export that holds your availability, including after you leave.",
        ],
        kept: [
          "A shift can be deleted only while its rota is a draft or while it is on no rota, and deleting it deletes the swaps that offer it; nothing in the box deletes your availability or your other swaps.",
        ],
      },
      "absences.json": {
        holds:
          "your absences: the kind (holiday, sick leave, other leave or unpaid), the dates, whether it was approved, who decided it and any note.",
        use: "Used to plan the rota around your time off.",
        kept: ["Nothing in the box deletes an absence."],
      },
      "attendance.json": {
        holds:
          "the questions the box asked you about missing clock-in or clock-out times or an automatic clock-out, the reminder email about a question on missing times, if the box prepared one, the answers you or a supervisor, manager or admin gave and who authorised them, and the activity (sign-ins, orders, payments, breaks) the box records to notice them.",
        use: "Used to keep your working-time record complete.",
        sentTo: [
          "Reminder emails are sent through the email service the venue set up, when it has one.",
        ],
        kept: ["Nothing in the box deletes these questions, emails, answers or activity records."],
      },
      "staff-roles.json": {
        holds:
          "the staff roles you can fill, and the area and staff role of each of your shifts that has been given one.",
        use: "Used to plan who covers each area.",
        sentTo: [
          "A manager or admin can download a configuration export that holds the staff roles you can fill, including after you leave.",
        ],
        kept: [
          "A staff role is taken from you when a manager or admin changes who holds it or deletes the role; a shift's area and role are deleted with the shift.",
        ],
      },
      "time-record.pdf": {
        holds:
          "your working-time record at this venue: when you started and finished work, your breaks, every correction and decision, and the closed periods, as the working-time export shows it.",
        use: "Kept as the venue's record of the hours you worked.",
        sentTo: [
          "A manager or admin can download the working-time record, yours included; the record names who has the right to see it.",
        ],
        kept: [
          "Nothing in the box deletes your working-time record, and the box refuses to change or delete an entry in it: a correction is added as a new entry.",
          "The record's \"Keep until\" date marks the end of the legal keeping time counted from the end of the period this copy covers, not from each entry's date.",
        ],
      },
      "time-record.csv": {
        holds: "the same working-time record as time-record.pdf, as a spreadsheet file.",
        use: "Kept as the venue's record of the hours you worked.",
      },
      "actions.json": {
        holds:
          "the whole sales already recorded whose void you authorised, the refunds you asked for, authorised or recorded the outcome of, and the cash-drawer openings you made or authorised: how many of each; for each one, the invoice number where there is one, the amount where there is one and when it happened; for each refund, the tip it gave back, whether it was cash or card and whether it went through, failed or is still waiting; for each opening, why the drawer opened and whether another person authorised it for the person who opened it; and for each refund and opening, your part in it.",
        use: "Kept to account for the money the venue takes and gives back.",
        kept: ["Nothing in the box deletes a voided sale, a refund or a cash-drawer opening."],
      },
      "adjustments.json": {
        holds:
          "the voids, comps and discounts on a bill that you made giving a reason, or approved for someone else: how many of each kind (cancel for a void, comp for an item given free, discount_percent and discount_amount); for each one, when it happened, the order number, the item and how much of it (none for a discount on the whole bill), the percentage of a percentage discount, the amount it took off the bill, the list value of what it applied to (the item, or the whole bill), the reason chosen, how far the item had got (unsent, held, fired or served), whether the charge was kept, whether preparation had started, and your part in it.",
        use: "Kept to account for what is taken off the venue's bills, and who decided it.",
        kept: [
          "Nothing in the box deletes or changes a void, comp or discount once it is recorded.",
        ],
      },
    },
    machineReadable: "The .json files are a machine-readable copy you can take to another service.",
    originHeading: "Where it came from",
    origin:
      "You, or a supervisor, manager or admin at the venue, entered your details, or they were imported when the box was set up; the rest was recorded automatically as you used Waitron.",
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
      "employment.json": {
        holds:
          "tus contratos: el tipo de contrato, los minutos semanales contratados, las fechas de inicio y fin y la retribución.",
        use: "Sirve para gestionar tu contrato y tu retribución; tus minutos contratados son la base para calcular las horas extra.",
        sentTo: [
          "Un gerente o un administrador puede descargar una exportación de la configuración que contiene tus contratos, con la retribución, también después de que te vayas.",
        ],
        kept: ["Nada en el servidor Waitron del local borra un contrato."],
      },
      "rota.json": {
        holds:
          "tus turnos (sus horas, el centro y el estado del cuadrante en que está cada uno), la disponibilidad registrada para ti y los cambios de turno que pediste o te ofrecieron, con el nombre de la otra persona y de quien los decidió.",
        use: "Sirve para planificar el cuadrante.",
        sentTo: [
          "Un gerente o un administrador puede descargar una exportación de la configuración que contiene tu disponibilidad, también después de que te vayas.",
        ],
        kept: [
          "Un turno solo se puede borrar mientras su cuadrante es un borrador o mientras no está en ningún cuadrante, y al borrarlo se borran los cambios de turno que lo ofrecen; nada en el servidor Waitron del local borra tu disponibilidad ni tus demás cambios de turno.",
        ],
      },
      "absences.json": {
        holds:
          "tus ausencias: el tipo (vacaciones, baja por enfermedad, otro permiso o sin sueldo), las fechas, si se aprobó, quién la decidió y cualquier nota.",
        use: "Sirve para planificar el cuadrante teniendo en cuenta tus ausencias.",
        kept: ["Nada en el servidor Waitron del local borra una ausencia."],
      },
      "attendance.json": {
        holds:
          "las preguntas que te hizo el servidor Waitron del local sobre fichajes de entrada o de salida que faltaban o un fichaje de salida automático, el correo de aviso de una pregunta sobre fichajes que faltaban, si el servidor preparó uno, las respuestas que diste tú o un supervisor, un gerente o un administrador y quién las autorizó, y la actividad (inicios de sesión, comandas, cobros, descansos) que registra el servidor para detectarlas.",
        use: "Sirve para que tu registro de jornada esté completo.",
        sentTo: [
          "Los correos de aviso se envían a través del servicio de correo que configuró el local, si tiene uno.",
        ],
        kept: [
          "Nada en el servidor Waitron del local borra estas preguntas, correos, respuestas ni registros de actividad.",
        ],
      },
      "staff-roles.json": {
        holds:
          "los roles de personal que puedes cubrir y el área y el rol de personal de cada uno de tus turnos que tenga uno asignado.",
        use: "Sirve para planificar quién cubre cada área.",
        sentTo: [
          "Un gerente o un administrador puede descargar una exportación de la configuración que contiene los roles de personal que puedes cubrir, también después de que te vayas.",
        ],
        kept: [
          "Un rol de personal se te quita cuando un gerente o un administrador cambia quién lo tiene o borra el rol; el área y el rol de un turno se borran con el turno.",
        ],
      },
      "time-record.pdf": {
        holds:
          "tu registro de jornada en este local: cuándo empezaste y terminaste de trabajar, tus descansos, cada corrección y decisión y los períodos cerrados, tal como lo muestra la exportación del registro de jornada.",
        use: "Se guarda como el registro del local de las horas que trabajaste.",
        sentTo: [
          "Un gerente o un administrador puede descargar el registro de jornada, incluido el tuyo; el propio registro indica quién tiene derecho a verlo.",
        ],
        kept: [
          "Nada en el servidor Waitron del local borra tu registro de jornada, y el servidor no permite cambiar ni borrar un asiento: una corrección se añade como un asiento nuevo.",
          "La fecha «Conservar hasta» del registro marca el final del plazo legal de conservación contado desde el final del período que cubre esta copia, no desde la fecha de cada asiento.",
        ],
      },
      "time-record.csv": {
        holds: "el mismo registro de jornada que time-record.pdf, como archivo de hoja de cálculo.",
        use: "Se guarda como el registro del local de las horas que trabajaste.",
      },
      "actions.json": {
        holds:
          "las ventas completas ya registradas cuya anulación autorizaste, las devoluciones que pediste, autorizaste o cuyo resultado registraste, y las aperturas del cajón de efectivo que hiciste o autorizaste: cuántas hay de cada una; de cada una, el número de factura si lo tiene, el importe si lo tiene y cuándo ocurrió; de cada devolución, la propina devuelta, si fue en efectivo o con tarjeta y si se completó, falló o sigue pendiente; de cada apertura, por qué se abrió el cajón y si otra persona la autorizó para quien lo abrió; y de cada devolución y cada apertura, qué parte tuviste tú.",
        use: "Se guarda para dar cuenta del dinero que el local cobra y devuelve.",
        kept: [
          "Nada en el servidor Waitron del local borra una venta anulada, una devolución ni una apertura del cajón de efectivo.",
        ],
      },
      "adjustments.json": {
        holds:
          "las cancelaciones y los descuentos en una cuenta que hiciste indicando un motivo, o que autorizaste a otra persona: cuántos hay de cada tipo (cancel, una cancelación; comp, un artículo gratis; discount_percent, un descuento de un porcentaje; discount_amount, un descuento de un importe); de cada uno, cuándo ocurrió, el número de pedido, el artículo y qué cantidad (nada en un descuento sobre toda la cuenta), el porcentaje de un descuento en porcentaje, el importe descontado de la cuenta, el valor de carta de aquello a lo que se aplicó (el artículo o toda la cuenta), el motivo elegido, en qué punto estaba el artículo (unsent, sin marchar; held, en espera; fired, marchado; served, servido), si se mantuvo el cobro, si se había empezado a preparar y qué parte tuviste tú.",
        use: "Se guarda para dar cuenta de lo que se descuenta de las cuentas del local y de quién lo decidió.",
        kept: [
          "Nada en el servidor Waitron del local borra ni cambia una cancelación o un descuento ya registrados.",
        ],
      },
    },
    machineReadable:
      "Los archivos .json son una copia legible por máquina que puedes llevar a otro servicio.",
    originHeading: "De dónde salen",
    origin:
      "Tus datos los introdujiste tú o un supervisor, un gerente o un administrador del local, o se importaron al configurar el servidor Waitron del local; el resto se registró automáticamente mientras usabas Waitron.",
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
