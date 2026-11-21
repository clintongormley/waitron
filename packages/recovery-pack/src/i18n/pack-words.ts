export type PackLocale = "en" | "es";
export type PartKind = "bucket" | "archives" | "server-key" | "emergency";

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
  couldNotBeDrawn: string;
  lockedAway: string;
  /** For a pack holding a restore code or the backup encryption key, and not the server key. */
  anyoneHoldingBackups: string;
  /** For a pack holding a restore code or the backup encryption key, and the server key. */
  anyoneHoldingBackupsAndServerKey: string;
  /** For a pack holding the server key and no restore code or backup encryption key. */
  anyoneHoldingServerKey: string;
  emergencyWarning: string;
  whichToKeep: string;
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
    emergencyWarning:
      "The emergency code starts a locked copy in the cloud. You also need your password and your authenticator or a recovery code. Passkeys do not work there.",
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
    couldNotBeDrawn: "Could not be drawn",
    lockedAway: "Keep this pack locked away, and off the box.",
    anyoneHoldingBackups:
      "Anyone holding it can open the backups its restore codes or backup encryption key unlock.",
    anyoneHoldingBackupsAndServerKey:
      "Anyone holding it can open the backups its restore codes or backup encryption key unlock, and, with its server key and a matching backup, recover the server.",
    anyoneHoldingServerKey: "Anyone holding it and its matching backup can recover the server.",
    whichToKeep:
      "When you make a new pack, the dashboard's Backups screen says which older packs to keep and until when.",
    serverKeyPage: (page) =>
      `Always keep the pack that holds the server key (page ${page} says which).`,
    part: {
      bucket: "Bucket copy",
      archives: "Archives",
      "server-key": "Server key",
      emergency: "Emergency start",
    },
    situation: {
      emergency: "The box has died and you need to start the venue in the cloud.",
      bucket: "You are setting up a new box and want the venue back from your bucket copy.",
      archives: "You need one old archive back (for example a month-end copy).",
      "server-key": "You are recovering the server's own key with a backup.",
    },
    notSetUp: {
      emergency: "Cloud cannot start this venue yet.",
      bucket: "This box has no bucket copy.",
      archives: "This box makes no archives.",
      "server-key": "This box has no server key yet.",
    },
    absent: {
      emergency: "Emergency start is not available for this pack.",
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
      `The key itself is on recovery pack ${number}, made on ${day}, but when this pack was made the box had not been told that pack ${number} arrived. If you do not have pack ${number}, make a new pack with Also make a new server key ticked.`,
    keyOnSheet: (keyName, day) =>
      `The key itself is on the recovery sheet whose key name is ${keyName}, made on ${day}. Keep that sheet.`,
    spaceMark: "Each \u02fd is a space: type one space for it.",
  },
  es: {
    title: "Paquete de recuperación de Waitron",
    emergencyWarning:
      "El código de emergencia inicia una copia bloqueada en la nube. También necesitas tu contraseña y tu autenticador o un código de recuperación. Las llaves de acceso no funcionan allí.",
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
    couldNotBeDrawn: "No se pudo generar",
    lockedAway: "Guarda este paquete bajo llave, y fuera del servidor.",
    anyoneHoldingBackups:
      "Quien lo tenga puede abrir las copias de seguridad que desbloquean sus códigos de restauración o su clave de cifrado de copias.",
    anyoneHoldingBackupsAndServerKey:
      "Quien lo tenga puede abrir las copias de seguridad que desbloquean sus códigos de restauración o su clave de cifrado de copias y, con su clave del servidor y la copia correspondiente, recuperar el servidor.",
    anyoneHoldingServerKey:
      "Quien lo tenga, junto con su copia correspondiente, puede recuperar el servidor.",
    whichToKeep:
      "Cuando hagas un paquete nuevo, la pantalla Copias de seguridad del panel te dice qué paquetes anteriores guardar y hasta cuándo.",
    serverKeyPage: (page) =>
      `Guarda siempre el paquete que tiene la clave del servidor (la página ${page} dice cuál).`,
    part: {
      emergency: "Inicio de emergencia",
      bucket: "Copia en el bucket",
      archives: "Archivos",
      "server-key": "Clave del servidor",
    },
    situation: {
      emergency: "El servidor ha fallado y necesitas iniciar el local en la nube.",
      bucket:
        "Estás instalando un servidor nuevo y quieres recuperar el local desde tu copia en el bucket.",
      archives: "Necesitas recuperar un archivo antiguo (por ejemplo, una copia de fin de mes).",
      "server-key": "Estás recuperando la clave propia del servidor junto con una copia.",
    },
    notSetUp: {
      emergency: "Cloud aún no puede iniciar este local.",
      bucket: "Este servidor no tiene copia en el bucket.",
      archives: "Este servidor no hace archivos.",
      "server-key": "Este servidor aún no tiene clave del servidor.",
    },
    absent: {
      emergency: "El inicio de emergencia no está disponible en este paquete.",
      bucket: "Este servidor no tiene copia en el bucket.",
      archives: "Este servidor no hace archivos.",
      "server-key": "Este local no presenta facturas a la Agencia Tributaria.",
    },
    failedTitle: (part) => `${part}: no se pudo generar`,
    thisPackHoldsKey: "Este paquete tiene la clave del servidor.",
    noNewKey: "Este paquete no creó una clave del servidor nueva.",
    keyOnPack: (number, day) =>
      `La clave está en el paquete de recuperación ${number}, hecho el ${day}. Guarda ese paquete.`,
    keyOnUnreceivedPack: (number, day) =>
      `La clave está en el paquete de recuperación ${number}, hecho el ${day}, pero cuando se hizo este paquete el servidor no había recibido la confirmación de que el paquete ${number} había llegado. Si no tienes el paquete ${number}, haz un paquete nuevo marcando También crear una clave del servidor nueva.`,
    keyOnSheet: (keyName, day) =>
      `La clave está en la hoja de recuperación cuyo nombre de clave es ${keyName}, hecha el ${day}. Guarda esa hoja.`,
    spaceMark: "Cada \u02fd es un espacio: escribe un espacio en su lugar.",
  },
};

/** The words of the pages the server builds for each part, and of a part that failed. */
export type PartFailure = { what: string; todo: string };

type PartWords = {
  emergency: {
    title: string;
    intro: string;
    address: string;
    code: string;
    issued: string;
    ready: string;
    notEnrolled: string;
    nobody: string;
    steps: string[];
    absent: Record<
      | "not_connected"
      | "not_primary"
      | "permission"
      | "setting_off"
      | "level_inactive"
      | "no_payment_method"
      | "not_provisioned",
      string
    >;
    failed: PartFailure;
  };
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
  /** The cover's check for a part guarded by the backup encryption key. */
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
  /** `recovery.pack_invalid` with reason `module_unsupported`: only a wrong module composition gives it. */
  moduleFault: PartFailure;
  general: PartFailure;
};

export const PART_WORDS: Record<PackLocale, PartWords> = {
  en: {
    emergency: {
      title: "Emergency start in the cloud",
      intro:
        "This code starts a locked copy of the venue. Sign in with your password and your authenticator or a recovery code. Passkeys do not work there.",
      address: "Emergency address",
      code: "Emergency code",
      issued: "Code issued",
      ready: "Have permission and an authenticator",
      notEnrolled: "Need to set up an authenticator first",
      nobody: "Nobody",
      steps: [
        "1. Unplug the old box so it cannot start again.",
        "2. Open the emergency address and enter this code.",
        "3. Sign in with your password and your authenticator or recovery code when asked.",
        "4. Review any missing minutes and confirm that the old box is stopped.",
        "5. Follow the page to join the tills to the cloud copy.",
      ],
      absent: {
        not_connected:
          "This box is not connected to Cloud. Connect it from Cloud services, then make a new pack.",
        not_primary: "This box is not the main box. Make the pack on the main box.",
        permission:
          "The maker cannot start the venue in the cloud; the code is left out. An administrator can make a pack with the code.",
        setting_off: "Emergency start is off. Enable it in Cloud, then make a new pack.",
        level_inactive:
          "The Cloud level for emergency start is inactive. Check it in Cloud, then make a new pack.",
        no_payment_method:
          "Cloud has no payment method for emergency start. Add one in Cloud, then make a new pack.",
        not_provisioned:
          "Cloud cannot start this venue yet. Make a new pack when emergency start is available.",
      },
      failed: {
        what: "The emergency code could not be read from Cloud.",
        todo: "Make a new pack when Cloud answers; if you just requested a code, try again in a minute.",
      },
    },

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
        "The box also keeps dated archives in a folder. To bring back one archive, setup asks for the archive file and this backup encryption key.",
      codeLabel: "Restore code for the archives",
      keyLabel: "Backup encryption key",
      folderRow: "Archive folder",
      stepsBucket: [
        "1. Copy this PDF onto the new box.",
        "2. Run: restore --from-archive with this PDF and --archive-key with the archive's name.",
        "3. The full command is in the Waitron install guide, under “The operator CLIs”.",
      ],
      stepsFolder: [
        "1. Install Waitron on the new box and open its setup page.",
        "2. Choose Restore from backup.",
        "3. Choose the archive file and type this backup encryption key exactly as printed.",
      ],
    },
    keyRow: "Backup encryption key",
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
      `The current server key is on recovery pack ${number}, made on ${day}, but when this pack was made the box had not been told that pack ${number} arrived. If you do not have pack ${number}, make a new pack with Also make a new server key ticked.`,
    currentKeyOnSheet: (keyName, day) =>
      `The current key, on the recovery sheet whose key name is ${keyName}, made on ${day}, still works.`,
    failures: {
      "backup.archive_settings_unreadable": {
        what: "The box could not read its saved archive settings.",
        todo: "Use Backups → Change destination or schedule, choose the destinations again and press Save changes. If backups are off, use Turn on backups instead. Then make a new pack.",
      },
      "backup.recovery_key_missing": {
        what: "The box has no backup encryption key.",
        todo: "Use Backups → Change the backup encryption key, then make a new pack.",
      },
      "backup.recovery_key_too_short": {
        what: "The backup encryption key is too short to use.",
        todo: "Use Backups → Change the backup encryption key: the new key replaces the short one. Then make a new pack.",
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
    emergency: {
      title: "Inicio de emergencia en la nube",
      intro:
        "Este código inicia una copia bloqueada del local. Entra con tu contraseña y tu autenticador o un código de recuperación. Las llaves de acceso no funcionan allí.",
      address: "Dirección de emergencia",
      code: "Código de emergencia",
      issued: "Código emitido",
      ready: "Tienen permiso y autenticador",
      notEnrolled: "Necesitan configurar un autenticador primero",
      nobody: "Nadie",
      steps: [
        "1. Desenchufa el servidor antiguo para que no pueda volver a arrancar.",
        "2. Abre la dirección de emergencia e introduce este código.",
        "3. Entra con tu contraseña y tu autenticador o código de recuperación cuando se solicite.",
        "4. Revisa los minutos que falten y confirma que el servidor antiguo está parado.",
        "5. Sigue la página para conectar las cajas a la copia en la nube.",
      ],
      absent: {
        not_connected:
          "Este servidor no está conectado a Cloud. Conéctalo desde Servicios en la nube y haz un paquete nuevo.",
        not_primary: "Este no es el servidor principal. Haz el paquete en el servidor principal.",
        permission:
          "Quien hizo el paquete no puede iniciar el local en la nube; se omite el código. Un administrador puede hacer un paquete con el código.",
        setting_off:
          "El inicio de emergencia está desactivado. Actívalo en Cloud y haz un paquete nuevo.",
        level_inactive:
          "El nivel de Cloud para el inicio de emergencia está inactivo. Revísalo en Cloud y haz un paquete nuevo.",
        no_payment_method:
          "Cloud no tiene un método de pago para el inicio de emergencia. Añade uno en Cloud y haz un paquete nuevo.",
        not_provisioned:
          "Cloud aún no puede iniciar este local. Haz un paquete nuevo cuando el inicio de emergencia esté disponible.",
      },
      failed: {
        what: "No se pudo leer el código de emergencia de Cloud.",
        todo: "Haz un paquete nuevo cuando Cloud responda; si acabas de pedir un código, vuelve a intentarlo en un minuto.",
      },
    },
    bucket: {
      title: "Copia en el bucket",
      intro:
        "El servidor envía una copia continua del local a tu bucket. Un servidor nuevo reconstruido desde esa copia pide este código de restauración.",
      codeLabel: "Código de restauración de la copia en el bucket",
      bucketRow: "Bucket",
      steps: [
        "1. Instala Waitron en el servidor nuevo y abre su página de instalación.",
        "2. Elige Restaurar desde mi bucket.",
        "3. Elige este PDF como archivo del paquete de recuperación. O lee el código con la cámara de un móvil y pégalo.",
      ],
    },
    archives: {
      title: "Archivos",
      introBucket:
        "El servidor también guarda archivos fechados en tu bucket. Para recuperar un archivo, la orden de restauración pide este código y el nombre del archivo.",
      introFolder:
        "El servidor también guarda archivos fechados en una carpeta. Para recuperar un archivo, la instalación pide el archivo y esta clave de cifrado de copias.",
      codeLabel: "Código de restauración de los archivos",
      keyLabel: "Clave de cifrado de copias",
      folderRow: "Carpeta de archivos",
      stepsBucket: [
        "1. Copia este PDF en el servidor nuevo.",
        "2. Ejecuta: restore --from-archive con este PDF y --archive-key con el nombre del archivo.",
        "3. La orden completa está en la guía de instalación de Waitron, en «The operator CLIs».",
      ],
      stepsFolder: [
        "1. Instala Waitron en el servidor nuevo y abre su página de instalación.",
        "2. Elige Restaurar desde una copia de seguridad.",
        "3. Elige el archivo y escribe esta clave de cifrado de copias tal como está impresa.",
      ],
    },
    keyRow: "Clave de cifrado de copias",
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
      `La clave del servidor actual está en el paquete de recuperación ${number}, hecho el ${day}, pero cuando se hizo este paquete el servidor no había recibido la confirmación de que el paquete ${number} había llegado. Si no tienes el paquete ${number}, haz un paquete nuevo marcando También crear una clave del servidor nueva.`,
    currentKeyOnSheet: (keyName, day) =>
      `La clave actual, en la hoja de recuperación cuyo nombre de clave es ${keyName}, hecha el ${day}, sigue sirviendo.`,
    failures: {
      "backup.archive_settings_unreadable": {
        what: "El servidor no pudo leer los ajustes de archivo guardados.",
        todo: "Usa Copias de seguridad → Cambiar el destino o la programación, elige de nuevo los destinos y pulsa Guardar cambios. Si las copias están desactivadas, usa Activar las copias. Después haz un paquete nuevo.",
      },
      "backup.recovery_key_missing": {
        what: "El servidor no tiene clave de cifrado de copias.",
        todo: "Usa Copias de seguridad → Cambiar la clave de cifrado de copias y después haz un paquete nuevo.",
      },
      "backup.recovery_key_too_short": {
        what: "La clave de cifrado de copias es demasiado corta para usarla.",
        todo: "Usa Copias de seguridad → Cambiar la clave de cifrado de copias: la clave nueva sustituye a la corta. Después haz un paquete nuevo.",
      },
      "backup.stream_signer_missing": {
        what: "El servidor no encontró la clave que firma su copia en el bucket.",
        todo: "Revisa Copias de seguridad y haz un paquete nuevo.",
      },
    },
    historyInvalid: {
      what: "El registro del servidor de sus series de facturas no coincide con lo que registró la instalación.",
      todo: "Guarda el paquete o la hoja que tiene la clave del servidor actual; el próximo paquete volverá a intentar esta página.",
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
