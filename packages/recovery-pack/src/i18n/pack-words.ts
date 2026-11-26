export type PackLocale = "en" | "es";
export type PartKind = "bucket" | "archives" | "emergency";

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
      emergency: "Emergency start",
    },
    failedTitle: (part) => `${part}: could not be drawn`,
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
    },
    failedTitle: (part) => `${part}: no se pudo generar`,
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
  keyChangedOn: (day: string) => string;
  /** Keyed by the refusal's real code. */
  failures: Record<string, PartFailure>;
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
    keyChangedOn: (day) => `changed on ${day}`,
    failures: {
      "backup.archive_settings_unreadable": {
        what: "The box could not read its saved archive settings.",
        todo: "Use Backups → Change destination or schedule, choose the destinations again and press Save changes. If backups are off, use Turn on backups instead. Then make a new pack.",
      },
      "backup.recovery_key_missing": {
        what: "The box has no backup key.",
        todo: "Use Backups → Recovery pack → Change the backup key, then make a new pack.",
      },
      "backup.recovery_key_too_short": {
        what: "The backup key is too short to use.",
        todo: "Use Backups → Recovery pack → Change the backup key: the new key replaces the short one. Then make a new pack.",
      },
      "backup.stream_signer_missing": {
        what: "The box could not find the key that signs its bucket copy.",
        todo: "Check Backups and make a new pack.",
      },
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
    keyChangedOn: (day) => `cambiada el ${day}`,
    failures: {
      "backup.archive_settings_unreadable": {
        what: "El servidor no pudo leer los ajustes de archivo guardados.",
        todo: "Usa Copias de seguridad → Cambiar el destino o la programación, elige de nuevo los destinos y pulsa Guardar cambios. Si las copias están desactivadas, usa Activar las copias. Después haz un paquete nuevo.",
      },
      "backup.recovery_key_missing": {
        what: "El servidor no tiene clave de las copias.",
        todo: "Usa Copias de seguridad → Paquete de recuperación → Cambiar la clave de las copias y después haz un paquete nuevo.",
      },
      "backup.recovery_key_too_short": {
        what: "La clave de las copias es demasiado corta para usarla.",
        todo: "Usa Copias de seguridad → Paquete de recuperación → Cambiar la clave de las copias: la clave nueva sustituye a la corta. Después haz un paquete nuevo.",
      },
      "backup.stream_signer_missing": {
        what: "El servidor no encontró la clave que firma su copia en el bucket.",
        todo: "Revisa Copias de seguridad y haz un paquete nuevo.",
      },
    },
    general: {
      what: "Esta parte no se pudo leer cuando se hizo este paquete.",
      todo: "Revisa Copias de seguridad y haz un paquete nuevo.",
    },
  },
};
