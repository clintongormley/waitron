// The provisioning, reset and done screens, and the mode pill they share with the review screen.

export const finishEn = {
  "mode_pill.demo": "Demo",
  "mode_pill.prepare": "Preparation",
  "mode_pill.live": "Live",

  "provisioning.heading": "Provisioning this box",
  "provisioning.setting_up": "Setting up {legalName}",
  "provisioning.keep_open": "Keep this page open.",
  "provisioning.busy": "Provisioning…",
  "provisioning.failed_heading": "Provisioning",
  "provisioning.trust_help_before":
    "If the browser shows a certificate warning, or this page will not connect,",
  "provisioning.trust_help_link": "open certificate and connection help",
  "provisioning.trust_help_after":
    "in a new tab. Your entries stay in this tab until you close or reload it.",
  "provisioning.reset": "Reset this box",
  "provisioning.retry": "Try again",

  "reset.heading": "Reset this box",
  "reset.heading_resetting": "Resetting this box",
  "reset.explanation":
    "This removes what the half-finished join left on this box and restarts it at a fresh setup. Nothing on the primary box is changed, so the primary may still list this box.",
  "reset.remove_plain":
    "To take it off that list, open the primary's dashboard, then System, then Servers, open this box's row menu and choose Remove from venue, then open the row menu again and choose Clear from list. If its row already says Removed, only Clear from list is needed. Do this before you join this box again: otherwise the new join adds a second row that is hard to tell apart from this one, or is refused if the list is full.",
  "reset.remove_before": "To take it off that list, open the primary's",
  "reset.servers_link": "Servers page",
  "reset.remove_after":
    "and, in this box's row menu, choose Remove from venue, then Clear from list (only Clear from list if the row already says Removed). Do this before you join this box again, or the new join adds a second row that is hard to tell apart from this one, or is refused if the list is full.",
  "reset.back": "Back",
  "reset.submit": "Reset this box",
  "reset.busy": "Resetting…",
  "reset.reload": "Reload",

  "done.heading": "Setup complete",
  "done.cloud_staff_email_unavailable":
    "Waitron Cloud staff email could not be confirmed. You can add or check your mail server in System → Email.",
  "done.cloud_staff_email_help": "About staff email",
  "done.heading_rebuilt": "Rebuilt from your bucket",
  "done.heading_restored": "Restored from your backup",
  "done.restarting": "The box is restarting to finish setup. Once it is back, open it here:",
  "done.ready": "The box is ready. Open it here:",
  "done.start_failed": "The box did not start. Open it to see what went wrong and what you can do:",
  "done.waiting_for_clock":
    "Before it creates the new invoice series, the box needs you to confirm its time again. Check that both times below are right, then press Confirm the time. If the box's time is wrong, press This device to set it from this device's time.",
  "done.clock_confirmed": "Time confirmed. This page shows when the box is ready.",
  "done.clock.server_time": "The box's time:",
  "done.clock.device_time": "This device's time:",
  "done.clock.confirm": "Confirm the time",
  "done.clock.this_device": "This device",
  "done.clock.on_box":
    "This screen is on the box itself, so its time does not count. Open this page on a phone, computer or till on the venue's network.",
  "done.clock.set_refused":
    "The box could not set its clock from this device. Check this device's date and time, then press This device again.",
  "done.clock.key_refused":
    "The box did not accept the box key this page holds. Open any of the box's pages on a phone, computer or till on the venue's network and enter the selected backup's box key there.",
  "done.clock.unanswered":
    "This page could not get the two times from the box, so Confirm the time and This device stay off. Keep this page open: it asks the box again by itself.",
  "done.description.dashboard":
    "Set up your menu, staff, devices and settings, and see your sales.",
  "done.description.till": "Take orders and payments.",
  "done.description.email": "Read Demo account emails, such as invitations and password resets.",
  "done.description.server": "Its page has a button to try starting it again.",
  "done.link.till": "Till",
  "done.link.dashboard": "Dashboard",
  "done.link.server": "Box",
  "done.link.email": "Email inbox",
  "done.devices.intro": "Devices depend on how each was set up:",
  "done.devices.local":
    "Tills, handhelds and station screens that were opened at https://waitron.local reconnect by themselves.",
  "done.devices.ip":
    "Any that were opened at an IP address (for example by scanning a QR code) must be opened again: go to /setup/trust on this box, scan its QR code, and set the device up again.",
  "done.devices.print_agent":
    "A print agent on this box reconnects by itself. One on another computer that was given an IP address needs its Box address changed on its own page, at port 9110 on that computer.",
  "done.pack.heading": "Recovery pack",
  "done.pack.lead":
    "Download, print or copy the master key, then keep it somewhere safe, away from this box.",
  "done.pack.warning": "This is the only time the master key is shown.",
  "done.pack.key_name": "Master key · {name}",
  "done.pack.download": "Download",
  "done.pack.print": "Print",
  "done.pack.copy": "Copy",
  "done.pack.copied": "Copied.",
  "done.pack.copy_failed": "Copy did not work. Use Download or Print, or write the key down.",
  "done.pack.continue": "Continue",
  "done.break_glass.heading": "Save your box key now",
  "done.break_glass.key_name": "Box key {date} · {code}",
  "done.break_glass.backups":
    "The backup encryption key opens the copy. To authorise a restore, keep the box key that was current when the backup was made.",
  "done.break_glass.warning":
    "Save it as a file or write it down, and keep it off this computer. It is shown once and will not be shown again.",
  "done.break_glass.promote": "You need it to promote this box if the primary is unreachable.",
  "done.break_glass.restore":
    "Save the name and key as a file or write them on paper, and keep them with your recovery pack. The key is shown once. You need it to restore this venue from its bucket.",
  "done.break_glass.save": "Save as a file",
  "done.break_glass.download_pack": "Download recovery pack (PDF)",
  "done.break_glass.pack_keep":
    "The recovery pack contains the box key. Keep it away from this box. You need the key to restore this venue from its bucket.",
  "done.break_glass.save_failed": "The file could not be saved. Write the key down instead.",
  "done.break_glass.file_title": "Waitron box key",
  "done.break_glass.file_purpose": "You need it to restore this venue from its bucket.",
  "done.break_glass.file_keep":
    "Print this file and keep it with your recovery pack, or move it to storage away from this computer, then delete it here. A copy left on this computer is lost with it.",
  "done.break_glass.replacement":
    "The box key was issued when setup finished. If you did not save it, sign in to Backups and make a recovery pack with a new box key before taking your first bucket copy.",
  "done.break_glass.open_backups": "Open Backups",
  "done.joining.heading": "This box is joining",
  "done.joined.heading": "This box has joined",
  "done.joining.status": "Joining. This can take a few minutes.",
  "done.joining.copy_waiting":
    "Joining. Waiting for the main box to send its copy of the restaurant's data.",
  "done.joining.copy_restoring":
    "Joining. Copying the restaurant's data from the main box. The main box keeps selling.",
  "done.joining.copy_ready": "Joining. The copy is complete and this box is restarting.",
  "done.joining.lost_before":
    "This page can no longer reach this box. This usually happens after it restarts to join: it then uses the restaurant's own security certificate, which this browser has not accepted. To check, open the main box's",
  "done.joining.lost_link": "Servers page",
  "done.joining.lost_after": "and look at this box's row.",
  "done.task.done": "Done",
  "done.task.in_progress": "In progress",
  "done.task.to_do": "To do",
  "done.task.join": "Join the restaurant",
  "done.task.key": "Download the box key",
  "done.task.key_why":
    "You need this key if this box ever has to take over from the main box. Save it as a file or write it down, and keep it off this computer.",
  "done.task.key_wrote": "I wrote it down",
  "done.task.key_file_purpose":
    "You will need it if this box ever has to take over from the main box.",
  "done.task.key_again": "Show the key again",
  "done.task.label": "Print this box's label",
  "done.task.label_why":
    "Stick it on this box. If the main box fails, scan it with any till or phone on the venue's network to switch to this box.",
  "done.task.label_stuck": "I've stuck it on",
  "done.label.why":
    "Stick it on this box. Every box in the restaurant has one: if the main box fails, scan the label on a spare with any till or phone on the venue's network to switch to that spare.",
  "done.label.print": "Print label",
  "done.label.words":
    "If the main box fails, scan this with any till or phone on the venue's network",
  "done.label.qr_alt": "QR code that opens this box's switch page",
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
    "Esto elimina lo que la unión a medias dejó en este servidor y lo reinicia con una configuración desde cero. No se cambia nada en el servidor principal, así que puede que el principal siga mostrando este servidor en su lista.",
  "reset.remove_plain":
    "Para quitarlo de esa lista, abre el panel del servidor principal, luego Sistema y luego Servidores; abre el menú de la fila de este servidor y elige Retirar del local, y después vuelve a abrir el menú de la fila y elige Quitar de la lista. Si su fila ya dice Retirado, solo hace falta Quitar de la lista. Hazlo antes de volver a unir este servidor: si no, la nueva unión añade una segunda fila difícil de distinguir de esta, o se rechaza si la lista está llena.",
  "reset.remove_before": "Para quitarlo de esa lista, abre la",
  "reset.servers_link": "página Servidores",
  "reset.remove_after":
    "del principal y, en el menú de la fila de este servidor, elige Retirar del local y después Quitar de la lista (solo Quitar de la lista si la fila ya dice Retirado). Hazlo antes de volver a unir este servidor, o la nueva unión añade una segunda fila difícil de distinguir de esta, o se rechaza si la lista está llena.",
  "reset.back": "Volver",
  "reset.submit": "Restablecer este servidor",
  "reset.busy": "Restableciendo…",
  "reset.reload": "Recargar",

  "done.heading": "Configuración completada",
  "done.cloud_staff_email_unavailable":
    "No se ha podido confirmar el correo del personal de Waitron Cloud. Puedes añadir o revisar tu servidor de correo en Sistema → Correo.",
  "done.cloud_staff_email_help": "Acerca del correo del personal",
  "done.heading_rebuilt": "Reconstruido desde tu bucket",
  "done.heading_restored": "Restaurado desde tu copia de seguridad",
  "done.restarting":
    "El servidor se está reiniciando para terminar la configuración. Cuando vuelva, ábrelo desde aquí:",
  "done.ready": "El servidor está listo. Ábrelo desde aquí:",
  "done.start_failed":
    "El servidor no ha arrancado. Ábrelo para ver qué ha fallado y qué puedes hacer:",
  "done.waiting_for_clock":
    "Antes de crear las series de facturas nuevas, el servidor necesita que vuelvas a confirmar su hora. Comprueba que las dos horas de abajo son correctas y pulsa Confirmar la hora. Si la hora del servidor está mal, pulsa Este dispositivo para ponerla con la hora de este dispositivo.",
  "done.clock_confirmed": "Hora confirmada. Esta página te avisa cuando el servidor esté listo.",
  "done.clock.server_time": "Hora del servidor:",
  "done.clock.device_time": "Hora de este dispositivo:",
  "done.clock.confirm": "Confirmar la hora",
  "done.clock.this_device": "Este dispositivo",
  "done.clock.on_box":
    "Esta pantalla está en el propio servidor, así que su hora no cuenta. Abre esta página en un móvil, ordenador o caja de la red del local.",
  "done.clock.set_refused":
    "El servidor no ha podido ponerse en hora con este dispositivo. Comprueba la fecha y la hora de este dispositivo y vuelve a pulsar Este dispositivo.",
  "done.clock.key_refused":
    "El servidor no ha aceptado la clave del servidor que guarda esta página. Abre cualquier página del servidor en un móvil, ordenador o caja de la red del local e introduce allí la clave del servidor de la copia elegida.",
  "done.clock.unanswered":
    "Esta página no ha podido obtener las dos horas del servidor, así que Confirmar la hora y Este dispositivo siguen desactivados. Mantén esta página abierta: vuelve a preguntar al servidor por sí sola.",
  "done.description.dashboard":
    "Configura la carta, el personal, los dispositivos y los ajustes, y consulta tus ventas.",
  "done.description.till": "Toma pedidos y cobra.",
  "done.description.email":
    "Lee los correos de cuentas de demostración, como invitaciones y restablecimientos de contraseña.",
  "done.description.server": "Su página tiene un botón para intentar arrancarlo de nuevo.",
  "done.link.till": "Caja",
  "done.link.dashboard": "Panel",
  "done.link.server": "Servidor",
  "done.link.email": "Bandeja de correo",
  "done.devices.intro": "Los dispositivos dependen de cómo se configuró cada uno:",
  "done.devices.local":
    "Las cajas, los terminales de mano y las pantallas de estación que se abrieron en https://waitron.local se vuelven a conectar solos.",
  "done.devices.ip":
    "Los que se abrieron en una dirección IP (por ejemplo, escaneando un código QR) hay que volver a abrirlos: ve a /setup/trust en este servidor, escanea su código QR y vuelve a configurar el dispositivo.",
  "done.devices.print_agent":
    "Un agente de impresión en este servidor se vuelve a conectar solo. Si está en otro ordenador y se le dio una dirección IP, hay que cambiar su «Box address» en su propia página, en el puerto 9110 de ese ordenador.",
  "done.pack.heading": "Paquete de recuperación",
  "done.pack.lead":
    "Descarga, imprime o copia la clave maestra y guárdala en un lugar seguro, lejos de este servidor.",
  "done.pack.warning": "Esta es la única vez que se muestra la clave maestra.",
  "done.pack.key_name": "Clave maestra · {name}",
  "done.pack.download": "Descargar",
  "done.pack.print": "Imprimir",
  "done.pack.copy": "Copiar",
  "done.pack.copied": "Copiada.",
  "done.pack.copy_failed": "No se ha podido copiar. Usa Descargar o Imprimir, o apunta la clave.",
  "done.pack.continue": "Continuar",
  "done.break_glass.heading": "Guarda ahora tu clave del servidor",
  "done.break_glass.key_name": "Clave del servidor {date} · {code}",
  "done.break_glass.backups":
    "La clave de cifrado de copias abre la copia. Para autorizar la restauración, conserva la clave del servidor que estaba en vigor cuando se hizo la copia.",
  "done.break_glass.warning":
    "Guárdala en un archivo o anótala, y guárdala fuera de este ordenador. Se muestra una sola vez y no se volverá a mostrar.",
  "done.break_glass.promote":
    "La necesitas para que este servidor pase a ser el principal si no se puede contactar con el principal actual.",
  "done.break_glass.restore":
    "Guarda el nombre y la clave en un archivo o anótalos en papel, y guárdalos con tu paquete de recuperación. La clave se muestra una sola vez. La necesitas para restaurar este local desde su bucket.",
  "done.break_glass.save": "Guardar en un archivo",
  "done.break_glass.download_pack": "Descargar paquete de recuperación (PDF)",
  "done.break_glass.pack_keep":
    "El paquete de recuperación contiene la clave del servidor. Guárdalo fuera de este servidor. Necesitas la clave para restaurar este local desde su bucket.",
  "done.break_glass.save_failed": "No se pudo guardar el archivo. Anota la clave.",
  "done.break_glass.file_title": "Clave del servidor de Waitron",
  "done.break_glass.file_purpose": "La necesitas para restaurar este local desde su bucket.",
  "done.break_glass.file_keep":
    "Imprime este archivo y guárdalo con tu paquete de recuperación, o muévelo a un almacenamiento fuera de este ordenador y después bórralo de aquí. Una copia que se quede en este ordenador se pierde con él.",
  "done.break_glass.replacement":
    "La clave del servidor se generó al terminar la configuración. Si no la guardaste, inicia sesión en Copias de seguridad y crea un paquete de recuperación con una clave nueva antes de hacer la primera copia en el bucket.",
  "done.break_glass.open_backups": "Abrir Copias de seguridad",
  "done.joining.heading": "Este servidor se está uniendo",
  "done.joined.heading": "Este servidor se ha unido",
  "done.joining.status": "Uniéndose. Puede tardar unos minutos.",
  "done.joining.copy_waiting":
    "Uniéndose. Esperando a que el servidor principal envíe su copia de los datos del restaurante.",
  "done.joining.copy_restoring":
    "Uniéndose. Copiando los datos del restaurante desde el servidor principal. El servidor principal sigue vendiendo.",
  "done.joining.copy_ready":
    "Uniéndose. La copia está completa y este servidor se está reiniciando.",
  "done.joining.lost_before":
    "Esta página ya no puede comunicarse con este servidor. Suele pasar después de que se reinicie para unirse: entonces usa el certificado de seguridad propio del restaurante, que este navegador no ha aceptado. Para comprobarlo, abre la",
  "done.joining.lost_link": "página Servidores",
  "done.joining.lost_after": "del servidor principal y mira la fila de este servidor.",
  "done.task.done": "Hecho",
  "done.task.in_progress": "En curso",
  "done.task.to_do": "Pendiente",
  "done.task.join": "Unirse al restaurante",
  "done.task.key": "Descargar la clave del servidor",
  "done.task.key_why":
    "Necesitas esta clave si algún día este servidor tiene que sustituir al servidor principal. Guárdala en un archivo o anótala, y guárdala fuera de este ordenador.",
  "done.task.key_wrote": "La he anotado",
  "done.task.key_file_purpose":
    "La necesitarás si algún día este servidor tiene que sustituir al servidor principal.",
  "done.task.key_again": "Mostrar la clave de nuevo",
  "done.task.label": "Imprimir la etiqueta de este servidor",
  "done.task.label_why":
    "Pégala en este servidor. Si el servidor principal falla, escanéala con cualquier caja o móvil conectado a la red del local para cambiar a este servidor.",
  "done.task.label_stuck": "Ya la he pegado",
  "done.label.why":
    "Pégala en este servidor. Cada servidor del restaurante tiene una: si el servidor principal falla, escanea la etiqueta de un servidor de reserva con cualquier caja o móvil conectado a la red del local para cambiar a ese servidor.",
  "done.label.print": "Imprimir etiqueta",
  "done.label.words":
    "Si el servidor principal falla, escanea esto con cualquier caja o móvil conectado a la red del local",
  "done.label.qr_alt": "Código QR que abre la página de cambio de este servidor",
};
