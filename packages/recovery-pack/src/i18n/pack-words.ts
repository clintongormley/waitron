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
      `The key itself is on recovery pack ${number}, made on ${day}, but the box was never told that pack ${number} arrived. If you do not have pack ${number}, make a new pack with Also make a new server key ticked.`,
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
      `La clave está en el paquete de recuperación ${number}, hecho el ${day}, pero la caja nunca recibió la confirmación de que el paquete ${number} llegó. Si no tienes el paquete ${number}, haz un paquete nuevo marcando También crear una clave del servidor nueva.`,
    keyOnSheet: (keyName, day) =>
      `La clave está en la hoja de recuperación cuyo nombre de clave es ${keyName}, hecha el ${day}. Guarda esa hoja.`,
    spaceMark: "Cada \u02fd es un espacio: escribe un espacio en su lugar.",
  },
};

/** The words of the pages the server builds for each part, and of a part that failed. */
export type PartFailure = { what: string; todo: string };

type PartWords = {
  bucket: {
    title: string;
    intro: string;
    codeLabel: string;
    bucketRow: string;
    steps: string[];
  };
  archives: {
    title: string;
    introBucket: string;
    introFolder: string;
    codeLabel: string;
    keyLabel: string;
    folderRow: string;
    stepsBucket: string[];
    stepsFolder: string[];
  };
  keyRow: string;
  /** The cover's check for a part guarded by the backup key. */
  check: (keyDay: string, revision: string | undefined) => string;
  keyChangedOn: (day: string) => string;
  alsoServerKey: (page: number) => string;
  keyNotReplaced: string;
  currentKeyOnPack: (number: number, day: string) => string;
  currentKeyOnUnreceivedPack: (number: number, day: string) => string;
  currentKeyOnSheet: (keyName: string, day: string) => string;
  /** Keyed by the refusal's real code. */
  failures: Record<string, PartFailure>;
  /** `sif.allocation_invalid` with reason `history_invalid`; its other reasons take `general`. */
  historyInvalid: PartFailure;
  /** The server-key page of a box that has no server key yet; no refusal stands behind it. */
  noServerKey: PartFailure;
  /** `recovery.pack_invalid` with reason `module_unsupported`: only a wrong module composition gives it. */
  moduleFault: PartFailure;
  general: PartFailure;
};

export const PART_WORDS: Record<PackLocale, PartWords> = {
  en: {
    bucket: {
      title: "Bucket copy",
      intro:
        "The box sends a continuous copy of the venue to your bucket. A new box rebuilt from that copy asks for this restore code.",
      codeLabel: "Restore code for the bucket copy",
      bucketRow: "Bucket",
      steps: [
        "1. Install Waitron on the new box and open its setup page.",
        "2. Choose Restore from my bucket.",
        "3. Choose this PDF as the recovery pack file. Or read the code with a phone's camera and paste it.",
      ],
    },
    archives: {
      title: "Archives",
      introBucket:
        "The box also keeps dated archives in your bucket. To bring back one archive, the restore command asks for this code and the archive's name.",
      introFolder:
        "The box also keeps dated archives in a folder. To bring back one archive, setup asks for the archive file and this backup key.",
      codeLabel: "Restore code for the archives",
      keyLabel: "Backup key",
      folderRow: "Archive folder",
      stepsBucket: [
        "1. Copy this PDF onto the new box.",
        "2. Run: restore --from-archive with this PDF and --archive-key with the archive's name.",
        "3. The full command is in the Waitron install guide, under “The operator CLIs”.",
      ],
      stepsFolder: [
        "1. Install Waitron on the new box and open its setup page.",
        "2. Choose Restore from backup.",
        "3. Choose the archive file and type this backup key exactly as printed.",
      ],
    },
    keyRow: "Backup key",
    check: (keyDay, revision) =>
      revision === undefined
        ? `key of ${keyDay}`
        : `key of ${keyDay} · rev ${revision.slice(0, 8)}`,
    keyChangedOn: (day) => `changed on ${day}`,
    alsoServerKey: (page) => `It also needs the server key: page ${page}, or the pack it names.`,
    keyNotReplaced: "The server key was not replaced.",
    currentKeyOnPack: (number, day) =>
      `The current key, on recovery pack ${number} made on ${day}, still works.`,
    currentKeyOnUnreceivedPack: (number, day) =>
      `The current server key is on recovery pack ${number}, made on ${day}, but the box was never told that pack ${number} arrived. If you do not have pack ${number}, make a new pack with Also make a new server key ticked.`,
    currentKeyOnSheet: (keyName, day) =>
      `The current key, on the recovery sheet whose key name is ${keyName}, made on ${day}, still works.`,
    failures: {
      "backup.archive_settings_unreadable": {
        what: "The box could not read its saved archive settings.",
        todo: "Open Backups, check the archive settings and save them again, then make a new pack.",
      },
      "backup.recovery_key_missing": {
        what: "The box has no backup key.",
        todo: "Use Backups → Change the recovery key, then make a new pack.",
      },
      "backup.recovery_key_too_short": {
        what: "The box's backup key is too short to use.",
        todo: "Use Backups → Change the recovery key: the new key replaces the short one. Then make a new pack.",
      },
      "backup.stream_signer_missing": {
        what: "The box could not find the key that signs its bucket copy.",
        todo: "Check Backups and make a new pack.",
      },
    },
    historyInvalid: {
      what: "The box's record of its invoice series disagrees with what setup recorded.",
      todo: "Keep the pack or sheet that holds the current server key; the next pack tries this page again.",
    },
    noServerKey: {
      what: "This box has no server key yet.",
      todo: "There is nothing to keep for this part until the box has one.",
    },
    moduleFault: {
      what: "This page could not be made. That is a fault in Waitron.",
      todo: "A new pack will fail here the same way. The other pages of this pack are still good.",
    },
    general: {
      what: "This part could not be read when this pack was made.",
      todo: "Check Backups and make a new pack.",
    },
  },
  es: {
    bucket: {
      title: "Copia en el bucket",
      intro:
        "La caja envía una copia continua del local a tu bucket. Una caja nueva reconstruida desde esa copia pide este código de restauración.",
      codeLabel: "Código de restauración de la copia en el bucket",
      bucketRow: "Bucket",
      steps: [
        "1. Instala Waitron en la caja nueva y abre su página de instalación.",
        "2. Elige Restaurar desde mi bucket.",
        "3. Elige este PDF como archivo del paquete de recuperación. O lee el código con la cámara de un móvil y pégalo.",
      ],
    },
    archives: {
      title: "Archivos",
      introBucket:
        "La caja también guarda archivos fechados en tu bucket. Para recuperar un archivo, la orden de restauración pide este código y el nombre del archivo.",
      introFolder:
        "La caja también guarda archivos fechados en una carpeta. Para recuperar un archivo, la instalación pide el archivo y esta clave de copia.",
      codeLabel: "Código de restauración de los archivos",
      keyLabel: "Clave de copia",
      folderRow: "Carpeta de archivos",
      stepsBucket: [
        "1. Copia este PDF en la caja nueva.",
        "2. Ejecuta: restore --from-archive con este PDF y --archive-key con el nombre del archivo.",
        "3. La orden completa está en la guía de instalación de Waitron, en «The operator CLIs».",
      ],
      stepsFolder: [
        "1. Instala Waitron en la caja nueva y abre su página de instalación.",
        "2. Elige Restaurar desde una copia de seguridad.",
        "3. Elige el archivo y escribe esta clave de copia tal como está impresa.",
      ],
    },
    keyRow: "Clave de copia",
    check: (keyDay, revision) =>
      revision === undefined
        ? `clave del ${keyDay}`
        : `clave del ${keyDay} · rev ${revision.slice(0, 8)}`,
    keyChangedOn: (day) => `cambiada el ${day}`,
    alsoServerKey: (page) =>
      `También necesita la clave del servidor: página ${page}, o el paquete que esta indica.`,
    keyNotReplaced: "La clave del servidor no se ha sustituido.",
    currentKeyOnPack: (number, day) =>
      `La clave actual, en el paquete de recuperación ${number} hecho el ${day}, sigue sirviendo.`,
    currentKeyOnUnreceivedPack: (number, day) =>
      `La clave del servidor actual está en el paquete de recuperación ${number}, hecho el ${day}, pero la caja nunca recibió la confirmación de que el paquete ${number} llegó. Si no tienes el paquete ${number}, haz un paquete nuevo marcando También crear una clave del servidor nueva.`,
    currentKeyOnSheet: (keyName, day) =>
      `La clave actual, en la hoja de recuperación cuyo nombre de clave es ${keyName}, hecha el ${day}, sigue sirviendo.`,
    failures: {
      "backup.archive_settings_unreadable": {
        what: "La caja no pudo leer los ajustes de archivo guardados.",
        todo: "Abre Copias de seguridad, revisa los ajustes de archivo y vuelve a guardarlos; después haz un paquete nuevo.",
      },
      "backup.recovery_key_missing": {
        what: "La caja no tiene clave de copia.",
        todo: "Usa Copias de seguridad → Cambiar la clave de recuperación y después haz un paquete nuevo.",
      },
      "backup.recovery_key_too_short": {
        what: "La clave de copia de la caja es demasiado corta para usarla.",
        todo: "Usa Copias de seguridad → Cambiar la clave de recuperación: la clave nueva sustituye a la corta. Después haz un paquete nuevo.",
      },
      "backup.stream_signer_missing": {
        what: "La caja no encontró la clave que firma su copia en el bucket.",
        todo: "Revisa Copias de seguridad y haz un paquete nuevo.",
      },
    },
    historyInvalid: {
      what: "El registro de la caja de sus series de facturas no coincide con lo que registró la instalación.",
      todo: "Guarda el paquete o la hoja que tiene la clave del servidor actual; el próximo paquete volverá a intentar esta página.",
    },
    noServerKey: {
      what: "Esta caja aún no tiene clave del servidor.",
      todo: "No hay nada que guardar de esta parte hasta que la caja tenga una.",
    },
    moduleFault: {
      what: "Esta página no se pudo hacer. Es un fallo de Waitron.",
      todo: "Un paquete nuevo fallará aquí de la misma forma. Las demás páginas de este paquete siguen sirviendo.",
    },
    general: {
      what: "Esta parte no se pudo leer cuando se hizo este paquete.",
      todo: "Revisa Copias de seguridad y haz un paquete nuevo.",
    },
  },
};
