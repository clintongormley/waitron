// The provisioning, reset and done screens, and the mode pill they share with the review screen.

export const finishEn = {
  "mode_pill.demo": "Demo",
  "mode_pill.prepare": "Preparation",
  "mode_pill.live": "Live",

  "provisioning.heading": "Provisioning this server",
  "provisioning.setting_up": "Setting up {legalName}",
  "provisioning.keep_open": "Keep this page open.",
  "provisioning.busy": "Provisioning…",
  "provisioning.failed_heading": "Provisioning",
  "provisioning.trust_help_before":
    "If the browser shows a certificate warning, or this page will not connect,",
  "provisioning.trust_help_link": "open certificate and connection help",
  "provisioning.trust_help_after":
    "in a new tab. Your entries stay in this tab until you close or reload it.",
  "provisioning.reset": "Reset this server",
  "provisioning.retry": "Try again",

  "reset.heading": "Reset this server",
  "reset.heading_resetting": "Resetting this server",
  "reset.explanation":
    "This removes what the half-finished join left on this server and restarts it at a fresh setup. Nothing on the primary server is changed, so the primary may still list this server. To take it off that list, open the primary's dashboard, then Settings, then Servers, open this server's row menu and choose Remove, then open the row menu again and choose Clear from list. If its row already says Removed, only Clear from list is needed. Do this before you join this server again: otherwise the new join adds a second row that is hard to tell apart from this one, or is refused if the list is full.",
  "reset.prompt": "Enter the admin person ID and password you used to connect this server.",
  "reset.person_id_label": "Admin login (person ID)",
  "reset.password_label": "Admin password",
  "reset.show_password": "Show password",
  "reset.hide_password": "Hide password",
  "reset.missing.person_id": "Enter the admin person ID.",
  "reset.missing.password": "Enter the admin password.",
  "reset.check.person_id": "Check the admin person ID.",
  "reset.check.password": "Check the admin password.",
  "reset.rejected":
    "That person ID and password are not the admin login used to connect this server. Check them and try again.",
  "reset.fix_fields": "Correct the highlighted fields to continue.",
  "reset.back": "Back",
  "reset.submit": "Reset this server",
  "reset.busy": "Resetting…",
  "reset.reload": "Reload",

  "done.heading": "Setup complete",
  "done.opening_hours": "Opening hours: Monday to Friday, 09:00–17:00",
  "done.change_opening_hours": "Change opening hours",
  "done.heading_rebuilt": "Rebuilt from your bucket",
  "done.restarting": "The server is restarting to finish setup. Once it is back, open it here:",
  "done.ready": "The server is ready. Open it here:",
  "done.description.dashboard":
    "Set up your menu, staff, devices and settings, and see your sales.",
  "done.description.till": "Take orders and payments.",
  "done.description.email":
    "Read account emails captured locally, such as invitations and password resets.",
  "done.link.till": "Till",
  "done.link.dashboard": "Dashboard",
  "done.link.email": "Email inbox",
  "done.backup_nudge":
    "Your server is trading — but it has no backups yet, so there is no way back from a disk failure.",
  "done.backup_link": "Set up backups now",
  "done.devices.intro": "Devices depend on how each was set up:",
  "done.devices.local":
    "Tills, handhelds and kitchen screens that were opened at https://waitron.local reconnect by themselves.",
  "done.devices.ip":
    "Any that were opened at an IP address (for example by scanning a QR code) must be opened again: go to /setup/trust on this server, scan its QR code, and set the device up again.",
  "done.devices.print_agent":
    "A print agent on this server reconnects by itself. One on another computer that was given an IP address needs its Server address changed on its own page, at port 9110 on that computer.",
  "done.break_glass.heading": "Save your break-glass code now",
  "done.break_glass.warning":
    "Write this down and store it offline. It is shown once and will not be shown again.",
  "done.break_glass.join_stalled":
    "It was meant to let this server take over if the primary server could not be reached. It cannot do that in this version, because this server does not finish joining — so keep the code, but do not count on it.",
  "done.break_glass.promote": "You need it to promote this server if the primary is unreachable.",
  "done.stalled.heading": "This server did not join",
  "done.stalled.body":
    "The sign-in to the restaurant's primary worked and this server is restarting. It will not come back able to do anything: it stops part-way through joining, and it will not get any further however many times you restart it. It holds none of the restaurant's information, it has no till and no dashboard, and it cannot sell or file anything.",
  "done.stalled.restarted":
    "The server has restarted, and this setup wizard is gone from it — reloading this page will not bring anything up, and there is nothing else on the server to open. Nothing on this page can fix that: tell whoever installed this server.",
  "done.stalled.waiting": "Waiting for the server to restart…",
} as const;

export const finishEs: Record<keyof typeof finishEn, string> = {
  "mode_pill.demo": "Demostración",
  "mode_pill.prepare": "Preparación",
  "mode_pill.live": "En vivo",

  "provisioning.heading": "Configurando este servidor",
  "provisioning.setting_up": "Configurando {legalName}",
  "provisioning.keep_open": "Mantén esta página abierta.",
  "provisioning.busy": "Configurando…",
  "provisioning.failed_heading": "Configuración",
  "provisioning.trust_help_before":
    "Si el navegador muestra un aviso de certificado, o esta página no conecta,",
  "provisioning.trust_help_link": "abre la ayuda sobre el certificado y la conexión",
  "provisioning.trust_help_after":
    "en una pestaña nueva. Lo que has introducido se queda en esta pestaña hasta que la cierres o la recargues.",
  "provisioning.reset": "Restablecer este servidor",
  "provisioning.retry": "Volver a intentar",

  "reset.heading": "Restablecer este servidor",
  "reset.heading_resetting": "Restableciendo este servidor",
  "reset.explanation":
    "Esto elimina lo que la unión a medias dejó en este servidor y lo reinicia con una configuración desde cero. No se cambia nada en el servidor principal, así que puede que el principal siga mostrando este servidor en su lista. Para quitarlo de esa lista, abre el panel del servidor principal, luego Ajustes y luego Servidores; abre el menú de la fila de este servidor y elige Retirar, y después vuelve a abrir el menú de la fila y elige Quitar de la lista. Si su fila ya dice Retirado, solo hace falta Quitar de la lista. Hazlo antes de volver a unir este servidor: si no, la nueva unión añade una segunda fila difícil de distinguir de esta, o se rechaza si la lista está llena.",
  "reset.prompt":
    "Introduce el ID de persona y la contraseña del administrador que usaste para conectar este servidor.",
  "reset.person_id_label": "Inicio de sesión del administrador (ID de persona)",
  "reset.password_label": "Contraseña del administrador",
  "reset.show_password": "Mostrar contraseña",
  "reset.hide_password": "Ocultar contraseña",
  "reset.missing.person_id": "Introduce el ID de persona del administrador.",
  "reset.missing.password": "Introduce la contraseña del administrador.",
  "reset.check.person_id": "Revisa el ID de persona del administrador.",
  "reset.check.password": "Revisa la contraseña del administrador.",
  "reset.rejected":
    "Ese ID de persona y esa contraseña no son el inicio de sesión de administrador que se usó para conectar este servidor. Revísalos e inténtalo de nuevo.",
  "reset.fix_fields": "Corrige los campos marcados para continuar.",
  "reset.back": "Volver",
  "reset.submit": "Restablecer este servidor",
  "reset.busy": "Restableciendo…",
  "reset.reload": "Recargar",

  "done.heading": "Configuración completada",
  "done.opening_hours": "Horario de apertura: de lunes a viernes, 09:00–17:00",
  "done.change_opening_hours": "Cambiar el horario de apertura",
  "done.heading_rebuilt": "Reconstruido desde tu bucket",
  "done.restarting":
    "El servidor se está reiniciando para terminar la configuración. Cuando vuelva, ábrelo desde aquí:",
  "done.ready": "El servidor está listo. Ábrelo desde aquí:",
  "done.description.dashboard":
    "Configura la carta, el personal, los dispositivos y los ajustes, y consulta tus ventas.",
  "done.description.till": "Toma pedidos y cobra.",
  "done.description.email":
    "Lee los correos de cuentas capturados localmente, como invitaciones y restablecimientos de contraseña.",
  "done.link.till": "Caja",
  "done.link.dashboard": "Panel",
  "done.link.email": "Bandeja de correo",
  "done.backup_nudge":
    "Tu servidor ya está vendiendo, pero aún no tiene copias de seguridad, así que no hay forma de recuperarse de un fallo del disco.",
  "done.backup_link": "Configura ahora las copias de seguridad",
  "done.devices.intro": "Los dispositivos dependen de cómo se configuró cada uno:",
  "done.devices.local":
    "Las cajas, los terminales de mano y las pantallas de cocina que se abrieron en https://waitron.local se vuelven a conectar solos.",
  "done.devices.ip":
    "Los que se abrieron en una dirección IP (por ejemplo, escaneando un código QR) hay que volver a abrirlos: ve a /setup/trust en este servidor, escanea su código QR y vuelve a configurar el dispositivo.",
  "done.devices.print_agent":
    "Un agente de impresión en este servidor se vuelve a conectar solo. Si está en otro ordenador y se le dio una dirección IP, hay que cambiar su «Server address» en su propia página, en el puerto 9110 de ese ordenador.",
  "done.break_glass.heading": "Guarda ahora tu código de emergencia",
  "done.break_glass.warning":
    "Anótalo y guárdalo fuera de línea. Se muestra una sola vez y no se volverá a mostrar.",
  "done.break_glass.join_stalled":
    "Servía para que este servidor tomara el relevo si no se pudiera contactar con el servidor principal. En esta versión no puede hacerlo, porque este servidor no termina de unirse, así que conserva el código, pero no cuentes con él.",
  "done.break_glass.promote":
    "Lo necesitas para que este servidor pase a ser el principal si no se puede contactar con el principal actual.",
  "done.stalled.heading": "Este servidor no se ha unido",
  "done.stalled.body":
    "El inicio de sesión en el servidor principal del restaurante ha funcionado y este servidor se está reiniciando. No volverá pudiendo hacer nada: se detiene a medias al unirse y no avanzará más por muchas veces que lo reinicies. No guarda ninguna información del restaurante, no tiene caja ni panel, y no puede vender ni enviar registros fiscales.",
  "done.stalled.restarted":
    "El servidor se ha reiniciado y este asistente de configuración ya no está en él: recargar esta página no mostrará nada, y no hay nada más que abrir en el servidor. Nada de esta página puede arreglarlo: avisa a quien instaló este servidor.",
  "done.stalled.waiting": "Esperando a que el servidor se reinicie…",
};
