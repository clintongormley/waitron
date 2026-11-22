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
  "connection.install_before_continuing":
    ", install this server's certificate before you continue.",
  "connection.install_certificate": "Install certificate",
  "connection.checking": "Checking connection…",
  "connection.continue": "Continue to setup",
  "connection.join": "Join or recover",
  "connection.join_hint": "Joining or recovering doesn't need the certificate.",

  "role.heading": "Join or recover an existing restaurant",
  "role.intro":
    "Restore a backup onto this server when no other server is still running with newer restaurant data, or rebuild from the continuous copy in your own storage bucket when the old server is gone. A mirror can take over only after it has joined a running primary.",
  "role.mirror.heading": "Add a mirror node",
  "role.mirror.copy":
    "This server joins the primary and keeps a copy of the restaurant's data. Once it has joined, it can take over: by a handover from the primary's Servers page, or by an emergency switch if the primary fails. A new server cannot join a primary that is already gone: to recover then, choose Restore from backup or Restore from my bucket.",
  "role.restore.heading": "Restore from backup",
  "role.restore.copy":
    "Recover onto this fresh server from an encrypted Waitron backup when no other server is still running with newer restaurant data.",
  "role.bucket.heading": "Restore from my bucket",
  "role.bucket.copy":
    "Rebuild onto this fresh server from the continuous copy in your own storage bucket, when the old server is gone. You need the recovery pack or kit file.",
  "role.back": "Back",

  "connect.heading": "Join the main box",
  "connect.intro":
    "This box joins your venue's main box and keeps a copy of its data. Once it has joined, it can take over: by a handover from the main box's Servers page, or by an emergency switch if the main box fails. Enter the main box's address and choose Join. To restore a backup instead, choose Back.",
  "connect.primary_url.label": "Main box address",
  "connect.primary_url.error": "Enter the main box's address.",
  "connect.primary_url.refused":
    "This address can't be used. Enter the main box's name, starting with https://, for example https://waitron.local. An IP address on the venue's network, such as https://192.168.1.10, is not accepted.",
  "connect.primary_url.hint": "For example https://waitron.local",
  "connect.fix_fields": "Correct the highlighted fields to continue.",
  "connect.back": "Back",
  "connect.join": "Join",
  "connect.start_again": "Start again",
  "connect.finish": "Finish joining",
  "connect.finish.bundle_fetch_failed":
    "This box could not get a copy from the main box that checks out, so nothing was installed. On the main box's Servers page, choose Remove in this box's row, then Clear from list. Then choose Start again here for a new code.",
  "connect.reading": "Checking this box's join…",
  "connect.waiting.lead":
    "On the main box, open System → Servers, choose Check beside the request from this box, and tap this code:",
  "connect.waiting.addresses":
    "The request on the main box should come from one of this box's addresses: {addresses}",
  "connect.waiting.main": "Main box: {primaryUrl}",
  "connect.waiting.time_left": "Time left: {minutes} min",
  "connect.approved": "The main box approved a join with code {code}.",
  "connect.approved.hint":
    "Choose Finish joining only if you tapped that code on the main box. If you did not, choose Start again here. On the main box's Servers page, choose Remove in this box's row, then Clear from list.",
  "connect.elsewhere":
    "A join was started from another page or device. This page cannot show its code. Choose Start again to start one here; the other page's join then ends.",
  "connect.replaced":
    "This page's join was ended from another page or device, so its code no longer counts. Do not tap it on the main box. Choose Start again for a new code.",
  "connect.ended.wrong_code":
    "On the main box, a code that is not this box's was chosen, so this request has ended and nothing was sent. Choose Start again for a new code.",
  "connect.ended.dismissed":
    "The main box's Servers page dismissed this request. Choose Start again to ask again.",
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
    "The main box is approving this join, or has just stopped approving it, so it cannot be stopped from here. Wait a moment: this page then shows the main box's answer.",
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

  "mode.heading": "Set up this Waitron server",
  "mode.intro":
    "This server runs the till and files fiscal records. Set it up once here, then it restarts into everyday trading mode.",
  "mode.cert_note": "If your browser shows a certificate warning,",
  "mode.cert_note_link": "open certificate help",
  "mode.production_warning":
    "This server is stamped for production — provisioning files real records to AEAT.",
  "mode.demo.heading": "Demo",
  "mode.demo.copy": "A practice server. Nothing is filed to AEAT — safe to explore and throw away.",
  "mode.prepare.heading": "Prepare your restaurant",
  "mode.prepare.copy":
    "Enter your real menus, staff and layouts, then practise with test payments. Nothing is filed to AEAT.",
  "mode.live.heading": "Live",
  "mode.live.copy": "The real thing. Every sale is filed to AEAT. This choice is permanent.",
  "mode.existing.heading": "Already have a restaurant?",
  "mode.existing.copy":
    "Add this server as a mirror of a running restaurant, or recover a restaurant from a backup.",
  "mode.existing.choice": "Join or recover",
  "mode.confirm.heading": "This is permanent",
  "mode.confirm.warning":
    "A live server files real invoices to AEAT and can NEVER become a demo — this is permanent.",
  "mode.confirm.understand": "I understand this cannot be undone",
  "mode.confirm.back": "Back",
  "mode.confirm.button": "Set up this live server",

  "admin.heading": "Your account",
  "admin.intro": "Create the account that manages this server. You can add more people later.",
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

  "old_box.problem": "Confirm that the old server is switched off for good.",
  "old_box.wrote_at": "The old server wrote to its bucket at",
  "old_box.unchecked":
    "Whether the old server is still writing to its bucket could not be checked.",
  "old_box.consequence":
    "If it is still running, two servers would sell from the same records, and that cannot be undone. Switch it off for good before you go on.",
  "old_box.gone": "The old server is switched off for good.",

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
    "Este servidor se une al servidor principal de tu local y guarda una copia de sus datos. Una vez unido, puede tomar el relevo: con un traspaso desde la página Servidores del servidor principal, o con un cambio de emergencia si el servidor principal falla. Escribe la dirección del servidor principal y elige Unirse. Para restaurar una copia de seguridad, elige Volver.",
  "connect.primary_url.label": "Dirección del servidor principal",
  "connect.primary_url.error": "Escribe la dirección del servidor principal.",
  "connect.primary_url.refused":
    "No se puede usar esta dirección. Escribe el nombre del servidor principal, empezando por https://, por ejemplo https://waitron.local. No se acepta una dirección IP de la red del local, como https://192.168.1.10.",
  "connect.primary_url.hint": "Por ejemplo https://waitron.local",
  "connect.fix_fields": "Corrige los campos marcados para continuar.",
  "connect.back": "Volver",
  "connect.join": "Unirse",
  "connect.start_again": "Empezar de nuevo",
  "connect.finish": "Terminar la unión",
  "connect.finish.bundle_fetch_failed":
    "Este servidor no ha podido obtener del servidor principal una copia que supere la comprobación, así que no se ha instalado nada. En la página Servidores del servidor principal, elige Retirar en la fila de este servidor y después Quitar de la lista. Luego elige Empezar de nuevo aquí para obtener un código nuevo.",
  "connect.reading": "Comprobando la unión de este servidor…",
  "connect.waiting.lead":
    "En el servidor principal, abre Sistema → Servidores, elige Comprobar junto a la solicitud de este servidor y toca este código:",
  "connect.waiting.addresses":
    "La solicitud en el servidor principal debe venir de una de las direcciones de este servidor: {addresses}",
  "connect.waiting.main": "Servidor principal: {primaryUrl}",
  "connect.waiting.time_left": "Tiempo restante: {minutes} min",
  "connect.approved": "El servidor principal aprobó una unión con el código {code}.",
  "connect.approved.hint":
    "Elige Terminar la unión solo si tocaste ese código en el servidor principal. Si no, elige Empezar de nuevo aquí. En la página Servidores del servidor principal, elige Retirar en la fila de este servidor y después Quitar de la lista.",
  "connect.elsewhere":
    "Se empezó una unión desde otra página o dispositivo. Esta página no puede mostrar su código. Elige Empezar de nuevo para empezar una aquí; la unión de la otra página terminará.",
  "connect.replaced":
    "La unión de esta página se terminó desde otra página o dispositivo, así que su código ya no vale. No lo toques en el servidor principal. Elige Empezar de nuevo para obtener un código nuevo.",
  "connect.ended.wrong_code":
    "En el servidor principal se eligió un código que no es el de este servidor, así que esta solicitud ha terminado y no se ha enviado nada. Elige Empezar de nuevo para obtener un código nuevo.",
  "connect.ended.dismissed":
    "En la página Servidores del servidor principal se descartó esta solicitud. Elige Empezar de nuevo para volver a pedir la unión.",
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
    "El servidor principal está aprobando esta unión, o acaba de dejar de aprobarla, así que no se puede detener desde aquí. Espera un momento: esta página mostrará después la respuesta del servidor principal.",
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

  "mode.heading": "Configura este servidor Waitron",
  "mode.intro":
    "Este servidor hace funcionar la caja y envía los registros fiscales. Configúralo aquí una vez y después se reiniciará en el modo de venta diaria.",
  "mode.cert_note": "Si tu navegador muestra un aviso de certificado,",
  "mode.cert_note_link": "abre la ayuda sobre el certificado",
  "mode.production_warning":
    "Este servidor está marcado para producción: al configurarlo se envían registros reales a la AEAT.",
  "mode.demo.heading": "Demostración",
  "mode.demo.copy":
    "Un servidor de práctica. No se envía nada a la AEAT: puedes explorarlo y descartarlo sin riesgo.",
  "mode.prepare.heading": "Prepara tu restaurante",
  "mode.prepare.copy":
    "Introduce tus cartas, tu personal y tus planos reales, y practica con pagos de prueba. No se envía nada a la AEAT.",
  "mode.live.heading": "En vivo",
  "mode.live.copy": "El de verdad. Cada venta se envía a la AEAT. Esta elección es permanente.",
  "mode.existing.heading": "¿Ya tienes un restaurante?",
  "mode.existing.copy":
    "Añade este servidor como réplica de un restaurante en funcionamiento, o recupera un restaurante desde una copia de seguridad.",
  "mode.existing.choice": "Unirse o recuperar",
  "mode.confirm.heading": "Esto es permanente",
  "mode.confirm.warning":
    "Un servidor en vivo envía facturas reales a la AEAT y NUNCA puede convertirse en uno de demostración: es permanente.",
  "mode.confirm.understand": "Entiendo que no se puede deshacer",
  "mode.confirm.back": "Volver",
  "mode.confirm.button": "Configurar este servidor en vivo",

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
