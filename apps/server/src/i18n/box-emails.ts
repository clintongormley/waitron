export const BOX_EMAIL_WORDS = {
  "storage.space_low": {
    en: {
      subject: "{venue}: the box is nearly out of disk space",
      text: "The box at {venue} is nearly out of disk space: it has about 2 GB left, or less. Everything still works, but if the disk fills up nothing can be saved. See what is using the space on the Box status page: in the dashboard, Settings → Box status.",
    },
    es: {
      subject: "{venue}: al equipo le queda poco espacio en disco",
      text: "Al equipo de {venue} le queda poco espacio en disco: unos 2 GB o menos. Todo sigue funcionando, pero si se llena no se podrá guardar nada. Mira qué ocupa espacio en Estado del equipo: en el panel de gestión, Ajustes → Estado del equipo.",
    },
  },
  "storage.disk_full": {
    en: {
      subject: "{venue}: the box is out of disk space and cannot save anything",
      text: "The box at {venue} is out of disk space, so nothing can be saved: no orders, payments or clock-ins. Free space on the Box status page (in the dashboard, Settings → Box status): its Free button deletes only files the box no longer needs. If that is not enough, ask whoever installed the box to free more space or fit a bigger disk.",
    },
    es: {
      subject: "{venue}: el equipo no tiene espacio en disco y no puede guardar nada",
      text: "El equipo de {venue} no tiene espacio en disco, así que no se puede guardar nada: ni pedidos, ni cobros, ni fichajes. Libera espacio en Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo): su botón Liberar borra solo archivos que el equipo ya no necesita. Si no basta, pide a quien instaló el equipo que libere más espacio o ponga un disco mayor.",
    },
  },
  "clock.unusable": {
    en: {
      subject: "{venue}: sales can't be recorded because the box's clock is wrong",
      text: "The box at {venue} has its clock set before 28 October 2024, so no sale can be recorded for the tax agency until the clock is right. Connect the box to the internet; if its clock does not correct itself, ask whoever installed the box to set it.",
    },
    es: {
      subject: "{venue}: no se pueden registrar ventas porque la hora del equipo es incorrecta",
      text: "El equipo de {venue} tiene la hora puesta antes del 28 de octubre de 2024, así que no se puede registrar ninguna venta en Hacienda hasta que la hora sea correcta. Conecta el equipo a internet; si la hora no se corrige sola, pide a quien instaló el equipo que la ponga.",
    },
  },
  "clock.behind_chain": {
    en: {
      subject: "Payments stopped at {venue}: the box's clock reads earlier than its last sale",
      text: "The box's clock ({clockAt}) reads earlier than its last recorded sale ({lastRecordAt}). Since then no device can take payment. Orders can still be taken and sent to the kitchen. What to do: • If the box's clock is wrong (usual after a power cut): connect the box to the internet so it corrects itself, or call whoever installed it. • If you think the box's clock is right: look at the Box status page (in the dashboard, Settings → Box status), which says whether payments can be restarted.",
    },
    es: {
      subject: "No se puede cobrar en {venue}: la hora del equipo es anterior a la última venta",
      text: "La hora del equipo ({clockAt}) es anterior a la última venta registrada ({lastRecordAt}). Desde entonces ningún dispositivo puede cobrar. Se pueden seguir tomando pedidos y enviándolos a cocina. Qué hacer: • Si la hora del equipo está mal (lo normal tras un corte de luz): conecta el equipo a internet para que la corrija, o llama a quien lo instaló. • Si crees que la hora del equipo es correcta: mira Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo), que dirá si se pueden reanudar los cobros.",
    },
  },
} as const satisfies Record<string, Record<"en" | "es", { subject: string; text: string }>>;

/** What confirmed the box's clock, by `clock.behind_chain_restarted`'s `confirmedBy`. */
export const CLOCK_CONFIRMED_BY_WORDS = {
  en: {
    authority: "the tax agency's time",
    devices: "two tills or handhelds",
    admin: "an administrator",
    otherwise: "a check recorded on the box",
  },
  es: {
    authority: "la hora de Hacienda",
    devices: "dos cajas o terminales",
    admin: "un administrador",
    otherwise: "una comprobación anotada en el equipo",
  },
} as const satisfies Record<"en" | "es", Record<string, string>>;

export const CLOCK_RESTARTED_EMAIL_WORDS = {
  en: {
    subject: "Payments restarted at {venue}",
    text: "The box's clock was confirmed by {confirmedBy} and payments started again. Sales recorded with a later time than the real one are listed on the Box status page (in the dashboard, Settings → Box status).",
  },
  es: {
    subject: "Se reanudaron los cobros en {venue}",
    text: "La hora del equipo se confirmó con {confirmedBy} y se volvió a cobrar. Las ventas registradas con una hora posterior a la real están en Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo).",
  },
} as const satisfies Record<"en" | "es", { subject: string; text: string }>;

/** `text` for several sales, `one` for one, `partial` appended to either; `unconfirmed` instead of
 * all three when the box cannot tell which sales. */
export const CLOCK_MISDATED_EMAIL_WORDS = {
  en: {
    subject: "Sales dated wrongly at {venue}: check them with your tax adviser",
    text: "{count} sales were recorded with a time later than the real time, from {from} to {to}. They stay as recorded. The list is on the Box status page; go through it with your tax adviser and then mark the alert as handled.",
    one: "One sale was recorded with a time later than the real time, at {from}. It stays as recorded. The list is on the Box status page; go through it with your tax adviser and then mark the alert as handled.",
    partial: "The box restarted during the stop, so the list may be short.",
    unconfirmed: {
      subject: "Sales may be dated wrongly at {venue}: check them with your tax adviser",
      text: "The payment stop that began at {from} ended by itself, but nothing confirmed the box's clock, so the box cannot tell which sales were dated wrongly. Check the box's clock, and go through the sales since then with your tax adviser; then mark the alert as handled.",
    },
  },
  es: {
    subject: "Ventas con fecha incorrecta en {venue}: revísalas con tu asesor",
    text: "Se registraron {count} ventas con una hora posterior a la real, de {from} a {to}. Quedan como se registraron. La lista está en Estado del equipo; revísala con tu asesor y después marca el aviso como atendido.",
    one: "Se registró una venta con una hora posterior a la real, a las {from}. Queda como se registró. La lista está en Estado del equipo; revísala con tu asesor y después marca el aviso como atendido.",
    partial: "El equipo se reinició durante la parada, así que puede faltar alguna.",
    unconfirmed: {
      subject: "Puede haber ventas con fecha incorrecta en {venue}: revísalas con tu asesor",
      text: "La parada de cobros que empezó a las {from} terminó sola, pero nada confirmó la hora del equipo, así que el equipo no puede saber qué ventas tienen la fecha mal. Comprueba la hora del equipo y revisa con tu asesor las ventas desde entonces; después marca el aviso como atendido.",
    },
  },
} as const;
