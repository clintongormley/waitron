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
        holds: "your name, contact details, language, role and account status.",
        use: "Used to run the venue, contact you and decide what you may do.",
        sentTo: [
          "A manager or admin can download a configuration export that holds your name, contact details, language, role and account status, including after you leave; they protect it with a passphrase they choose.",
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
          "Your till sign-in sessions stay on the box after they end. When you sign out, the box deletes your current dashboard session. Dashboard sessions you leave open stay on the box, even after they time out. Dashboard sign-ins and sign-outs are recorded in activity history, which the box keeps for 30 days.",
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
          "your shifts (their times and the state of the rota each is on), the availability recorded for you, and the shift swaps you asked for or were offered, with the other person's name and who decided them.",
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
      "clock-entries.json": {
        holds:
          "your clock-ins, clock-outs, breaks, corrections and confirmations, with their times, time offsets, capture sources and the ids of the people involved.",
        use: "Kept as the venue's record of the hours you worked.",
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
          "the whole sales already recorded whose void you authorised, the refunds you asked for, authorised or recorded the outcome of, and the cash-drawer openings you made or authorised: how many of each; for each one, the invoice number where there is one, the amount where there is one and when it happened; for each refund, the tip it gave back, whether it was cash or card and whether it went through, failed or is still waiting; for each opening, why the drawer opened and whether another person authorised it for the person who opened it; and for each refund and opening, your part in it. It also lists the cash you counted, added or took out, with a minus sign for cash out. A drawer close shows what went to the bank as a positive amount or zero. For each bill payment you requested or confirmed, it gives the amount, tip, method, status, when it was requested, the invoice number if the bill was invoiced and, if you confirmed the outcome, when the payment was recorded as received or failed. For each receipt reprint you requested, it gives the invoice number and request time.",
        use: "Kept to account for the money the venue takes and gives back.",
        kept: ["Nothing in the box deletes a voided sale, a refund or a cash-drawer opening."],
      },
      "service-actions.json": {
        holds:
          "your order events (including draft take-overs), group submissions and firings, party openings and closings, when you answered a party’s allergy question, dish moves (with station IDs), order amendments, the last recorded cancellation of each dish and late-dish confirmations. A group action can appear twice. A move or split can carry a cancellation or confirmation to another line, and a dish and its extras can share a confirmation. For a late dish, the time shown is when it was sent, if recorded.",
        use: "Used to track how orders were handled and who took each action.",
      },
      "staff-actions.json": {
        holds:
          "the bills, drafts and lines that currently name you as editor, owner or the person credited, plus the alerts you acknowledged, your recorded activity by kind and time, the receipts you handed over and the settings that name you as the last person to save them. For recorded emails about you or requested by you, it gives the kind, status, time queued and your role. With working-time tracking enabled, your attendance reminders are in attendance.json.",
        use: "Used to account for staff actions at the venue.",
        kept: ["The box prunes the activity log after 30 days."],
      },
      "workforce-decisions.json": {
        holds:
          "the absence, swap and attendance decisions you made about other staff, with record references, outcomes and decision times. It also lists the rota periods you published and when.",
        use: "Used to account for workforce decisions at the venue.",
      },
      "department-transfers.json": {
        holds:
          "the department transfers you resolved, including those you withdrew, with the order number, department IDs, outcome and when you resolved each one.",
        use: "Used to track how orders move between departments.",
      },
      "payment-holds.json": {
        holds: "the order number for each payment hold you decided, what you decided and when.",
        use: "Kept to account for how the venue settled a payment discrepancy.",
      },
      "menu-publications.json": {
        holds:
          "the editions you published or scheduled and the cancellations recorded under your name, with the menu ID, today’s menu name, the edition number, the action (created covers publishing, scheduling and edits to a live menu) and the time of the original creation or the cancellation. A live edit can cancel a scheduled edition under the editor’s name. Its replacement has a new edition number and keeps the original author and time.",
        use: "Used to track who published, scheduled or cancelled a menu edition.",
      },
      "bookings-created.json": {
        holds: "the ID of each booking you created and when you created it.",
        use: "Used to track who took each booking.",
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
        holds: "tu nombre, tus datos de contacto, tu idioma, tu rol y el estado de tu cuenta.",
        use: "Sirve para gestionar el local, contactarte y decidir qué puedes hacer.",
        sentTo: [
          "Un encargado o un administrador puede descargar una exportación de la configuración que contiene tu nombre, tus datos de contacto, tu idioma, tu rol y el estado de tu cuenta, también después de que te vayas; la protege con una contraseña que elige esa persona.",
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
          "Tus sesiones de caja se quedan en el servidor Waitron del local aunque hayan terminado. Al cerrar sesión en el panel, el servidor borra la sesión actual. Las sesiones del panel que dejas abiertas se quedan en el servidor, incluso después de caducar. Los accesos y cierres de sesión del panel se registran en el historial de actividad, que el servidor conserva durante 30 días.",
          "El registro de un correo de cuenta ya usado o caducado se borra cuando se genera para ti otro del mismo tipo; una vinculación con Google sin terminar se borra la próxima vez que alguien empieza un inicio de sesión o una vinculación con Google después de que caduque.",
        ],
      },
      "employment.json": {
        holds:
          "tus contratos: el tipo de contrato, los minutos semanales contratados, las fechas de inicio y fin y la retribución.",
        use: "Sirve para gestionar tu contrato y tu retribución; tus minutos contratados son la base para calcular las horas extra.",
        sentTo: [
          "Un encargado o un administrador puede descargar una exportación de la configuración que contiene tus contratos, con la retribución, también después de que te vayas.",
        ],
        kept: ["Nada en el servidor Waitron del local borra un contrato."],
      },
      "rota.json": {
        holds:
          "tus turnos (sus horas y el estado del cuadrante en que está cada uno), la disponibilidad registrada para ti y los cambios de turno que pediste o te ofrecieron, con el nombre de la otra persona y de quien los decidió.",
        use: "Sirve para planificar el cuadrante.",
        sentTo: [
          "Un encargado o un administrador puede descargar una exportación de la configuración que contiene tu disponibilidad, también después de que te vayas.",
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
          "las preguntas que te hizo el servidor Waitron del local sobre fichajes de entrada o de salida que faltaban o un fichaje de salida automático, el correo de aviso de una pregunta sobre fichajes que faltaban, si el servidor preparó uno, las respuestas que diste tú o un supervisor, un encargado o un administrador y quién las autorizó, y la actividad (inicios de sesión, comandas, cobros, descansos) que registra el servidor para detectarlas.",
        use: "Sirve para que tu registro de jornada esté completo.",
        sentTo: [
          "Los correos de aviso se envían a través del servicio de correo que configuró el local, si tiene uno.",
        ],
        kept: [
          "Nada en el servidor Waitron del local borra estas preguntas, correos, respuestas ni registros de actividad.",
        ],
      },
      "clock-entries.json": {
        holds:
          "tus entradas, salidas, descansos, correcciones y confirmaciones, con sus horas, desfases horarios, fuentes de captura y los identificadores de las personas que intervinieron.",
        use: "Se guarda como el registro del local de las horas que trabajaste.",
      },
      "staff-roles.json": {
        holds:
          "los roles de personal que puedes cubrir y el área y el rol de personal de cada uno de tus turnos que tenga uno asignado.",
        use: "Sirve para planificar quién cubre cada área.",
        sentTo: [
          "Un encargado o un administrador puede descargar una exportación de la configuración que contiene los roles de personal que puedes cubrir, también después de que te vayas.",
        ],
        kept: [
          "Un rol de personal se te quita cuando un encargado o un administrador cambia quién lo tiene o borra el rol; el área y el rol de un turno se borran con el turno.",
        ],
      },
      "time-record.pdf": {
        holds:
          "tu registro de jornada en este local: cuándo empezaste y terminaste de trabajar, tus descansos, cada corrección y decisión y los períodos cerrados, tal como lo muestra la exportación del registro de jornada.",
        use: "Se guarda como el registro del local de las horas que trabajaste.",
        sentTo: [
          "Un encargado o un administrador puede descargar el registro de jornada, incluido el tuyo; el propio registro indica quién tiene derecho a verlo.",
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
          "las ventas completas ya registradas cuya anulación autorizaste, las devoluciones que pediste, autorizaste o cuyo resultado registraste, y las aperturas del cajón de efectivo que hiciste o autorizaste: cuántas hay de cada una; de cada una, el número de factura si lo tiene, el importe si lo tiene y cuándo ocurrió; de cada devolución, la propina devuelta, si fue en efectivo o con tarjeta y si se completó, falló o sigue pendiente; de cada apertura, por qué se abrió el cajón y si otra persona la autorizó para quien lo abrió; y de cada devolución y cada apertura, qué parte tuviste tú. También indica el efectivo que contaste, añadiste o retiraste. Las salidas de efectivo llevan un signo menos. El cierre del cajón muestra lo que se retiró para el banco como un importe positivo o cero. De los pagos de cuentas que pediste o confirmaste, indica el importe, la propina, el método, el estado, cuándo se pidió, el número de factura si se facturó la cuenta y, si confirmaste el resultado, cuándo consta que se recibió o falló el pago. De cada reimpresión de un recibo que pediste, indica el número de factura y cuándo la pediste.",
        use: "Se guarda para dar cuenta del dinero que el local cobra y devuelve.",
        kept: [
          "Nada en el servidor Waitron del local borra una venta anulada, una devolución ni una apertura del cajón de efectivo.",
        ],
      },
      "service-actions.json": {
        holds:
          "tus acciones en pedidos (incluidas las tomas de control de borradores), los grupos que enviaste o mandaste preparar, las mesas que abriste o cerraste, cuándo respondiste a una pregunta sobre alergias, los cambios de estación de platos (con los identificadores de las estaciones), las modificaciones de pedidos, la última cancelación registrada de cada plato y las confirmaciones de platos tardíos. Una acción de grupo puede aparecer dos veces. Al mover o dividir un plato, otra línea puede conservar su cancelación o confirmación, y un plato y sus extras pueden compartir una confirmación. La hora de un plato tardío indica cuándo se envió, si consta.",
        use: "Se usa para saber cómo se gestionaron los pedidos y quién realizó cada acción.",
      },
      "staff-actions.json": {
        holds:
          "las cuentas, los borradores y las líneas en los que figuras como responsable de la edición, titular del borrador o la persona a la que se atribuye la línea. También incluye las alertas que atendiste, el tipo y la hora de tu actividad registrada, los recibos que entregaste y los ajustes que guardaste por última vez. Para los correos registrados sobre ti o que solicitaste, indica el tipo, el estado, cuándo se pusieron en cola y qué papel tuviste. Si el control horario está activado, tus recordatorios de asistencia están en attendance.json.",
        use: "Sirve para dar cuenta de las acciones del personal del local.",
        kept: ["El servidor borra las entradas del registro de actividad al cabo de 30 días."],
      },
      "workforce-decisions.json": {
        holds:
          "las decisiones que tomaste sobre ausencias, cambios de turno y asistencia de otras personas, con las referencias de los registros, los resultados y las fechas y horas de las decisiones. También recoge los períodos de los cuadrantes que publicaste y cuándo lo hiciste.",
        use: "Sirve para dar cuenta de las decisiones sobre el personal del local.",
      },
      "department-transfers.json": {
        holds:
          "los traspasos entre departamentos que resolviste, incluidos los que retiraste, con el número de pedido, los identificadores de los departamentos, el resultado y la fecha y hora de la resolución.",
        use: "Se usa para seguir los pedidos que pasan de un departamento a otro.",
      },
      "payment-holds.json": {
        holds:
          "el número de pedido de cada pago retenido sobre el que tomaste una decisión, qué decidiste y cuándo.",
        use: "Se guarda para dar cuenta de cómo resolvió el local una discrepancia de pago.",
      },
      "menu-publications.json": {
        holds:
          "las ediciones que publicaste o programaste y las cancelaciones que constan a tu nombre, con el identificador y el nombre actual de la carta, el número de edición, la acción (created abarca la publicación, la programación y los cambios en una carta publicada) y la hora de creación original o la de cancelación. Un cambio en la carta publicada puede dejar una edición programada cancelada a nombre de quien hizo el cambio. La edición que la sustituye tiene un número nuevo y conserva la autoría y la hora originales.",
        use: "Se usa para saber quién publicó, programó o canceló una edición de la carta.",
      },
      "bookings-created.json": {
        holds: "el identificador de cada reserva que creaste y cuándo la creaste.",
        use: "Se usa para saber quién tomó cada reserva.",
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
      "Tus datos los introdujiste tú o un supervisor, un encargado o un administrador del local, o se importaron al configurar el servidor Waitron del local; el resto se registró automáticamente mientras usabas Waitron.",
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

/** The invoice-customer download's own lines; the shared ones come from `PERSONAL_DATA_README_WORDS`. */
export interface InvoiceCustomerReadmeWords {
  readonly holds: string;
  readonly use: string;
  readonly pdfs: string;
  readonly notFound: string;
  readonly origin: string;
  readonly taxRecord: string;
  readonly email: string;
  readonly kept: readonly string[];
}

export const INVOICE_CUSTOMER_README_WORDS: Record<"en" | "es", InvoiceCustomerReadmeWords> = {
  en: {
    holds:
      "the full invoices the venue issued to your tax number: for each one, its number, when it was issued, the name, tax number, country and address on it, its total, the PDF copy in this download, whether the box keeps a tax record of it, and every address the box emailed it to or tried to, with when the email was asked for, whether it went and when, and the result recorded for each attempt and when.",
    use: "Kept because an invoice must name its customer and the venue must keep a copy of each invoice it issues.",
    pdfs: "a copy of each of those invoices as a PDF, marked as a copy.",
    notFound:
      "This copy holds your full invoices and a record of every attempt to email them. The box also keeps the details staff typed for an invoice on the bill itself and in printer records; ask the venue for those. Anything else the venue holds about you, such as a booking or an invoice you sent the venue, is not in this copy; ask the venue for it.",
    origin:
      "Staff at the venue entered your name, tax number and address when you asked for a full invoice; the rest was recorded as each invoice was issued and sent.",
    taxRecord:
      'For each invoice marked "taxRecord": true in invoices.json, the box keeps a tax record that it sends to the tax authority (in Spain, the Agencia Tributaria); that record holds your name and tax number, not your address.',
    email: "Invoices emailed to you are sent through the email service the venue set up.",
    kept: [
      "Nothing in the box deletes or changes an issued invoice: the box refuses to.",
      "Nothing in the box deletes the record of an invoice email.",
    ],
  },
  es: {
    holds:
      "las facturas completas que el local emitió a tu NIF: de cada una, su número, cuándo se emitió, el nombre, el NIF, el país y la dirección que lleva, su total, la copia en PDF de esta descarga, si el servidor Waitron del local guarda un registro fiscal de ella, y todas las direcciones de correo a las que se envió o se intentó enviar, con cuándo se pidió el envío, si salió y cuándo, y el resultado registrado de cada intento y cuándo.",
    use: "Se guarda porque una factura debe identificar a su destinatario y el local debe conservar una copia de cada factura que emite.",
    pdfs: "una copia en PDF de cada una de esas facturas, marcada como copia.",
    notFound:
      "Esta copia contiene tus facturas completas y un registro de cada intento de enviarlas por correo. El servidor Waitron del local también guarda los datos que el personal escribió para una factura en la propia cuenta y en los registros de impresión; pídeselos al local. Cualquier otro dato tuyo que tenga el local, como una reserva o una factura que enviaste al local, no está en esta copia; pídeselo al local.",
    origin:
      "El personal del local introdujo tu nombre, tu NIF y tu dirección cuando pediste una factura completa; el resto se registró al emitir y enviar cada factura.",
    taxRecord:
      'De cada factura marcada con "taxRecord": true en invoices.json, el servidor Waitron del local guarda un registro fiscal que envía a la administración tributaria (en España, la Agencia Tributaria); ese registro contiene tu nombre y tu NIF, no tu dirección.',
    email:
      "Las facturas que se te enviaron por correo salen a través del servicio de correo que configuró el local.",
    kept: [
      "Nada en el servidor Waitron del local borra ni cambia una factura emitida: el servidor no lo permite.",
      "Nada en el servidor Waitron del local borra el registro del envío de una factura por correo.",
    ],
  },
};
