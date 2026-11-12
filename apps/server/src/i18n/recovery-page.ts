import type { ErrorCode, SupportedLocale } from "@waitron/shared";
import type { VenueHolderKind } from "@waitron/db";

/** Keyed by locale, so an entry with no Spanish fails the typecheck. */
export type OperatorText = Readonly<
  Record<
    SupportedLocale,
    {
      /** What is wrong, in the operator's terms. */
      title: string;
      /** What they should do about it. */
      action: string;
    }
  >
>;

/** Each kind's name on the page. `script` and an unknown holder share the last row. */
const HOLDER_NAMES: Readonly<Record<VenueHolderKind, Readonly<Record<SupportedLocale, string>>>> = {
  server: { "en-GB": "the Waitron server", "es-ES": "el servidor de Waitron" },
  restore: {
    "en-GB": "a restore from a backup",
    "es-ES": "una restauración desde una copia de seguridad",
  },
  rejoin: {
    "en-GB": "a rejoin of this box to its venue",
    "es-ES": "la reincorporación de este equipo a su local",
  },
  provisioning: {
    "en-GB": "the Waitron setup command",
    "es-ES": "el comando de configuración de Waitron",
  },
  script: { "en-GB": "another Waitron program", "es-ES": "otro programa de Waitron" },
};

/**
 * The page's own fixed wording. `code` and `at` come from outside and are shown as recorded, the
 * trigger `names` through `redactSecrets`; `level` is shown by its internal name. Each line is
 * escaped whole where it is rendered.
 */
export const RECOVERY_PAGE_WORDS: Readonly<
  Record<
    SupportedLocale,
    {
      heading: string;
      stoppedHeading: string;
      retry: string;
      details: string;
      logTail: string;
      lastFailure: (at: string) => string;
      status: (level: string, failures: number) => string;
      stoppedStatus: (level: string) => string;
      uncountedStatus: (level: string) => string;
      refusedAtStartStatus: (level: string) => string;
      freeSpace: (amount: string) => string;
      unknownSpace: string;
      missingTriggers: (names: string) => string;
      changedTriggers: (names: string) => string;
      lastError: (code: string, at: string) => string;
      noCode: string;
      noTime: string;
      noLog: string;
    }
  >
> = {
  "en-GB": {
    heading: "Waitron did not start",
    stoppedHeading: "Waitron stopped",
    retry: "Retry a normal boot",
    details: "Details",
    logTail: "Log tail",
    lastFailure: (at) => `Why the last start failed (${at})`,
    status: (level, failures) => `Level: ${level}. Failed ${failures} times.`,
    stoppedStatus: (level) => `Level: ${level}. Stopped while running.`,
    uncountedStatus: (level) => `Level: ${level}. This start was not counted: the disk is full.`,
    refusedAtStartStatus: (level) =>
      `Level: ${level}. This start was refused before it began, and was not counted.`,
    freeSpace: (amount) => `Free space on the box's disk: ${amount}.`,
    unknownSpace: "unknown",
    missingTriggers: (names) => `Missing triggers: ${names}`,
    changedTriggers: (names) => `Changed triggers: ${names}`,
    lastError: (code, at) => `Last error: ${code} at ${at}`,
    noCode: "none",
    noTime: "never",
    noLog: "(no log yet)",
  },
  "es-ES": {
    heading: "Waitron no ha arrancado",
    stoppedHeading: "Waitron se ha detenido",
    retry: "Reintentar un arranque normal",
    details: "Detalles",
    logTail: "Final del registro",
    lastFailure: (at) => `Por qué falló el último arranque (${at})`,
    status: (level, failures) => `Nivel: ${level}. Intentos fallidos: ${failures}.`,
    stoppedStatus: (level) => `Nivel: ${level}. Se detuvo mientras funcionaba.`,
    uncountedStatus: (level) =>
      `Nivel: ${level}. Este arranque no se ha contado: el disco está lleno.`,
    refusedAtStartStatus: (level) =>
      `Nivel: ${level}. Este arranque se rechazó antes de empezar y no se ha contado.`,
    freeSpace: (amount) => `Espacio libre en el disco del equipo: ${amount}.`,
    unknownSpace: "desconocido",
    missingTriggers: (names) => `Disparadores que faltan: ${names}`,
    changedTriggers: (names) => `Disparadores cambiados: ${names}`,
    lastError: (code, at) => `Último error: ${code}, fecha: ${at}`,
    noCode: "ninguno",
    noTime: "nunca",
    noLog: "(aún no hay registro)",
  },
};

/**
 * "Two minutes" is the holder's watchdog bound (`WATCHDOG_KILL_MS`,
 * `packages/store/src/venue-liveness.ts`).
 */
export function holderStalledText(kind: VenueHolderKind | undefined): OperatorText {
  const name = HOLDER_NAMES[kind ?? "script"];
  return {
    "en-GB": {
      title: `The box's database is held by ${name["en-GB"]}, which appears to have stopped responding.`,
      action:
        "Wait two minutes, then press Retry: Waitron normally ends a program of its own that stops responding within that time. If it fails again, switch the box off and on: that ends any program holding the database.",
    },
    "es-ES": {
      title: `La base de datos de este equipo está ocupada por ${name["es-ES"]}, que parece haber dejado de responder.`,
      action:
        "Espera dos minutos y pulsa «Reintentar un arranque normal»: Waitron normalmente cierra en ese tiempo un programa propio que deja de responder. Si vuelve a fallar, apaga y enciende el equipo: así se cierra cualquier programa que tenga ocupada la base de datos.",
    },
  };
}

/**
 * Recorded before the server starts, so a boot that hangs still leaves the page something true to
 * say. Not an `AppError` code: nothing throws it.
 *
 * It lives in the module whose computed key below reads it, not in `node-entry.ts` which writes
 * it: exported from there it closes an import cycle, and in the esbuild bundle the key then
 * evaluates to `undefined`.
 */
export const BOOT_INCOMPLETE = "server.boot_incomplete";

/** Like `BOOT_INCOMPLETE`: nothing throws it, and it lives here for the same reason. */
export const HOLDER_STALLED = "provisioning.database_holder_stalled";

/** Typed so a misspelled code below fails the typecheck rather than rendering the generic line. */
type RecoveryCode = ErrorCode | typeof BOOT_INCOMPLETE | typeof HOLDER_STALLED;

const MALFORMED_PRODUCER_EN =
  "This copy of Waitron was built with its producer's details incomplete or in the wrong form, so it cannot be used.";
const MALFORMED_PRODUCER_ES =
  "Esta copia de Waitron se creó con los datos de quien la produce incompletos o mal escritos, así que no puede usarse.";
const PRODUCER_ACTION_EN =
  "Install an official Waitron update on this box. If you build Waitron yourself, build it with your own producer's details.";
const PRODUCER_ACTION_ES =
  "Instala en este equipo una actualización oficial de Waitron. Si creas Waitron tú mismo, créalo con los datos de tu propio productor.";

/**
 * Every string in this table is fixed and chosen by code. The strings on the page that are not —
 * the error code, `lastFailureAt`, the log tail, the last failed start's detail, the recorded
 * trigger names and, on the Start again page, the found files' paths and the set-aside folder's
 * name — are HTML-escaped, in either language, as is the line carrying `level` and
 * `failures`.
 *
 * The tail and the detail carry caught errors' own words, stacks and `AppError` params: the
 * operator's only window on why the box did not start (owner decision, 2026-09-26). What bounds
 * them is not this page: `redactSecrets`, which masks passwords in a URL and nothing else, the
 * personal-data mask over the details `PERSONAL_LOG_KEYS` names
 * (`apps/server/src/log-personal-data.ts`), and the convention that an `AppError`'s params never
 * carry a secret (`apps/server/src/errors.ts`).
 *
 * The wording never suggests wiping or resetting anything: a real venue's database holds fiscal
 * records that cannot be re-created, so the action is always restore or reinstall (owner decision,
 * 2026-09-10).
 */
export const OPERATOR_TEXT: Readonly<Partial<Record<RecoveryCode, OperatorText>>> = {
  "provisioning.database_ahead": {
    "en-GB": {
      title:
        "This box's database was set up by a different version of Waitron than the one installed.",
      action:
        "Restore it from a backup, or reinstall. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
    },
    "es-ES": {
      title:
        "La base de datos de este equipo la configuró una versión de Waitron distinta de la instalada.",
      action:
        "Restáurala desde una copia de seguridad, o reinstala. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
    },
  },
  "provisioning.schema_mismatch": {
    "en-GB": {
      title: "The box's database does not match the installed software.",
      action:
        "Restore it from a backup, or reinstall. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
    },
    "es-ES": {
      title: "La base de datos del equipo no coincide con el software instalado.",
      action:
        "Restáurala desde una copia de seguridad, o reinstala. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
    },
  },
  "provisioning.database_unreachable": {
    // The engine could not open the file (`boot-failure.ts`, SQLITE_CANTOPEN).
    "en-GB": {
      title: "Waitron could not open the box's database.",
      action:
        "Press Retry. If it fails again, restart the box — that can fix a disk or a volume that did not come up. If it still fails, this is a fault in Waitron or this box's disk: the box's database is a file on its disk, and the software cannot read it.",
    },
    "es-ES": {
      title: "Waitron no ha podido abrir la base de datos del equipo.",
      action:
        "Pulsa «Reintentar un arranque normal». Si vuelve a fallar, reinicia el equipo: eso puede arreglar un disco o un volumen que no se activó. Si sigue fallando, es un fallo de Waitron o del disco de este equipo: la base de datos del equipo es un archivo en su disco, y el software no puede leerlo.",
    },
  },
  "storage.disk_full": {
    "en-GB": {
      title: "The box's disk is full, so Waitron cannot save anything.",
      action:
        "The box has deleted the temporary copies, old logs and crash reports it can make again, and the disk is still full. Your sales and the venue's database are not touched. Waitron cannot free more space by itself: the rest of the disk holds the venue's data, the backups kept on this box and files that are not Waitron's. Once more space is free, press “Retry a normal boot”. If you reinstall Waitron instead, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
    },
    "es-ES": {
      title: "El disco del equipo está lleno, así que Waitron no puede guardar nada.",
      action:
        "El equipo ha quitado las copias temporales, los registros y los avisos de fallo antiguos que puede volver a crear, y el disco sigue lleno. Tus ventas y la base de datos del local no se tocan. Waitron no puede liberar más espacio por sí solo: el resto del disco guarda los datos del local, las copias de seguridad que se guardan en este equipo y archivos que no son de Waitron. Cuando haya más espacio libre, pulsa «Reintentar un arranque normal». Si en cambio reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
    },
  },
  "migrations.incomplete": {
    // Deliberately no restore: a restore runs the migrations itself, so it can raise this code.
    "en-GB": {
      title: "The box's database was only partly updated.",
      action:
        "This is a fault in Waitron. Restoring a backup may not help: a restore runs the same update, and it can stop in the same place.",
    },
    "es-ES": {
      title: "La base de datos del equipo solo se actualizó en parte.",
      action:
        "Es un fallo de Waitron. Restaurar una copia de seguridad puede no servir: una restauración ejecuta la misma actualización, y puede detenerse en el mismo punto.",
    },
  },
  "setup.environment_move_unfinished": {
    "en-GB": {
      title: "Start again has not finished.",
      action:
        "Some files may already be set aside. Each time this box starts, it tries to finish the recorded move before first setup. Keep these files on the box, unchanged.",
    },
    "es-ES": {
      title: "Empezar de nuevo no ha terminado.",
      action:
        "Puede que algunos archivos ya estén apartados. Cada vez que este equipo arranca, intenta terminar el traslado registrado antes de la configuración inicial. Conserva estos archivos en el equipo, sin cambios.",
    },
  },
  "deployment.environment_mismatch": {
    "en-GB": {
      title:
        "This box and its database do not belong to the same system: one is set up for real sales, the other for testing.",
      action:
        "If the host settings are wrong, leave these files as they are, correct the settings and retry. Otherwise, choose Start again over the secure connection to move this database aside and start fresh or choose another backup.",
    },
    "es-ES": {
      title:
        "Este equipo y su base de datos no pertenecen al mismo sistema: uno está configurado para ventas reales y el otro para pruebas.",
      action:
        "Si la configuración del equipo es incorrecta, conserva estos archivos tal como están, corrige la configuración y reintenta. Si no, elige Empezar de nuevo con la conexión segura para apartar esta base de datos y empezar de cero o elegir otra copia de seguridad.",
    },
  },
  "sif.producer_unset": {
    "en-GB": {
      title:
        "This copy of Waitron was built without the name, tax number and address of its producer, so it cannot be used for real sales.",
      action: PRODUCER_ACTION_EN,
    },
    "es-ES": {
      title:
        "Esta copia de Waitron se creó sin el nombre, el NIF y la dirección de quien la produce, así que no puede usarse para ventas reales.",
      action: PRODUCER_ACTION_ES,
    },
  },
  "software_producer.invalid": {
    "en-GB": { title: MALFORMED_PRODUCER_EN, action: PRODUCER_ACTION_EN },
    "es-ES": { title: MALFORMED_PRODUCER_ES, action: PRODUCER_ACTION_ES },
  },
  "sif.producer_invalid": {
    "en-GB": { title: MALFORMED_PRODUCER_EN, action: PRODUCER_ACTION_EN },
    "es-ES": { title: MALFORMED_PRODUCER_ES, action: PRODUCER_ACTION_ES },
  },
  "sif.producer_changed": {
    "en-GB": {
      title:
        "This box has been given a different software producer from the one its invoices were recorded under. A new producer needs a new fiscal installation, and this version of Waitron cannot open one, so the box will not sell.",
      action:
        "Install a Waitron version that names the same producer as this box's invoices. Changing the producer needs a Waitron version that can open a new fiscal installation, which does not exist yet.",
    },
    "es-ES": {
      title:
        "Este equipo tiene un productor del software distinto del de sus facturas registradas. Un productor nuevo necesita una nueva instalación fiscal, y esta versión de Waitron no puede abrirla, así que el equipo no venderá.",
      action:
        "Instala una versión de Waitron que indique el mismo productor que las facturas de este equipo. Cambiar de productor necesita una versión de Waitron capaz de abrir una nueva instalación fiscal, que todavía no existe.",
    },
  },
  "sif.allocation_invalid": {
    // Chosen by code alone, so it covers every reason the code carries at start, a clock
    // disagreement included.
    "en-GB": {
      title: "The box could not make its new invoice series.",
      action:
        "It checks its time against the internet first. Connect the box to the internet, then press “Retry a normal boot”.",
    },
    "es-ES": {
      title: "El equipo no pudo crear sus nuevas series de facturas.",
      action:
        "El equipo comprueba primero su hora con internet. Conecta el equipo a internet y pulsa «Reintentar un arranque normal».",
    },
  },
  "server.config_missing": {
    "en-GB": {
      title: "The box's configuration is incomplete.",
      action:
        "This is a fault in Waitron's installation on this box: a setting the box needs is missing.",
    },
    "es-ES": {
      title: "La configuración del equipo está incompleta.",
      action:
        "Es un fallo de la instalación de Waitron en este equipo: falta un ajuste que el equipo necesita.",
    },
  },
  "server.config_invalid": {
    "en-GB": {
      title: "The box's configuration is invalid.",
      action:
        "This is a fault in Waitron's installation on this box: a setting the box needs is not valid.",
    },
    "es-ES": {
      title: "La configuración del equipo no es válida.",
      action:
        "Es un fallo de la instalación de Waitron en este equipo: un ajuste que el equipo necesita no es válido.",
    },
  },
  [BOOT_INCOMPLETE]: {
    "en-GB": {
      title: "Waitron did not finish starting.",
      action: "Press Retry. If it keeps failing, this is a fault in Waitron or this box.",
    },
    "es-ES": {
      title: "Waitron no terminó de arrancar.",
      action:
        "Pulsa «Reintentar un arranque normal». Si sigue fallando, es un fallo de Waitron o de este equipo.",
    },
  },
  // These four name no next step beyond the retry: Waitron's own steps should not produce them.
  "handover.accepted_copy_missing": {
    "en-GB": {
      title: "The copy of the venue this box accepted is no longer on its disk.",
      action:
        "This is a fault in Waitron or this box's disk. This box cannot take over without that copy. The old box has given up filing and stays stopped. Press “Retry a normal boot” if the file has been put back.",
    },
    "es-ES": {
      title: "La copia del local que este equipo aceptó ya no está en su disco.",
      action:
        "Es un fallo de Waitron o del disco de este equipo. Este equipo no puede hacerse cargo sin esa copia. El equipo antiguo ha cedido el envío de registros y sigue detenido. Pulsa «Reintentar un arranque normal» si el archivo ha vuelto a su sitio.",
    },
  },
  "handover.copy_mismatch": {
    "en-GB": {
      title: "The copy of the venue this box accepted has changed on its disk.",
      action:
        "This is a fault in Waitron or this box's disk. This box did not put it in place, and its own database is unchanged. The old box has given up filing and stays stopped. Press “Retry a normal boot” if the file has been put back as it was.",
    },
    "es-ES": {
      title: "La copia del local que este equipo aceptó ha cambiado en su disco.",
      action:
        "Es un fallo de Waitron o del disco de este equipo. Este equipo no la ha puesto en su sitio, y su propia base de datos no ha cambiado. El equipo antiguo ha cedido el envío de registros y sigue detenido. Pulsa «Reintentar un arranque normal» si el archivo ha vuelto a su sitio tal como estaba.",
    },
  },
  "handover.preparation_state_unusable": {
    "en-GB": {
      title: "This box cannot record the old box's selections, so it did not take over.",
      action:
        "This is a fault in Waitron or this box's disk: its module preparation file is unreadable or too full. Without those selections this box could reuse a name the old box already used, so its own database stays unchanged. The old box has given up filing and stays stopped. Press “Retry a normal boot” if the file has been repaired.",
    },
    "es-ES": {
      title:
        "Este equipo no puede guardar las selecciones del equipo antiguo, así que no se ha hecho cargo.",
      action:
        "Es un fallo de Waitron o del disco de este equipo: su archivo de preparación de módulos no se puede leer o está demasiado lleno. Sin esas selecciones, este equipo podría repetir un nombre que el equipo antiguo ya usó, así que su propia base de datos sigue sin cambios. El equipo antiguo ha cedido el envío de registros y sigue detenido. Pulsa «Reintentar un arranque normal» si el archivo se ha reparado.",
    },
  },
  "handover.placement_failed": {
    "en-GB": {
      title: "This box could not put the copy of the venue it accepted in place.",
      action:
        "This is a fault in Waitron or this box's disk. The copy is kept. The old box has given up filing and stays stopped. Press “Retry a normal boot” to try again.",
    },
    "es-ES": {
      title: "Este equipo no pudo poner en su sitio la copia del local que aceptó.",
      action:
        "Es un fallo de Waitron o del disco de este equipo. La copia se conserva. El equipo antiguo ha cedido el envío de registros y sigue detenido. Pulsa «Reintentar un arranque normal» para volver a intentarlo.",
    },
  },
  "handover.placement_no_room": {
    "en-GB": {
      title: "This box's disk has no room for the copy of the venue it accepted.",
      action:
        "It needs room for one more whole copy of the venue, and the details below say how many bytes. Waitron cannot free more space by itself. The copy is kept. The old box has given up filing and stays stopped. Press “Retry a normal boot” to try again.",
    },
    "es-ES": {
      title: "El disco de este equipo no tiene sitio para la copia del local que aceptó.",
      action:
        "Necesita sitio para otra copia entera del local, y los detalles de abajo indican cuántos bytes. Waitron no puede liberar más espacio por sí solo. La copia se conserva. El equipo antiguo ha cedido el envío de registros y sigue detenido. Pulsa «Reintentar un arranque normal» para volver a intentarlo.",
    },
  },
  "restore.flow_unreadable": {
    "en-GB": {
      title: "The unfinished restore request cannot be read.",
      action: "The box cannot finish this restore.",
    },
    "es-ES": {
      title: "No se puede leer la solicitud de restauración sin terminar.",
      action: "El equipo no puede terminar esta restauración.",
    },
  },
  "restore.placement_failed": {
    "en-GB": {
      title: "A restore could not put the restored database in place.",
      action:
        "This is a fault in Waitron or this box's disk. The details under “Why the last start failed” below describe the failed step. A restore started from setup runs again from its backup when you retry. Use the restore choice below to abandon it.",
    },
    "es-ES": {
      title: "Una restauración no pudo poner en su sitio la base de datos restaurada.",
      action:
        "Es un fallo de Waitron o del disco de este equipo. Los detalles de «Por qué falló el último arranque», más abajo, describen el paso que falló. Una restauración iniciada desde la configuración vuelve a ejecutarse desde su copia cuando reintentas. La opción de abajo permite descartar esta restauración.",
    },
  },
  "restore.database_set_aside": {
    "en-GB": {
      title: "This box's database was moved aside by a restore that did not finish.",
      action:
        "This is a fault in Waitron or this box's disk. The database is in a folder inside the venue folder, named under “Why the last start failed” below and in the server's own output. It must be moved back, or the restore run again, before the box can start.",
    },
    "es-ES": {
      title: "La base de datos de este equipo quedó apartada por una restauración que no terminó.",
      action:
        "Es un fallo de Waitron o del disco de este equipo. La base de datos está en una carpeta dentro de la carpeta del local, cuyo nombre aparece más abajo, en «Por qué falló el último arranque», y en la salida del propio servidor. Hay que devolverla a su sitio, o volver a hacer la restauración, antes de que el equipo pueda arrancar.",
    },
  },
  "append_only.triggers_changed": {
    "en-GB": {
      title: "A safeguard on the box's permanent records was removed or changed.",
      action:
        "This is a fault in Waitron or this box's disk, or a program other than Waitron changed the box's database.",
    },
    "es-ES": {
      title: "Se ha quitado o cambiado una protección de los registros permanentes del equipo.",
      action:
        "Es un fallo de Waitron o del disco de este equipo, o un programa que no es Waitron ha cambiado la base de datos del equipo.",
    },
  },
  "restore.membership_invalid": {
    // No retry: the refusal leaves the copy unchanged, so the next start reads it again.
    "en-GB": {
      title:
        "The list of machines in the restored copy is damaged or does not carry a valid signature, so it may have been changed after it was saved.",
      action:
        "The box will not start from this copy. Unless it was changed after it was saved, this is a fault in Waitron or this box's disk.",
    },
    "es-ES": {
      title:
        "La lista de equipos de la copia restaurada está dañada o no tiene una firma válida, así que puede haberse cambiado después de guardarse.",
      action:
        "El equipo no arrancará con esta copia. Salvo que se cambiara después de guardarse, es un fallo de Waitron o del disco de este equipo.",
    },
  },
  "migrations.apply_failed": {
    // "Undone" and "can start again": `packages/migrations/src/apply-failed.test.ts`. Only the
    // refused set is undone; a set that finished earlier in the same start stays applied.
    "en-GB": {
      title: "The box's database could not be updated for the installed version of Waitron.",
      action:
        "This is a fault in Waitron. The step that failed was undone, so the box can start once a version of Waitron that fixes it is installed. Restoring a backup may not help: a restore runs the same update, and it can fail in the same place.",
    },
    "es-ES": {
      title:
        "No se ha podido actualizar la base de datos del equipo para la versión de Waitron instalada.",
      action:
        "Es un fallo de Waitron. El paso que falló se deshizo, así que el equipo podrá arrancar cuando se instale una versión de Waitron que lo corrija. Restaurar una copia de seguridad puede no servir: una restauración ejecuta la misma actualización, y puede fallar en el mismo punto.",
    },
  },
  "migrations.set_missing": {
    "en-GB": {
      title: "The installed software is incomplete.",
      action: "Reinstall Waitron on this box.",
    },
    "es-ES": {
      title: "El software instalado está incompleto.",
      action: "Reinstala Waitron en este equipo.",
    },
  },
  "setup.workspace_unsupported": {
    "en-GB": {
      title:
        "This box holds a setup from an older version of Waitron that this version cannot use.",
      action: "Reinstall Waitron on this box to start fresh.",
    },
    "es-ES": {
      title:
        "Este equipo tiene una configuración de una versión anterior de Waitron que esta versión no puede usar.",
      action: "Reinstala Waitron en este equipo para empezar de cero.",
    },
  },
  "setup.start_again_incomplete": {
    "en-GB": {
      title:
        "Start again did not finish: the box found files it did not expect, or could not read or delete one.",
      action:
        "The box has not changed files it did not expect, because they may be a venue restored from a backup. If you reinstall Waitron, the box starts fresh, but everything on it is lost.",
    },
    "es-ES": {
      title:
        "«Empezar de nuevo» no terminó: el equipo encontró archivos que no esperaba, o no pudo leer o borrar uno.",
      action:
        "El equipo no ha cambiado los archivos que no esperaba, porque pueden ser un local recuperado desde una copia de seguridad. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que hay en él.",
    },
  },
  "setup.start_again_files_found": {
    "en-GB": {
      title: "Start again did not finish, and the box found files it did not expect.",
      action:
        "An earlier Start again was cut off. Since then, files have appeared on this box that Start again did not create. They may be a venue restored from a backup. The box has not changed them.",
    },
    "es-ES": {
      title: "«Empezar de nuevo» no terminó y el equipo encontró archivos que no esperaba.",
      action:
        "Un «Empezar de nuevo» anterior se interrumpió. Desde entonces han aparecido en este equipo archivos que «Empezar de nuevo» no creó. Pueden ser un local recuperado desde una copia de seguridad. El equipo no los ha cambiado.",
    },
  },
  "setup.start_again_kept": {
    "en-GB": {
      title: "Start again did not finish, and everything on this box was kept.",
      action:
        "Nothing was moved. This page stays until Waitron is reinstalled on this box. If Waitron is reinstalled, everything on this box is lost, the kept files included.",
    },
    "es-ES": {
      title: "«Empezar de nuevo» no terminó y se ha conservado todo lo que hay en este equipo.",
      action:
        "No se ha movido nada. Esta página sigue hasta que se reinstale Waitron en este equipo. Si se reinstala Waitron, se pierde todo lo que hay en el equipo, también los archivos conservados.",
    },
  },
  "setup.start_again_move_unfinished": {
    "en-GB": {
      title: "Start again was moving files aside and has not finished.",
      action:
        "Some of the files may already be in the set-aside folder; none has been deleted. Press “Retry a normal boot” to finish moving them, and the box then starts a new first setup. If you reinstall Waitron instead, the box starts fresh, but everything on it is lost, including the files moved aside.",
    },
    "es-ES": {
      title: "«Empezar de nuevo» estaba apartando archivos y no ha terminado.",
      action:
        "Puede que algunos archivos ya estén en la carpeta apartada; todos siguen en el equipo. Pulsa «Reintentar un arranque normal» para terminar de moverlos, y después el equipo empieza una configuración inicial nueva. Si en cambio reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, también los archivos apartados.",
    },
  },
  // The holder's own name, when `recovery.json` recorded one, replaces this row's in
  // `operatorText` (`recovery-surface.ts`).
  [HOLDER_STALLED]: holderStalledText(undefined),
};

/**
 * Promises no recorded reason: a failure reading or counting the recovery state reaches
 * `node-entry.ts`'s outer handler, which logs its code and no detail.
 */
export const GENERIC_TEXT: OperatorText = {
  "en-GB": {
    title: "Waitron could not start.",
    action:
      "Press “Retry a normal boot”. If it fails again, this is a fault in Waitron or this box.",
  },
  "es-ES": {
    title: "Waitron no ha podido arrancar.",
    action:
      "Pulsa «Reintentar un arranque normal». Si vuelve a fallar, es un fallo de Waitron o de este equipo.",
  },
};

export const ENVIRONMENT_RECOVERY_TEXT: Readonly<
  Record<
    SupportedLocale,
    {
      move: string;
      stop: string;
      stopped: string;
      detail: string;
      wrong: string;
      unavailable: string;
    }
  >
> = {
  "en-GB": {
    unavailable:
      "These files cannot be moved aside on this box. Nothing was changed. You can Stop and keep them as they are.",
    move: "Start again",
    stop: "Stop",
    stopped: "Nothing was changed. You can correct the host settings and retry.",
    detail:
      "Move this venue's files aside, unchanged. The box then starts first setup, where you can start fresh or choose another backup.",
    wrong:
      "The administrator password could not be verified. Nothing was moved. Check it and try again.",
  },
  "es-ES": {
    unavailable:
      "Estos archivos no se pueden apartar en este equipo. No se ha cambiado nada. Puedes parar y conservarlos tal como están.",
    move: "Empezar de nuevo",
    stop: "Parar",
    stopped: "No se ha cambiado nada. Puedes corregir la configuración del equipo y reintentar.",
    detail:
      "Apartar los archivos de este local, sin cambios. El equipo empieza la configuración inicial, donde puedes empezar de cero o elegir otra copia de seguridad.",
    wrong:
      "No se ha podido verificar la contraseña de administrador. No se ha movido nada. Revísala y vuelve a intentarlo.",
  },
};

export const RESTORE_DISCARD_TEXT = {
  "en-GB": {
    move: "Throw this restore away",
    stop: "Stop",
    before:
      "This restore has not begun copying. Throwing it away keeps the database already on this box.",
    after:
      "Throwing this restore away removes the destination database, including any previous database put back after a failed attempt. It does not recover the old data. You can restore again or set up this box.",
    wrong: "The password does not match an active administrator in the selected backup.",
    unavailable: "This restore cannot be thrown away now.",
    notFinished:
      "The restore could not be thrown away completely. The box remains stopped. Try this action again.",
    done: "This restore has been thrown away. You can restore again or set up this box.",
    stopped: "Nothing changed. This restore is still waiting.",
  },
  "es-ES": {
    move: "Descartar esta restauración",
    stop: "Parar",
    before:
      "La copia de esta restauración aún no ha comenzado. Descartarla conserva la base de datos que ya está en esta caja.",
    after:
      "Descartar esta restauración elimina la base de datos de destino, incluida cualquier base de datos anterior que se haya devuelto tras un intento fallido. No recupera los datos anteriores. Puedes restaurar otra copia o configurar esta caja.",
    wrong: "La contraseña no coincide con la de un administrador activo de la copia seleccionada.",
    unavailable: "Ahora no se puede descartar esta restauración.",
    notFinished:
      "No se ha podido descartar por completo la restauración. La caja sigue detenida. Vuelve a intentarlo.",
    done: "Se ha descartado esta restauración. Puedes restaurar otra copia o configurar esta caja.",
    stopped: "Nada ha cambiado. Esta restauración sigue pendiente.",
  },
} as const;
