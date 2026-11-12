export const BOX_EMAIL_WORDS = {
  "storage.space_low": {
    en: {
      subject: "{venue}: the box is nearly out of disk space",
      text: "The box at {venue} is nearly out of disk space: it has about 2 GB left, or less. Everything still works, but if the disk fills up nothing can be saved. See what is using the space on the Box status page: in the dashboard, Settings → Box status.",
    },
    es: {
      subject: "{venue}: al servidor le queda poco espacio en disco",
      text: "Al servidor de {venue} le queda poco espacio en disco: unos 2 GB o menos. Todo sigue funcionando, pero si se llena no se podrá guardar nada. Mira qué ocupa espacio en Estado del servidor: en el panel de gestión, Ajustes → Estado del servidor.",
    },
  },
  "storage.disk_full": {
    en: {
      subject: "{venue}: the box is out of disk space and cannot save anything",
      text: "The box at {venue} is out of disk space, so nothing can be saved: no orders, payments or clock-ins. Free space on the Box status page (in the dashboard, Settings → Box status): its Free button deletes only files the box no longer needs. If that is not enough, Waitron cannot free more space by itself: the rest of the disk holds the venue's data, the backups kept on this box and files that are not Waitron's.",
    },
    es: {
      subject: "{venue}: el servidor no tiene espacio en disco y no puede guardar nada",
      text: "El servidor de {venue} no tiene espacio en disco, así que no se puede guardar nada: ni pedidos, ni cobros, ni fichajes. Libera espacio en Estado del servidor (en el panel de gestión, Ajustes → Estado del servidor): su botón Liberar borra solo archivos que el servidor ya no necesita. Si no basta, Waitron no puede liberar más espacio por sí solo: el resto del disco guarda los datos del local, las copias de seguridad que se guardan en este servidor y archivos que no son de Waitron.",
    },
  },
  "clock.unusable": {
    en: {
      subject: "{venue}: sales can't be recorded because the box's clock is wrong",
      text: "The box at {venue} has its clock set before 28 October 2024, so no sale can be recorded for the tax agency until the clock is right. With the internet the box puts it right by itself. Otherwise an administrator can usually set it from their own phone or computer on the Box status page (in the dashboard, Settings → Box status); if the box started with its clock wrong, any staff member can do it from a till with “Check the time”.",
    },
    es: {
      subject: "{venue}: no se pueden registrar ventas porque la hora del servidor es incorrecta",
      text: "El servidor de {venue} tiene la hora puesta antes del 28 de octubre de 2024, así que no se puede registrar ninguna venta en Hacienda hasta que la hora sea correcta. Con internet, el servidor la corrige solo. Si no, un administrador normalmente puede ponerla en hora desde su propio móvil u ordenador en Estado del servidor (en el panel de gestión, Ajustes → Estado del servidor); si el servidor arrancó con la hora mal, cualquier empleado puede hacerlo desde una caja con «Comprobar la hora».",
    },
  },
} as const satisfies Record<string, Record<"en" | "es", { subject: string; text: string }>>;

/** By what set the clock, `unverified` (with its own subject) instead of any when the box could
 * not confirm the step took; `{step}` is `forward`, `back` or `moved` with the step's length. */
export const CLOCK_CORRECTED_EMAIL_WORDS = {
  en: {
    subject: "{venue}: the box's clock was set",
    admin: "The box's clock was set from {person}'s device: {step}, from {before} to {after}.",
    setup:
      "The box's clock was set from the device showing the setup or restore page{person}: {step}, from {before} to {after}.",
    setupPerson: ", by {name}",
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
    subject: "{venue}: se puso la hora del servidor",
    admin:
      "El reloj del servidor se puso con la hora del dispositivo de {person}: {step}, de {before} a {after}.",
    setup:
      "El reloj del servidor se puso en hora con el dispositivo que mostraba la página de configuración o restauración{person}: {step}, de {before} a {after}.",
    setupPerson: ", por {name}",
    staff:
      "El reloj del servidor se puso con la hora de {till}, confirmada por {person}, miembro del personal: {step}, de {before} a {after}.",
    unverifiedSubject: "{venue}: el servidor no pudo confirmar que puso su reloj",
    unverified:
      "El servidor intentó poner su reloj, pero no ha podido confirmar que el cambio se aplicara. Su reloj marcaba {before} antes y {after} después ({step}). Comprueba la hora del servidor en Estado del servidor (en el panel de gestión, Ajustes → Estado del servidor).",
    forward: "adelantado {duration}",
    back: "atrasado {duration}",
    moved: "cambiado {duration}",
    namedTill: "la caja {device}",
    unnamedTill: "una caja",
  },
} as const satisfies Record<"en" | "es", Record<string, string>>;

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
    one: "Poco espacio en disco: el servidor borró su copia de seguridad más antigua ({date}).",
    text: "Poco espacio en disco: el servidor borró sus {count} copias más antiguas ({date}).",
    severalDays:
      "Poco espacio en disco: el servidor borró sus {count} copias más antiguas (del {date} al {lastDate}).",
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
