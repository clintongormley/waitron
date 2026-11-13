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
    "This server did not accept this request from this page, so nothing changed. Reload starts setup again from its first screen; what you typed on this page is not kept.",
  "shell.setup_conflict":
    "Another setup on this server is in the way, so the server did not do this. Reload shows where setup on this server stands and what can be done next.",
  "shell.provisioning.first_setup_held":
    "This server holds an unfinished first setup, so it sets nothing else up while that setup is there. Reload shows that setup and what can be done with it.",
  "shell.restore.first_setup_held":
    "This server holds an unfinished first setup, so it restores no copy while that setup is there. Reload shows that setup and what can be done with it.",
  "shell.reset.first_setup_held":
    "This server holds an unfinished first setup, so it resets nothing while that setup is there. Reload shows that setup and what can be done with it.",
  "shell.first_setup.attempt_invalid": "The saved setup cannot be read. Contact support.",
  "shell.first_setup.start_again_incomplete": "Deletion interrupted. Reload the page to continue.",
  "shell.first_setup.disk_full":
    "The box's disk is full, so Waitron cannot save anything. Restart the box: as it starts, it removes old logs and crash reports to make room. Then try again. If the disk is still full, Waitron cannot free more space by itself. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
  "shell.first_setup.disk_full_restart_unknown":
    "The box's disk is full, so Waitron cannot save anything. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
  "shell.first_setup.series_minute_taken":
    "The invoice series cannot be created: the minute this setup chose is already in this box's records. This is a fault in Waitron.",
  "shell.first_setup.clock_step_unsaved":
    "The server's time was set from this device, but the server could not save a note of that change, so setup cannot finish yet. Reconnect, then provision this server again: the server tries to save the note first.",
  "shell.clock_step_unsaved":
    "The server's time was set from this device, but the server could not save a note of that change, so it cannot finish yet. Try again: the server tries to save the note first.",

  "shell.document_title": "Waitron — set up your server",
  "shell.reload": "Reload",
  "shell.reload_open_till": "Reload to open the till",
  "shell.theme.label": "Theme",
  "shell.theme.light": "Light",
  "shell.theme.dark": "Dark",
  "shell.theme.device": "Follow device",
  "shell.about.title": "About Waitron",
  "shell.about.close": "Close",

  "shell.connection.already_set_up": "This server is already set up. Reload to open it.",
  "shell.connection.server_problem": "This server reported a problem. Try again in a moment.",
  "shell.connection.unreachable":
    "We could not reach the server. Check its power and your network connection.",

  "shell.not_ready": "The server isn't ready yet. Wait a moment, then try again.",
  "shell.operation_conflict":
    "This server holds saved setup work that does not match this request, so it did not do this one.",
  "shell.already_stamped":
    "A previous setup attempt left this server partly set up, for a different environment. Contact support to reset this server, then start setup again.",
  "shell.already_provisioning": "Setup is already in progress on this server.",
  "shell.already_provisioned": "This server is already set up.",

  "shell.venue_error.territory_country_mismatch": "The country must match the fiscal territory.",
  "shell.venue_error.invalid_locales": "Choose the receipt language.",
  "shell.venue_error.duplicate_series_code":
    "The series code and rectificative series code must differ.",
  "shell.venue_error.regime_not_implemented": "That fiscal territory isn't supported yet.",
  "shell.venue_error.other":
    "The venue details were rejected — please review and correct them. ({code})",

  "shell.review.request_invalid":
    "The server rejected the details. Check your entries, then provision again.",
  "shell.review.request_invalid_field":
    "The server rejected the details (field: {field}). Check your entries, then provision again.",
  "shell.review.email_invalid":
    "The admin email address is invalid. Check it, then provision again.",

  "shell.fiscal_test.required": "Run an accepted fiscal test before activating production.",
  "shell.fiscal_test.could_not_run":
    "The fiscal test could not run. Check the connection and try again.",

  "shell.provision.usb_demo_refused":
    "Demo is unavailable on this box. Reload to return to setup, then choose Prepare your restaurant, Live or Join or recover.",
  "shell.provision.throwaway_refused":
    "This server is stamped for production, so it does not offer Demo or Prepare your restaurant. Reload to choose another option.",

  "shell.provision.failed":
    "Provisioning failed. Check that the server is on and your device is connected to its network, then try again. If you see a certificate warning, use the certificate help below.",

  "shell.adopt.bundle_fetch_failed":
    "The primary couldn't supply a mirror setup. Enter a new authenticator code if you use one, and press Connect to try again, or choose Back to restore a backup instead.",
  "shell.adopt.request_invalid":
    "The server rejected the details. Check the address and login, then try again.",
  "shell.adopt.vault_not_empty":
    "This server already holds saved keys for other services, and joining would make them unreadable for good. Nothing was changed. Starting again on this server would set those keys aside or delete them, with the rest of its restaurant files; to keep them, leave this server as it is.",
  "shell.adopt.primary_unconfirmed":
    "The primary server's certificate wasn't compared, so nothing was sent. This is a fault in Waitron. Check the address and compare the certificate again.",
  "shell.adopt.login_failed":
    "The login failed. Check the admin person ID, password and authenticator code, then try again.",
  "shell.adopt.generic":
    "Couldn't connect to the primary. Check the address and login, then try again.",
  "shell.adopt.bucket_stream_active":
    "The primary server copies the restaurant's data to its own storage bucket, and it can copy to only one place at a time. This version of Waitron cannot yet pass that copy on from this server to the bucket, so joining now would end the restaurant's offsite copy. Nothing was changed on either server. To join anyway, turn off the bucket copy in the primary's dashboard under Backups — the restaurant then has no offsite copy — enter a new authenticator code if you use one, and press Connect again. To keep the bucket copy, press Back: nothing changes, and this server can join later.",
  "shell.adopt.standby_name_taken":
    "This server picked a name another server of the restaurant already uses. Nothing was changed on either server. Enter a new authenticator code if you use one, and press Connect again: it picks a new name.",
  "shell.adopt.standby_series_unsupported":
    "The restaurant files its invoices with Veri*Factu, and this version of Waitron cannot yet add a standby server to a restaurant that does. Nothing was changed on either server, and the primary keeps working as before. Choose Back to set this server up another way, or leave it switched off and join it after an update that adds this.",
  "shell.adopt.spare_already_joined":
    "The primary server already has a standby server receiving its data, and this version of Waitron keeps one standby per restaurant. A standby receiving its data cannot be removed in this version. Nothing was changed on either server. Choose Back to restore another restaurant onto this server or, from there, Back again to set up a new restaurant. You can also leave it switched off.",
  "shell.adopt.recovery_key_missing":
    "The primary server has no backup key yet. Nothing was changed. Open Backups on the primary server and choose Turn on backups. Then enter a new authenticator code if you use one, and press Connect again.",
  "shell.adopt.clocks_apart":
    "This server's clock and the primary server's are 10 minutes or more apart: this server reads {standbyAt}, the primary reads {primaryAt}. The two servers can work together only while their clocks agree. Nothing was changed on either server. If this server's time is wrong, connect it to the internet for a minute so it sets its clock, then enter a new authenticator code if you use one, and press Connect again.",
  "shell.adopt.incomplete":
    "A previous attempt to join this server to a restaurant stopped partway and left it partly set up. It cannot be finished. You can reset this server with the admin person ID and password you used to connect it, then start setup again.",

  "shell.reset.request_invalid":
    "The server rejected the details. Check the admin person ID and password, then try again.",
  "shell.reset.generic": "The server could not be reset. Check the connection and try again.",
  "shell.reset.resetting":
    "The server is resetting and will restart. Wait a minute, then reload this page to start setup again. If joining again says the previous join stopped partway, the reset did not run: press Reset this server again.",
  "shell.reset.unavailable":
    "There is no half-finished join to reset on this server. Reload to start setup again.",
  "shell.throttle": "Too many attempts. Wait a few minutes, then try again.",
  "shell.throttle_wait": "Too many attempts. Wait {seconds} seconds, then try again.",
  "shell.throttle_wait_one": "Too many attempts. Wait 1 second, then try again.",

  "shell.restore.staging_failed":
    "The backup could not be staged. Check the connection and try again. If an earlier restore choice is still saved, it will run when the server starts. Choose another restore to replace it.",
  "shell.restore.staging_failed_code":
    "The backup could not be staged. Check the file, key and environment. ({code}) If an earlier restore choice is still saved, it will run when the server starts. Choose another restore to replace it.",
  "shell.restore.administrator_password_missing":
    "This backup has no active administrator with a password. Choose another backup.",
  "shell.restore.environment_mismatch":
    "The backup comes from the other environment. Choose the environment it came from.",
  "shell.restore.other_version":
    "This backup file was made by a different version of Waitron. This server's version cannot restore it. Install that version on this server and try again, or choose another file.",

  "shell.bucket.no_answer":
    "The copy could not be restored. Check the connection and try again. If an earlier restore choice is still saved, it will run when the server starts. Choose another restore to replace it.",
  "shell.bucket.refused_code":
    "The copy could not be restored. ({code}) If an earlier restore choice is still saved, it will run when the server starts. Choose another restore to replace it.",
  "shell.bucket.kit_damaged":
    "This recovery kit is incomplete or damaged, perhaps cut short when it was copied. Choose your recovery pack or kit file as it was saved, or paste the whole kit.",
  "shell.bucket.kit_invalid":
    "This is not a Waitron recovery kit. Choose your recovery pack or kit file, or paste the whole kit.",
  "shell.bucket.key_does_not_open":
    "The recovery key in this kit does not open the latest copy. If the recovery key was changed, use the newest recovery pack or kit.",
  "shell.bucket.other_version":
    "The copy in the bucket was made by a different version of Waitron. This server's version cannot restore it. Install that version on this server and try again, or choose another copy.",
  "shell.bucket.pointer_missing": "The bucket in this kit holds no copy of this restaurant.",
  "shell.bucket.pointer_unverified":
    "The copy in the bucket was not written by the server this kit belongs to. Check that the kit is this restaurant's newest. Nothing was changed.",
  "shell.bucket.key_or_access":
    "The recovery pack does not match this copy, or the bucket login cannot read it. Use the pack matching this copy, or correct the bucket access and try again.",
  "shell.bucket.venue_mismatch":
    "The bucket's record of its newest copy names a different restaurant from this kit. Nothing was changed.",
  "shell.bucket.venue_unconfirmed":
    "The copy in the bucket names no business tax id, so it cannot be confirmed or restored.",
  "shell.bucket.pointer_invalid":
    "The bucket's record of its newest copy is damaged, so it cannot be rebuilt from. Nothing was changed.",
  "shell.bucket.integrity_failed":
    "The copy read from the bucket is damaged. Nothing on this server was changed.",
  "shell.bucket.state_missing":
    "The copy in the bucket does not hold the old server's locked settings, so it cannot be rebuilt from.",
  "shell.bucket.identity_unknown":
    "The copy in the bucket does not say which business it belongs to, so it cannot be restored. Nothing on this server was changed.",
  "shell.bucket.restore_failed":
    "The copy could not be downloaded from the bucket. Check this server's internet connection and that the bucket still exists, then try again.",
  "shell.bucket.request_failed":
    "The bucket did not answer, or refused the key in this kit. Check this server's internet connection and that the bucket and its key still exist, then try again.",
  "shell.bucket.disk_full":
    "This server's disk filled while the copy was downloading. Nothing on this server was changed. Free some space and try again.",
  "shell.bucket.environment_mismatch":
    "The copy comes from the other environment. Choose the environment it came from.",
  "shell.bucket.already_provisioning":
    "Setup is already in progress on this server. Wait for it to finish, then reload this page.",
  "shell.bucket.request_invalid":
    "The server rejected the details. Check your entries, then try again.",

  "shell.cloud.other_version":
    "The snapshot was made by a different version of Waitron. This server's version cannot restore it. Install that version on this server and try again, or choose another copy.",
  "shell.cloud.unopenable":
    "This snapshot could not be opened. It is damaged, or the recovery key Waitron Cloud holds for it does not open it.",
  "shell.cloud.environment_mismatch":
    "This snapshot is not from a preparation or demo venue, and Cloud recovery restores only those.",
  "shell.cloud.unavailable":
    "Cloud recovery is unavailable. Check the connection or request expiry, then try again.",
  "shell.cloud.restore_unavailable":
    "Cloud recovery is unavailable. Check the connection or request expiry, then try again. If an earlier restore choice is still saved, it will run when the server starts. Choose another restore to replace it.",
  "shell.cloud.request_invalid":
    "The server rejected the details. Check your entries, then try again.",

  "shell.configuration.outdated":
    "This configuration export is from an older format. Export it again from a current box.",
  "shell.configuration.newer":
    "This export comes from a newer version of Waitron. Update the software on this server then load the export again.",
  "shell.configuration.passphrase_invalid":
    "This passphrase does not open the export. Check it and try again.",
  "shell.configuration.could_not_open":
    "The configuration export could not be opened. Check the file and passphrase.",
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
    "No se puede leer la configuración guardada. Contacta con soporte.",
  "shell.first_setup.start_again_incomplete":
    "Borrado interrumpido. Recarga la página para continuar.",
  "shell.first_setup.disk_full":
    "El disco del equipo está lleno, así que Waitron no puede guardar nada. Reinicia el equipo: al arrancar, quita registros y avisos de fallo antiguos para hacer sitio. Después, vuelve a intentarlo. Si el disco sigue lleno, Waitron no puede liberar más espacio por sí solo. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
  "shell.first_setup.disk_full_restart_unknown":
    "El disco del equipo está lleno, así que Waitron no puede guardar nada. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
  "shell.first_setup.series_minute_taken":
    "No se pueden crear las series de facturas: el minuto que eligió esta configuración ya está en los registros de este servidor. Es un fallo de Waitron.",
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
  "shell.connection.unreachable":
    "No hemos podido contactar con el servidor. Comprueba que está encendido y tu conexión de red.",

  "shell.not_ready": "El servidor aún no está listo. Espera un momento e inténtalo de nuevo.",
  "shell.operation_conflict":
    "Este servidor tiene guardado un trabajo de configuración que no coincide con esta solicitud, así que no ha hecho esta.",
  "shell.already_stamped":
    "Un intento anterior de configuración dejó este servidor configurado a medias, para otro entorno. Contacta con soporte para restablecer este servidor y vuelve a empezar la configuración.",
  "shell.already_provisioning": "La configuración ya está en curso en este servidor.",
  "shell.already_provisioned": "Este servidor ya está configurado.",

  "shell.venue_error.territory_country_mismatch":
    "El país debe coincidir con el territorio fiscal.",
  "shell.venue_error.invalid_locales": "Elige el idioma del recibo.",
  "shell.venue_error.duplicate_series_code":
    "El código de serie y el de la serie rectificativa deben ser distintos.",
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
    "Demostración no está disponible en este servidor. Recarga para volver a la configuración y elige Prepara tu restaurante, En vivo o Unirse o recuperar.",
  "shell.provision.throwaway_refused":
    "Este servidor está marcado para producción, así que no ofrece Demostración ni Prepara tu restaurante. Recarga para elegir otra opción.",

  "shell.provision.failed":
    "La configuración ha fallado. Comprueba que el servidor está encendido y que tu dispositivo está conectado a su red, e inténtalo de nuevo. Si ves un aviso de certificado, usa la ayuda sobre el certificado de abajo.",

  "shell.adopt.bundle_fetch_failed":
    "El servidor principal no ha podido proporcionar la configuración de una réplica. Introduce un nuevo código del autenticador si usas uno y pulsa Conectar para volver a intentarlo, o elige Volver para restaurar una copia de seguridad.",
  "shell.adopt.request_invalid":
    "El servidor ha rechazado los datos. Revisa la dirección y el inicio de sesión, e inténtalo de nuevo.",
  "shell.adopt.vault_not_empty":
    "Este servidor ya guarda claves de otros servicios y, al unirlo, dejarían de poder leerse para siempre. No se ha cambiado nada. Empezar de nuevo en este servidor apartaría o borraría esas claves junto con el resto de sus archivos del restaurante; para conservarlas, deja este servidor como está.",
  "shell.adopt.primary_unconfirmed":
    "No se ha comparado el certificado del servidor principal, así que no se ha enviado nada. Es un fallo de Waitron. Revisa la dirección y vuelve a comparar el certificado.",
  "shell.adopt.login_failed":
    "No se ha podido iniciar sesión. Revisa el ID de persona, la contraseña y el código del autenticador del administrador, e inténtalo de nuevo.",
  "shell.adopt.generic":
    "No se ha podido conectar con el servidor principal. Revisa la dirección y el inicio de sesión, e inténtalo de nuevo.",
  "shell.adopt.bucket_stream_active":
    "El servidor principal copia los datos del restaurante en su propio bucket de almacenamiento, y solo puede copiar en un sitio a la vez. Esta versión de Waitron aún no puede pasar esa copia desde este servidor al bucket, así que unirlo ahora acabaría con la copia externa del restaurante. No se ha cambiado nada en ninguno de los dos servidores. Para unirlo de todos modos, desactiva la copia al bucket en el panel del servidor principal, en Copias de seguridad —el restaurante se queda entonces sin copia externa—, introduce un nuevo código del autenticador si usas uno y vuelve a pulsar Conectar. Para conservar la copia al bucket, pulsa Volver: no cambia nada, y este servidor puede unirse más adelante.",
  "shell.adopt.standby_name_taken":
    "Este servidor eligió un nombre que ya usa otro servidor del restaurante. No se ha cambiado nada en ninguno de los dos servidores. Introduce un nuevo código del autenticador si usas uno y vuelve a pulsar Conectar: elegirá un nombre nuevo.",
  "shell.adopt.standby_series_unsupported":
    "El restaurante presenta sus facturas con Veri*Factu, y esta versión de Waitron aún no puede añadir un servidor en espera a un restaurante que lo hace. No se ha cambiado nada en ninguno de los dos servidores, y el principal sigue funcionando como antes. Elige Volver para configurar este servidor de otra forma, o déjalo apagado y únelo después de una actualización que lo permita.",
  "shell.adopt.spare_already_joined":
    "El servidor principal ya tiene un servidor en espera que recibe sus datos, y esta versión de Waitron admite un solo servidor en espera por restaurante. Un servidor en espera que recibe sus datos no se puede retirar en esta versión. No se ha cambiado nada en ninguno de los dos servidores. Elige Volver para restaurar otro restaurante en este servidor o, desde ahí, Volver otra vez para configurar un restaurante nuevo. También puedes dejarlo apagado.",
  "shell.adopt.recovery_key_missing":
    "El servidor principal aún no tiene clave de copia de seguridad. No se ha cambiado nada. Abre Copias de seguridad en el servidor principal y elige «Activar las copias». Después introduce un nuevo código del autenticador si usas uno y vuelve a pulsar Conectar.",
  "shell.adopt.clocks_apart":
    "El reloj de este servidor y el del servidor principal se diferencian en 10 minutos o más: este servidor marca {standbyAt} y el principal marca {primaryAt}. Los dos servidores solo pueden trabajar juntos mientras sus relojes coinciden. No se ha cambiado nada en ninguno de los dos servidores. Si la hora de este servidor está mal, conéctalo a internet un minuto para que ajuste su reloj, introduce un nuevo código del autenticador si usas uno y vuelve a pulsar Conectar.",
  "shell.adopt.incomplete":
    "Un intento anterior de unir este servidor a un restaurante se detuvo a medias y lo dejó configurado a medias. No se puede terminar. Puedes restablecer este servidor con el ID de persona y la contraseña del administrador que usaste para conectarlo, y volver a empezar la configuración.",

  "shell.reset.request_invalid":
    "El servidor ha rechazado los datos. Revisa el ID de persona y la contraseña del administrador, e inténtalo de nuevo.",
  "shell.reset.generic":
    "No se ha podido restablecer el servidor. Comprueba la conexión e inténtalo de nuevo.",
  "shell.reset.resetting":
    "El servidor se está restableciendo y se reiniciará. Espera un minuto y recarga esta página para volver a empezar la configuración. Si al unirlo de nuevo se indica que la unión anterior se detuvo a medias, el restablecimiento no se ha hecho: vuelve a pulsar Restablecer este servidor.",
  "shell.reset.unavailable":
    "No hay ninguna unión a medias que restablecer en este servidor. Recarga para volver a empezar la configuración.",
  "shell.throttle": "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  "shell.throttle_wait": "Demasiados intentos. Espera {seconds} segundos y vuelve a intentarlo.",
  "shell.throttle_wait_one": "Demasiados intentos. Espera 1 segundo y vuelve a intentarlo.",

  "shell.restore.staging_failed":
    "No se ha podido preparar la copia de seguridad. Comprueba la conexión e inténtalo de nuevo. Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.",
  "shell.restore.staging_failed_code":
    "No se ha podido preparar la copia de seguridad. Revisa el archivo, la clave y el entorno. ({code}) Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.",
  "shell.restore.administrator_password_missing":
    "Esta copia no tiene ningún administrador activo con contraseña. Elige otra copia de seguridad.",
  "shell.restore.environment_mismatch":
    "La copia viene del otro entorno. Elige el entorno del que viene.",
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
  "shell.bucket.key_does_not_open":
    "La clave de recuperación de este kit no abre la copia más reciente. Si se cambió la clave de recuperación, usa el último paquete de recuperación o el último kit.",
  "shell.bucket.other_version":
    "La copia del bucket se hizo con otra versión de Waitron. La versión de este servidor no puede restaurarla. Instala en este servidor la versión con la que se hizo y vuelve a intentarlo, o elige otra copia.",
  "shell.bucket.pointer_missing":
    "El bucket de este kit no guarda ninguna copia de este restaurante.",
  "shell.bucket.pointer_unverified":
    "La copia del bucket no la escribió el servidor al que pertenece este kit. Comprueba que el kit es el más reciente de este restaurante. No se ha cambiado nada.",
  "shell.bucket.key_or_access":
    "El paquete de recuperación no corresponde a esta copia, o el acceso al bucket no permite leerla. Usa el paquete que corresponda a esta copia, o corrige el acceso al bucket y vuelve a intentarlo.",
  "shell.bucket.venue_mismatch":
    "El registro del bucket de su copia más reciente nombra un restaurante distinto al de este kit. No se ha cambiado nada.",
  "shell.bucket.venue_unconfirmed":
    "La copia del bucket no indica ningún NIF del negocio, así que no se puede confirmar ni restaurar.",
  "shell.bucket.pointer_invalid":
    "El registro del bucket de su copia más reciente está dañado, así que no se puede reconstruir a partir de él. No se ha cambiado nada.",
  "shell.bucket.integrity_failed":
    "La copia leída del bucket está dañada. No se ha cambiado nada en este servidor.",
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
    "No se ha podido abrir esta instantánea. Está dañada, o la clave de recuperación que Waitron Cloud guarda para ella no la abre.",
  "shell.cloud.environment_mismatch":
    "Esta instantánea no es de un local de preparación o de demostración, y la recuperación desde Cloud solo restaura esos.",
  "shell.cloud.unavailable":
    "La recuperación desde Cloud no está disponible. Comprueba la conexión o si la solicitud ha caducado, e inténtalo de nuevo.",
  "shell.cloud.restore_unavailable":
    "La recuperación desde Cloud no está disponible. Comprueba la conexión o si la solicitud ha caducado, e inténtalo de nuevo. Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.",
  "shell.cloud.request_invalid":
    "El servidor ha rechazado los datos. Revisa lo que has introducido e inténtalo de nuevo.",

  "shell.configuration.outdated":
    "Esta exportación de configuración usa un formato anterior. Vuelve a exportarla desde un equipo actualizado.",
  "shell.configuration.newer":
    "Esta exportación viene de una versión más reciente de Waitron. Actualiza el software de este servidor y vuelve a cargar la exportación.",
  "shell.configuration.passphrase_invalid":
    "Esta frase de contraseña no abre la exportación. Revísala e inténtalo de nuevo.",
  "shell.configuration.could_not_open":
    "No se ha podido abrir la exportación de configuración. Revisa el archivo y la contraseña de exportación.",
  "shell.configuration.category_name_taken":
    "La exportación tiene dos categorías llamadas «{name}» en el mismo lugar. Cambia el nombre de una en el restaurante de origen, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.product_name_taken":
    "La exportación tiene dos productos o variantes activos llamados «{name}». Cambia el nombre de uno en el restaurante de origen, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.privacy_notice_url_invalid":
    "La página web del aviso de privacidad de esta exportación no es una dirección que Waitron acepte. En el equipo del que exportaste, corrígela en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.privacy_notice_url_too_long":
    "La página web del aviso de privacidad de esta exportación es más larga de lo que Waitron acepta. En el equipo del que exportaste, acórtala en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.privacy_email_invalid":
    "El correo de privacidad de esta exportación no es una dirección que Waitron acepte. En el equipo del que exportaste, corrígelo en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación.",
  "shell.configuration.privacy_email_too_long":
    "El correo de privacidad de esta exportación es más largo de lo que Waitron acepta. En el equipo del que exportaste, acórtalo en la tarjeta Privacidad de Ajustes del local, vuelve a exportar y carga la nueva exportación.",
};
