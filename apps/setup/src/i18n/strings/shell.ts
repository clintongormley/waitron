// setup-app.ts's own text: the page title and every refusal and outcome the shell hands a screen.

export const shellEn = {
  "shell.problem_report.title": "Report a problem",
  "shell.problem_report.cancel": "Cancel",
  "shell.problem_report.description": "What happened?",
  "shell.problem_report.scope":
    "Save only this browser's activity to a file you keep; nothing is stored on the box or sent anywhere.",
  "shell.problem_report.warning":
    "Your description may identify someone. Do not include passwords, payment details or personal information.",
  "shell.problem_report.preview": "Report preview",
  "shell.problem_report.invalid": "Check your description.",
  "shell.problem_report.description_invalid":
    "Use up to 2,000 characters and remove unsupported characters.",
  "shell.problem_report.download": "Download report",
  "shell.problem_report.download_failed": "Could not create the download. Try again.",

  "shell.first_setup.owner_required": "The box no longer lets this page carry this setup on.",
  "shell.first_setup.attempt_conflict": "Another setup attempt owns this venue.",
  "shell.first_setup.attempt_uncertain":
    "The setup on this box may already have used its invoice series, so the box does not repeat or replace it.",
  "shell.setup_not_accepted":
    "This box did not accept this request from this page, so nothing changed. Reload starts setup again from its first screen; what you typed on this page is not kept.",
  "shell.setup_conflict":
    "Another setup on this box is in the way, so the box did not do this. Reload shows where setup on this box stands and what can be done next.",
  "shell.provisioning.first_setup_held":
    "This box holds an unfinished first setup, so it sets nothing else up while that setup is there. Reload shows that setup and what can be done with it.",
  "shell.restore.first_setup_held":
    "This box holds an unfinished first setup, so it restores no copy while that setup is there. Reload shows that setup and what can be done with it.",
  "shell.reset.first_setup_held":
    "This box holds an unfinished first setup, so it resets nothing while that setup is there. Reload shows that setup and what can be done with it.",
  "shell.first_setup.attempt_invalid":
    "Waitron cannot read or save part of what it keeps about this setup, so this step cannot go on. Reload the page, or press Reconnect where it is shown, to try again. If this message comes back, paste this page's address into a new tab: a new tab does not use this tab's own copy of the setup. Where they are offered, Start again and Recover from backup ask before they delete anything.",
  "shell.first_setup.start_again_incomplete": "Deletion interrupted. Reload the page to continue.",
  "shell.first_setup.disk_full":
    "The box's disk is full, so Waitron cannot save anything. Restart the box: as it starts, it removes old logs and crash reports to make room. Then try again. If the disk is still full, Waitron cannot free more space by itself. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
  "shell.first_setup.disk_full_restart_unknown":
    "The box's disk is full, so Waitron cannot save anything. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
  "shell.first_setup.series_minute_taken":
    "The invoice series cannot be created: the minute this setup chose is already in this box's records. This is a fault in Waitron.",
  "shell.first_setup.configuration_unreadable":
    "The box can no longer read the configuration export imported earlier. Export it again from the box you exported from, then set up this box again and import the new export.",
  "shell.first_setup.clock_step_unsaved":
    "The box's time was set from this device, but the box could not save a note of that change, so setup cannot finish yet. Reconnect, then provision this box again: the box tries to save the note first.",
  "shell.clock_step_unsaved":
    "The box's time was set from this device, but the box could not save a note of that change, so it cannot finish yet. Try again: the box tries to save the note first.",

  "shell.document_title": "Waitron — set up your box",
  "shell.reload": "Reload",
  "shell.reload_open_till": "Reload to open the till",
  "shell.theme.label": "Theme",
  "shell.theme.light": "Light",
  "shell.theme.dark": "Dark",
  "shell.theme.device": "Follow device",
  "shell.about.title": "About Waitron",
  "shell.about.close": "Close",

  "shell.connection.already_set_up": "This box is already set up. Reload to open it.",
  "shell.connection.server_problem": "This box reported a problem. Try again in a moment.",
  "shell.connection.provision_secure":
    "Setup needs a secure connection to show your box key. Follow the instructions above before continuing.",
  "shell.connection.unreachable":
    "We could not reach the box. Check its power and your network connection.",

  "shell.not_ready": "The box isn't ready yet. Wait a moment, then try again.",
  "shell.operation_conflict":
    "This box holds saved setup work that does not match this request, so it did not do this one.",
  "shell.already_provisioning": "Setup is already in progress on this box.",
  "shell.already_provisioned": "This box is already set up.",

  "shell.venue_error.territory_country_mismatch": "The country must match the fiscal territory.",
  "shell.venue_error.invalid_locales": "Choose the receipt language.",
  "shell.venue_error.regime_not_implemented": "That fiscal territory isn't supported yet.",
  "shell.venue_error.other":
    "The venue details were rejected — please review and correct them. ({code})",

  "shell.review.request_invalid":
    "The box rejected the details. Check your entries, then provision again.",
  "shell.review.request_invalid_field":
    "The box rejected the details (field: {field}). Check your entries, then provision again.",
  "shell.review.email_invalid":
    "The admin email address is invalid. Check it, then provision again.",

  "shell.fiscal_test.required": "Run an accepted fiscal test before activating production.",
  "shell.fiscal_test.could_not_run":
    "The fiscal test could not run. Check the connection and try again.",

  "shell.provision.usb_demo_refused":
    "Demo is unavailable on this box. Reload to return to setup, then choose Prepare your restaurant, Start a new restaurant or Join or recover a restaurant.",
  "shell.provision.throwaway_refused":
    "This box is stamped for production, so it does not offer Demo or Prepare your restaurant. Reload to choose another option.",

  "shell.provision.failed":
    "Provisioning failed. Check that the box is on and your device is connected to its network, then try again. If you see a certificate warning, use the certificate help below.",

  "shell.adopt.vault_not_empty":
    "This box already holds saved keys for other services, and joining would make them unreadable for good. Nothing was changed. Starting again on this box would set those keys aside or delete them, with the rest of its restaurant files; to keep them, leave this box as it is.",
  "shell.adopt.vault_key_differs":
    "This box's own settings give a WAITRON_CREDENTIALS_KEY setting a value that is not the primary box's, so after joining it could not open its saved keys. Nothing was changed. Remove the WAITRON_CREDENTIALS_KEY settings from this box, or set them to the primary box's, then restart it and join again.",
  "shell.adopt.setting_missing":
    "This box's own settings leave out {variable}, which it needs to start after joining this primary box. Nothing was changed. Set {variable} on this box, then restart it and join again.",
  "shell.adopt.setting_unusable":
    "This box's own {variable} setting has a value it could not start with after joining this primary box. Nothing was changed. Correct {variable} on this box, then restart it and join again.",
  "shell.adopt.unreleased_build":
    "This copy of Waitron is not a released version, so it cannot run for real sales, and this primary box is for real sales. Nothing was changed. Install a released version on this box, then join again.",
  "shell.adopt.environment_mismatch":
    "This box's WAITRON_ENV setting names a different mode from the primary box's: one is for real sales, the other for testing. Nothing was changed. Remove WAITRON_ENV from this box, or set it to the primary box's mode, then restart it and join again.",
  "shell.adopt.generic":
    "This box could not finish joining just now. Check that it is switched on and connected, then try again.",
  "shell.adopt.incomplete":
    "A previous attempt to join this box to a restaurant stopped partway and left it partly set up. It cannot be finished. Choosing Reset this box clears what the stopped join left on this box and restarts setup from the first page. If the main box's Servers page lists this box, choose Remove in its row there, then Clear from list.",

  "shell.reset.generic": "The box could not be reset. Check the connection and try again.",
  "shell.reset.resetting":
    "The box is resetting and will restart. Wait a minute, then reload this page to start setup again. If joining again says the previous join stopped partway, the reset did not run: press Reset this box again.",
  "shell.reset.unavailable":
    "There is no half-finished join to reset on this box. Reload to start setup again.",

  "shell.restore.upload_interrupted":
    "The backup upload did not finish. Connect this device by cable or to the venue’s network, then try again.",
  "shell.restore.archive_resource_limit":
    "The box cannot receive or open this backup within its size and temporary-space limits, or could not measure its free space. Choose a smaller backup or free disk space on this box and try again.",
  "shell.restore.staging_failed":
    "The backup could not be staged. Check the connection and try again. If an earlier restore choice is still saved, it will run when the box starts. Choose another restore to replace it.",
  "shell.restore.staging_failed_code":
    "The backup could not be staged. Check the file, key and environment. ({code}) If an earlier restore choice is still saved, it will run when the box starts. Choose another restore to replace it.",
  "shell.restore.administrator_password_missing":
    "This backup has no active administrator with a password. Choose another backup.",
  "shell.restore.environment_mismatch":
    "The backup comes from the other environment. Choose the environment it came from.",
  "shell.restore.manifest_invalid":
    "The backup manifest is damaged or incomplete. Choose another complete backup.",
  "shell.restore.manifest_unsupported":
    "This backup uses an unsupported format. Install a Waitron version that supports it, then try again.",
  "shell.restore.other_version":
    "This backup file was made by a different version of Waitron. This box's version cannot restore it. Install that version on this box and try again, or choose another file.",

  "shell.bucket.no_answer":
    "The copy could not be restored. Check the connection and try again. If an earlier restore choice is still saved, it will run when the box starts. Choose another restore to replace it.",
  "shell.bucket.refused_code":
    "The copy could not be restored. ({code}) If an earlier restore choice is still saved, it will run when the box starts. Choose another restore to replace it.",
  "shell.bucket.kit_damaged":
    "This recovery kit is incomplete or damaged, perhaps cut short when it was copied. Choose your recovery pack or kit file as it was saved, or paste the whole kit.",
  "shell.bucket.kit_invalid":
    "This is not a Waitron recovery kit. Choose your recovery pack or kit file, or paste the whole kit.",
  "shell.bucket.kit_old_version":
    "This bucket recovery code was made before this version of Waitron and cannot be used. Choose a newer recovery pack, or restore an archive backup.",
  "shell.bucket.unopenable":
    "The latest copy in the bucket could not be opened. It is damaged, or the backup encryption key in this kit does not open it. If the backup encryption key was changed, use the newest recovery pack or kit. Otherwise choose Back, then Restore from backup, to restore from a backup file.",
  "shell.bucket.other_version":
    "The copy in the bucket was made by a different version of Waitron. This box's version cannot restore it. Install that version on this box and try again, or choose another copy.",
  "shell.bucket.pointer_missing": "The bucket in this kit holds no copy of this restaurant.",
  "shell.bucket.pointer_unverified":
    "The copy in the bucket was not written by the box this kit belongs to. Check that the kit is this restaurant's newest. Nothing was changed.",
  "shell.bucket.key_or_access":
    "The recovery pack does not match this copy, or the bucket login cannot read it. Use the pack matching this copy, or correct the bucket access and try again.",
  "shell.bucket.venue_mismatch":
    "This recovery kit belongs to a different bucket copy. Choose the recovery pack or kit made for this copy and try again. Nothing was changed.",
  "shell.bucket.venue_unconfirmed":
    "The copy in the bucket names no business tax id, so it cannot be confirmed or restored.",
  "shell.bucket.pointer_invalid":
    "The bucket's record of its newest copy is damaged, so it cannot be rebuilt from. Nothing was changed.",
  "shell.bucket.integrity_failed":
    "The downloaded copy did not pass its checks. Try again, or choose another backup. Nothing on this box was changed.",
  "shell.bucket.state_missing":
    "The copy in the bucket does not hold the old box's locked settings, so it cannot be rebuilt from.",
  "shell.bucket.identity_unknown":
    "The copy in the bucket does not say which business it belongs to, so it cannot be restored. Nothing on this box was changed.",
  "shell.bucket.restore_failed":
    "The copy could not be downloaded from the bucket. Check this box's internet connection and that the bucket still exists, then try again.",
  "shell.bucket.request_failed":
    "The bucket did not answer, or refused the key in this kit. Check this box's internet connection and that the bucket and its key still exist, then try again.",
  "shell.bucket.disk_full":
    "This box's disk filled while the copy was downloading. Nothing on this box was changed. Free some space and try again.",
  "shell.bucket.environment_mismatch":
    "The copy comes from the other environment. Choose the environment it came from.",
  "shell.bucket.already_provisioning":
    "Setup is already in progress on this box. Wait for it to finish, then reload this page.",
  "shell.bucket.request_invalid":
    "The box rejected the details. Check your entries, then try again.",

  "shell.cloud.other_version":
    "The snapshot was made by a different version of Waitron. This box's version cannot restore it. Install that version on this box and try again, or choose another copy.",
  "shell.cloud.unopenable":
    "This snapshot could not be opened. It is damaged, or the backup encryption key Waitron Cloud holds for it does not open it.",
  "shell.cloud.environment_mismatch":
    "This snapshot is not from a preparation or demo venue, and Cloud recovery restores only those.",
  "shell.cloud.unavailable":
    "Cloud recovery is unavailable. Check the connection or request expiry, then try again.",
  "shell.cloud.restore_unavailable":
    "Cloud recovery is unavailable. Check the connection or request expiry, then try again. If an earlier restore choice is still saved, it will run when the box starts. Choose another restore to replace it.",
  "shell.cloud.request_invalid":
    "The box rejected the details. Check your entries, then try again.",

  "shell.configuration.outdated":
    "This configuration export is from an older format. Export it again from a current box.",
  "shell.configuration.newer":
    "This export comes from a newer version of Waitron. Update the software on this box then load the export again.",
  "shell.configuration.passphrase_invalid":
    "This passphrase does not open the export. Check it and try again.",
  "shell.configuration.could_not_open":
    "The configuration export could not be opened. Check the file and passphrase.",
  "shell.configuration.unreadable":
    "This file is not a configuration export Waitron can read. Export it again from the box you exported from, then load the new export.",
  "shell.configuration.category_name_taken":
    "The export has two categories named “{name}” in the same place. Rename one in the restaurant you exported from, export again, then load the new export.",
  "shell.configuration.product_name_taken":
    "The export has two active products or variants named “{name}”. Rename one in the restaurant you exported from, export again, then load the new export.",
  "shell.configuration.privacy_notice_url_invalid":
    "This export's privacy notice web page is not an address Waitron accepts. On the box you exported from, correct it on the Privacy card in Venue settings, export again, then load the new export.",
  "shell.configuration.privacy_notice_url_too_long":
    "This export's privacy notice web page is longer than Waitron accepts. On the box you exported from, shorten it on the Privacy card in Venue settings, export again, then load the new export.",
  "shell.configuration.privacy_email_invalid":
    "This export's privacy email is not an address Waitron accepts. On the box you exported from, correct it on the Privacy card in Venue settings, export again, then load the new export.",
  "shell.configuration.privacy_email_too_long":
    "This export's privacy email is longer than Waitron accepts. On the box you exported from, shorten it on the Privacy card in Venue settings, export again, then load the new export.",
} as const;

export const shellEs: Record<keyof typeof shellEn, string> = {
  "shell.problem_report.title": "Informar de un problema",
  "shell.problem_report.cancel": "Cancelar",
  "shell.problem_report.description": "¿Qué ha pasado?",
  "shell.problem_report.scope":
    "Guarda solo la actividad de este navegador en un archivo que conservas; no se guarda nada en el servidor ni se envía a ningún sitio.",
  "shell.problem_report.warning":
    "Tu descripción puede identificar a alguien. No incluyas contraseñas, datos de pago ni información personal.",
  "shell.problem_report.preview": "Vista previa del informe",
  "shell.problem_report.invalid": "Revisa la descripción.",
  "shell.problem_report.description_invalid":
    "Usa hasta 2000 caracteres y elimina los caracteres no admitidos.",
  "shell.problem_report.download": "Descargar informe",
  "shell.problem_report.download_failed": "No se ha podido crear la descarga. Inténtalo de nuevo.",

  "shell.first_setup.owner_required":
    "El servidor ya no deja que esta página continúe esta configuración.",
  "shell.first_setup.attempt_conflict":
    "Otro intento de configuración tiene el control de este local.",
  "shell.first_setup.attempt_uncertain":
    "Puede que la configuración de este servidor ya haya usado su serie de facturas, así que el servidor no la repite ni la sustituye.",
  "shell.setup_not_accepted":
    "Este servidor no ha aceptado esta petición desde esta página, así que no ha cambiado nada. Recargar empieza la configuración de nuevo desde su primera pantalla; lo que has escrito en esta página no se guarda.",
  "shell.setup_conflict":
    "Otra configuración de este servidor lo impide, así que el servidor no lo ha hecho. Recargar muestra en qué punto está la configuración de este servidor y qué se puede hacer después.",
  "shell.provisioning.first_setup_held":
    "Este servidor tiene una primera configuración sin terminar, así que no configura nada más mientras esa configuración siga ahí. Recargar muestra esa configuración y lo que se puede hacer con ella.",
  "shell.restore.first_setup_held":
    "Este servidor tiene una primera configuración sin terminar, así que no restaura ninguna copia mientras esa configuración siga ahí. Recargar muestra esa configuración y lo que se puede hacer con ella.",
  "shell.reset.first_setup_held":
    "Este servidor tiene una primera configuración sin terminar, así que no restablece nada mientras esa configuración siga ahí. Recargar muestra esa configuración y lo que se puede hacer con ella.",
  "shell.first_setup.attempt_invalid":
    "Waitron no puede leer o guardar parte de lo que conserva sobre esta configuración, así que este paso no puede seguir. Recarga la página, o pulsa Reconectar donde aparezca, para intentarlo de nuevo. Si el mensaje vuelve a aparecer, pega la dirección de esta página en una pestaña nueva: una pestaña nueva no usa la copia de la configuración que guarda esta pestaña. Donde se ofrezcan, Empezar de nuevo y Recuperar desde una copia preguntan antes de borrar nada.",
  "shell.first_setup.start_again_incomplete":
    "Borrado interrumpido. Recarga la página para continuar.",
  "shell.first_setup.disk_full":
    "El disco del servidor está lleno, así que Waitron no puede guardar nada. Reinicia el servidor: al arrancar, quita registros y avisos de fallo antiguos para hacer sitio. Después, vuelve a intentarlo. Si el disco sigue lleno, Waitron no puede liberar más espacio por sí solo. Si reinstalas Waitron, el servidor empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
  "shell.first_setup.disk_full_restart_unknown":
    "El disco del servidor está lleno, así que Waitron no puede guardar nada. Si reinstalas Waitron, el servidor empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
  "shell.first_setup.series_minute_taken":
    "No se pueden crear las series de facturas: el minuto que eligió esta configuración ya está en los registros de este servidor. Es un fallo de Waitron.",
  "shell.first_setup.configuration_unreadable":
    "El servidor ya no puede leer la exportación de configuración importada antes. Vuelve a exportarla desde el servidor del que la exportaste, configura de nuevo este servidor e importa la nueva exportación.",
  "shell.first_setup.clock_step_unsaved":
    "La hora del servidor se puso desde este dispositivo, pero el servidor no pudo guardar una nota de ese cambio, así que la configuración todavía no puede terminar. Pulsa Reconectar y vuelve a configurar este servidor: el servidor intenta primero guardar la nota.",
  "shell.clock_step_unsaved":
    "La hora del servidor se puso desde este dispositivo, pero el servidor no pudo guardar una nota de ese cambio, así que todavía no puede terminar. Vuelve a intentarlo: el servidor intenta primero guardar la nota.",

  "shell.document_title": "Waitron — configura tu servidor",
  "shell.reload": "Recargar",
  "shell.reload_open_till": "Recargar para abrir la caja",
  "shell.theme.label": "Tema",
  "shell.theme.light": "Claro",
  "shell.theme.dark": "Oscuro",
  "shell.theme.device": "Según el dispositivo",
  "shell.about.title": "Acerca de Waitron",
  "shell.about.close": "Cerrar",

  "shell.connection.already_set_up": "Este servidor ya está configurado. Recarga para abrirlo.",
  "shell.connection.server_problem":
    "Este servidor ha informado de un problema. Inténtalo de nuevo en un momento.",
  "shell.connection.provision_secure":
    "La configuración necesita una conexión segura para mostrarte la clave del servidor. Sigue las instrucciones de arriba antes de continuar.",
  "shell.connection.unreachable":
    "No hemos podido contactar con el servidor. Comprueba que está encendido y tu conexión de red.",

  "shell.not_ready": "El servidor aún no está listo. Espera un momento e inténtalo de nuevo.",
  "shell.operation_conflict":
    "Este servidor tiene guardado un trabajo de configuración que no coincide con esta solicitud, así que no ha hecho esta.",
  "shell.already_provisioning": "La configuración ya está en curso en este servidor.",
  "shell.already_provisioned": "Este servidor ya está configurado.",

  "shell.venue_error.territory_country_mismatch":
    "El país debe coincidir con el territorio fiscal.",
  "shell.venue_error.invalid_locales": "Elige el idioma del recibo.",
  "shell.venue_error.regime_not_implemented": "Ese territorio fiscal aún no está disponible.",
  "shell.venue_error.other":
    "Se han rechazado los datos del local: revísalos y corrígelos. ({code})",

  "shell.review.request_invalid":
    "El servidor ha rechazado los datos. Revisa lo que has introducido y vuelve a configurar.",
  "shell.review.request_invalid_field":
    "El servidor ha rechazado los datos (campo: {field}). Revisa lo que has introducido y vuelve a configurar.",
  "shell.review.email_invalid":
    "El correo del administrador no es válido. Revísalo y vuelve a configurar.",

  "shell.fiscal_test.required": "Haz una prueba fiscal aceptada antes de activar la producción.",
  "shell.fiscal_test.could_not_run":
    "No se ha podido hacer la prueba fiscal. Comprueba la conexión e inténtalo de nuevo.",

  "shell.provision.usb_demo_refused":
    "Demostración no está disponible en este servidor. Recarga para volver a la configuración y elige Prepara tu restaurante, Empezar un restaurante nuevo o Unirse a un restaurante o recuperarlo.",
  "shell.provision.throwaway_refused":
    "Este servidor está marcado para producción, así que no ofrece Demostración ni Prepara tu restaurante. Recarga para elegir otra opción.",

  "shell.provision.failed":
    "La configuración ha fallado. Comprueba que el servidor está encendido y que tu dispositivo está conectado a su red, e inténtalo de nuevo. Si ves un aviso de certificado, usa la ayuda sobre el certificado de abajo.",

  "shell.adopt.vault_not_empty":
    "Este servidor ya guarda claves de otros servicios y, al unirlo, dejarían de poder leerse para siempre. No se ha cambiado nada. Empezar de nuevo en este servidor apartaría o borraría esas claves junto con el resto de sus archivos del restaurante; para conservarlas, deja este servidor como está.",
  "shell.adopt.vault_key_differs":
    "La configuración propia de este servidor da a un ajuste WAITRON_CREDENTIALS_KEY un valor que no es el del servidor principal, así que, tras unirse, no podría abrir sus claves guardadas. No se ha cambiado nada. Quita los ajustes WAITRON_CREDENTIALS_KEY de este servidor o pon los del servidor principal; después reinícialo y vuelve a unirlo.",
  "shell.adopt.setting_missing":
    "La configuración propia de este servidor no incluye {variable}, que necesita para arrancar después de unirse a este servidor principal. No se ha cambiado nada. Pon {variable} en este servidor; después reinícialo y vuelve a unirlo.",
  "shell.adopt.setting_unusable":
    "El ajuste {variable} de este servidor tiene un valor con el que no podría arrancar después de unirse a este servidor principal. No se ha cambiado nada. Corrige {variable} en este servidor; después reinícialo y vuelve a unirlo.",
  "shell.adopt.unreleased_build":
    "Esta copia de Waitron no es una versión publicada, así que no puede funcionar para ventas reales, y este servidor principal es para ventas reales. No se ha cambiado nada. Instala una versión publicada en este servidor y vuelve a unirlo.",
  "shell.adopt.environment_mismatch":
    "El ajuste WAITRON_ENV de este servidor indica un modo distinto del del servidor principal: uno es para ventas reales y el otro para pruebas. No se ha cambiado nada. Quita WAITRON_ENV de este servidor o ponle el modo del servidor principal; después reinícialo y vuelve a unirlo.",
  "shell.adopt.generic":
    "Este servidor no ha podido terminar la unión ahora. Comprueba que está encendido y conectado, e inténtalo de nuevo.",
  "shell.adopt.incomplete":
    "Un intento anterior de unir este servidor a un restaurante se detuvo a medias y lo dejó configurado a medias. No se puede terminar. Elegir Restablecer este servidor elimina lo que la unión detenida dejó en este servidor y vuelve a empezar la configuración desde la primera página. Si la página Servidores del servidor principal muestra este servidor, elige Retirar en su fila y después Quitar de la lista.",

  "shell.reset.generic":
    "No se ha podido restablecer el servidor. Comprueba la conexión e inténtalo de nuevo.",
  "shell.reset.resetting":
    "El servidor se está restableciendo y se reiniciará. Espera un minuto y recarga esta página para volver a empezar la configuración. Si al unirlo de nuevo se indica que la unión anterior se detuvo a medias, el restablecimiento no se ha hecho: vuelve a pulsar Restablecer este servidor.",
  "shell.reset.unavailable":
    "No hay ninguna unión a medias que restablecer en este servidor. Recarga para volver a empezar la configuración.",

  "shell.restore.upload_interrupted":
    "La carga de la copia de seguridad no ha terminado. Conecta este dispositivo por cable o a la red del local y vuelve a intentarlo.",
  "shell.restore.archive_resource_limit":
    "El servidor no puede recibir o abrir esta copia dentro de sus límites de tamaño y espacio temporal, o no ha podido medir el espacio libre. Elige una copia más pequeña o libera espacio en el disco de este servidor y vuelve a intentarlo.",
  "shell.restore.staging_failed":
    "No se ha podido preparar la copia de seguridad. Comprueba la conexión e inténtalo de nuevo. Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.",
  "shell.restore.staging_failed_code":
    "No se ha podido preparar la copia de seguridad. Revisa el archivo, la clave y el entorno. ({code}) Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.",
  "shell.restore.administrator_password_missing":
    "Esta copia no tiene ningún administrador activo con contraseña. Elige otra copia de seguridad.",
  "shell.restore.environment_mismatch":
    "La copia viene del otro entorno. Elige el entorno del que viene.",
  "shell.restore.manifest_invalid":
    "El manifiesto de la copia está dañado o incompleto. Elige otra copia completa.",
  "shell.restore.manifest_unsupported":
    "Esta copia usa un formato no compatible. Instala una versión de Waitron que lo admita y vuelve a intentarlo.",
  "shell.restore.other_version":
    "Este archivo de copia de seguridad se hizo con otra versión de Waitron. La versión de este servidor no puede restaurarlo. Instala en este servidor la versión con la que se hizo y vuelve a intentarlo, o elige otro archivo.",

  "shell.bucket.no_answer":
    "No se ha podido restaurar la copia. Comprueba la conexión e inténtalo de nuevo. Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.",
  "shell.bucket.refused_code":
    "No se ha podido restaurar la copia. ({code}) Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.",
  "shell.bucket.kit_damaged":
    "Este kit de recuperación está incompleto o dañado; quizá se cortó al copiarlo. Elige tu paquete de recuperación o el archivo del kit tal como se guardó, o pega el kit completo.",
  "shell.bucket.kit_invalid":
    "Esto no es un kit de recuperación de Waitron. Elige tu paquete de recuperación o el archivo del kit, o pega el kit completo.",
  "shell.bucket.kit_old_version":
    "Este código de recuperación del bucket se hizo antes de esta versión de Waitron y no se puede usar. Elige un paquete de recuperación más reciente o restaura una copia de seguridad de archivo.",
  "shell.bucket.unopenable":
    "No se ha podido abrir la copia más reciente del bucket. Está dañada, o la clave de cifrado de copias de este kit no la abre. Si se cambió la clave de cifrado de copias, usa el último paquete de recuperación o el último kit. Si no, elige Volver y después Restaurar desde una copia de seguridad para restaurar desde un archivo de copia de seguridad.",
  "shell.bucket.other_version":
    "La copia del bucket se hizo con otra versión de Waitron. La versión de este servidor no puede restaurarla. Instala en este servidor la versión con la que se hizo y vuelve a intentarlo, o elige otra copia.",
  "shell.bucket.pointer_missing":
    "El bucket de este kit no guarda ninguna copia de este restaurante.",
  "shell.bucket.pointer_unverified":
    "La copia del bucket no la escribió el servidor al que pertenece este kit. Comprueba que el kit es el más reciente de este restaurante. No se ha cambiado nada.",
  "shell.bucket.key_or_access":
    "El paquete de recuperación no corresponde a esta copia, o el acceso al bucket no permite leerla. Usa el paquete que corresponda a esta copia, o corrige el acceso al bucket y vuelve a intentarlo.",
  "shell.bucket.venue_mismatch":
    "Este kit de recuperación corresponde a otra copia del bucket. Elige el paquete o kit de recuperación creado para esta copia y vuelve a intentarlo. No se ha cambiado nada.",
  "shell.bucket.venue_unconfirmed":
    "La copia del bucket no indica ningún NIF del negocio, así que no se puede confirmar ni restaurar.",
  "shell.bucket.pointer_invalid":
    "El registro del bucket de su copia más reciente está dañado, así que no se puede reconstruir a partir de él. No se ha cambiado nada.",
  "shell.bucket.integrity_failed":
    "La copia descargada no ha superado las comprobaciones. Inténtalo de nuevo o elige otra copia de seguridad. No se ha cambiado nada en este servidor.",
  "shell.bucket.state_missing":
    "La copia del bucket no guarda los ajustes cifrados del servidor anterior, así que no se puede reconstruir a partir de ella.",
  "shell.bucket.identity_unknown":
    "La copia del bucket no indica a qué negocio pertenece, así que no se puede restaurar. No se ha cambiado nada en este servidor.",
  "shell.bucket.restore_failed":
    "No se ha podido descargar la copia del bucket. Comprueba la conexión a internet de este servidor y que el bucket sigue existiendo, e inténtalo de nuevo.",
  "shell.bucket.request_failed":
    "El bucket no ha respondido o ha rechazado la clave de este kit. Comprueba la conexión a internet de este servidor y que el bucket y su clave siguen existiendo, e inténtalo de nuevo.",
  "shell.bucket.disk_full":
    "El disco de este servidor se ha llenado mientras se descargaba la copia. No se ha cambiado nada en este servidor. Libera espacio e inténtalo de nuevo.",
  "shell.bucket.environment_mismatch":
    "La copia viene del otro entorno. Elige el entorno del que viene.",
  "shell.bucket.already_provisioning":
    "La configuración ya está en curso en este servidor. Espera a que termine y recarga esta página.",
  "shell.bucket.request_invalid":
    "El servidor ha rechazado los datos. Revisa lo que has introducido e inténtalo de nuevo.",

  "shell.cloud.other_version":
    "La instantánea se hizo con otra versión de Waitron. La versión de este servidor no puede restaurarla. Instala en este servidor la versión con la que se hizo y vuelve a intentarlo, o elige otra copia.",
  "shell.cloud.unopenable":
    "No se ha podido abrir esta instantánea. Está dañada, o la clave de cifrado de copias que Waitron Cloud guarda para ella no la abre.",
  "shell.cloud.environment_mismatch":
    "Esta instantánea no es de un local de preparación o de demostración, y la recuperación desde Cloud solo restaura esos.",
  "shell.cloud.unavailable":
    "La recuperación desde Cloud no está disponible. Comprueba la conexión o si la solicitud ha caducado, e inténtalo de nuevo.",
  "shell.cloud.restore_unavailable":
    "La recuperación desde Cloud no está disponible. Comprueba la conexión o si la solicitud ha caducado, e inténtalo de nuevo. Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.",
  "shell.cloud.request_invalid":
    "El servidor ha rechazado los datos. Revisa lo que has introducido e inténtalo de nuevo.",

  "shell.configuration.outdated":
    "Esta exportación de configuración usa un formato anterior. Vuelve a exportarla desde un servidor actualizado.",
  "shell.configuration.newer":
    "Esta exportación viene de una versión más reciente de Waitron. Actualiza el software de este servidor y vuelve a cargar la exportación.",
  "shell.configuration.passphrase_invalid":
    "Esta frase de contraseña no abre la exportación. Revísala e inténtalo de nuevo.",
  "shell.configuration.could_not_open":
    "No se ha podido abrir la exportación de configuración. Revisa el archivo y la contraseña de exportación.",
  "shell.configuration.unreadable":
    "Este archivo no es una exportación de configuración que Waitron pueda leer. Vuelve a exportarla desde el servidor del que la exportaste y carga la nueva exportación.",
  "shell.configuration.category_name_taken":
    "La exportación tiene dos categorías llamadas «{name}» en el mismo lugar. Cambia el nombre de una en el restaurante de origen, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.product_name_taken":
    "La exportación tiene dos productos o variantes activos llamados «{name}». Cambia el nombre de uno en el restaurante de origen, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.privacy_notice_url_invalid":
    "La página web del aviso de privacidad de esta exportación no es una dirección que Waitron acepte. En el servidor del que exportaste, corrígela en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.privacy_notice_url_too_long":
    "La página web del aviso de privacidad de esta exportación es más larga de lo que Waitron acepta. En el servidor del que exportaste, acórtala en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.privacy_email_invalid":
    "El correo de privacidad de esta exportación no es una dirección que Waitron acepte. En el servidor del que exportaste, corrígelo en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.privacy_email_too_long":
    "El correo de privacidad de esta exportación es más largo de lo que Waitron acepta. En el servidor del que exportaste, acórtalo en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación.",
};
