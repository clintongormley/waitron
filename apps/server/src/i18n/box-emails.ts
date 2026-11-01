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
      text: "The box at {venue} has its clock set before 28 October 2024, so no sale can be recorded for the tax agency until the clock is right. With the internet the box puts it right by itself. Otherwise an administrator can usually set it from their own phone or computer on the Box status page (in the dashboard, Settings → Box status); if the box started with its clock wrong, any staff member can do it from a till with “Check the time”.",
    },
    es: {
      subject: "{venue}: no se pueden registrar ventas porque la hora del equipo es incorrecta",
      text: "El equipo de {venue} tiene la hora puesta antes del 28 de octubre de 2024, así que no se puede registrar ninguna venta en Hacienda hasta que la hora sea correcta. Con internet, el equipo la corrige solo. Si no, un administrador normalmente puede ponerla en hora desde su propio móvil u ordenador en Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo); si el equipo arrancó con la hora mal, cualquier empleado puede hacerlo desde una caja con «Comprobar la hora».",
    },
  },
  "clock.behind_chain": {
    en: {
      subject: "Payments stopped at {venue}: the box's clock reads earlier than its last sale",
      text: "The box's clock ({clockAt}) reads earlier than its last recorded sale ({lastRecordAt}). Since then no device can take payment. Orders can still be taken and sent to the kitchen. What to do: • If the box's clock is wrong (usual after a power cut): with the internet the box puts it right by itself; otherwise an administrator can usually set it from their own phone or computer on the Box status page (in the dashboard, Settings → Box status), and if the box started with payments stopped and the tax agency does not answer (or the box does not send it records), any staff member can do it from a till with “Check the time”. • If you think the box's clock is right: an administrator can confirm it on the same page; with the internet the box does it by itself, and so do two tills that agree with it — except when the box started with payments stopped: then two tills are not enough, and, in the same case, a staff member confirms it from a till with “Check the time”.",
    },
    es: {
      subject: "No se puede cobrar en {venue}: la hora del equipo es anterior a la última venta",
      text: "La hora del equipo ({clockAt}) es anterior a la última venta registrada ({lastRecordAt}). Desde entonces ningún dispositivo puede cobrar. Se pueden seguir tomando pedidos y enviándolos a cocina. Qué hacer: • Si la hora del equipo está mal (lo normal tras un corte de luz): con internet, el equipo la corrige solo; si no, un administrador normalmente puede ponerla en hora desde su propio móvil u ordenador en Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo), y si el equipo arrancó con los cobros parados y Hacienda no responde (o el equipo no le envía registros), cualquier empleado puede hacerlo desde una caja con «Comprobar la hora». • Si crees que la hora del equipo es correcta: un administrador puede confirmarla en esa misma página; con internet, el equipo lo hace solo, y también dos cajas que coincidan con él, salvo si el equipo arrancó con los cobros parados: entonces no bastan dos cajas y, en ese mismo caso, un empleado la confirma desde una caja con «Comprobar la hora».",
    },
  },
} as const satisfies Record<string, Record<"en" | "es", { subject: string; text: string }>>;

/** What confirmed the box's clock, by `clock.behind_chain_restarted`'s `confirmedBy`. */
export const CLOCK_CONFIRMED_BY_WORDS = {
  en: {
    authority: "the tax agency's time",
    devices: "two tills or handhelds",
    admin: "an administrator",
    staff: "a staff member on a till",
    otherwise: "a check recorded on the box",
    staffNamed: "a staff member ({person}) on a till",
  },
  es: {
    authority: "la hora de Hacienda",
    devices: "dos cajas o terminales",
    admin: "un administrador",
    staff: "un empleado en una caja",
    otherwise: "una comprobación anotada en el equipo",
    staffNamed: "un miembro del personal ({person}) en una caja",
  },
} as const satisfies Record<"en" | "es", Record<string, string>>;

export const CLOCK_RESTARTED_EMAIL_WORDS = {
  en: {
    subject: "Payments restarted at {venue}",
    text: "The box's clock was confirmed by {confirmedBy} and payments started again. Sales recorded with a later time than the real one are listed on the Box status page (in the dashboard, Settings → Box status).",
    byStaff:
      "The box's clock was confirmed by {person}, a staff member, on {till}, and payments started again. Sales recorded with a later time than the real one are listed on the Box status page (in the dashboard, Settings → Box status).",
    namedTill: "till {device}",
    unnamedTill: "a till",
  },
  es: {
    subject: "Se reanudaron los cobros en {venue}",
    text: "La hora del equipo se confirmó con {confirmedBy} y se volvió a cobrar. Las ventas registradas con una hora posterior a la real están en Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo).",
    byStaff:
      "La hora del equipo la confirmó {person}, miembro del personal, en {till}, y se volvió a cobrar. Las ventas registradas con una hora posterior a la real están en Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo).",
    namedTill: "la caja {device}",
    unnamedTill: "una caja",
  },
} as const satisfies Record<
  "en" | "es",
  { subject: string; text: string; byStaff: string; namedTill: string; unnamedTill: string }
>;

/** By what set the clock, `unverified` (with its own subject) instead of any when the box could
 * not confirm the step took; `{step}` is `forward`, `back` or `moved` with the step's length. */
export const CLOCK_CORRECTED_EMAIL_WORDS = {
  en: {
    subject: "{venue}: the box's clock was set",
    authority:
      "The box set its clock from the tax agency's time: {step}, from {before} to {after}.",
    admin: "The box's clock was set from {person}'s device: {step}, from {before} to {after}.",
    staff:
      "The box's clock was set from the time on {till}, confirmed by {person}, a staff member: {step}, from {before} to {after}.",
    unverifiedSubject: "{venue}: the box could not confirm it set its clock",
    unverified:
      "The box tried to set its clock but could not confirm the change took. Its clock read {before} before and {after} after ({step}). Check the box's clock on the Box status page (in the dashboard, Settings → Box status).",
    forward: "moved forward {duration}",
    back: "moved back {duration}",
    moved: "moved {duration}",
    namedTill: "till {device}",
    unnamedTill: "a till",
  },
  es: {
    subject: "{venue}: se puso la hora del equipo",
    authority: "El equipo puso su reloj con la hora de Hacienda: {step}, de {before} a {after}.",
    admin:
      "El reloj del equipo se puso con la hora del dispositivo de {person}: {step}, de {before} a {after}.",
    staff:
      "El reloj del equipo se puso con la hora de {till}, confirmada por {person}, miembro del personal: {step}, de {before} a {after}.",
    unverifiedSubject: "{venue}: el equipo no pudo confirmar que puso su reloj",
    unverified:
      "El equipo intentó poner su reloj, pero no ha podido confirmar que el cambio se aplicara. Su reloj marcaba {before} antes y {after} después ({step}). Comprueba la hora del equipo en Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo).",
    forward: "adelantado {duration}",
    back: "atrasado {duration}",
    moved: "cambiado {duration}",
    namedTill: "la caja {device}",
    unnamedTill: "una caja",
  },
} as const satisfies Record<"en" | "es", Record<string, string>>;

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
    text: "Se registraron {count} ventas con una hora posterior a la real, de {from} a {to}. Quedan como se registraron. La lista está en Estado del equipo; revísala con tu asesor y después marca el aviso como resuelto.",
    one: "Se registró una venta con una hora posterior a la real, el {from}. Queda como se registró. La lista está en Estado del equipo; revísala con tu asesor y después marca el aviso como resuelto.",
    partial: "El equipo se reinició durante la parada, así que puede faltar alguna.",
    unconfirmed: {
      subject: "Puede haber ventas con fecha incorrecta en {venue}: revísalas con tu asesor",
      text: "La parada de cobros que empezó el {from} terminó sola, pero nada confirmó la hora del equipo, así que el equipo no puede saber qué ventas tienen la fecha mal. Comprueba la hora del equipo y revisa con tu asesor las ventas desde entonces; después marca el aviso como resuelto.",
    },
  },
} as const;

/** `one` for a single deleted backup, `text` for several taken on one day, `severalDays` for
 * several taken on different days. */
export const BACKUP_DELETED_EMAIL_WORDS = {
  en: {
    subject: "{venue}: Old backups deleted: low disk space",
    one: "Low disk space: the box deleted its oldest backup ({date}).",
    text: "Low disk space: the box deleted its {count} oldest backups ({date}).",
    severalDays:
      "Low disk space: the box deleted its {count} oldest backups ({date} to {lastDate}).",
  },
  es: {
    subject: "{venue}: Copias antiguas borradas: poco espacio en disco",
    one: "Poco espacio en disco: el equipo borró su copia de seguridad más antigua ({date}).",
    text: "Poco espacio en disco: el equipo borró sus {count} copias más antiguas ({date}).",
    severalDays:
      "Poco espacio en disco: el equipo borró sus {count} copias más antiguas (del {date} al {lastDate}).",
  },
} as const;

export const BACKUP_REFUSED_EMAIL_WORDS = {
  en: {
    subject: "{venue}: Backup not made: low disk space",
    text: "Backup not made: it needs {needed} free and the disk has {available}.",
  },
  es: {
    subject: "{venue}: Copia no hecha: poco espacio en disco",
    text: "Copia no hecha: necesita {needed} libres y el disco tiene {available}.",
  },
} as const satisfies Record<"en" | "es", { subject: string; text: string }>;
