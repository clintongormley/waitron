// The connection, role, connect, mode and admin screens, the old-box question and server-fields.ts.

export const startEn = {
  "admin.password.held_hint": "Leave blank to keep your password.",
  "admin.pin.held_hint": "Leave blank to keep your PIN.",
  "admin.cloud_expired":
    "The box stopped holding your administrator credentials. Enter your password and PIN again to continue.",
  "cloud_sign_in.heading": "Connect to Waitron Cloud",
  "cloud_sign_in.copy":
    "Sign in or create an account. Waitron will connect this box when you save the venue.",
  "cloud_sign_in.sign_in": "Sign in to Waitron Cloud",
  "cloud_sign_in.skip": "Skip",
  "cloud_sign_in.error":
    "Cloud sign-in didn’t finish. Try again or choose Skip to finish setup manually.",

  "emergency.heading": "Start the venue in the cloud",
  "emergency.authenticator":
    "You need an authenticator app, set up in Waitron before the box failed. You cannot set one up here.",
  "emergency.no_passkeys": "Passkeys are not offered here.",
  "emergency.email": "Email",
  "emergency.email_invalid": "Enter a valid email address.",
  "emergency.password": "Password",
  "emergency.code": "Authenticator code",
  "emergency.recovery_code": "Recovery code",
  "emergency.use_recovery": "Use a recovery code",
  "emergency.use_authenticator": "Use an authenticator code",
  "emergency.sign_in": "Sign in",
  "emergency.invalid": "The email, password or code is incorrect.",
  "emergency.permission":
    "Your role does not allow you to start the venue on another machine. Sign in as someone else, or use the owner’s Cloud account.",
  "emergency.expired": "Your sign-in has expired. Nothing was started. Sign in again.",
  "emergency.throttled": "Too many sign-in attempts. Wait a minute, then try again.",
  "emergency.unavailable":
    "This copy could not be reached. Try again, or open the owner’s Cloud account.",
  "emergency.account": "Sign in to the owner’s Cloud account",
  "emergency.not_started":
    "The venue has not been started here. Declaration and activation are not available yet.",
  "emergency.actor": "Signed in as {name}.",
  "emergency.stops": "This copy stops by",
  "emergency.sign_out": "Sign out",
  "emergency.fix_fields": "Correct the highlighted fields to sign in.",
  "emergency.required": "Enter this value.",
  "emergency.loading": "Reading this copy…",
  "emergency.retry": "Try again",
  "emergency.source_contact": "Cloud last heard from the old box at",
  "emergency.source_contact_unknown": "Cloud does not know when it last heard from the old box.",
  "emergency.status_unavailable": "Cloud status is unavailable.",
  "emergency.status_source_recent":
    "Cloud reported recent contact with the old box. Reload this page to check again.",
  "emergency.status_setting_off":
    "Emergency start is switched off. Open the owner’s Cloud account to turn it on.",
  "emergency.status_level_inactive":
    "Emergency start needs an active Connected plan. Check the plan in the Cloud account.",
  "emergency.status_no_payment_method":
    "Emergency start needs a payment method. Open the owner’s Cloud account to add one.",
  "emergency.status_not_provisioned":
    "Cloud cannot start this venue yet. Check availability in the Cloud account.",
  "emergency.status_state_not_ready": "Cloud could not check whether emergency start is available.",
  "emergency.check_status": "Check again",

  "connection.heading": "Is this page secure?",
  "connection.check_address_bar": "Look at your browser's address bar. If it says",
  "connection.warning_words": "Not secure",
  "connection.install_before_continuing": ", install this box's certificate before you continue.",
  "connection.install_certificate": "Install certificate",
  "connection.checking": "Checking connection…",
  "connection.continue": "Continue to setup",
  "connection.join": "Join or recover",
  "connection.join_hint": "Joining or recovering doesn't need the certificate.",

  "role.heading": "Join or recover an existing restaurant",
  "role.intro":
    "Restore a backup onto this box when no other box is still running with newer restaurant data, or rebuild from the continuous copy in your own storage bucket when the old box is gone. A mirror can take over only after it has joined a running primary.",
  "role.mirror.heading": "Add a mirror node",
  "role.mirror.copy":
    "This box joins the primary and keeps a copy of the restaurant's data. Once it has joined, it can take over: by a handover from the primary's Servers page, or by an emergency switch if the primary fails. A new box cannot join a primary that is already gone: to recover then, choose Restore from backup or Restore from my bucket.",
  "role.restore.heading": "Restore from backup",
  "role.restore.copy":
    "Recover onto this fresh box from an encrypted Waitron backup when no other box is still running with newer restaurant data.",
  "role.bucket.heading": "Restore from my bucket",
  "role.bucket.copy":
    "Rebuild onto this fresh box from the continuous copy in your own storage bucket, when the old box is gone. You need the recovery pack or kit file.",
  "role.back": "Back",

  "connect.heading": "Join the main box",
  "connect.intro":
    "This box joins the main box as a spare. It keeps an up-to-date copy of the venue's data, so it can take over if the main box fails, or when you choose a planned handover.",
  "connect.primary_url.label": "Main box address",
  "connect.primary_url.error": "Enter the main box's address.",
  "connect.primary_url.refused":
    "This address can't be used. Enter the main box's name, starting with https://, for example https://waitron.local. An IP address on the venue's network, such as https://192.168.1.10, is not accepted.",
  "connect.primary_url.hint": "https://waitron.local",
  "connect.fix_fields": "Correct the highlighted fields to continue.",
  "connect.back": "Back",
  "connect.join": "Join",
  "connect.start_again": "Start again",
  "connect.no": "No",
  "connect.try_again": "Try again",
  "connect.finish.bundle_fetch_failed":
    "This box could not get a copy from the main box that checks out, so nothing was installed. On the main box's Servers page, choose Remove in this box's row, then Clear from list. Then choose Start again here for a new code.",
  "connect.reading": "Checking this box's join…",
  "connect.waiting.open_link": "Open the Servers page on the main box",
  "connect.waiting.open_after": " and choose Check beside this box's request.",
  "connect.waiting.lead": "Does the main box show this code?",
  "connect.waiting.confirmed": "Now choose Add as spare on the main box.",
  "connect.waiting.time_left": "Time left: {minutes} min",
  "connect.approved": "The main box added this box.",
  "connect.approved.finishing": "This box is finishing joining…",
  "connect.elsewhere":
    "A join was started from another page or device. This page cannot show its code. Choose Start again to start one here; the other page's join then ends.",
  "connect.replaced":
    "This page's join was ended from another page or device, so its code no longer counts. Choose Start again for a new code.",
  "connect.ended.dismissed":
    "On the main box, this request was dismissed or answered No. Choose Start again to ask again.",
  "connect.ended.cancelled":
    "This request was cancelled, so its code no longer counts and nothing was sent. Choose Start again for a new code.",
  "connect.ended.stopped":
    "The main box stopped partway through approving this box, so nothing was installed. On the main box's Servers page, choose Remove in this box's row, then Clear from list. Then choose Start again here.",
  "connect.ended.unknown":
    "The main box ended this request, so its code no longer counts and nothing was sent. Choose Start again for a new code.",
  "connect.ended.code_taken": "The main box needs this box to ask again. Choose Start again.",
  "connect.ended.invalid":
    "The main box could not read this box's request. Choose Start again. If it happens again, check that both boxes run the same Waitron version.",
  "connect.failed":
    "This join stopped, so its code no longer counts and nothing was sent. Choose Start again for a new code.",
  "connect.failed.not_found":
    "The main box no longer has this request: it ran out of time or the main box restarted. Choose Start again.",
  "connect.failed.copy_invalid":
    "The main box approved this box, but the copy it sent did not check out, so nothing was installed. On the main box's Servers page, choose Remove in this box's row, then Clear from list. Then choose Start again here.",
  "connect.refusal.join_invalid":
    "The main box could not read this box's request. Choose Join again. If it happens again, check that both boxes run the same Waitron version.",
  "connect.refusal.join_not_found":
    "The main box no longer has this request: it ran out of time or the main box restarted. Choose Join again.",
  "connect.refusal.join_address_mismatch":
    "The main box received this box's request from a network address this box does not have, so something on the network may be passing it on. Choose Join again. If it happens again, check what is connected between the two boxes.",
  "connect.refusal.join_code_taken": "The main box needs this box to ask again. Choose Join again.",
  "connect.refusal.join_full_address":
    "The main box has had too many requests from this box's address in the last minute. Wait a minute, then choose Join again.",
  "connect.refusal.join_full_network":
    "The main box has had too many requests to join from the network in the last minute. Wait a minute, then choose Join again. If this keeps happening, something on the network is sending them.",
  "connect.refusal.join_full_listed":
    "The main box already has {max} other boxes asking to join. On its Servers page, dismiss any you do not recognise, then choose Join again here.",
  "connect.refusal.join_full_recent":
    "The main box has had {max} requests to join in the last {minutes} minutes, counting ones ended by Start again, which its Servers page no longer lists. Wait until {retryAt}, then choose Join again. Dismissing a request on its Servers page frees a place sooner.",
  "connect.refusal.join_waiting":
    "This box is already waiting to join, or is still ending its last request. Choose Start again to cancel that request and make a new one.",
  "connect.refusal.join_approving":
    "The main box is already adding this box, so the request cannot be ended from here. Wait a moment: this box then finishes joining, or this page says what went wrong.",
  "connect.refusal.join_in_use":
    "This box's join is open on another page or device right now. Finish or cancel it there. If that page is closed, wait 15 seconds and choose Start again here.",
  "connect.refusal.join_handle_invalid":
    "This join was started on another page or device, so this page cannot finish it. Finish it there, or choose Start again.",
  "connect.refusal.unreachable":
    "This box got no usable answer from the main box at that address. Check the address and that the main box is switched on, then choose Join again.",
  "connect.refusal.clocks_apart":
    "The two boxes' clocks are more than 10 minutes apart (the main box reads {primaryAt}, this box {standbyAt}). If this box's time is wrong, connect it to the internet for a minute so it sets its clock, then choose Join again.",
  "connect.refusal.name_taken":
    "This box picked a name another box of the venue already uses. Nothing was changed. Choose Join again: it picks a new name.",
  "connect.refusal.insecure":
    "This page is not using a secure connection, so this box will not join from it. Open this box's setup page at an address starting with https://, then try again.",
  "connect.refusal.adopt_incomplete":
    "An earlier join of this box stopped partway. Reload this page to see how to clear it.",
  "connect.refusal.generic":
    "This box could not do that just now. Check the address and that the main box is switched on, then try again.",

  "mode.heading": "Set up this box",
  "mode.other_box": "Another Waitron box is already running a restaurant on this network.",
  "mode.join_spare.heading": "Join it as a spare",
  "mode.join_spare.copy":
    "Add this box as a spare for the restaurant that's already running. It can take over if the main box fails.",
  "mode.others.heading": "Other choices",
  "mode.demo.heading": "Demo",
  "mode.demo.copy":
    "A practice box. Nothing is sent to the tax agency, so it is safe to explore and throw away.",
  "mode.prepare.heading": "Prepare your restaurant",
  "mode.prepare.copy":
    "Enter your real menus, staff and layouts, then practise with test payments. Nothing is sent to the tax agency.",
  "mode.live.heading": "Start a new restaurant",
  "mode.live.copy": "Every sale is sent to the tax agency (AEAT). You can't change this later.",
  "mode.existing.heading": "Join or recover a restaurant",
  "mode.existing.copy":
    "Add this box as a spare for a restaurant that's already running, or bring one back from a backup.",
  "mode.recover.heading": "Recover a restaurant",
  "mode.recover.copy": "Bring a restaurant back from a backup.",
  "mode.confirm.heading": "This is permanent",
  "mode.confirm.warning":
    "A new restaurant sends every sale to the tax agency (AEAT) and can NEVER become a demo — this is permanent.",
  "mode.confirm.understand": "I understand this cannot be undone",
  "mode.confirm.back": "Back",
  "mode.confirm.button": "Start a new restaurant",

  "admin.heading": "Your account",
  "admin.intro": "Create the account that manages this box. You can add more people later.",
  "admin.first_names.label": "First name(s)",
  "admin.first_names.error": "Enter your first name(s).",
  "admin.first_names.hint": "As on your ID",
  "admin.last_names.label": "Last name(s)",
  "admin.last_names.error": "Enter your last name(s).",
  "admin.last_names.hint": "As on your ID",
  "admin.display_name.label": "Display name",
  "admin.display_name.error": "Enter your display name.",
  "admin.display_name.hint": "The name colleagues see",
  "admin.email.label": "Email",
  "admin.email.error": "Enter your email.",
  "admin.email.hint": "To sign in and recover your account",
  "admin.password.label": "Password",
  "admin.password.error": "Enter your password.",
  "admin.password.hint": "To sign in to the dashboard",
  "admin.pin.label": "PIN",
  "admin.pin.error": "Enter your pin.",
  "admin.pin.hint": "Digits, to sign in at the till",
  "admin.show_password": "Show password",
  "admin.hide_password": "Hide password",
  "admin.password_shown": "Password shown",
  "admin.password_hidden": "Password hidden",
  "admin.show_pin": "Show PIN",
  "admin.hide_pin": "Hide PIN",
  "admin.fix_fields": "Correct the highlighted fields to continue.",
  "admin.back": "Back",
  "admin.next": "Next",

  "old_box.problem": "Confirm that the old box is switched off for good.",
  "old_box.wrote_at": "The old box wrote to its bucket at",
  "old_box.unchecked": "Whether the old box is still writing to its bucket could not be checked.",
  "old_box.consequence":
    "If it is still running, two boxes would sell from the same records, and that cannot be undone. Switch it off for good before you go on.",
  "old_box.gone": "The old box is switched off for good.",

  // The message's 120 is `NOMBRE_RAZON_MAX` (`packages/fiscal-verifactu/src/venue-fields.ts`).
  "server_fields.legal_name":
    "Keep the name to 120 characters or fewer, and remove any hidden characters the tax agency's records cannot carry — typing the name out instead of pasting it usually clears them.",
  "server_fields.tax_id": "Check the tax ID. A new business needs its own.",
  "server_fields.taxpayer_domicile": "Enter the full registered business address.",
  "server_fields.day_cutover":
    "That is not a time of day. Enter one from 00:00 to 23:59, such as 04:00.",
  "server_fields.series_code":
    "Use letters, numbers, and the characters / _ . and - only, up to 21 characters.",
} as const;

export const startEs: Record<keyof typeof startEn, string> = {
  "admin.password.held_hint": "Déjala en blanco para conservar tu contraseña.",
  "admin.pin.held_hint": "Déjalo en blanco para conservar tu PIN.",
  "admin.cloud_expired":
    "El servidor ha dejado de guardar tus credenciales de administrador. Vuelve a introducir la contraseña y el PIN para continuar.",
  "cloud_sign_in.heading": "Conecta con Waitron Cloud",
  "cloud_sign_in.copy":
    "Inicia sesión o crea una cuenta. Waitron conectará este servidor cuando guardes el local.",
  "cloud_sign_in.sign_in": "Iniciar sesión en Waitron Cloud",
  "cloud_sign_in.skip": "Omitir",
  "cloud_sign_in.error":
    "No se ha completado el inicio de sesión en Cloud. Inténtalo de nuevo o elige Omitir para terminar la configuración manualmente.",

  "emergency.heading": "Iniciar el local en la nube",
  "emergency.authenticator":
    "Necesitas una aplicación de autenticación configurada en Waitron antes de que fallara el servidor. No puedes configurarla aquí.",
  "emergency.no_passkeys": "Aquí no se ofrecen claves de acceso.",
  "emergency.email": "Correo electrónico",
  "emergency.email_invalid": "Introduce un correo electrónico válido.",
  "emergency.password": "Contraseña",
  "emergency.code": "Código del autenticador",
  "emergency.recovery_code": "Código de recuperación",
  "emergency.use_recovery": "Usar un código de recuperación",
  "emergency.use_authenticator": "Usar un código del autenticador",
  "emergency.sign_in": "Iniciar sesión",
  "emergency.invalid": "El correo, la contraseña o el código son incorrectos.",
  "emergency.permission":
    "Tu rol no permite iniciar el local en otro servidor. Entra con otra cuenta o usa la cuenta del propietario en Cloud.",
  "emergency.expired": "Tu sesión ha caducado. No se ha iniciado nada. Vuelve a iniciar sesión.",
  "emergency.throttled": "Demasiados intentos de acceso. Espera un minuto y vuelve a intentarlo.",
  "emergency.unavailable":
    "No se ha podido contactar con esta copia. Inténtalo de nuevo o abre la cuenta del propietario en Cloud.",
  "emergency.account": "Entrar en la cuenta del propietario en Cloud",
  "emergency.not_started":
    "El local no se ha iniciado aquí. La declaración y la activación aún no están disponibles.",
  "emergency.actor": "Sesión iniciada como {name}.",
  "emergency.stops": "Esta copia se detiene como máximo a las",
  "emergency.sign_out": "Cerrar sesión",
  "emergency.fix_fields": "Corrige los campos marcados para iniciar sesión.",
  "emergency.required": "Introduce este valor.",
  "emergency.loading": "Leyendo esta copia…",
  "emergency.retry": "Volver a intentar",
  "emergency.source_contact": "Último contacto de Cloud con el servidor anterior:",
  "emergency.source_contact_unknown": "Se desconoce el último contacto con el servidor anterior.",
  "emergency.status_unavailable": "No se pudo consultar el estado en Cloud.",
  "emergency.status_source_recent":
    "Cloud detectó contacto reciente con el servidor anterior. Recarga la página para volver a comprobarlo.",
  "emergency.status_setting_off":
    "El inicio de emergencia está desactivado. Entra en la cuenta del propietario en Cloud para activarlo.",
  "emergency.status_level_inactive":
    "El inicio de emergencia necesita un plan Conectado activo. Consulta el plan en la cuenta de Cloud.",
  "emergency.status_no_payment_method":
    "El inicio de emergencia necesita un método de pago. Añádelo en la cuenta del propietario en Cloud.",
  "emergency.status_not_provisioned":
    "Cloud aún no puede iniciar este local. Consulta la disponibilidad en la cuenta de Cloud.",
  "emergency.status_state_not_ready":
    "Cloud no pudo comprobar si el inicio de emergencia está disponible.",
  "emergency.check_status": "Volver a comprobar",

  "connection.heading": "¿Es segura esta página?",
  "connection.check_address_bar": "Mira la barra de direcciones de tu navegador. Si pone",
  "connection.warning_words": "No es seguro",
  "connection.install_before_continuing":
    ", instala el certificado de este servidor antes de continuar.",
  "connection.install_certificate": "Instalar el certificado",
  "connection.checking": "Comprobando la conexión…",
  "connection.continue": "Continuar con la configuración",
  "connection.join": "Unirse o recuperar",
  "connection.join_hint": "Para unirse o recuperar no hace falta el certificado.",

  "role.heading": "Unirse a un restaurante existente o recuperarlo",
  "role.intro":
    "Restaura una copia de seguridad en este servidor cuando no haya otro servidor funcionando con datos más recientes del restaurante, o reconstrúyelo desde la copia continua de tu propio bucket cuando el servidor anterior ya no esté. Una réplica solo puede sustituir al principal después de unirse a un principal en marcha.",
  "role.mirror.heading": "Añadir un nodo réplica",
  "role.mirror.copy":
    "Este servidor se une al principal y guarda una copia de los datos del restaurante. Cuando termina de unirse, puede sustituirlo: con un traspaso desde la página Servidores del principal, o con un cambio de emergencia si el principal falla. Un servidor nuevo no puede unirse a un principal que ya no está: para recuperar el restaurante en ese caso, elige Restaurar desde una copia de seguridad o Restaurar desde mi bucket.",
  "role.restore.heading": "Restaurar desde una copia de seguridad",
  "role.restore.copy":
    "Recupera el restaurante en este servidor nuevo desde una copia de seguridad cifrada de Waitron cuando no haya ningún otro servidor funcionando con datos más recientes del restaurante.",
  "role.bucket.heading": "Restaurar desde mi bucket",
  "role.bucket.copy":
    "Reconstruye el restaurante en este servidor nuevo a partir de la copia continua de tu propio bucket de almacenamiento, cuando el servidor anterior ya no esté. Necesitas el paquete de recuperación o el archivo del kit.",
  "role.back": "Volver",

  "connect.heading": "Unirse al servidor principal",
  "connect.intro":
    "Este servidor se une al servidor principal como servidor de reserva. Guarda una copia al día de los datos del local, así que puede tomar el relevo si el servidor principal falla o cuando elijas un traspaso planificado.",
  "connect.primary_url.label": "Dirección del servidor principal",
  "connect.primary_url.error": "Escribe la dirección del servidor principal.",
  "connect.primary_url.refused":
    "No se puede usar esta dirección. Escribe el nombre del servidor principal, empezando por https://, por ejemplo https://waitron.local. No se acepta una dirección IP de la red del local, como https://192.168.1.10.",
  "connect.primary_url.hint": "https://waitron.local",
  "connect.fix_fields": "Corrige los campos marcados para continuar.",
  "connect.back": "Volver",
  "connect.join": "Unirse",
  "connect.start_again": "Empezar de nuevo",
  "connect.no": "No",
  "connect.try_again": "Volver a intentar",
  "connect.finish.bundle_fetch_failed":
    "Este servidor no ha podido obtener del servidor principal una copia que supere la comprobación, así que no se ha instalado nada. En la página Servidores del servidor principal, elige Retirar en la fila de este servidor y después Quitar de la lista. Luego elige Empezar de nuevo aquí para obtener un código nuevo.",
  "connect.reading": "Comprobando la unión de este servidor…",
  "connect.waiting.open_link": "Abre la página Servidores del servidor principal",
  "connect.waiting.open_after": " y elige Comprobar junto a la solicitud de este servidor.",
  "connect.waiting.lead": "¿El servidor principal muestra este código?",
  "connect.waiting.confirmed": "Ahora elige Añadir como reserva en el servidor principal.",
  "connect.waiting.time_left": "Tiempo restante: {minutes} min",
  "connect.approved": "El servidor principal ha añadido este servidor.",
  "connect.approved.finishing": "Este servidor está terminando de unirse…",
  "connect.elsewhere":
    "Se empezó una unión desde otra página o dispositivo. Esta página no puede mostrar su código. Elige Empezar de nuevo para empezar una aquí; la unión de la otra página terminará.",
  "connect.replaced":
    "La unión de esta página se terminó desde otra página o dispositivo, así que su código ya no vale. Elige Empezar de nuevo para obtener un código nuevo.",
  "connect.ended.dismissed":
    "En el servidor principal se descartó esta solicitud o se respondió No. Elige Empezar de nuevo para volver a pedir la unión.",
  "connect.ended.cancelled":
    "Esta solicitud se canceló, así que su código ya no vale y no se ha enviado nada. Elige Empezar de nuevo para obtener un código nuevo.",
  "connect.ended.stopped":
    "El servidor principal se detuvo a medias al aprobar este servidor, así que no se ha instalado nada. En la página Servidores del servidor principal, elige Retirar en la fila de este servidor y después Quitar de la lista. Luego elige Empezar de nuevo aquí.",
  "connect.ended.unknown":
    "El servidor principal terminó esta solicitud, así que su código ya no vale y no se ha enviado nada. Elige Empezar de nuevo para obtener un código nuevo.",
  "connect.ended.code_taken":
    "El servidor principal necesita que este servidor vuelva a pedir la unión. Elige Empezar de nuevo.",
  "connect.ended.invalid":
    "El servidor principal no ha podido leer la solicitud de este servidor. Elige Empezar de nuevo. Si vuelve a pasar, comprueba que los dos servidores tienen la misma versión de Waitron.",
  "connect.failed":
    "Esta unión se detuvo, así que su código ya no vale y no se ha enviado nada. Elige Empezar de nuevo para obtener un código nuevo.",
  "connect.failed.not_found":
    "El servidor principal ya no tiene esta solicitud: se agotó el tiempo o se reinició. Elige Empezar de nuevo.",
  "connect.failed.copy_invalid":
    "El servidor principal aprobó este servidor, pero la copia que envió no ha superado la comprobación, así que no se ha instalado nada. En la página Servidores del servidor principal, elige Retirar en la fila de este servidor y después Quitar de la lista. Luego elige Empezar de nuevo aquí.",
  "connect.refusal.join_invalid":
    "El servidor principal no ha podido leer la solicitud de este servidor. Vuelve a elegir Unirse. Si pasa otra vez, comprueba que los dos servidores tienen la misma versión de Waitron.",
  "connect.refusal.join_not_found":
    "El servidor principal ya no tiene esta solicitud: se agotó el tiempo o se reinició. Vuelve a elegir Unirse.",
  "connect.refusal.join_address_mismatch":
    "El servidor principal recibió la solicitud de este servidor desde una dirección de red que este servidor no tiene, así que algo en la red podría estar reenviándola. Vuelve a elegir Unirse. Si pasa otra vez, comprueba qué hay conectado entre los dos servidores.",
  "connect.refusal.join_code_taken":
    "El servidor principal necesita que este servidor vuelva a pedir la unión. Vuelve a elegir Unirse.",
  "connect.refusal.join_full_address":
    "El servidor principal ha recibido demasiadas solicitudes desde la dirección de este servidor en el último minuto. Espera un minuto y vuelve a elegir Unirse.",
  "connect.refusal.join_full_network":
    "El servidor principal ha recibido demasiadas solicitudes para unirse desde la red en el último minuto. Espera un minuto y vuelve a elegir Unirse. Si sigue pasando, algo en la red las está enviando.",
  "connect.refusal.join_full_listed":
    "Ya hay otros {max} servidores pidiendo unirse al servidor principal. En su página Servidores, descarta los que no reconozcas y vuelve a elegir Unirse aquí.",
  "connect.refusal.join_full_recent":
    "El servidor principal ha recibido {max} solicitudes para unirse en los últimos {minutes} minutos, contando las terminadas con Empezar de nuevo, que su página Servidores ya no muestra. Espera hasta las {retryAt} y vuelve a elegir Unirse. Descartar una solicitud en su página Servidores libera un sitio antes.",
  "connect.refusal.join_waiting":
    "Este servidor ya está esperando para unirse, o todavía está terminando su última solicitud. Elige Empezar de nuevo para cancelar esa solicitud y hacer otra.",
  "connect.refusal.join_approving":
    "El servidor principal ya está añadiendo este servidor, así que la solicitud no se puede terminar desde aquí. Espera un momento: este servidor terminará de unirse, o esta página dirá qué ha fallado.",
  "connect.refusal.join_in_use":
    "La unión de este servidor está abierta ahora en otra página o dispositivo. Termínala o cancélala allí. Si esa página está cerrada, espera 15 segundos y elige Empezar de nuevo aquí.",
  "connect.refusal.join_handle_invalid":
    "Esta unión se empezó en otra página o dispositivo, así que esta página no puede terminarla. Termínala allí o elige Empezar de nuevo.",
  "connect.refusal.unreachable":
    "Este servidor no ha recibido una respuesta útil del servidor principal en esa dirección. Comprueba la dirección y que el servidor principal está encendido, y vuelve a elegir Unirse.",
  "connect.refusal.clocks_apart":
    "Los relojes de los dos servidores tienen más de 10 minutos de diferencia (el principal marca {primaryAt}, este servidor {standbyAt}). Si la hora de este servidor es incorrecta, conéctalo a internet un minuto para que ajuste su reloj y vuelve a elegir Unirse.",
  "connect.refusal.name_taken":
    "Este servidor eligió un nombre que ya usa otro servidor del local. No se ha cambiado nada. Vuelve a elegir Unirse: tomará otro nombre.",
  "connect.refusal.insecure":
    "Esta página no usa una conexión segura, así que este servidor no se unirá desde ella. Abre la página de configuración de este servidor en una dirección que empiece por https:// e inténtalo de nuevo.",
  "connect.refusal.adopt_incomplete":
    "Una unión anterior de este servidor se detuvo a medias. Recarga esta página para ver cómo resolverlo.",
  "connect.refusal.generic":
    "Este servidor no ha podido hacerlo ahora. Comprueba la dirección y que el servidor principal está encendido, e inténtalo de nuevo.",

  "mode.heading": "Configura este servidor",
  "mode.other_box": "Ya hay otro servidor Waitron con un restaurante en marcha en esta red.",
  "mode.join_spare.heading": "Unirse como reserva",
  "mode.join_spare.copy":
    "Añade este servidor como reserva del restaurante que ya está en marcha. Puede tomar el relevo si el servidor principal falla.",
  "mode.others.heading": "Otras opciones",
  "mode.demo.heading": "Demostración",
  "mode.demo.copy":
    "Un servidor de práctica. No se envía nada a la AEAT, así que puedes explorarlo y descartarlo sin riesgo.",
  "mode.prepare.heading": "Prepara tu restaurante",
  "mode.prepare.copy":
    "Introduce tus cartas, tu personal y tus planos reales, y practica con pagos de prueba. No se envía nada a la AEAT.",
  "mode.live.heading": "Empezar un restaurante nuevo",
  "mode.live.copy": "Cada venta se envía a la AEAT. No podrás cambiarlo después.",
  "mode.existing.heading": "Unirse a un restaurante o recuperarlo",
  "mode.existing.copy":
    "Añade este servidor como reserva de un restaurante que ya está en marcha, o recupera uno desde una copia de seguridad.",
  "mode.recover.heading": "Recuperar un restaurante",
  "mode.recover.copy": "Recupera un restaurante desde una copia de seguridad.",
  "mode.confirm.heading": "Esto es permanente",
  "mode.confirm.warning":
    "Un restaurante nuevo envía cada venta a la AEAT y NUNCA puede convertirse en uno de demostración: es permanente.",
  "mode.confirm.understand": "Entiendo que no se puede deshacer",
  "mode.confirm.back": "Volver",
  "mode.confirm.button": "Empezar un restaurante nuevo",

  "admin.heading": "Tu cuenta",
  "admin.intro":
    "Crea la cuenta que gestiona este servidor. Puedes añadir más personas más adelante.",
  "admin.first_names.label": "Nombre(s)",
  "admin.first_names.error": "Introduce tu nombre o nombres.",
  "admin.first_names.hint": "Como en tu documento",
  "admin.last_names.label": "Apellido(s)",
  "admin.last_names.error": "Introduce tus apellidos.",
  "admin.last_names.hint": "Como en tu documento",
  "admin.display_name.label": "Nombre visible",
  "admin.display_name.error": "Introduce tu nombre visible.",
  "admin.display_name.hint": "El nombre que ven tus compañeros",
  "admin.email.label": "Correo electrónico",
  "admin.email.error": "Introduce tu correo electrónico.",
  "admin.email.hint": "Para entrar y recuperar tu cuenta",
  "admin.password.label": "Contraseña",
  "admin.password.error": "Introduce tu contraseña.",
  "admin.password.hint": "Para entrar en el panel",
  "admin.pin.label": "PIN",
  "admin.pin.error": "Introduce tu PIN.",
  "admin.pin.hint": "Cifras, para entrar en la caja",
  "admin.show_password": "Mostrar contraseña",
  "admin.hide_password": "Ocultar contraseña",
  "admin.password_shown": "Contraseña visible",
  "admin.password_hidden": "Contraseña oculta",
  "admin.show_pin": "Mostrar PIN",
  "admin.hide_pin": "Ocultar PIN",
  "admin.fix_fields": "Corrige los campos marcados para continuar.",
  "admin.back": "Volver",
  "admin.next": "Siguiente",

  "old_box.problem": "Confirma que el servidor anterior está apagado para siempre.",
  "old_box.wrote_at": "El servidor anterior escribió en su bucket el",
  "old_box.unchecked":
    "No se ha podido comprobar si el servidor anterior sigue escribiendo en su bucket.",
  "old_box.consequence":
    "Si sigue funcionando, dos servidores venderían a partir de los mismos registros, y eso no se puede deshacer. Apágalo para siempre antes de continuar.",
  "old_box.gone": "El servidor anterior está apagado para siempre.",

  "server_fields.legal_name":
    "Usa 120 caracteres como máximo y quita los caracteres ocultos que los registros de la Agencia Tributaria no admiten; suele bastar con escribir el nombre en lugar de pegarlo.",
  "server_fields.tax_id": "Revisa el NIF. Un negocio nuevo necesita el suyo.",
  "server_fields.taxpayer_domicile": "Introduce el domicilio fiscal completo del negocio.",
  "server_fields.day_cutover":
    "Esa no es una hora del día. Introduce una entre las 00:00 y las 23:59, por ejemplo las 04:00.",
  "server_fields.series_code":
    "Usa solo letras, números y los caracteres / _ . y - (hasta 21 caracteres).",
};
