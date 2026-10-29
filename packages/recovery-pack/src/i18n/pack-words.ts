export type PackLocale = "en" | "es";
export type PartKind = "bucket" | "archives" | "server-key";

type Words = {
  title: string;
  header: (venue: string, number: number, day: string) => string;
  page: (n: number, of: number) => string;
  madeBy: (day: string, time: string, person: string) => string;
  madeDuringSetup: (day: string, time: string) => string;
  whichPage: string;
  whatHappened: string;
  pageColumn: string;
  whatIsIn: string;
  partColumn: string;
  lastChangedColumn: string;
  checkColumn: string;
  sameChecks: string;
  couldNotBeDrawn: string;
  lockedAway: string;
  anyoneHolding: string;
  serverKeyPage: (page: number) => string;
  part: Record<PartKind, string>;
  situation: Record<PartKind, string>;
  notSetUp: Record<PartKind, string>;
  absent: Record<PartKind, string>;
  failedTitle: (part: string) => string;
  thisPackHoldsKey: string;
  noNewKey: string;
  keyOnPack: (number: number, day: string) => string;
  keyOnUnreceivedPack: (number: number, day: string) => string;
  keyOnSheet: (keyName: string, day: string) => string;
  spaceMark: string;
};

export const PACK_WORDS: Record<PackLocale, Words> = {
  en: {
    title: "Waitron recovery pack",
    header: (venue, number, day) => `${venue} · Recovery pack ${number} · ${day}`,
    page: (n, of) => `Page ${n} of ${of}`,
    madeBy: (day, time, person) => `Made on ${day} at ${time} by ${person}.`,
    madeDuringSetup: (day, time) => `Made during setup on ${day} at ${time}.`,
    whichPage: "Which page do I need?",
    whatHappened: "What has happened",
    pageColumn: "Page",
    whatIsIn: "What is in this pack",
    partColumn: "Part",
    lastChangedColumn: "Last changed",
    checkColumn: "Check",
    sameChecks:
      "The dashboard's Backups screen shows the same checks. If one differs, this pack is out of date: make a new one.",
    couldNotBeDrawn: "Could not be drawn",
    lockedAway: "Keep this pack locked away, and off the box.",
    anyoneHolding:
      "Anyone holding it can open every backup of this venue and start the venue somewhere else. When you make a new pack, the dashboard's Backups screen says which older packs to keep and until when.",
    serverKeyPage: (page) =>
      `Always keep the pack that holds the server key (page ${page} says which).`,
    part: { bucket: "Bucket copy", archives: "Archives", "server-key": "Server key" },
    situation: {
      bucket: "You are setting up a new box and want the venue back from your bucket copy.",
      archives: "You need one old archive back (for example a month-end copy).",
      "server-key": "You are recovering the server's own key with a backup.",
    },
    notSetUp: {
      bucket: "This box has no bucket copy.",
      archives: "This box makes no archives.",
      "server-key": "This box has no server key yet.",
    },
    absent: {
      bucket: "This box has no bucket copy.",
      archives: "This box makes no archives.",
      "server-key": "This venue files no invoices with the tax agency.",
    },
    failedTitle: (part) => `${part}: could not be drawn`,
    thisPackHoldsKey: "This pack holds the server key.",
    noNewKey: "This pack did not make a new server key.",
    keyOnPack: (number, day) =>
      `The key itself is on recovery pack ${number}, made on ${day}. Keep that pack.`,
    keyOnUnreceivedPack: (number, day) =>
      `The key itself is on recovery pack ${number}, made on ${day}, which never reached a browser. If you do not have pack ${number}, make a new pack with Also make a new server key ticked.`,
    keyOnSheet: (keyName, day) =>
      `The key itself is on the recovery sheet whose key name is ${keyName}, made on ${day}. Keep that sheet.`,
    spaceMark: "Each \u02fd is a space: type one space for it.",
  },
  es: {
    title: "Paquete de recuperación de Waitron",
    header: (venue, number, day) => `${venue} · Paquete de recuperación ${number} · ${day}`,
    page: (n, of) => `Página ${n} de ${of}`,
    madeBy: (day, time, person) => `Hecho el ${day} a las ${time} por ${person}.`,
    madeDuringSetup: (day, time) => `Hecho durante la instalación el ${day} a las ${time}.`,
    whichPage: "¿Qué página necesito?",
    whatHappened: "Qué ha pasado",
    pageColumn: "Página",
    whatIsIn: "Qué contiene este paquete",
    partColumn: "Parte",
    lastChangedColumn: "Último cambio",
    checkColumn: "Comprobación",
    sameChecks:
      "La pantalla Copias de seguridad del panel muestra las mismas comprobaciones. Si alguna no coincide, este paquete está desfasado: haz uno nuevo.",
    couldNotBeDrawn: "No se pudo generar",
    lockedAway: "Guarda este paquete bajo llave, y fuera de la caja.",
    anyoneHolding:
      "Quien lo tenga puede abrir todas las copias de seguridad de este local y poner el local en marcha en otro sitio. Cuando hagas un paquete nuevo, la pantalla Copias de seguridad del panel te dice qué paquetes anteriores guardar y hasta cuándo.",
    serverKeyPage: (page) =>
      `Guarda siempre el paquete que tiene la clave del servidor (la página ${page} dice cuál).`,
    part: {
      bucket: "Copia en el bucket",
      archives: "Archivos",
      "server-key": "Clave del servidor",
    },
    situation: {
      bucket:
        "Estás instalando una caja nueva y quieres recuperar el local desde tu copia en el bucket.",
      archives: "Necesitas recuperar un archivo antiguo (por ejemplo, una copia de fin de mes).",
      "server-key": "Estás recuperando la clave propia del servidor junto con una copia.",
    },
    notSetUp: {
      bucket: "Esta caja no tiene copia en el bucket.",
      archives: "Esta caja no hace archivos.",
      "server-key": "Esta caja aún no tiene clave del servidor.",
    },
    absent: {
      bucket: "Esta caja no tiene copia en el bucket.",
      archives: "Esta caja no hace archivos.",
      "server-key": "Este local no presenta facturas a la Agencia Tributaria.",
    },
    failedTitle: (part) => `${part}: no se pudo generar`,
    thisPackHoldsKey: "Este paquete tiene la clave del servidor.",
    noNewKey: "Este paquete no creó una clave del servidor nueva.",
    keyOnPack: (number, day) =>
      `La clave está en el paquete de recuperación ${number}, hecho el ${day}. Guarda ese paquete.`,
    keyOnUnreceivedPack: (number, day) =>
      `La clave está en el paquete de recuperación ${number}, hecho el ${day}, que nunca llegó a un navegador. Si no tienes el paquete ${number}, haz un paquete nuevo marcando También crear una clave del servidor nueva.`,
    keyOnSheet: (keyName, day) =>
      `La clave está en la hoja de recuperación cuyo nombre de clave es ${keyName}, hecha el ${day}. Guarda esa hoja.`,
    spaceMark: "Cada \u02fd es un espacio: escribe un espacio en su lugar.",
  },
};
