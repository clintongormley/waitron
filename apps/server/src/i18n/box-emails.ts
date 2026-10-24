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
