// The restore, restore-bucket, cloud-restore, live-source, configuration-preview and fiscal-test screens.

export const restoreEn = {
  "restore.heading": "Restore from backup",
  "restore.cloud_restore": "Restore from Waitron Cloud",
  "restore.intro":
    "Use cold recovery only when no other server is still running with newer restaurant data.",
  "restore.backup_file": "Backup file",
  "restore.backup_file_help_label": "Help with backup file",
  "restore.backup_file_help": "Choose the encrypted backup from the server you are recovering.",
  "restore.backup_file_missing": "Choose a backup file.",
  "restore.recovery_key": "Recovery key",
  "restore.recovery_key_help_label": "Help with recovery key",
  "restore.recovery_key_help":
    "Enter the recovery key saved for this backup. It unlocks the encrypted backup.",
  "restore.recovery_key_missing": "Enter the recovery key.",
  "restore.environment": "Backup environment",
  "restore.environment_help_label": "Help with backup environment",
  "restore.environment_help":
    "Choose the environment the backup came from. A preparation or demo backup cannot become a Live database.",
  "restore.environment_live": "Live",
  "restore.environment_preproduction": "Preparation or demo",
  "restore.acknowledge": "I confirm no other running server has newer restaurant data.",
  "restore.acknowledge_help_label": "Help with recovery confirmation",
  "restore.acknowledge_help":
    "Check every other server this restaurant still has before restoring. A backup may be older than a server that is still running.",
  "restore.acknowledge_missing": "Confirm that no other running server has newer data.",
  "restore.fix_fields": "Correct the highlighted fields to continue.",
  "restore.check.artifact": "Check the backup file.",
  "restore.check.recovery_key": "Check the recovery key.",
  "restore.check.environment": "Check the backup environment.",
  "restore.back": "Back",
  "restore.submit": "Restore backup",

  "restore_bucket.heading": "Restore from my bucket",
  "restore_bucket.intro":
    "Rebuild this server from the copy the old server kept in your storage bucket. Use this only when the old server is gone. You need the recovery kit, and nothing else.",
  "restore_bucket.sensitive":
    "The recovery kit is as sensitive as the recovery key: anyone holding it can read every sale and every stored credential in the bucket copy. Enter it only here.",
  "restore_bucket.kit_file": "Recovery kit file",
  "restore_bucket.kit": "Recovery kit",
  "restore_bucket.kit_help_label": "Help with the recovery kit",
  "restore_bucket.kit_help":
    "Choose the kit file above, or paste the kit here: one long line starting with WAITRON-RECOVERY-KIT-1.",
  "restore_bucket.kit_missing": "Upload or paste the recovery kit.",
  "restore_bucket.environment": "Environment",
  "restore_bucket.environment_help_label": "Help with environment",
  "restore_bucket.environment_help":
    "Choose the environment the old server ran in. A preparation or demo copy cannot become a Live database.",
  "restore_bucket.environment_live": "Live",
  "restore_bucket.environment_preproduction": "Preparation or demo",
  "restore_bucket.acknowledge": "I confirm no other running server has newer restaurant data.",
  "restore_bucket.acknowledge_missing": "Confirm that no other running server has newer data.",
  "restore_bucket.venue_owner": "The copy in the bucket belongs to",
  "restore_bucket.venue_details": "(tax id {taxId}), location {location}.",
  "restore_bucket.venue_confirm": "This is my business. Restore it onto this server.",
  "restore_bucket.venue_missing": "Confirm that this is your business.",
  "restore_bucket.fix_fields": "Correct the highlighted fields to continue.",
  "restore_bucket.check.kit": "Check the recovery kit.",
  "restore_bucket.check.environment": "Check the environment.",
  "restore_bucket.back": "Back",
  "restore_bucket.submit": "Restore from my bucket",

  "cloud_restore.heading": "Restore from Waitron Cloud",
  "cloud_restore.intro":
    "Use a verified snapshot for a preparation or demo venue. Stop the old server and any surviving peers before restoring. Changes after the snapshot time will be lost.",
  "cloud_restore.start": "Start Cloud recovery",
  "cloud_restore.expired": "This recovery request has expired.",
  "cloud_restore.start_again": "Start a new request",
  "cloud_restore.enter_code": "Enter this code in your Waitron Cloud account:",
  "cloud_restore.expires": "Request expires:",
  "cloud_restore.open_cloud": "Open Waitron Cloud",
  "cloud_restore.check": "Check approval",
  "cloud_restore.approved_heading": "Approved snapshot",
  "cloud_restore.captured": "Captured:",
  "cloud_restore.later_changes": "Later changes will not be in this restored venue.",
  "cloud_restore.acknowledge":
    "I confirm the old server and surviving peers are stopped, and I accept losing changes after this snapshot.",
  "cloud_restore.acknowledge_missing":
    "Confirm that the old server and surviving peers are stopped, and that you accept losing changes after this snapshot.",
  "cloud_restore.fix_fields": "Correct the highlighted fields to continue.",
  "cloud_restore.restore": "Restore this snapshot",
  "cloud_restore.back": "Back to backup file",

  "live_source.heading": "Bring your prepared restaurant live",
  "live_source.intro":
    "Copy menus, layouts, staff profiles and settings from a preparation export.",
  "live_source.export": "Configuration export",
  "live_source.export_help_label": "Help with configuration export",
  "live_source.export_help":
    "Choose the encrypted configuration exported from your prepared restaurant. This copies its settings into a new Live setup.",
  "live_source.export_missing": "Choose a configuration export.",
  "live_source.passphrase": "Export passphrase",
  "live_source.passphrase_short": "Enter a passphrase of at least 12 characters.",
  "live_source.passphrase_help_label": "Help with export passphrase",
  "live_source.passphrase_help": "Enter the passphrase used to encrypt the configuration export.",
  "live_source.show_passphrase": "Show export passphrase",
  "live_source.hide_passphrase": "Hide export passphrase",
  "live_source.fix_fields": "Correct the highlighted fields to continue.",
  "live_source.import": "Review prepared configuration",
  "live_source.start_empty": "Start empty",
  "live_source.empty_intro": "Create a fresh live restaurant and enter its configuration yourself.",
  "live_source.back": "Back",

  "config_preview.heading": "Review prepared configuration",
  "config_preview.creates_for": "This will create a fresh production restaurant for",
  "config_preview.not_included": ". Practice sales and fiscal records are not included.",
  "config_preview.copy_heading": "Configuration to copy",
  "config_preview.reconnect_heading": "Reconnect after setup",
  "config_preview.no_reconnect": "No hardware reconnection is listed.",
  "config_preview.back": "Back",
  "config_preview.continue": "Continue",

  "fiscal_test.heading": "Check fiscal readiness",
  "fiscal_test.intro":
    "Waitron will file one small sample with the AEAT test service using this restaurant's tax identity and certificate. It does not file to AEAT's production service.",
  "fiscal_test.accepted": "AEAT accepted the test submission.",
  "fiscal_test.rejected":
    "AEAT rejected the test submission. Correct the certificate or restaurant details, then try again.",
  "fiscal_test.uncertain":
    "The result is uncertain. Wait a moment and retry; Waitron will keep the same test record.",
  "fiscal_test.back": "Back",
  "fiscal_test.continue": "Continue",
  "fiscal_test.running": "Running test…",
  "fiscal_test.run": "Run fiscal test",
} as const;

export const restoreEs: Record<keyof typeof restoreEn, string> = {
  "restore.heading": "Restaurar desde una copia de seguridad",
  "restore.cloud_restore": "Restaurar desde Waitron Cloud",
  "restore.intro":
    "Usa la recuperación en frío solo cuando no quede ningún otro servidor funcionando con datos más recientes del restaurante.",
  "restore.backup_file": "Archivo de copia de seguridad",
  "restore.backup_file_help_label": "Ayuda sobre el archivo de copia de seguridad",
  "restore.backup_file_help":
    "Elige la copia de seguridad cifrada del servidor que estás recuperando.",
  "restore.backup_file_missing": "Elige un archivo de copia de seguridad.",
  "restore.recovery_key": "Clave de recuperación",
  "restore.recovery_key_help_label": "Ayuda sobre la clave de recuperación",
  "restore.recovery_key_help":
    "Introduce la clave de recuperación guardada para esta copia. Es la que abre la copia cifrada.",
  "restore.recovery_key_missing": "Introduce la clave de recuperación.",
  "restore.environment": "Entorno de la copia",
  "restore.environment_help_label": "Ayuda sobre el entorno de la copia",
  "restore.environment_help":
    "Elige el entorno del que viene la copia. Una copia de preparación o de demostración no puede convertirse en una base de datos en vivo.",
  "restore.environment_live": "En vivo",
  "restore.environment_preproduction": "Preparación o demostración",
  "restore.acknowledge":
    "Confirmo que ningún otro servidor en funcionamiento tiene datos más recientes del restaurante.",
  "restore.acknowledge_help_label": "Ayuda sobre la confirmación de la recuperación",
  "restore.acknowledge_help":
    "Antes de restaurar, revisa todos los demás servidores que siga teniendo este restaurante. Una copia puede ser más antigua que un servidor que sigue funcionando.",
  "restore.acknowledge_missing":
    "Confirma que ningún otro servidor en funcionamiento tiene datos más recientes.",
  "restore.fix_fields": "Corrige los campos marcados para continuar.",
  "restore.check.artifact": "Revisa el archivo de copia de seguridad.",
  "restore.check.recovery_key": "Revisa la clave de recuperación.",
  "restore.check.environment": "Revisa el entorno de la copia.",
  "restore.back": "Volver",
  "restore.submit": "Restaurar la copia",

  "restore_bucket.heading": "Restaurar desde mi bucket",
  "restore_bucket.intro":
    "Reconstruye este servidor a partir de la copia que el servidor anterior guardaba en tu bucket de almacenamiento. Úsalo solo cuando el servidor anterior ya no esté. Necesitas el kit de recuperación y nada más.",
  "restore_bucket.sensitive":
    "El kit de recuperación es tan delicado como la clave de recuperación: quien lo tenga puede leer todas las ventas y todas las credenciales guardadas en la copia del bucket. Introdúcelo solo aquí.",
  "restore_bucket.kit_file": "Archivo del kit de recuperación",
  "restore_bucket.kit": "Kit de recuperación",
  "restore_bucket.kit_help_label": "Ayuda sobre el kit de recuperación",
  "restore_bucket.kit_help":
    "Elige arriba el archivo del kit, o pega aquí el kit: una sola línea larga que empieza por WAITRON-RECOVERY-KIT-1.",
  "restore_bucket.kit_missing": "Sube o pega el kit de recuperación.",
  "restore_bucket.environment": "Entorno",
  "restore_bucket.environment_help_label": "Ayuda sobre el entorno",
  "restore_bucket.environment_help":
    "Elige el entorno en el que funcionaba el servidor anterior. Una copia de preparación o de demostración no puede convertirse en una base de datos en vivo.",
  "restore_bucket.environment_live": "En vivo",
  "restore_bucket.environment_preproduction": "Preparación o demostración",
  "restore_bucket.acknowledge":
    "Confirmo que ningún otro servidor en funcionamiento tiene datos más recientes del restaurante.",
  "restore_bucket.acknowledge_missing":
    "Confirma que ningún otro servidor en funcionamiento tiene datos más recientes.",
  "restore_bucket.venue_owner": "La copia del bucket pertenece a",
  "restore_bucket.venue_details": "(NIF {taxId}), local {location}.",
  "restore_bucket.venue_confirm": "Este es mi negocio. Restáuralo en este servidor.",
  "restore_bucket.venue_missing": "Confirma que este es tu negocio.",
  "restore_bucket.fix_fields": "Corrige los campos marcados para continuar.",
  "restore_bucket.check.kit": "Revisa el kit de recuperación.",
  "restore_bucket.check.environment": "Revisa el entorno.",
  "restore_bucket.back": "Volver",
  "restore_bucket.submit": "Restaurar desde mi bucket",

  "cloud_restore.heading": "Restaurar desde Waitron Cloud",
  "cloud_restore.intro":
    "Usa una instantánea verificada de un local de preparación o de demostración. Antes de restaurar, detén el servidor anterior y los demás servidores que queden. Se perderán los cambios posteriores a la hora de la instantánea.",
  "cloud_restore.start": "Iniciar la recuperación desde Cloud",
  "cloud_restore.expired": "Esta solicitud de recuperación ha caducado.",
  "cloud_restore.start_again": "Iniciar una nueva solicitud",
  "cloud_restore.enter_code": "Introduce este código en tu cuenta de Waitron Cloud:",
  "cloud_restore.expires": "La solicitud caduca:",
  "cloud_restore.open_cloud": "Abrir Waitron Cloud",
  "cloud_restore.check": "Comprobar la aprobación",
  "cloud_restore.approved_heading": "Instantánea aprobada",
  "cloud_restore.captured": "Tomada:",
  "cloud_restore.later_changes": "Los cambios posteriores no estarán en este local restaurado.",
  "cloud_restore.acknowledge":
    "Confirmo que el servidor anterior y los demás servidores que queden están detenidos, y acepto perder los cambios posteriores a esta instantánea.",
  "cloud_restore.acknowledge_missing":
    "Confirma que el servidor anterior y los demás servidores que queden están detenidos, y que aceptas perder los cambios posteriores a esta instantánea.",
  "cloud_restore.fix_fields": "Corrige los campos marcados para continuar.",
  "cloud_restore.restore": "Restaurar esta instantánea",
  "cloud_restore.back": "Volver al archivo de copia de seguridad",

  "live_source.heading": "Lleva tu restaurante preparado a producción",
  "live_source.intro":
    "Copia cartas, planos, perfiles del personal y ajustes de una exportación de preparación.",
  "live_source.export": "Exportación de configuración",
  "live_source.export_help_label": "Ayuda sobre la exportación de configuración",
  "live_source.export_help":
    "Elige la configuración cifrada que exportaste de tu restaurante preparado. Sus ajustes se copian en una nueva configuración en vivo.",
  "live_source.export_missing": "Elige una exportación de configuración.",
  "live_source.passphrase": "Contraseña de exportación",
  "live_source.passphrase_short": "Introduce una contraseña de al menos 12 caracteres.",
  "live_source.passphrase_help_label": "Ayuda sobre la contraseña de exportación",
  "live_source.passphrase_help":
    "Introduce la contraseña con la que se cifró la exportación de configuración.",
  "live_source.show_passphrase": "Mostrar la contraseña de exportación",
  "live_source.hide_passphrase": "Ocultar la contraseña de exportación",
  "live_source.fix_fields": "Corrige los campos marcados para continuar.",
  "live_source.import": "Revisar la configuración preparada",
  "live_source.start_empty": "Empezar desde cero",
  "live_source.empty_intro": "Crea un restaurante en vivo nuevo y configúralo tú.",
  "live_source.back": "Volver",

  "config_preview.heading": "Revisar la configuración preparada",
  "config_preview.creates_for": "Esto creará un restaurante de producción nuevo para",
  "config_preview.not_included":
    ". No se incluyen las ventas de práctica ni los registros fiscales.",
  "config_preview.copy_heading": "Configuración que se copia",
  "config_preview.reconnect_heading": "Qué reconectar después de la configuración",
  "config_preview.no_reconnect": "No hay ningún hardware que reconectar.",
  "config_preview.back": "Volver",
  "config_preview.continue": "Continuar",

  "fiscal_test.heading": "Comprueba la preparación fiscal",
  "fiscal_test.intro":
    "Waitron enviará un pequeño registro de muestra al servicio de pruebas de la AEAT con la identidad fiscal y el certificado de este restaurante. No se envía nada al servicio de producción de la AEAT.",
  "fiscal_test.accepted": "La AEAT ha aceptado el envío de prueba.",
  "fiscal_test.rejected":
    "La AEAT ha rechazado el envío de prueba. Corrige el certificado o los datos del restaurante e inténtalo de nuevo.",
  "fiscal_test.uncertain":
    "El resultado no es seguro. Espera un momento y vuelve a intentarlo; Waitron conservará el mismo registro de prueba.",
  "fiscal_test.back": "Volver",
  "fiscal_test.continue": "Continuar",
  "fiscal_test.running": "Haciendo la prueba…",
  "fiscal_test.run": "Hacer la prueba fiscal",
};
