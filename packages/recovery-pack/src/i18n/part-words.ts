import type { PackLocale } from "./pack-words.js";

type Failure = { what: string; todo: string };

type Words = {
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
  /** The cover's check for a part guarded by the backup key: the Backups card prints the same. */
  check: (keyDay: string, revision: string | undefined) => string;
  keyChangedOn: (day: string) => string;
  alsoServerKey: (page: number) => string;
  keyNotReplaced: string;
  currentKeyOnPack: (number: number, day: string) => string;
  currentKeyOnUnreceivedPack: (number: number, day: string) => string;
  currentKeyOnSheet: (keyName: string, day: string) => string;
  failures: Record<string, Failure>;
  historyInvalid: string;
  general: Failure;
};

export const PART_WORDS: Record<PackLocale, Words> = {
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
      `The current server key is on recovery pack ${number}, made on ${day}, which never reached a browser. If you do not have pack ${number}, make a new pack with Also make a new server key ticked.`,
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
      "sif.allocation_invalid": {
        what: "",
        todo: "Keep the pack or sheet that holds the current server key; the next pack tries this page again.",
      },
      "server_key.missing": {
        what: "This box has no server key yet.",
        todo: "There is nothing to keep for this part until the box has one.",
      },
    },
    historyInvalid: "The box's record of its invoice series disagrees with what setup recorded.",
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
      `La clave del servidor actual está en el paquete de recuperación ${number}, hecho el ${day}, que nunca llegó a un navegador. Si no tienes el paquete ${number}, haz un paquete nuevo marcando También crear una clave del servidor nueva.`,
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
      "sif.allocation_invalid": {
        what: "",
        todo: "Guarda el paquete o la hoja que tiene la clave del servidor actual; el próximo paquete volverá a intentar esta página.",
      },
      "server_key.missing": {
        what: "Esta caja aún no tiene clave del servidor.",
        todo: "No hay nada que guardar de esta parte hasta que la caja tenga una.",
      },
    },
    historyInvalid:
      "El registro de la caja de sus series de facturas no coincide con lo que registró la instalación.",
    general: {
      what: "Esta parte no se pudo leer cuando se hizo este paquete.",
      todo: "Revisa Copias de seguridad y haz un paquete nuevo.",
    },
  },
};

/** What failed and what to do, keyed by the refusal's real code; no parameter value is printed. */
export function partFailure(
  locale: PackLocale,
  code: string,
  params: Readonly<Record<string, unknown>>,
): Failure {
  const words = PART_WORDS[locale];
  if (code === "sif.allocation_invalid") {
    if (params.reason !== "history_invalid") return words.general;
    return { what: words.historyInvalid, todo: words.failures[code]!.todo };
  }
  return Object.hasOwn(words.failures, code) ? words.failures[code]! : words.general;
}
