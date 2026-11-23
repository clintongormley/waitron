export type PackLocale = "en" | "es";
export type PartKind = "bucket" | "archives" | "server-key" | "emergency";

type Words = {
  title: string;
  heading: (venue: string) => string;
  masterKeyLabel: (keyName: string) => string;
  masterKeyQr: string;
  masterKeyInPack: (keyName: string, number: number) => string;
  /** On a pack that does not hold the master key, when no pack of this box is known to. */
  masterKeyNamed: (keyName: string) => string;
  header: (venue: string, number: number, day: string) => string;
  page: (n: number, of: number) => string;
  part: Record<PartKind, string>;
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
    heading: (venue) => `Waitron recovery pack · ${venue}`,
    masterKeyLabel: (keyName) => `Master key · ${keyName}`,
    masterKeyQr: "Master key",
    masterKeyInPack: (keyName, number) => `Master key ${keyName}: in pack ${number}`,
    masterKeyNamed: (keyName) => `Master key ${keyName}`,
    header: (venue, number, day) => `${venue} · Recovery pack ${number} · ${day}`,
    page: (n, of) => `Page ${n} of ${of}`,
    part: {
      bucket: "Bucket copy",
      archives: "Archives",
      "server-key": "Box key",
      emergency: "Emergency start",
    },
    failedTitle: (part) => `${part}: could not be drawn`,
    thisPackHoldsKey: "This pack holds the box key.",
    noNewKey: "This pack did not make a new box key.",
    keyOnPack: (number, day) =>
      `The key itself is on recovery pack ${number}, made on ${day}. Keep that pack.`,
    keyOnUnreceivedPack: (number, day) =>
      `The key itself is on recovery pack ${number}, made on ${day}, but when this pack was made the box had not been told that pack ${number} arrived. If you do not have pack ${number}, make a new pack with Also make a new box key ticked.`,
    keyOnSheet: (keyName, day) =>
      `The key itself is on the recovery sheet whose key name is ${keyName}, made on ${day}. Keep that sheet.`,
    spaceMark: "Each \u02fd is a space: type one space for it.",
  },
  es: {
    title: "Paquete de recuperación de Waitron",
    heading: (venue) => `Paquete de recuperación de Waitron · ${venue}`,
    masterKeyLabel: (keyName) => `Clave maestra · ${keyName}`,
    masterKeyQr: "Clave maestra",
    masterKeyInPack: (keyName, number) => `Clave maestra ${keyName}: en el paquete ${number}`,
    masterKeyNamed: (keyName) => `Clave maestra ${keyName}`,
    header: (venue, number, day) => `${venue} · Paquete de recuperación ${number} · ${day}`,
    page: (n, of) => `Página ${n} de ${of}`,
    part: {
      emergency: "Inicio de emergencia",
      bucket: "Copia en el bucket",
      archives: "Archivos",
      "server-key": "Clave del servidor",
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
    alsoServerKey: (page) => `It also needs the box key: page ${page}, or the pack it names.`,
    keyNotReplaced: "The box key was not replaced.",
    currentKeyOnPack: (number, day) =>
      `The current key, on recovery pack ${number} made on ${day}, still works.`,
    currentKeyOnUnreceivedPack: (number, day) =>
      `The current box key is on recovery pack ${number}, made on ${day}, but when this pack was made the box had not been told that pack ${number} arrived. If you do not have pack ${number}, make a new pack with Also make a new box key ticked.`,
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
      todo: "Keep the pack or sheet that holds the current box key; the next pack tries this page again.",
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
