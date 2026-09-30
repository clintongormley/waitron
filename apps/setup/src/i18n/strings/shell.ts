// setup-app.ts's own text: the page title and every refusal and outcome the shell hands a screen.

export const shellEn = {
  "shell.document_title": "Waitron — set up your server",
  "shell.reload": "Reload",
  "shell.reload_open_till": "Reload to open the till",

  "shell.connection.already_set_up": "This server is already set up. Reload to open it.",
  "shell.connection.server_problem": "This server reported a problem. Try again in a moment.",
  "shell.connection.unreachable":
    "We could not reach the server. Check its power and your network connection.",

  "shell.not_ready": "The server isn't ready yet. Wait a moment, then try again.",
  "shell.operation_conflict":
    "This server has saved setup work for a different request. Resume the original setup or contact support.",
  "shell.already_stamped":
    "A previous setup attempt left this server partly set up, for a different environment. Contact support to reset this server, then start setup again.",
  "shell.already_provisioning": "Setup is already in progress on this server.",
  "shell.already_provisioned": "This server is already set up.",

  "shell.venue_error.territory_country_mismatch": "The country must match the fiscal territory.",
  "shell.venue_error.invalid_locales": "Choose 1 or 2 invoice locales.",
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

  "shell.provision.failed":
    "Provisioning failed. Check that the server is on and your device is connected to its network, then try again. If you see a certificate warning, use the certificate help below.",

  "shell.adopt.bundle_fetch_failed":
    "Couldn't join the primary server: it couldn't be reached, it refused the request, or its reply couldn't be used. Check that the address is your restaurant's primary Waitron server, then try again.",
  "shell.adopt.request_invalid":
    "The server rejected the details. Check the address and login, then try again.",
  "shell.adopt.login_failed":
    "The login failed. Check the admin person ID, password and authenticator code, then try again.",
  "shell.adopt.generic":
    "Couldn't connect to the primary. Check the address and login, then try again.",
  "shell.adopt.incomplete":
    "A previous attempt to join this server to a restaurant stopped partway and left it partly set up. It cannot be finished. You can reset this server with the admin person ID and password you used to connect it, then start setup again.",

  "shell.reset.request_invalid":
    "The server rejected the details. Check the admin person ID and password, then try again.",
  "shell.reset.generic": "The server could not be reset. Check the connection and try again.",
  "shell.reset.resetting":
    "The server is resetting and will restart. Wait a minute, then reload this page to start setup again. If joining again says the previous join stopped partway, the reset did not run: contact support.",
  "shell.reset.unavailable":
    "There is no half-finished join to reset on this server. Reload to start setup again.",
  "shell.throttle": "Too many attempts. Wait a few minutes, then try again.",
  "shell.throttle_wait": "Too many attempts. Wait {seconds} seconds, then try again.",
  "shell.throttle_wait_one": "Too many attempts. Wait 1 second, then try again.",

  "shell.restore.staging_failed":
    "The backup could not be staged. Check the connection and try again.",
  "shell.restore.staging_failed_code":
    "The backup could not be staged. Check the file, key and environment. ({code})",
  "shell.restore.environment_mismatch":
    "The backup comes from the other environment. Choose the environment it came from.",

  "shell.bucket.no_answer": "The copy could not be restored. Check the connection and try again.",
  "shell.bucket.refused_code": "The copy could not be restored. ({code})",
  "shell.bucket.kit_damaged":
    "This recovery kit is incomplete or damaged, perhaps cut short when it was copied. Upload the kit file as it was saved, or paste the whole kit.",
  "shell.bucket.kit_invalid":
    "This is not a Waitron recovery kit. Upload the kit file, or paste the whole kit.",
  "shell.bucket.key_does_not_open":
    "The recovery key in this kit does not open the latest copy. If the recovery key was changed, use the newest kit.",
  "shell.bucket.newer_software":
    "The copy in the bucket was made by newer Waitron software than this server has. Update this server, then try again.",
  "shell.bucket.pointer_missing": "The bucket in this kit holds no copy of this restaurant.",
  "shell.bucket.pointer_unverified":
    "The copy in the bucket was not written by the server this kit belongs to. Check that the kit is this restaurant's newest. Nothing was changed.",
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

  "shell.cloud.newer_software":
    "This snapshot was made by newer Waitron software than this server has. Update this server, then try again.",
  "shell.cloud.unopenable":
    "This snapshot could not be opened. It is damaged, or the recovery key Waitron Cloud holds for it does not open it.",
  "shell.cloud.environment_mismatch":
    "This snapshot is not from a preparation or demo venue, and Cloud recovery restores only those.",
  "shell.cloud.unavailable":
    "Cloud recovery is unavailable. Check the connection or request expiry, then try again.",

  "shell.configuration.could_not_open":
    "The configuration export could not be opened. Check the file and passphrase.",
} as const;

export const shellEs: Record<keyof typeof shellEn, string> = {
  "shell.document_title": "Waitron — configura tu servidor",
  "shell.reload": "Recargar",
  "shell.reload_open_till": "Recargar para abrir la caja",

  "shell.connection.already_set_up": "Este servidor ya está configurado. Recarga para abrirlo.",
  "shell.connection.server_problem":
    "Este servidor ha informado de un problema. Inténtalo de nuevo en un momento.",
  "shell.connection.unreachable":
    "No hemos podido contactar con el servidor. Comprueba que está encendido y tu conexión de red.",

  "shell.not_ready": "El servidor aún no está listo. Espera un momento e inténtalo de nuevo.",
  "shell.operation_conflict":
    "Este servidor tiene guardada una configuración de otra solicitud. Continúa la configuración original o contacta con soporte.",
  "shell.already_stamped":
    "Un intento anterior de configuración dejó este servidor configurado a medias, para otro entorno. Contacta con soporte para restablecer este servidor y vuelve a empezar la configuración.",
  "shell.already_provisioning": "La configuración ya está en curso en este servidor.",
  "shell.already_provisioned": "Este servidor ya está configurado.",

  "shell.venue_error.territory_country_mismatch":
    "El país debe coincidir con el territorio fiscal.",
  "shell.venue_error.invalid_locales": "Elige 1 o 2 idiomas de factura.",
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

  "shell.provision.failed":
    "La configuración ha fallado. Comprueba que el servidor está encendido y que tu dispositivo está conectado a su red, e inténtalo de nuevo. Si ves un aviso de certificado, usa la ayuda sobre el certificado de abajo.",

  "shell.adopt.bundle_fetch_failed":
    "No se ha podido unir al servidor principal: no se ha podido contactar con él, ha rechazado la solicitud o su respuesta no se ha podido usar. Comprueba que la dirección es la del servidor principal de Waitron de tu restaurante e inténtalo de nuevo.",
  "shell.adopt.request_invalid":
    "El servidor ha rechazado los datos. Revisa la dirección y el inicio de sesión, e inténtalo de nuevo.",
  "shell.adopt.login_failed":
    "No se ha podido iniciar sesión. Revisa el ID de persona, la contraseña y el código del autenticador del administrador, e inténtalo de nuevo.",
  "shell.adopt.generic":
    "No se ha podido conectar con el servidor principal. Revisa la dirección y el inicio de sesión, e inténtalo de nuevo.",
  "shell.adopt.incomplete":
    "Un intento anterior de unir este servidor a un restaurante se detuvo a medias y lo dejó configurado a medias. No se puede terminar. Puedes restablecer este servidor con el ID de persona y la contraseña del administrador que usaste para conectarlo, y volver a empezar la configuración.",

  "shell.reset.request_invalid":
    "El servidor ha rechazado los datos. Revisa el ID de persona y la contraseña del administrador, e inténtalo de nuevo.",
  "shell.reset.generic":
    "No se ha podido restablecer el servidor. Comprueba la conexión e inténtalo de nuevo.",
  "shell.reset.resetting":
    "El servidor se está restableciendo y se reiniciará. Espera un minuto y recarga esta página para volver a empezar la configuración. Si al unirlo de nuevo se indica que la unión anterior se detuvo a medias, el restablecimiento no se ha hecho: contacta con soporte.",
  "shell.reset.unavailable":
    "No hay ninguna unión a medias que restablecer en este servidor. Recarga para volver a empezar la configuración.",
  "shell.throttle": "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  "shell.throttle_wait": "Demasiados intentos. Espera {seconds} segundos y vuelve a intentarlo.",
  "shell.throttle_wait_one": "Demasiados intentos. Espera 1 segundo y vuelve a intentarlo.",

  "shell.restore.staging_failed":
    "No se ha podido preparar la copia de seguridad. Comprueba la conexión e inténtalo de nuevo.",
  "shell.restore.staging_failed_code":
    "No se ha podido preparar la copia de seguridad. Revisa el archivo, la clave y el entorno. ({code})",
  "shell.restore.environment_mismatch":
    "La copia viene del otro entorno. Elige el entorno del que viene.",

  "shell.bucket.no_answer":
    "No se ha podido restaurar la copia. Comprueba la conexión e inténtalo de nuevo.",
  "shell.bucket.refused_code": "No se ha podido restaurar la copia. ({code})",
  "shell.bucket.kit_damaged":
    "Este kit de recuperación está incompleto o dañado; quizá se cortó al copiarlo. Sube el archivo del kit tal como se guardó, o pega el kit completo.",
  "shell.bucket.kit_invalid":
    "Esto no es un kit de recuperación de Waitron. Sube el archivo del kit, o pega el kit completo.",
  "shell.bucket.key_does_not_open":
    "La clave de recuperación de este kit no abre la copia más reciente. Si se cambió la clave de recuperación, usa el kit más reciente.",
  "shell.bucket.newer_software":
    "La copia del bucket la hizo una versión de Waitron más nueva que la de este servidor. Actualiza este servidor e inténtalo de nuevo.",
  "shell.bucket.pointer_missing":
    "El bucket de este kit no guarda ninguna copia de este restaurante.",
  "shell.bucket.pointer_unverified":
    "La copia del bucket no la escribió el servidor al que pertenece este kit. Comprueba que el kit es el más reciente de este restaurante. No se ha cambiado nada.",
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

  "shell.cloud.newer_software":
    "Esta instantánea la hizo una versión de Waitron más nueva que la de este servidor. Actualiza este servidor e inténtalo de nuevo.",
  "shell.cloud.unopenable":
    "No se ha podido abrir esta instantánea. Está dañada, o la clave de recuperación que Waitron Cloud guarda para ella no la abre.",
  "shell.cloud.environment_mismatch":
    "Esta instantánea no es de un local de preparación o de demostración, y la recuperación desde Cloud solo restaura esos.",
  "shell.cloud.unavailable":
    "La recuperación desde Cloud no está disponible. Comprueba la conexión o si la solicitud ha caducado, e inténtalo de nuevo.",

  "shell.configuration.could_not_open":
    "No se ha podido abrir la exportación de configuración. Revisa el archivo y la contraseña de exportación.",
};
