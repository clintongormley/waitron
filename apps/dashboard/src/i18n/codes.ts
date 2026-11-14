import {
  codeMessage as registeredCodeMessage,
  codeOf,
  registerCodeMessages,
} from "@waitron/dashboard-kit";
import { t, currentLocale, pickLocale } from "./t.js";
import { en, es } from "./strings.js";

// Add new codes with BOTH columns.
const CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "person.job_roles_changed": {
    en: "Someone changed this person's job roles while you were editing. Reload to see them; your changes are kept until you do.",
    es: "Alguien cambió los puestos de esta persona mientras editabas. Recarga para verlos; tus cambios se conservan hasta entonces.",
  },
  "management_session.proof_required": {
    en: "Confirm it is you to continue. The action has not been carried out.",
    es: "Confirma que eres tú para continuar. La acción no se ha realizado.",
  },
  "node.spare": {
    en: "This box is the spare. Open the main box's address for restaurant screens and data.",
    es: "Este es el equipo de reserva. Abre la dirección del equipo principal para acceder a las pantallas y los datos del local.",
  },
  "connection.cancelled": {
    en: "The request was stopped. Its result is unavailable.",
    es: "Se ha parado la solicitud. Su resultado no está disponible.",
  },
  "fiscal.fingerprint_mismatch": {
    en: "Fingerprint check failed; ask a manager.",
    es: "Ha fallado la comprobación de la huella; avisa a un responsable.",
  },
  "fiscal.chain_handed_over": {
    en: "This server is no longer the main server, so it cannot add new records for the tax agency. Open this page on the main server.",
    es: "Este servidor ya no es el servidor principal, así que no puede añadir registros nuevos para Hacienda. Abre esta página en el servidor principal.",
  },
  "invoice_customer.not_found": {
    en: "No full invoice names that tax number.",
    es: "Ninguna factura completa lleva ese NIF.",
  },
  "venue.time_zone_invalid": {
    en: en["zone_repair.invalid_zone"],
    es: es["zone_repair.invalid_zone"],
  },
  "venue.time_zone_conversion_failed": {
    en: en["zone_repair.conversion_failed"],
    es: es["zone_repair.conversion_failed"],
  },
  "venue.time_zone_repair_not_needed": {
    en: en["zone_repair.not_needed"],
    es: es["zone_repair.not_needed"],
  },
  "attendance.state_changed": {
    en: "The attendance record changed. Read its latest history before responding.",
    es: "El registro de horas ha cambiado. Consulta el historial actual antes de responder.",
  },
  "correction.not_pending": {
    en: "This request has changed. Read its latest history before responding.",
    es: "Esta solicitud ha cambiado. Consulta el historial actual antes de responder.",
  },
  "correction.not_permitted": {
    en: "You cannot authorise this change. Ask another eligible manager.",
    es: "No puedes autorizar este cambio. Pide ayuda a otro responsable autorizado.",
  },
  "correction.invalid": {
    en: "These times cannot be applied to the current attendance record. Check the day and times.",
    es: "Estas horas no se pueden aplicar al registro actual. Revisa la jornada y las horas.",
  },
  "correction.target_not_found": {
    en: "This time entry could not be found. Read the day again.",
    es: "No se ha encontrado este fichaje. Vuelve a consultar la jornada.",
  },
  "attendance.not_pending": {
    en: "This question no longer needs an answer. Read the day again.",
    es: "Esta pregunta ya no necesita respuesta. Vuelve a consultar la jornada.",
  },

  "ticket.extra_not_movable": {
    en: "Extras cannot be moved separately",
    es: "Los extras no se pueden pasar por separado",
  },
  "cloud.unavailable": {
    en: "Waitron could not reach Cloud or verify its reply. Try again.",
    es: "Waitron no pudo conectar con Cloud o verificar su respuesta. Vuelve a intentarlo.",
  },
  "cloud.tunnel_unavailable": {
    en: "The staff tunnel could not be configured on this box. Check its tunnel configuration and refresh status to try again.",
    es: "No se pudo configurar el túnel del personal en esta caja. Revisa su configuración del túnel y actualiza el estado para volver a intentarlo.",
  },
  "cloud.tunnel_conflict": {
    en: "This tunnel setup conflicts with a connection already saved in Cloud. Automatic attempts have stopped. You can stop Cloud access here; local trading continues.",
    es: "Esta configuración del túnel entra en conflicto con una conexión ya guardada en Cloud. Los intentos automáticos se han detenido. Puedes detener el acceso a Cloud aquí; las ventas locales siguen funcionando.",
  },
  "cloud.request_unavailable": {
    en: "This request is unavailable. Start again to get a new code.",
    es: "Esta solicitud no está disponible. Empieza de nuevo para obtener otro código.",
  },
  "cloud.state_invalid": {
    en: "The saved Cloud connection cannot be read. Check this server’s Cloud configuration.",
    es: "No se puede leer la conexión Cloud guardada. Revisa la configuración Cloud de este servidor.",
  },
  "cloud.binding_conflict": {
    en: "The connection details changed or the previous request is still active. Check the connection before trying again.",
    es: "Los datos de conexión han cambiado o la solicitud anterior sigue activa. Comprueba la conexión antes de volver a intentarlo.",
  },
  "cloud.busy": {
    en: "A connection operation is in progress. Wait a moment and try again.",
    es: "Hay una operación de conexión en curso. Espera un momento y vuelve a intentarlo.",
  },
  "cloud.not_primary": {
    en: "Open this page on your serving primary server to connect the venue.",
    es: "Abre esta página en el servidor principal activo para conectar el local.",
  },
  "cloud.not_configured": {
    en: "This server is not connected to Waitron Cloud",
    es: "Este servidor no está conectado a Waitron Cloud",
  },
  "cloud.request_invalid": {
    en: "Check the connection details and try again.",
    es: "Revisa los datos de conexión y vuelve a intentarlo.",
  },
  "cloud.replacement_not_restored": {
    en: "Finish restoring and reporting the approved Cloud snapshot on this server, then request reconnection.",
    es: "Termina la restauración de la instantánea aprobada de Cloud en este servidor y comunícala antes de solicitar la reconexión.",
  },
  "cloud.replacement_state_invalid": {
    en: "The saved Cloud reconnection request on this box cannot be read. Choose “Get a fresh reconnection request” to set it aside and ask Cloud for a new one; the Cloud owner then approves it as before.",
    es: "No se puede leer la solicitud guardada de reconexión con Cloud de este equipo. Elige «Obtener una nueva solicitud de reconexión» para apartarla y pedir una nueva a Cloud; después, el propietario de Cloud la aprueba como antes.",
  },
  "cloud.replacement_refused": {
    en: "Cloud refused the replacement request. Check the approved recovery and old installation in Cloud, then check reconnection here.",
    es: "Cloud rechazó la solicitud de sustitución. Comprueba la recuperación aprobada y la instalación anterior en Cloud, y después comprueba la reconexión aquí.",
  },

  "business_day.clock_invalid": {
    en: "The venue’s business-day clock cannot be read.",
    es: "No se puede leer el reloj del día del local.",
  },
  "venue.business_day_invalid": {
    en: "Check the start time.",
    es: "Revisa la hora de inicio.",
  },
  "venue.business_day_changed": {
    en: "The business-day clock changed. Reopen the editor.",
    es: "El inicio del día ha cambiado. Vuelve a abrir el editor.",
  },
  "venue.business_day_locked": { en: "This change is locked.", es: "Este cambio está bloqueado." },
  "venue.business_day_hours_conflict": {
    en: "Review conflicting opening hours first.",
    es: "Revisa primero los horarios incompatibles.",
  },
  "connection.failed": {
    en: "This browser could not connect to Waitron. Check your connection and try again.",
    es: "Este navegador no pudo conectar con Waitron. Comprueba tu conexión e inténtalo de nuevo.",
  },
  "connection.timed_out": {
    en: "Waitron is taking too long to answer. Try again in a moment.",
    es: "Waitron está tardando demasiado en responder. Inténtalo de nuevo en un momento.",
  },
  "category.not_found": {
    en: "This category no longer exists. Refresh the list.",
    es: "Esta categoría ya no existe. Actualiza la lista.",
  },
  "category.invalid": {
    en: "Enter a name for the category.",
    es: "Introduce un nombre para la categoría.",
  },
  "category.parent_cycle": {
    en: "Choose a parent outside this category and its descendants.",
    es: "Elige una categoría superior fuera de esta categoría y sus descendientes.",
  },
  "category.name_taken": {
    en: "Another category in the same place already has this name.",
    es: "Otra categoría en el mismo lugar ya tiene este nombre.",
  },
  "category.contents_changed": {
    en: "What these categories hold has changed, so nothing was deleted. Check the new counts and try again.",
    es: "Lo que contienen estas categorías ha cambiado, así que no se ha eliminado nada. Revisa las nuevas cifras y vuelve a intentarlo.",
  },
  "menu_section.not_found": {
    en: "This section, or the item in it, no longer exists. Refresh the list.",
    es: "Esta sección, o el elemento que contiene, ya no existe. Actualiza la lista.",
  },
  "menu_section.invalid": {
    en: "Check the section's details or the position you chose, and try again.",
    es: "Revisa los datos de la sección o la posición elegida y vuelve a intentarlo.",
  },
  "menu_section.translation_required": {
    en: "Add the section's customer-facing name in the default content language, or remove the customer-facing names.",
    es: "Añade el nombre de la sección para el cliente en el idioma de contenido predeterminado, o quita los nombres para el cliente.",
  },
  "menu_section.member_cycle": {
    en: "A section cannot contain itself, directly or through another section.",
    es: "Una sección no puede contenerse a sí misma, ni directamente ni a través de otra sección.",
  },
  "menu_section.member_duplicate": {
    en: "This list already contains that item.",
    es: "Esta lista ya contiene ese elemento.",
  },
  "menu_section.wrong_role": {
    en: "A menu's own list cannot be used this way.",
    es: "La lista propia de una carta no se puede usar de esta forma.",
  },
  "menu_section.membership_invalid": {
    en: "Some of the chosen items cannot be used. Refresh the list and try again.",
    es: "Algunos de los elementos elegidos no se pueden usar. Actualiza la lista e inténtalo de nuevo.",
  },
  "menu.reset_required": {
    en: "This venue has a menu in an unsupported format. Reset the venue before using menus.",
    es: "Este local tiene una carta en un formato no compatible. Restablece el local antes de usar las cartas.",
  },
  "menu.shortcut_unreachable": {
    en: "Only products and sections that are on this menu can be shortcuts on its Device Home Page.",
    es: "Solo los productos y secciones que están en esta carta pueden ser accesos directos en su página de inicio del dispositivo.",
  },
  "menu.home_display_invalid": {
    en: "That home page setting is not available for this device. Refresh the page and try again.",
    es: "Ese ajuste de la página de inicio no está disponible para este dispositivo. Actualiza la página e inténtalo de nuevo.",
  },
  "menu.clashes_unresolved": {
    en: "Resolve the price clashes before publishing this menu.",
    es: "Resuelve los conflictos de precio antes de publicar esta carta.",
  },
  "menu.changed_since_preview": {
    en: "This menu changed after the preview was shown, so it was not published. Check the new preview and publish again.",
    es: "Esta carta ha cambiado después de mostrar la vista previa, así que no se ha publicado. Revisa la nueva vista previa y vuelve a publicarla.",
  },
  "menu_patch.base_changed": {
    en: "Another version went live while you were patching. Reload to patch it instead; changes that still fit are kept.",
    es: "Otra versión se ha publicado mientras corregías la carta. Vuelve a cargar para corregir esa versión; se conservan las correcciones que todavía encajan.",
  },
  "menu_patch.unchanged": {
    en: "These values are already live. Nothing was saved.",
    es: "Estos valores ya están publicados. No se ha guardado nada.",
  },
  "menu_patch.not_published": {
    en: "This menu has never been published, so there is nothing live to patch. Publish it first.",
    es: "Esta carta no se ha publicado nunca, así que no hay nada publicado que corregir. Publícala primero.",
  },
  "menu_patch.invalid": {
    en: "Check this value.",
    es: "Revisa este valor.",
  },
  "menu_publication.overtakes_queued": {
    en: "A version that is already scheduled would go live in the wrong order. Cancel it or change its time, then try again.",
    es: "Una versión ya programada se publicaría en el orden equivocado. Cancélala o cambia su hora y vuelve a intentarlo.",
  },
  "menu_publication.not_found": {
    en: "That scheduled version no longer exists. Refresh the list and try again.",
    es: "Esa versión programada ya no existe. Actualiza la lista y vuelve a intentarlo.",
  },
  "menu_publication.not_queued": {
    en: "That version is no longer scheduled: it has already gone live or been cancelled.",
    es: "Esa versión ya no está programada: ya se ha publicado o se ha cancelado.",
  },
  "menu_publication.time_past": {
    en: "Choose a time later than now.",
    es: "Elige una hora posterior a la actual.",
  },
  "menu_publication.unchanged": {
    en: "Nothing to schedule: this menu is the same as the version it would follow.",
    es: "No hay nada que programar: esta carta es igual que la versión a la que seguiría.",
  },
  "menu_publication.time_skipped": {
    en: "The venue's clock never shows that time, because the clocks go forward past it. Choose another time.",
    es: "El reloj del local nunca marca esa hora, porque se adelanta al cambiar la hora. Elige otra hora.",
  },
  "menu_publication.time_repeated": {
    en: "The venue's clock shows that time twice, because the clocks go back. Choose which one.",
    es: "El reloj del local marca esa hora dos veces, porque se atrasa al cambiar la hora. Elige cuál.",
  },
  "time_zone.unreadable": {
    en: "The venue's time zone or day cutover cannot be read. Check them in Venue details.",
    es: "No se puede leer la zona horaria o el corte del día del local. Revísalos en Datos del local.",
  },
  "sale_classification.invalid": {
    en: "Today's categories could not be read: a product's category setup is inconsistent. The report at time of sale still works.",
    es: "No se pudieron leer las categorías actuales: la configuración de categorías de un producto no es coherente. El informe en el momento de la venta sigue funcionando.",
  },

  "printer.probe_busy": {
    en: "Several addresses are being checked. Wait a moment and try again.",
    es: "Se están comprobando varias direcciones. Espera un momento e inténtalo de nuevo.",
  },
  "printer.bluetooth_command_busy": {
    en: "Several Bluetooth requests are already waiting for this print agent. Wait a moment and try again.",
    es: "Ya hay varias solicitudes Bluetooth esperando a este agente de impresión. Espera un momento e inténtalo de nuevo.",
  },
  "printer.bluetooth_not_discovered": {
    en: "This print agent has not found that Bluetooth device recently. Scan for printers, then try again.",
    es: "Este agente de impresión no ha encontrado ese dispositivo Bluetooth recientemente. Pulsa Buscar impresoras e inténtalo de nuevo.",
  },
  "printer.bluetooth_not_paired": {
    en: "This print agent no longer reports that Bluetooth device as paired.",
    es: "Este agente de impresión ya no indica que ese dispositivo Bluetooth esté emparejado.",
  },
  "printer.not_visible": {
    en: "No print agent currently sees this printer. Check the printer connection and print agent.",
    es: "Ningún agente de impresión ve esta impresora ahora. Comprueba la conexión de la impresora y el agente.",
  },
  "print_job.drawer_expired": {
    en: "The drawer command expired before it was sent. Open the drawer again if needed.",
    es: "La orden del cajón caducó antes de enviarse. Vuelve a abrirlo si hace falta.",
  },
  "print_job.drawer_outcome_unknown": {
    en: "No result was reported. The drawer may have opened. This command will not be retried.",
    es: "No se recibió el resultado. El cajón puede haberse abierto. Esta orden no se volverá a intentar.",
  },
  "printer.unpaired": {
    en: "The printer was unpaired, so this job will not be retried.",
    es: "La impresora se desvinculó, así que este trabajo no se volverá a intentar.",
  },
  "printer.deleted": {
    en: "The printer was deleted, so this job will not be retried.",
    es: "La impresora se eliminó, por lo que no se volverá a intentar este trabajo.",
  },
  "print_job.moved": {
    en: "Reprinted on another printer, so this job will not be retried.",
    es: "Se reimprimió en otra impresora, así que este trabajo no se volverá a intentar.",
  },
  "content.language_invalid": {
    en: "Choose a recognised language.",
    es: "Elige un idioma reconocido.",
  },
  "content.languages_invalid": {
    en: "Choose a default from your enabled languages and remove any duplicates.",
    es: "Elige un idioma predeterminado entre los disponibles y elimina los duplicados.",
  },
  "content.suggestion_job_running": {
    en: "Translate all is already running.",
    es: "Traducir todo ya está en marcha.",
  },
  "content.suggestion_consent_required": {
    en: "Your Waitron Cloud account must first agree to menu names going to its translation providers.",
    es: "Tu cuenta de Waitron Cloud debe aceptar primero que los nombres de la carta se envíen a sus proveedores de traducción.",
  },
  "content.suggestion_limit_reached": {
    en: "This month's translation limit is reached.",
    es: "Se ha alcanzado el límite de traducción de este mes.",
  },
  "content.suggestion_service_unavailable": {
    en: "The translation service failed. Try again later.",
    es: "El servicio de traducción ha fallado. Vuelve a intentarlo más tarde.",
  },
  "content.suggestion_expired": {
    en: "The results were deleted before Waitron collected them. Press Translate all again.",
    es: "Los resultados se borraron antes de que Waitron los recogiera. Pulsa Traducir todo de nuevo.",
  },
  "content.suggestion_not_found": {
    en: "That suggestion is no longer there.",
    es: "Esa sugerencia ya no existe.",
  },
  "content.translation_stale": {
    en: "These names or their language settings changed. Review the latest values before saving again.",
    es: "Estos nombres o su configuración de idiomas han cambiado. Revisa los valores actuales antes de volver a guardar.",
  },
  "content.translation_unavailable": {
    en: "An edited item is no longer available here. Review the latest items before saving again.",
    es: "Un elemento editado ya no está disponible aquí. Revisa los elementos actuales antes de volver a guardar.",
  },
  "content.translation_batch_invalid": {
    en: "Check the edited names and save up to 100 items at a time. Each name can use up to 4 KiB and the whole request up to 256 KiB.",
    es: "Revisa los nombres editados y guarda hasta 100 elementos cada vez. Cada nombre puede ocupar hasta 4 KiB y la solicitud completa hasta 256 KiB.",
  },
  "content.translation_refused": {
    en: "Check the marked name before saving again.",
    es: "Revisa el nombre señalado antes de volver a guardar.",
  },
  "content.translation_invalid": {
    en: "Enter text for each translation.",
    es: "Introduce texto para cada traducción.",
  },
  "content.translation_required": {
    en: "Enter the required text in the site's default language.",
    es: "Introduce el texto obligatorio en el idioma predeterminado del sitio.",
  },
  "content.language_required": {
    en: "Waitron keeps this language enabled for venues in this region, so it cannot be removed.",
    es: "Waitron mantiene este idioma activado en los locales de esta región, así que no se puede quitar.",
  },
  "unit.invalid": {
    en: "Enter the unit's staff name and abbreviation.",
    es: "Introduce el nombre y la abreviatura de la unidad para el personal.",
  },
  "unit.precision_invalid": {
    en: "Choose between 0 and 3 decimal places.",
    es: "Elige entre 0 y 3 decimales.",
  },
  "unit.not_found": {
    en: "That unit could not be found.",
    es: "No se ha encontrado esa unidad.",
  },
  "unit.in_use": {
    en: "That unit can't be deleted because products are still using it.",
    es: "Esa unidad no se puede eliminar porque todavía la usan algunos productos.",
  },
  "unit.translation_required": {
    en: "Enter the unit's name and abbreviation in the site's default language.",
    es: "Introduce el nombre y la abreviatura de la unidad en el idioma predeterminado del sitio.",
  },
  "management_session.required": {
    en: "Please log in to continue",
    es: "Inicia sesión para continuar",
  },
  "management_session.expired": {
    en: "Your session has expired — please log in again",
    es: "Tu sesión ha caducado. Vuelve a iniciar sesión",
  },
  "node.reset": {
    en: "This box was reset.",
    es: "Este equipo se ha restablecido.",
  },
  "password.invalid": {
    en: "Incorrect password, try again",
    es: "Contraseña incorrecta, inténtalo de nuevo",
  },
  "password.throttled": {
    en: "Too many incorrect attempts. Wait a moment before trying again.",
    es: "Demasiados intentos incorrectos. Espera un momento antes de volver a intentarlo.",
  },
  "password.reset_complete": {
    en: "Your password has been changed. Log in with it to continue.",
    es: "Tu contraseña se ha cambiado. Inicia sesión con ella para continuar.",
  },
  "profile.invalid": {
    en: "Check your profile details and try again.",
    es: "Revisa los datos de tu perfil y vuelve a intentarlo.",
  },
  "totp.invalid": {
    en: "Incorrect code, try again",
    es: "Código incorrecto, inténtalo de nuevo",
  },
  "totp.required": {
    en: "Enter your authenticator or recovery code",
    es: "Introduce el código del autenticador o un código de recuperación",
  },
  "passkey.not_registered": {
    en: "This passkey is no longer registered with Waitron",
    es: "Esta passkey ya no está registrada en Waitron",
  },
  "passkey.verification_failed": {
    en: "Could not verify the passkey. Try again.",
    es: "No se pudo verificar la passkey. Vuelve a intentarlo.",
  },
  "passkey.challenge_expired": {
    en: "The passkey request expired, try again",
    es: "La solicitud de passkey ha caducado, inténtalo de nuevo",
  },
  "passkey.registered": {
    en: "Passkey added",
    es: "Passkey añadida",
  },
  "passkey.already_registered": {
    en: "This device already holds a passkey for your account. Remove it first, or add a passkey from a different device or password manager.",
    es: "Este dispositivo ya tiene una passkey para tu cuenta. Elimínala primero o añade una passkey desde otro dispositivo o gestor de contraseñas.",
  },
  "google.invalid": {
    en: "Google could not complete the login. Try again or use another login method.",
    es: "Google no pudo completar el inicio de sesión. Inténtalo de nuevo o usa otro método.",
  },
  "google.already_linked": {
    en: "That Google account is already linked to another user.",
    es: "Esa cuenta de Google ya está vinculada a otro usuario.",
  },
  "google.second_factor_required": {
    en: "This account also requires an authenticator code. Log in with your password instead.",
    es: "Esta cuenta también requiere un código de autenticación. Inicia sesión con tu contraseña.",
  },
  "person.self_deactivation": {
    en: "You cannot disable your own account. Ask another administrator.",
    es: "No puedes deshabilitar tu propia cuenta. Pídeselo a otro administrador.",
  },
  "person.suspended": {
    en: "This account is disabled — ask a manager",
    es: "Esta cuenta está deshabilitada. Avisa a un responsable",
  },
  "person.not_found": {
    en: "That person could not be found",
    es: "No se ha encontrado a esa persona",
  },
  "catalogue.not_found": {
    en: "That menu could not be found",
    es: "No se ha encontrado esa carta",
  },
  "authorization.not_permitted": {
    en: "You don't have permission to do that",
    es: "No tienes permiso para hacer eso",
  },
  "pin.too_short": {
    en: "The PIN is too short",
    es: "El PIN es demasiado corto",
  },
  "pin.invalid": {
    en: "Incorrect PIN, try again",
    es: "PIN incorrecto, inténtalo de nuevo",
  },
  "pin.throttled": {
    en: "Too many incorrect PINs. Wait a moment before trying again.",
    es: "Demasiados PIN incorrectos. Espera un momento antes de volver a intentarlo.",
  },
  "person.email_invalid": {
    en: "That email address isn't valid",
    es: "Esa dirección de correo no es válida",
  },
  "person.email_taken": {
    en: "That email is already in use",
    es: "Ese correo ya está en uso",
  },
  "person.telephone_invalid": {
    en: "Enter a valid telephone number, or leave it blank.",
    es: "Introduce un número de teléfono válido o déjalo en blanco.",
  },
  "person.display_name_taken": {
    en: "That display name is already in use. Add a surname or nickname.",
    es: "Ese nombre visible ya está en uso. Añade un apellido o apodo.",
  },
  "role.not_found": {
    en: "This access role is no longer available. Reload to choose from the current roles.",
    es: "Este rol de acceso ya no está disponible. Recarga para elegir entre los roles actuales.",
  },
  "role.not_permitted": {
    en: "You can only give or take away a role whose permissions you all have.",
    es: "Solo puedes dar o quitar un rol cuyos permisos tengas todos.",
  },
  "person.roles_changed": {
    en: "Someone changed this person's access roles while you were editing. Reload to see them; your changes are kept until you do.",
    es: "Alguien cambió los roles de acceso de esta persona mientras editabas. Recarga para verlos; tus cambios se conservan hasta entonces.",
  },
  "person.holds_more": {
    en: "This person can do things you can't, so only someone who can do everything they can may change their sign-in.",
    es: "Esta persona puede hacer cosas que tú no, así que solo alguien que pueda hacer todo lo que ella hace puede cambiar su acceso.",
  },
  "person.last_admin": {
    en: "Keep at least one active Admin who can sign in to the dashboard.",
    es: "Mantén al menos un administrador activo que pueda entrar al panel.",
  },
  "person.transition_invalid": {
    en: "Use the account action provided for that status change.",
    es: "Usa la acción de cuenta indicada para ese cambio de estado.",
  },
  "password.too_short": {
    en: "The password is too short",
    es: "La contraseña es demasiado corta",
  },
  "locale.unsupported": {
    en: "That language isn't available. Choose another.",
    es: "Ese idioma no está disponible. Elige otro.",
  },
  "account_action.invalid": {
    en: "This link is invalid or has expired. Request a new one.",
    es: "Este enlace no es válido o ha caducado. Solicita uno nuevo.",
  },
  "account_action.rate_limited": {
    en: "Too many attempts. Wait a minute and try again.",
    es: "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
  },
  "email.test_host_not_found": {
    en: "No mail server has this name. Check the spelling.",
    es: "No hay ningún servidor de correo con este nombre. Revisa cómo está escrito.",
  },
  "email.test_connection_refused": {
    en: "Check the port: nothing at this mail server accepts connections on it.",
    es: "Revisa el puerto: el servidor de correo no acepta conexiones en él.",
  },
  "email.test_starttls_refused": {
    en: "This mail server would not start encryption on this port. Try TLS on port 465 or STARTTLS on port 587, or try again later.",
    es: "El servidor de correo no ha iniciado el cifrado en este puerto. Prueba TLS en el puerto 465 o STARTTLS en el puerto 587, o inténtalo más tarde.",
  },
  "email.test_tls_refused": {
    en: "This port does not start with TLS. Try STARTTLS on this port.",
    es: "Este puerto no inicia la conexión con TLS. Prueba STARTTLS en este puerto.",
  },
  "email.test_certificate_untrusted": {
    en: "This mail server's certificate is not trusted, so Waitron will not send it your password.",
    es: "El certificado de este servidor de correo no es de confianza, por lo que Waitron no le enviará tu contraseña.",
  },
  "email.test_login_refused": {
    en: "The mail server refused this user and password. Check both, then send the test again.",
    es: "El servidor de correo ha rechazado este usuario y contraseña. Revisa ambos y vuelve a enviar la prueba.",
  },
  "email.test_login_required": {
    en: "This mail server needs a user and password. Turn on Use authentication.",
    es: "Este servidor de correo necesita un usuario y una contraseña. Activa Usar autenticación.",
  },
  "email.test_timeout": {
    en: "The mail server did not answer in time. Check the port and the encryption.",
    es: "El servidor de correo no ha respondido a tiempo. Revisa el puerto y el cifrado.",
  },
  "email.test_refused": {
    en: "The mail server refused the test message. Check the settings and try again.",
    es: "El servidor de correo ha rechazado la prueba. Revisa la configuración y vuelve a intentarlo.",
  },
  "email.settings_invalid": {
    en: "Check the mail server settings and your account email address, then try again.",
    es: "Revisa la configuración de correo y la dirección de tu cuenta, y vuelve a intentarlo.",
  },
  "email.settings_not_allowed": {
    en: "You cannot change mail settings in Demo or Prepare mode.",
    es: "No puedes cambiar el correo en modo Demo o Preparación.",
  },
  "email.test_inbox_unavailable": {
    en: "The email inbox is unavailable because account email is not using local capture",
    es: "La bandeja de correo no está disponible porque el correo de cuentas no usa la captura local",
  },
  "email.message_not_found": {
    en: "That email is no longer in the test inbox",
    es: "Ese correo ya no está en el buzón de prueba",
  },
  "management.request_invalid": {
    en: "Check the form and try again",
    es: "Revisa el formulario e inténtalo de nuevo",
  },

  "device_profile.not_found": {
    en: "That device profile no longer exists",
    es: "Ese perfil de dispositivo ya no existe",
  },
  "device_profile.name_taken": {
    en: "A device profile with that name already exists",
    es: "Ya existe un perfil de dispositivo con ese nombre",
  },
  "device_profile.in_use": {
    en: "This profile is still assigned to a device — give the device another profile first",
    es: "Este perfil todavía está asignado a un dispositivo. Asigna otro perfil al dispositivo primero",
  },
  "device_profile.invalid": {
    en: "The device profile isn't valid",
    es: "El perfil de dispositivo no es válido",
  },
  // Client-side pseudo-codes live here, not in `t()`, so one editor banner resolves them and the
  // server's codes through the same `codeMessage` call.

  "receipt.invalid": {
    en: "The receipt settings aren't valid",
    es: "Los ajustes del recibo no son válidos",
  },
  "receipt.language_fixed": {
    en: "This venue's region fixes the receipt language, so another one cannot be chosen.",
    es: "La región del local fija el idioma del recibo, así que no se puede elegir otro.",
  },
  "receipt.language_orders_open": {
    en: "Some orders at this venue are still in progress in the current receipt language, so it cannot be changed yet.",
    es: "Algunos pedidos de este local siguen en curso en el idioma actual del recibo, así que todavía no se puede cambiar.",
  },
  "department.name_taken": {
    en: "A department with that name already exists",
    es: "Ya existe un departamento con ese nombre",
  },
  "zone.name_taken": {
    en: "A zone with that name already exists",
    es: "Ya existe una zona con ese nombre",
  },
  "service_zone.not_found": {
    en: "That zone no longer exists",
    es: "Esa zona ya no existe",
  },
  "department.not_found": {
    en: "That department no longer exists",
    es: "Ese departamento ya no existe",
  },
  "department.last_active": {
    en: "Keep at least one department. Create another before deleting this one.",
    es: "Mantén al menos un departamento. Crea otro antes de eliminar este.",
  },
  "zone.order_in_progress": {
    en: "Finish the open orders in this zone before deleting it.",
    es: "Termina los pedidos abiertos de esta zona antes de eliminarla.",
  },
  "zone.transfer_pending": {
    en: "Resolve the pending transfers to this zone before deleting it.",
    es: "Resuelve los traslados pendientes a esta zona antes de eliminarla.",
  },
  "zone.profile_in_use": {
    en: "Choose another service zone for the device profile before deleting this zone.",
    es: "Elige otra zona de servicio para el perfil de dispositivo antes de eliminar esta zona.",
  },
  "department.order_in_progress": {
    en: "Finish the open orders in this department before deleting it.",
    es: "Termina los pedidos abiertos de este departamento antes de eliminarlo.",
  },
  "department.transfer_pending": {
    en: "Resolve the pending transfers involving this department before deleting it.",
    es: "Resuelve los traslados pendientes de este departamento antes de eliminarlo.",
  },
  "department.profile_in_use": {
    en: "Move the device profile to another department before deleting this one.",
    es: "Asigna el perfil de dispositivo a otro departamento antes de eliminar este.",
  },
  "zone.table_in_use": {
    en: "Finish the visits at this zone’s tables before deleting it.",
    es: "Termina las visitas en las mesas de esta zona antes de eliminarla.",
  },
  "table.delivery_in_progress": {
    en: "Finish the delivery to this table before deleting it.",
    es: "Termina la entrega a esta mesa antes de eliminarla.",
  },
  "table.booked": {
    en: "Move or cancel this table’s bookings before deleting it.",
    es: "Cambia de mesa o cancela las reservas de esta mesa antes de eliminarla.",
  },
  "zone.not_found": {
    en: "That zone no longer exists",
    es: "Esa zona ya no existe",
  },
  "table.label_taken": {
    en: "A table with that name already exists",
    es: "Ya existe una mesa con ese nombre",
  },
  "table.short_name_taken": {
    en: "Another table already uses that short name",
    es: "Otra mesa ya usa ese nombre corto",
  },
  "table.not_found": {
    en: "That table no longer exists",
    es: "Esa mesa ya no existe",
  },
  "table.fixed": {
    en: "That table is fixed in place",
    es: "Esa mesa está fija",
  },
  "table.merged": {
    en: "That table is joined to another. Split it first",
    es: "Esa mesa está unida a otra. Sepárala primero",
  },
  "table.taken_off": {
    en: "That table is off today's plan. Put it back first",
    es: "Esa mesa está quitada hoy. Vuelve a ponerla primero",
  },
  "merge.seats_required": {
    en: "Enter the seats for this merge",
    es: "Indica las plazas de esta unión",
  },
  "table.not_on_today_plan": {
    en: "That table is not on today's plan",
    es: "Esa mesa no está en el plano de hoy",
  },
  "table.delivery_pending": {
    en: "Food is on its way to that table",
    es: "Hay comida en camino a esa mesa",
  },
  "floor_plan.out_of_date": {
    en: "Someone else changed this floor plan. Reload it and try again",
    es: "Otra persona ha cambiado este plano de sala. Vuelve a cargarlo e inténtalo de nuevo",
  },
  "floor_plan.invalid": {
    en: "Check the floor plan's tables and try again",
    es: "Revisa las mesas del plano de sala y vuelve a intentarlo",
  },
  "tab.already_open": {
    en: "Another party is already seated at this table. Check the floor and try again",
    es: "Ya hay clientes sentados en esta mesa. Revisa la sala e inténtalo de nuevo",
  },
  "table.needs_clearing": {
    en: "That table needs clearing first. Mark it cleared on the till, then try again",
    es: "Esa mesa está por recoger. Márcala como recogida en la caja e inténtalo de nuevo",
  },
  "table.needs_moving": {
    en: "That table needs moving first. Mark it moved on the till, then try again",
    es: "Esa mesa está por mover. Márcala como movida en la caja e inténtalo de nuevo",
  },
  "station.name_taken": {
    en: "A station with that name already exists",
    es: "Ya existe una estación con ese nombre",
  },
  "station.not_found": {
    en: "That station no longer exists",
    es: "Esa estación ya no existe",
  },
  "course.name_taken": {
    en: "A course with that name already exists",
    es: "Ya existe un curso con ese nombre",
  },
  "course.not_found": {
    en: "That course no longer exists",
    es: "Ese curso ya no existe",
  },
  "device.not_found": {
    en: "That device no longer exists",
    es: "Ese dispositivo ya no existe",
  },
  // `device.join_mismatch` is terminal: the server has already deleted the request, so the copy
  // sends the operator back to the device rather than inviting a second tap.
  "device.join_mismatch": {
    en: "That number did not match, so the request was refused — the device has to ask again",
    es: "Ese número no coincide, así que se rechazó la solicitud. El dispositivo debe solicitarlo de nuevo",
  },
  "join_request.not_found": {
    en: "That request is no longer waiting",
    es: "Esa solicitud ya no está esperando",
  },
  "device.pairing_hold_lapsed": {
    en: "Devices can no longer ask to join from this dialog, and any that were waiting may have to ask again. Start again to keep accepting them",
    es: "Este diálogo ya no acepta dispositivos, y los que esperaban pueden tener que solicitarlo de nuevo. Vuelve a empezar para seguir aceptándolos",
  },
  "join_request.claimed": {
    en: "Another manager is pairing this device",
    es: "Otro responsable está emparejando este dispositivo",
  },
  // Also the answer for an id that is gone or already approved, such as a repeated submit after success.
  "join_request.unclaimed": {
    en: "This request is no longer waiting for your approval. If the device is not in the list, ask it to try again",
    es: "Esta solicitud ya no espera tu aprobación. Si el dispositivo no está en la lista, pídele que lo vuelva a intentar",
  },
  "kitchen_screen.required": {
    en: "Choose what this kitchen display shows",
    es: "Elige qué muestra esta pantalla de cocina",
  },
  "kitchen_screen.not_allowed": {
    en: "This device's profile does not offer that screen. Choose one it offers",
    es: "El perfil de este dispositivo no ofrece esa pantalla. Elige una de las que ofrece",
  },
  "kitchen_screen.zone_not_allowed": {
    en: "This device's profile does not list that zone. Choose one it lists",
    es: "El perfil de este dispositivo no incluye esa zona. Elige una de las que incluye",
  },
  "kitchen_screen.invalid": {
    en: "Something this device's kitchen screens name is no longer available. Check them and save again",
    es: "Algo que nombran las pantallas de cocina de este dispositivo ya no está disponible. Revísalas y vuelve a guardar",
  },
  "device.name_taken": {
    en: "An active device here already has that name — choose another",
    es: "Ya hay un dispositivo activo con ese nombre aquí. Elige otro",
  },
  "device.payment_in_progress": {
    en: "A payment on this device is still in progress. Try again once it finishes or is cancelled",
    es: "Hay un pago en curso en este dispositivo. Vuelve a intentarlo cuando termine o se cancele",
  },
  "device_profile.incompatible": {
    en: "That profile is for another kind of device. Untick it",
    es: "Ese perfil es para otro tipo de dispositivo. Desmárcalo",
  },
  "station.not_allowed": {
    en: "This device's profile does not list that station. Choose one it lists",
    es: "El perfil de este dispositivo no incluye esa estación. Elige una de las que incluye",
  },
  "device_profile.access_invalid": {
    en: "Something this profile names is no longer available. Check its choices and save again",
    es: "Algo que nombra este perfil ya no está disponible. Revisa sus opciones y vuelve a guardar",
  },
  "device_profile.admission_invalid": {
    en: "Check who can sign in on this profile and save again",
    es: "Revisa quién puede iniciar sesión con este perfil y vuelve a guardar",
  },
  "device.equipment_held": {
    en: "Another device has that equipment now. Choose another",
    es: "Otro dispositivo tiene ahora ese equipo. Elige otro",
  },
  "reader.payment_in_progress": {
    en: "A payment is in progress on that card reader. Try again when it finishes",
    es: "Hay un cobro en curso en ese lector de tarjetas. Vuelve a intentarlo cuando termine",
  },
  "reader.not_held": {
    en: "This device does not have that card reader. Choose it on the device first",
    es: "Este dispositivo no tiene ese lector de tarjetas. Elígelo primero en el dispositivo",
  },
  "device.binding_invalid": {
    en: "This profile cannot use that printer or card reader, or it has been disabled. Choose another",
    es: "Este perfil no puede usar esa impresora o lector de tarjetas, o se ha deshabilitado. Elige otro",
  },
  "shared.invalid_id": {
    en: "That identifier isn't valid",
    es: "Ese identificador no es válido",
  },
  "printer.invalid_config": {
    en: "Check the printer's connection settings",
    es: "Revisa los ajustes de conexión de la impresora",
  },
  "printer.not_found": {
    en: "That printer no longer exists",
    es: "Esa impresora ya no existe",
  },
  "working_order.not_found": {
    en: "That bill was not found",
    es: "No se encontró esa cuenta",
  },
  "device.forbidden_action": {
    en: "This device's profile does not allow that. Ask a manager",
    es: "El perfil de este dispositivo no lo permite. Avisa a un responsable",
  },
  "invoice_delivery.active": {
    en: "This invoice is already waiting for delivery. Check its status before trying again.",
    es: "Esta factura ya está pendiente de entrega. Comprueba su estado antes de intentarlo de nuevo.",
  },
  "invoice_delivery.printer_invalid": {
    en: "That printer is unavailable. Choose another printer",
    es: "Esa impresora no está disponible. Elige otra impresora",
  },
  "invoice_delivery.email_unavailable": {
    en: "Invoice email is unavailable. Check the mail server and the Email field on the department's Receipts tab in Departments and zones",
    es: "No se puede enviar la factura por correo. Revisa el servidor de correo y el campo Correo electrónico de la pestaña Recibos del departamento en Departamentos y zonas",
  },
  "invoice_delivery.full_invoice_required": {
    en: "Only a full invoice can be sent this way",
    es: "Solo una factura completa se puede enviar así",
  },
  "invoice_delivery.not_found": {
    en: "That invoice was not found",
    es: "No se encontró esa factura",
  },
  "deferred_close.ineligible": {
    en: "This bill can't be closed as a deferred payment: it has already been paid, changed or cancelled, it belongs to another server, or its total is zero",
    es: "Esta cuenta no se puede cerrar como pago aplazado: ya se ha pagado, modificado o anulado, pertenece a otro servidor o su total es cero",
  },
  "deferred_close.conflict": {
    en: "This bill's total or invoice details have changed since you opened it. Reload the bill, check them and try again",
    es: "El total o los datos de factura de esta cuenta han cambiado desde que la abriste. Vuelve a cargarla, revísalos e inténtalo de nuevo",
  },
  "deferred_close.day_frozen": {
    en: "This business day already has its daily close. Close the bill as a deferred payment once the next business day starts",
    es: "Este día de trabajo ya tiene su cierre diario. Cierra la cuenta como pago aplazado cuando empiece el siguiente día de trabajo",
  },
  "submission.id_reused": {
    en: "This request could not be matched to what was sent before. Reload and try again",
    es: "Esta petición no coincide con la que se envió antes. Vuelve a cargar e inténtalo de nuevo",
  },
  "printer.already_registered": {
    en: "That device is already registered as a printer",
    es: "Ese dispositivo ya está dado de alta como impresora",
  },
  "printer.office_printer": {
    en: "That is an office printer, not a receipt printer",
    es: "Es una impresora de oficina, no una impresora de tickets",
  },
  "page_printer.not_found": {
    en: "That office printer wasn't found. Scan again and retry",
    es: "No se encontró esa impresora de oficina. Vuelve a buscar e inténtalo de nuevo",
  },
  "page_printer.not_printable": {
    en: "That printer can't print Waitron's invoices",
    es: "Esa impresora no puede imprimir las facturas de Waitron",
  },
  "page_printer.no_agent": {
    en: "That printer has no print agent. Find it again in Add a printer",
    es: "Esa impresora no tiene agente de impresión. Búscala de nuevo en Añadir impresora",
  },
  "print_job.not_resendable": {
    en: "That job is still waiting to print or retry automatically",
    es: "Ese trabajo sigue pendiente de impresión o reintento automático",
  },
  "print_job.own_printer_only": {
    en: "This printout can only be reprinted on its own printer. Choose that printer.",
    es: "Esta impresión solo se puede reimprimir en su propia impresora. Elige esa impresora.",
  },
  "print_job.printer_unsuitable": {
    en: "That printer is disabled, deleted or narrower than this printout. Choose another printer.",
    es: "Esa impresora está deshabilitada, eliminada o es más estrecha que esta impresión. Elige otra impresora.",
  },
  "print_job.not_found": {
    en: "That print job no longer exists",
    es: "Ese trabajo de impresión ya no existe",
  },
  "agent.not_found": {
    en: "That print agent no longer exists",
    es: "Ese agente de impresión ya no existe",
  },
  "allergen.kinds_required": {
    en: "Choose which cereals",
    es: "Elige los cereales",
  },
  "allergen.invalid_kind": {
    en: "Choose a valid cereal or nut",
    es: "Elige un cereal o fruto de cáscara válido",
  },
  "allergen.invalid_code": {
    en: "That allergen isn't valid",
    es: "Ese alérgeno no es válido",
  },
  // `options.label_required` and `extras.limit_exceeded` are deliberately absent: only the order
  // path's selection validators throw them, never a management route.
  "options.invalid": {
    en: "Check the options list's names, its options and which one is the default.",
    es: "Revisa los nombres de la lista de opciones, sus opciones y cuál es la predeterminada.",
  },
  "options.not_found": {
    en: "This options list no longer exists. Refresh the list and try again.",
    es: "Esta lista de opciones ya no existe. Actualiza la lista e inténtalo de nuevo.",
  },
  "options.translation_required": {
    en: "Enter the customer-facing name in the site's default language.",
    es: "Introduce el nombre para el cliente en el idioma predeterminado del sitio.",
  },
  "extras.invalid": {
    en: "Check the extras list's name, its products, the selection limits and the prices.",
    es: "Revisa el nombre de la lista de extras, sus productos, los límites de selección y los precios.",
  },
  "extras.not_found": {
    en: "This extras list no longer exists. Refresh the list and try again.",
    es: "Esta lista de extras ya no existe. Actualiza la lista e inténtalo de nuevo.",
  },
  "extras.translation_required": {
    en: "Enter the customer-facing name in the site's default language.",
    es: "Introduce el nombre para el cliente en el idioma predeterminado del sitio.",
  },
  "extras.product_has_variants": {
    en: "This product has active variants, so it can't be offered as an extra.",
    es: "Este producto tiene variantes activas, así que no se puede ofrecer como extra.",
  },
  "product.archived": {
    en: "This product is archived and can no longer be changed.",
    es: "Este producto está archivado y ya no se puede modificar.",
  },
  "product.on_live_menu": {
    en: "It is on a live or scheduled menu. Take it off the menu and publish, then archive it.",
    es: "Está en una carta publicada o programada. Quítalo de la carta y publica; después archívalo.",
  },
  "product.name_taken": {
    en: "Another active product or variant already has this name.",
    es: "Ya hay otro producto o variante activo con este nombre.",
  },
  "product.not_found": {
    en: "This product no longer exists. Refresh the page and try again.",
    es: "Este producto ya no existe. Actualiza la página y vuelve a intentarlo.",
  },
  "product.variant_not_found": {
    en: "This variant can no longer be used here. Refresh the page and try again.",
    es: "Esta variante ya no se puede usar aquí. Actualiza la página y vuelve a intentarlo.",
  },
  // The screen shows the names of the lists after this sentence.
  "product.offered_as_extra": {
    en: "A product offered as an extra can't have active variants. First remove it from these extras lists:",
    es: "Un producto que se ofrece como extra no puede tener variantes activas. Quítalo primero de estas listas de extras:",
  },
  "media.read_failed": {
    en: "The image couldn't be read, try again",
    es: "No se pudo leer la imagen, inténtalo de nuevo",
  },
  "media.unsupported_type": {
    en: "That image type isn't supported",
    es: "Ese tipo de imagen no es compatible",
  },
  "roster.draft_exists": {
    en: "A draft already exists for that week",
    es: "Ya existe un borrador para esa semana",
  },
  "roster.not_draft": {
    en: "That week is already published",
    es: "Esa semana ya está publicada",
  },
  "roster.not_found": {
    en: "That roster could not be found",
    es: "No se ha encontrado ese cuadrante",
  },
  "roster.already_published": {
    en: "That roster is already published",
    es: "Ese cuadrante ya está publicado",
  },
  "roster.period_already_published": {
    en: "Another version of that week was just published",
    es: "Se acaba de publicar otra versión de esa semana",
  },
  "shift.not_found": {
    en: "That shift could not be found",
    es: "No se ha encontrado ese turno",
  },
  "shift.invalid": {
    en: "Check the shift times",
    es: "Revisa las horas del turno",
  },
  "convenio.not_found": {
    en: "Configure the venue's working-time rules first",
    es: "Configura primero las reglas de jornada del local",
  },
  "swap.not_found": {
    en: "That swap could not be found",
    es: "No se ha encontrado ese cambio de turno",
  },
  "swap.not_decidable": {
    en: "That swap can no longer be decided",
    es: "Ese cambio de turno ya no se puede decidir",
  },
  "swap.not_permitted": {
    en: "You can only offer your own shifts, and accept only swaps offered to you",
    es: "Solo puedes ofrecer tus propios turnos y aceptar los cambios que te ofrezcan",
  },
  "swap.not_acceptable": {
    en: "That swap can no longer be accepted",
    es: "Ese cambio de turno ya no se puede aceptar",
  },
  "absence.not_found": {
    en: "That absence could not be found",
    es: "No se ha encontrado esa ausencia",
  },
  "absence.overlaps": {
    en: "That time off overlaps time off you already have",
    es: "Esa ausencia se solapa con otra que ya tienes",
  },
  "absence.invalid": {
    en: "Check the time-off dates",
    es: "Revisa las fechas de la ausencia",
  },
  "purchase.not_found": {
    en: "That purchase invoice could not be found",
    es: "No se ha encontrado esa factura recibida",
  },
  "purchase.duplicate": {
    en: "That supplier invoice is already recorded",
    es: "Esa factura del proveedor ya está registrada",
  },
  "purchase.invalid": {
    en: "Check the amounts and VAT breakdown",
    es: "Revisa los importes y el desglose de IVA",
  },
  // `shared.invalid_decimal` fires on anything `decimal()` does not accept, not only a comma: a blank,
  // whitespace, letters, `.5` and `01.00` all reach it. The hint names the SHAPE that is accepted, so
  // it is also true of a catalogue price write, which answers the same code.
  "shared.invalid_decimal": {
    en: "Check the amounts: digits with a dot only (21.00, not 21,00 or 021.00)",
    es: "Revisa los importes: solo cifras con punto decimal (21.00, no 21,00 ni 021.00)",
  },
  "shared.decimal_overflow": {
    en: "That amount is too large",
    es: "Ese importe es demasiado grande",
  },
  "purchase.lines_required": {
    en: "Add at least one VAT line",
    es: "Añade al menos una línea de IVA",
  },
  "backup.not_primary": {
    en: "This node isn't the venue's primary — change backups from the primary node",
    es: "Este nodo no es el principal del local; cambia las copias de seguridad desde el nodo principal",
  },
  "backup.recovery_key_unstorable": {
    en: "That recovery key can't be stored safely — remove any spaces or line breaks",
    es: "Esa clave de recuperación no se puede guardar de forma segura; quita los espacios o saltos de línea",
  },
  "backup.recovery_key_too_short": {
    en: "The recovery key is too short",
    es: "La clave de recuperación es demasiado corta",
  },
  "backup.recovery_key_missing": {
    en: "This box holds no recovery key.",
    es: "Esta caja no tiene clave de recuperación.",
  },
  "backup.destinations_invalid": {
    en: "Check the backup destination",
    es: "Revisa el destino de la copia de seguridad",
  },
  "backup.request_invalid": {
    en: "Check the backup settings and try again",
    es: "Revisa los ajustes de la copia de seguridad e inténtalo de nuevo",
  },
  "backup.effective_mismatch": {
    en: "The saved key could not be confirmed. Keep both the previous key and the key you just saved. Stop changing keys here; this page cannot diagnose the conflicting backup-key settings or confirm which key opens a backup.",
    es: "No se pudo confirmar la clave guardada. Conserva tanto la clave anterior como la que acabas de guardar. No sigas cambiando claves aquí; esta página no puede diagnosticar el conflicto de configuración ni confirmar qué clave abre una copia.",
  },
  "backup.recovery_key_exists": {
    en: "This box holds a different recovery key from the one this page sent. Reload the page and try again. To replace the key, use “Change the recovery key”, which appears while backups are on.",
    es: "Este equipo tiene una clave de recuperación distinta de la que ha enviado esta página. Vuelve a cargar la página e inténtalo de nuevo. Para sustituir la clave, usa «Cambiar la clave de recuperación», que aparece mientras las copias están activadas.",
  },
  "backup.reload_in_progress": {
    en: "The box is still applying an earlier change. Wait a moment and try again.",
    es: "El equipo todavía está aplicando un cambio anterior. Espera un momento y vuelve a intentarlo.",
  },
  "backup.stream_held_by_another_box": {
    en: "Another box was found writing this venue's copy to the same bucket, so this box will not copy over it. Two boxes must never sell for one venue: if that box replaced this one, switch this box off.",
    es: "Se ha visto a otro equipo escribiendo la copia de este local en el mismo bucket, así que este equipo no copiará encima. Nunca deben vender dos equipos para un mismo local: si ese equipo sustituyó a este, apaga este equipo.",
  },
  "backup.spare_stream_active": {
    en: "This venue has a standby server, listed under Servers, which is set up to receive the venue's copy, or is about to be, and a venue copies its data to one place at a time. Nothing was saved. If the standby is not yet set up to receive the venue's data, choose Remove on its row under Servers; the bucket can then be saved here. A standby that is set up to receive the venue's data cannot be removed in this version, so the copy stays with it until an update lets the standby pass it on to a bucket.",
    es: "Este local tiene un servidor en espera, en la lista de Servidores, que está preparado para recibir la copia del local, o lo estará pronto, y un local copia sus datos en un solo sitio a la vez. No se ha guardado nada. Si el servidor en espera aún no está preparado para recibir los datos del local, elige Retirar en su fila de Servidores; después se puede guardar aquí el bucket. Un servidor en espera preparado para recibir los datos del local no se puede retirar en esta versión, así que la copia sigue yendo a él hasta que una actualización le permita pasarla a un bucket.",
  },
  "backup.stream_config_unsafe": {
    en: "The bucket copy cannot use one of these settings as written.",
    es: "La copia en el bucket no puede usar uno de estos ajustes tal como está escrito.",
  },
  "backup.stream_test_failed": {
    en: "The bucket failed the test. Check the address, the key and the bucket's permissions.",
    es: "El bucket no ha superado la prueba. Revisa la dirección, la clave y los permisos del bucket.",
  },
  "backup.stream_not_configured": {
    en: "Set up the bucket copy first.",
    es: "Configura primero la copia en el bucket.",
  },
  "backup.archive_namespace_overlap": {
    en: "The bucket copy and the scheduled backups would write into each other's folder in this bucket. Choose a different folder for one of them.",
    es: "La copia en el bucket y las copias programadas escribirían una en la carpeta de la otra en este bucket. Elige otra carpeta para una de ellas.",
  },
  "backup.archive_test_failed": {
    en: "The backup bucket failed the test, so nothing was saved. Check the address, the key and the bucket's permissions.",
    es: "El bucket de las copias no ha superado la prueba, así que no se ha guardado nada. Revisa la dirección, la clave y los permisos del bucket.",
  },
  "backup.destination_timed_out": {
    en: "The backup destination took too long to answer, so the box stopped waiting for it.",
    es: "El destino de las copias ha tardado demasiado en responder, así que la caja ha dejado de esperarlo.",
  },
  "backup.destination_cancelled": {
    en: "The backup was stopped part-way because backups were restarting or switching off.",
    es: "La copia se ha detenido a medias porque las copias se estaban reiniciando o apagando.",
  },
  "backup.destination_key_invalid": {
    en: "A file or folder name at the backup destination is not one the box can safely use.",
    es: "Un nombre de archivo o de carpeta en el destino de las copias no es uno que la caja pueda usar con seguridad.",
  },
  "backup.destination_object_too_large": {
    en: "A file sent to or read from the backup destination was larger than the box allows.",
    es: "Un archivo enviado al destino de las copias o leído de él superaba el tamaño que admite la caja.",
  },
  "backup.rotation_metadata_failed": {
    en: "The new recovery key is in use, but the box could not record the change in the backup settings.",
    es: "La nueva clave de recuperación ya está en uso, pero la caja no ha podido anotar el cambio en los ajustes de las copias.",
  },
  "backup.archive_settings_invalid": {
    en: "The saved settings for scheduled backups are not valid. Save them again on the Backups screen.",
    es: "Los ajustes guardados de las copias programadas no son válidos. Vuelve a guardarlos en la pantalla Copias de seguridad.",
  },
  "backup.archive_settings_unusable": {
    en: "Scheduled backups are off because their saved settings could not be used. What the box recorded shows what the box found. Turn on backups replaces the saved choices; leave without applying to keep them. Sales continue.",
    es: "Las copias programadas están desactivadas porque no se han podido usar sus ajustes guardados. Lo que ha registrado el equipo muestra lo que encontró el equipo. Activar las copias sustituye los ajustes guardados; sal sin aplicarlos para conservarlos. Las ventas continúan.",
  },
  "backup.archive_settings_unreadable": {
    en: "The saved settings for scheduled backups can't be read. Save them again on the Backups screen to replace them.",
    es: "No se pueden leer los ajustes guardados de las copias programadas. Vuelve a guardarlos en la pantalla Copias de seguridad para sustituirlos.",
  },
  "recovery.pack_connection_insecure": {
    en: "Open the dashboard at its secure address (https://…) to make a recovery pack.",
    es: "Abre el panel en su dirección segura (https://…) para hacer un paquete de recuperación.",
  },
  // A fault in Waitron: `makeRecoveryPack` sends the make route's exact JSON, and no screen shows
  // the received route's answer.
  "recovery.pack_invalid": {
    en: "The box could not read the request to make a recovery pack. This is a fault in Waitron. Reload the page and make the pack again.",
    es: "La caja no pudo leer la solicitud para hacer un paquete de recuperación. Es un fallo de Waitron. Recarga la página y vuelve a hacer el paquete.",
  },
  "management.origin_refused": {
    en: "The box did not make this change because this page's address is not one it trusts. Open the dashboard at the box's own address and make the change again.",
    es: "La caja no ha hecho este cambio porque no confía en la dirección de esta página. Abre el panel en la propia dirección de la caja y vuelve a hacer el cambio.",
  },
  "recovery.pack_origin_refused": {
    en: "Make the pack from the dashboard's own page, not from another site.",
    es: "Haz el paquete desde la propia página del panel, no desde otro sitio.",
  },
  "backup.stream_settings_unreadable": {
    en: "The saved settings for the bucket copy can't be read.",
    es: "No se pueden leer los ajustes guardados de la copia en el bucket.",
  },
  "backup.stream_signer_missing": {
    en: "This server has no signing key, so it cannot put the bucket copy in a recovery pack.",
    es: "Este servidor no tiene clave de firma, así que no puede incluir la copia en el bucket en un paquete de recuperación.",
  },
  "backup.stream_request_failed": {
    en: "The bucket did not answer. Check this server's internet connection and the bucket's address.",
    es: "El bucket no ha respondido. Revisa la conexión a internet de este servidor y la dirección del bucket.",
  },
  "reader.not_listed": {
    en: "This reader is no longer listed by the payment provider. Check the list and try again.",
    es: "Este lector ya no aparece en la lista del proveedor de pagos. Revisa la lista e inténtalo de nuevo.",
  },
  "reader.not_found": {
    en: "That card reader no longer exists",
    es: "Ese lector de tarjetas ya no existe",
  },
  "reader.reference_unknown": {
    en: "The payment provider has no reader with this ID",
    es: "El proveedor de pagos no tiene ningún lector con este ID",
  },
  "reader.provider_disconnected": {
    en: "Connect this payment provider first",
    es: "Conecta primero este proveedor de pagos",
  },
  "reader.unpair_failed": {
    en: "The provider did not confirm the unpairing. The reader is unavailable; try again.",
    es: "El proveedor no confirmó la desvinculación. El lector no está disponible; inténtalo de nuevo.",
  },
  "reader.unpair_in_progress": {
    en: "That card reader is being unpaired or deleted. Try again when that finishes.",
    es: "Ese lector de tarjetas se está desvinculando o eliminando. Vuelve a intentarlo cuando termine.",
  },
  "payment.provider_disabled": {
    en: "Turn on this provider in Modules before adding a reader",
    es: "Activa este proveedor en Módulos antes de añadir un lector",
  },
  "payment.provider_in_use": {
    en: "Delete or unpair this provider's card readers before disconnecting it",
    es: "Elimina o desvincula los lectores de tarjetas de este proveedor antes de desconectarlo",
  },
  "payment.provider_credential_rejected": {
    en: "The payment provider rejected those details — check them and try again",
    es: "El proveedor de pagos rechazó esos datos; revísalos e inténtalo de nuevo",
  },
  "payment.provider_merchant_ambiguous": {
    en: "That key covers more than one merchant — choose which one to connect",
    es: "Esa clave cubre más de un comercio; elige cuál conectar",
  },
  "payment.provider_unknown": {
    en: "That payment provider is not available",
    es: "Ese proveedor de pagos no está disponible",
  },
  "payment.provider_duplicate": {
    en: "There is a problem with the payment provider setup",
    es: "Hay un problema con la configuración del proveedor de pagos",
  },
  "payment.pairing_expired": {
    en: "The reader did not pair in time — start the pairing again",
    es: "El lector no se emparejó a tiempo; vuelve a iniciar el emparejamiento",
  },
  "payment.pairing_refused": {
    en: "The reader refused to pair — check the code and try again",
    es: "El lector rechazó el emparejamiento; comprueba el código e inténtalo de nuevo",
  },
  "payment.credential_environment_mismatch": {
    en: "Those credentials are for a different environment (test vs live) than this venue",
    es: "Esas credenciales son de un entorno distinto (prueba o real) al de este local",
  },
  "payment.not_stuck": {
    en: "This payment is no longer stuck.",
    es: "Este cobro ya no está pendiente.",
  },
  "stuck_payment.not_found": {
    en: "There is no such stuck payment.",
    es: "No existe ese cobro pendiente.",
  },
  "payment.hold_not_found": {
    en: "That payment is no longer held.",
    es: "Ese pago ya no está retenido.",
  },
  "payment.hold_already_recorded": {
    en: "Someone has already recorded what was done with that payment.",
    es: "Alguien ya ha registrado qué se hizo con ese pago.",
  },
  "payment.resolve_unsupported": {
    en: "Waitron cannot ask this card provider about a stuck payment, so the order stays locked. Check the payment in the provider's dashboard.",
    es: "Waitron no puede consultar un cobro pendiente con este proveedor de pagos, así que el pedido sigue bloqueado. Revisa el pago en el panel del proveedor.",
  },
  "payment.outcome_unknown": {
    en: "The card provider could not say what happened to this payment; the order stays locked. Try again in a minute.",
    es: "El proveedor de pagos no pudo confirmar qué pasó con este cobro; el pedido sigue bloqueado. Vuelve a intentarlo en un minuto.",
  },
  "bill.payment_not_found": {
    en: "That payment towards a bill no longer exists. Refresh the list.",
    es: "Ese pago a cuenta de una cuenta ya no existe. Actualiza la lista.",
  },
  "bill.payment_not_stuck": {
    en: "This card payment is no longer waiting, or it is being handled right now. Refresh the list.",
    es: "Este pago con tarjeta ya no está pendiente, o se está gestionando ahora mismo. Actualiza la lista.",
  },
  "bill.payment_outcome_unconfirmed": {
    en: "Waitron could not confirm what happened to this card payment, so nothing was recorded and the bill stays locked. Ask the card provider about it again from this list; if it still cannot be confirmed, check the payment in the provider's own dashboard and record the outcome it confirms.",
    es: "Waitron no ha podido confirmar qué pasó con este pago con tarjeta, así que no se ha registrado nada y la cuenta sigue bloqueada. Vuelve a consultarlo con el proveedor de pagos desde esta lista; si sigue sin confirmarse, comprueba el pago en el panel del proveedor y registra el resultado que confirme.",
  },
  "bill.refund_not_found": {
    en: "That refund no longer exists. Refresh the list.",
    es: "Esa devolución ya no existe. Actualiza la lista.",
  },
  "tender.refund_not_found": {
    en: "That refund could not be found. Refresh the list.",
    es: "No se ha encontrado esa devolución. Actualiza la lista.",
  },
  "tender.refund_not_stuck": {
    en: "This refund is no longer waiting, or it is being checked right now. Refresh the list.",
    es: "Esta devolución ya no está pendiente, o se está comprobando ahora mismo. Actualiza la lista.",
  },
  "tender.refund_outcome_unconfirmed": {
    en: "The provider has not confirmed this refund's outcome. It stays pending and the original invoice is unchanged. Record an outcome only after the provider confirms it.",
    es: "El proveedor no ha confirmado el resultado de esta devolución. Sigue pendiente y la factura original no cambia. Registra un resultado solo cuando el proveedor lo confirme.",
  },
  "tender.attestation_contradicted": {
    en: "Waitron's records show this refund was never sent, so it cannot be recorded as completed.",
    es: "Los registros de Waitron muestran que esta devolución nunca se envió, así que no se puede registrar como completada.",
  },
  "bill.refund_not_stuck": {
    en: "This refund is no longer waiting, or it is being checked right now. Refresh the list.",
    es: "Esta devolución ya no está pendiente, o se está comprobando ahora mismo. Actualiza la lista.",
  },
  "bill.refund_outcome_unconfirmed": {
    en: "The card provider does not show what happened to this refund, so nothing was recorded and the bill stays locked. Check the refund in the provider's own dashboard, then record the outcome it confirms.",
    es: "El proveedor de pagos no muestra qué pasó con esta devolución, así que no se ha registrado nada y la cuenta sigue bloqueada. Comprueba la devolución en el panel del proveedor y registra el resultado que confirme.",
  },
  "payment.not_refundable": {
    en: "This card payment can no longer be given back. Check the refund in the card provider's own dashboard, then refresh the list.",
    es: "Este pago con tarjeta ya no se puede devolver. Comprueba la devolución en el panel del proveedor de pagos y actualiza la lista.",
  },
  "payment.refund_exceeds_capture": {
    en: "That is more than is left to give back on this card payment. Check the refund in the card provider's own dashboard, then refresh the list.",
    es: "Es más de lo que queda por devolver de este pago con tarjeta. Comprueba la devolución en el panel del proveedor de pagos y actualiza la lista.",
  },
  "bill.attestation_contradicted": {
    en: "Waitron's own records contradict that outcome, so it was not recorded. Check what the card provider shows again.",
    es: "Los registros de Waitron contradicen ese resultado, así que no se ha registrado. Vuelve a comprobar lo que muestra el proveedor de pagos.",
  },
  "membership.node_not_found": {
    en: "That server is not on this venue's list of servers. Refresh the list.",
    es: "Ese servidor no está en la lista de servidores del local. Actualiza la lista.",
  },
  "membership.not_primary": {
    en: "Only the primary server can remove a server or clear it from the list. Open this page on the primary server.",
    es: "Solo el servidor principal puede retirar un servidor o quitarlo de la lista. Abre esta página en el servidor principal.",
  },
  "membership.node_is_primary": {
    en: "The primary server cannot be removed or cleared from the list.",
    es: "El servidor principal no se puede retirar ni quitar de la lista.",
  },
  "membership.node_has_served": {
    en: "This server has worked as the primary before, so it cannot be removed.",
    es: "Este servidor ya ha funcionado como principal, así que no se puede retirar.",
  },
  "membership.standby_joined": {
    en: "This standby is already set up to receive the venue's data, so it cannot be removed.",
    es: "Este servidor en espera ya está preparado para recibir los datos del local, así que no se puede retirar.",
  },
  "membership.node_not_removed": {
    en: "This server has not been removed, so it cannot be cleared from the list.",
    es: "Este servidor no está retirado, así que no se puede quitar de la lista.",
  },
  "membership.chart_too_large": {
    en: "The list of servers has reached its size limit, so this change cannot be made.",
    es: "La lista de servidores ha llegado a su tamaño máximo, así que no se puede hacer este cambio.",
  },
  "membership.cleared_list_full": {
    en: "The list of cleared servers has reached its size limit, so this server cannot be cleared.",
    es: "La lista de servidores que se han quitado ha llegado a su tamaño máximo, así que este servidor no se puede quitar.",
  },
  "membership.revoked_duplicate": {
    en: "The list of servers this server holds is not valid, so it cannot be changed here.",
    es: "La lista de servidores que tiene este servidor no es válida, así que no se puede cambiar aquí.",
  },
  "membership.revoked_node_listed": {
    en: "The list of servers this server holds is not valid, so it cannot be changed here.",
    es: "La lista de servidores que tiene este servidor no es válida, así que no se puede cambiar aquí.",
  },
  "membership.write_contended": {
    en: "The list of servers was being changed at the same moment. Try again.",
    es: "La lista de servidores se estaba cambiando en ese mismo momento. Vuelve a intentarlo.",
  },
  "handover.request_invalid": {
    en: "The request to hand the work over to another server was not valid, so nothing was changed. Start the handover again.",
    es: "La solicitud para pasar el trabajo a otro servidor no era válida, así que no se ha cambiado nada. Vuelve a empezar el cambio de servidor.",
  },
  "handover.step_out_of_order": {
    en: "The handover is at a different stage, so this step cannot be taken now. Refresh the page to see where it stands.",
    es: "El cambio de servidor está en otra fase, así que este paso no se puede dar ahora. Actualiza la página para ver en qué punto está.",
  },
  "handover.operation_conflict": {
    en: "This handover was already started with different details, so nothing was changed. Start a new handover.",
    es: "Este cambio de servidor ya se empezó con otros datos, así que no se ha cambiado nada. Empieza un cambio de servidor nuevo.",
  },
  "promotion.from_box_only": {
    en: "In this version a standby server cannot be switched on from another device. Nothing was changed.",
    es: "En esta versión, un servidor en espera no se puede activar desde otro dispositivo. No se ha cambiado nada.",
  },
  "handover.operation_in_progress": {
    en: "Another handover is already in progress. Keep both boxes connected. Do not start another handover until it finishes.",
    es: "Ya hay otro traspaso en curso. Mantén los dos equipos conectados. No inicies otro traspaso hasta que termine.",
  },
  // A fault in Waitron: a box records one restriction, a repeat carries the same values, and nothing
  // rewrites one.
  "handover.restriction_conflict": {
    en: "This server has already recorded that it handed over its work, with different details, so the record was not changed. This is a fault in Waitron.",
    es: "Este servidor ya registró que pasó su trabajo a otro, con otros datos, así que el registro no se ha cambiado. Es un fallo de Waitron.",
  },
  "handover.stepping_down": {
    en: "This server no longer runs the venue, so it is not taking requests now. Nothing was changed.",
    es: "Este servidor ya no lleva el local, así que ahora no atiende solicitudes. No se ha cambiado nada.",
  },
  "handover.known_handover": {
    en: "This box has already handed over to another box. It cannot carry on as the main box.",
    es: "Este equipo ya ha pasado el local a otro equipo. No puede seguir como equipo principal.",
  },
  "handover.peer_unknown": {
    en: "This server does not accept that request from the server that sent it, so it did not answer. Nothing was changed.",
    es: "Este servidor no acepta esa solicitud del servidor que la ha enviado, así que no ha respondido. No se ha cambiado nada.",
  },
  "handover.not_stepped_down": {
    en: "The old box has not handed over its work in this handover, so it will not send its final copy of the venue. Nothing was changed.",
    es: "El equipo antiguo no ha pasado su trabajo en este cambio de servidor, así que no enviará su copia final del local. No se ha cambiado nada.",
  },
  "handover.operation_unknown": {
    en: "That box holds no record of that handover, so it sent nothing. Nothing was changed.",
    es: "Ese equipo no tiene constancia de ese cambio de servidor, así que no ha enviado nada. No se ha cambiado nada.",
  },
  "handover.final_copy_changed": {
    en: "The old box's venue data changed after it made its final copy, so it did not send the copy. Nothing was changed.",
    es: "Los datos del local en el equipo antiguo cambiaron después de hacer la copia final, así que no ha enviado la copia. No se ha cambiado nada.",
  },
  "handover.source_unreachable": {
    en: "This box can't get an answer it can use from the old box yet. It keeps asking by itself. Nothing was changed.",
    es: "Este equipo aún no recibe una respuesta válida del equipo antiguo. Sigue preguntando por sí solo. No se ha cambiado nada.",
  },
  "handover.not_a_spare": {
    en: "This box is not a spare, so it cannot take over the venue. Nothing was changed.",
    es: "Este equipo no es un equipo de reserva, así que no puede pasar a llevar el local. No se ha cambiado nada.",
  },
  "handover.promotion_running": {
    en: "This box is being made the main box right now, so it did not accept this handover. Nothing was changed. If that does not finish, start the handover again.",
    es: "Este equipo está pasando a ser el equipo principal en este momento, así que no ha aceptado el traspaso. No se ha cambiado nada. Si eso no termina, vuelve a empezar el traspaso.",
  },
  "handover.membership_mismatch": {
    en: "The box offering this handover is not the main box on this box's list of the venue's boxes, or the two boxes hold different venue details or different lists, so this box did not accept the handover. Nothing was changed.",
    es: "El equipo que ofrece este traspaso no es el equipo principal en la lista de equipos del local de este equipo, o los dos equipos tienen datos del local o listas distintos, así que este equipo no ha aceptado el traspaso. No se ha cambiado nada.",
  },
  "handover.not_main_box": {
    en: "This box is not the main box. Open Servers at the main box’s address to start a handover.",
    es: "Este equipo no es el principal. Abre Servidores en la dirección del equipo principal para iniciar un traspaso.",
  },
  "handover.venue_not_supported": {
    en: "This venue’s way of filing invoices does not support handover yet. Choose Stop and keep using the main box.",
    es: "La forma de presentar facturas de este local aún no admite el traspaso. Elige Parar y sigue usando el equipo principal.",
  },
  "handover.destination_not_spare": {
    en: "That box is not listed as a spare. Choose Stop and check the current Servers list before choosing a spare.",
    es: "Ese equipo no figura como reserva. Elige Parar y revisa la lista actual de Servidores antes de elegir un equipo de reserva.",
  },
  "handover.destination_not_joined": {
    en: "That spare has not finished joining this venue. Choose Stop and finish joining it before handing over.",
    es: "Ese equipo de reserva no ha terminado de unirse a este local. Elige Parar y termina de incorporarlo antes de traspasar el local.",
  },
  "handover.destination_unaddressable": {
    en: "The spare has no separate address on this box’s list. Choose Stop and finish the spare’s network setup before handing over.",
    es: "El equipo de reserva no tiene una dirección propia en la lista de este equipo. Elige Parar y termina de configurar su red antes de traspasar el local.",
  },
  "handover.destination_unreachable": {
    en: "The spare did not give a verifiable answer. Check its power and network connection, then try the handover again.",
    es: "El equipo de reserva no ha dado una respuesta verificable. Comprueba su alimentación y su conexión de red y vuelve a intentar el traspaso.",
  },
  "handover.restarted_before_stepdown": {
    en: "This handover was cancelled before this box handed over. Check the current Servers list, then start a new handover if the spare is still listed.",
    es: "Este traspaso se canceló antes de que este equipo cediera el local. Revisa la lista actual de Servidores e inicia otro traspaso si el equipo de reserva sigue en ella.",
  },
  "handover.superseded_during_start": {
    en: "Another box took over or the venue’s list of boxes changed. Open the current main box’s address to continue.",
    es: "Otro equipo ha pasado a llevar el local o ha cambiado la lista de equipos. Abre la dirección del equipo principal actual para continuar.",
  },
  "handover.membership_changed": {
    en: "The venue’s details or its list of boxes changed during this handover. Check Servers on the current main box before starting a new handover.",
    es: "Los datos del local o su lista de equipos han cambiado durante el traspaso. Revisa Servidores en el equipo principal actual antes de iniciar otro.",
  },
  "handover.backup_settings_differ": {
    en: "The two boxes have different backup settings. Choose Stop and make their backup settings match before handing over.",
    es: "Los dos equipos tienen ajustes de copia de seguridad distintos. Elige Parar e iguala sus ajustes antes de traspasar el local.",
  },
  "handover.modules_differ": {
    en: "The two boxes have different software or enabled modules. Choose Stop and bring both boxes to the same software and module selection before handing over.",
    es: "Los dos equipos tienen programas o módulos activados distintos. Elige Parar y pon en ambos los mismos programas y módulos antes de traspasar el local.",
  },
  "handover.key_ring_mismatch": {
    en: "The spare lacks an encryption key needed for this venue. Choose Stop and join the spare again before handing over.",
    es: "Al equipo de reserva le falta una clave de cifrado necesaria para este local. Elige Parar y vuelve a unirlo al local antes de traspasarlo.",
  },
  "handover.settings_unreadable": {
    en: "This box could not read the settings needed for handover. Choose Stop, restart this box and check its start page before trying again.",
    es: "Este equipo no ha podido leer los ajustes necesarios para el traspaso. Elige Parar, reinícialo y revisa su página de inicio antes de volver a intentarlo.",
  },
  "handover.destination_settings_unreadable": {
    en: "The spare could not read the settings needed for handover. Choose Stop, restart the spare and check its start page before trying again.",
    es: "El equipo de reserva no ha podido leer los ajustes necesarios para el traspaso. Elige Parar, reinícialo y revisa su página de inicio antes de volver a intentarlo.",
  },
  "handover.settings_changed": {
    en: "This box’s settings changed during the handover. Check Servers on the current main box before starting a new handover.",
    es: "Los ajustes de este equipo han cambiado durante el traspaso. Revisa Servidores en el equipo principal actual antes de iniciar otro.",
  },
  "handover.indicator_untrusted": {
    en: "The description of the final copy was not signed by the box handing over, so the spare did not accept it. The old box stays stopped.",
    es: "La descripción de la copia final no está firmada por el equipo que hace el traspaso, así que el equipo de reserva no la ha aceptado. El equipo antiguo sigue detenido.",
  },
  "handover.copy_mismatch": {
    en: "This copy has not been confirmed for this handover. A controlled handover fetches it again. After an emergency restart, repeat the declaration to check it again; a changed copy cannot activate a saved declaration.",
    es: "Esta copia no está confirmada para este traspaso. Un traspaso controlado vuelve a pedirla. Tras reiniciar durante una emergencia, repite la declaración para comprobarla; una copia que haya cambiado no puede activar una declaración guardada.",
  },
  "handover.copy_damaged": {
    en: "This copy is damaged. A controlled handover fetches it again. In an emergency, retry when a working copy is available.",
    es: "Esta copia está dañada. Un traspaso controlado vuelve a pedirla. En una emergencia, reintenta cuando haya una copia válida disponible.",
  },
  "handover.chain_broken": {
    en: "The records in this copy failed their check, so this box has not taken over. Retry when a working copy is available.",
    es: "Los registros de esta copia no han superado su comprobación, así que este equipo no ha tomado el relevo. Reintenta cuando haya una copia válida disponible.",
  },
  "handover.preparation_state_too_large": {
    en: "The two boxes' saved preparations would leave their file with too little room to be sure the spare can take over, so the spare did not accept this handover. The old box stays stopped.",
    es: "Los preparativos guardados de los dos equipos dejarían su archivo con muy poco espacio para asegurar que el equipo de reserva pueda tomar el relevo, así que no ha aceptado este traspaso. El equipo antiguo sigue detenido.",
  },
  "handover.summary_mismatch": {
    en: "The copy the spare received does not hold what the old box said it holds, so the spare did not accept it. The old box stays stopped.",
    es: "La copia que ha recibido el equipo de reserva no contiene lo que el equipo antiguo dijo que contenía, así que no la ha aceptado. El equipo antiguo sigue detenido.",
  },
  "handover.summary_unreadable": {
    en: "The spare could not read the copy it received to check what it holds, so it did not accept it. The old box stays stopped.",
    es: "El equipo de reserva no ha podido leer la copia que ha recibido para comprobar su contenido, así que no la ha aceptado. El equipo antiguo sigue detenido.",
  },
  "handover.copy_lacks_destination": {
    en: "The copy the spare received has no usable record of the spare, so the spare could not start from it and did not accept it. The old box stays stopped.",
    es: "La copia que ha recibido el equipo de reserva no tiene un registro válido de ese equipo, así que no podría arrancar con ella y no la ha aceptado. El equipo antiguo sigue detenido.",
  },
  "handover.authoriser_not_permitted": {
    en: "According to the copy the spare received, the person who authorised this handover may not move the venue to another box, so the spare did not accept it. The old box stays stopped.",
    es: "Según la copia que ha recibido el equipo de reserva, la persona que autorizó este traspaso no puede pasar el local a otro equipo, así que no la ha aceptado. El equipo antiguo sigue detenido.",
  },
  "handover.preparation_state_unusable": {
    en: "This box's module preparation file is unreadable or too full to take the old box's selections, so this box did not put the accepted copy in place.",
    es: "El archivo de preparación de módulos de este equipo no se puede leer o está demasiado lleno para añadir las selecciones del equipo antiguo, así que este equipo no ha puesto en su sitio la copia aceptada.",
  },
  "handover.placement_failed": {
    en: "This box could not put the copy of the venue it accepted in place. The copy is kept, and Retry tries again.",
    es: "Este equipo no pudo poner en su sitio la copia del local que aceptó. La copia se conserva, y Reintentar lo vuelve a intentar.",
  },
  "handover.placement_no_room": {
    en: "This box's disk has no room for the copy of the venue it accepted: it needs room for one more whole copy. The copy is kept, and Retry tries again.",
    es: "El disco de este equipo no tiene sitio para la copia del local que aceptó: necesita sitio para otra copia entera. La copia se conserva, y Reintentar lo vuelve a intentar.",
  },
  "handover.no_room_to_place": {
    en: "This box's disk has no room to put the accepted copy of the venue in place. It asks the old box to give up filing once there is room. The old box stays stopped.",
    es: "El disco de este equipo no tiene sitio para poner en su sitio la copia aceptada del local. Pedirá al equipo antiguo que ceda el envío de registros cuando haya sitio. El equipo antiguo sigue detenido.",
  },
  "handover.accepted_copy_missing": {
    en: "The copy of the venue this box accepted is no longer on its disk, so this box cannot take over the venue.",
    es: "La copia del local que este equipo aceptó ya no está en su disco, así que este equipo no puede pasar a llevar el local.",
  },
  "handover.source_no_longer_main": {
    en: "This box's list of servers no longer has the old box as the main box, so this box has not taken over from it. If a newer list names the old box again, a waiting box carries on by itself, and an activation that was refused has to be sent again.",
    es: "La lista de servidores de este equipo ya no tiene al equipo antiguo como equipo principal, así que este equipo no ha asumido sus funciones. Si una lista más reciente vuelve a nombrar al equipo antiguo, un equipo en espera sigue por sí solo, y una activación rechazada hay que enviarla de nuevo.",
  },
  "handover.relinquishment_invalid": {
    en: "The old box's answer did not hand filing to this box for the copy it accepted, so this box has not taken over. It keeps asking the old box.",
    es: "La respuesta del equipo antiguo no le cede a este equipo el envío de registros de la copia que aceptó, así que este equipo no ha asumido el envío. Sigue preguntando al equipo antiguo.",
  },
  "handover.summary_failed": {
    en: "The old box could not read part of the venue's data from its final copy, so it sent neither the copy nor its description. Its venue data is unchanged. Asking again makes it take a new copy and read that.",
    es: "El equipo antiguo no ha podido leer parte de los datos del local en su copia final, así que no ha enviado ni la copia ni su descripción. Sus datos del local no han cambiado. Si se vuelve a pedir, hará una copia nueva y la leerá.",
  },
  "handover.indicator_mismatch": {
    en: "The description the old box sent of its final copy is not one this box can read or does not belong to this handover, so this box did not accept the copy. Nothing changed on this box.",
    es: "La descripción que ha enviado el equipo antiguo de su copia final no se puede leer en este equipo o no corresponde a este traspaso, así que este equipo no ha aceptado la copia. No ha cambiado nada en este equipo.",
  },
  "handover.copy_check_failed": {
    en: "This box could not finish checking the copy, so it has not taken over. Try again.",
    es: "Este equipo no ha podido terminar de comprobar la copia, así que no ha tomado el relevo. Reinténtalo.",
  },
  "handover.source_still_answering": {
    en: "The old box still answers. Switch it off before declaring an emergency handover, or use a controlled handover. Before activation, it must be off or confirm that this box replaces it.",
    es: "El equipo antiguo sigue respondiendo. Apágalo antes de declarar un traspaso de emergencia o usa un traspaso controlado. Antes de activar, debe estar apagado o confirmar que este equipo lo sustituye.",
  },
  "handover.source_not_established": {
    en: "The old box's status could not be established. Switch it off at the plug, check its address and connection, then try again.",
    es: "No se ha podido determinar el estado del equipo antiguo. Desenchúfalo, comprueba su dirección y conexión y vuelve a intentarlo.",
  },
  "handover.controlled_unresolved": {
    en: "This box has an unfinished handover that an emergency declaration cannot replace. Resume that handover before starting another.",
    es: "Este equipo tiene un traspaso sin terminar que una declaración de emergencia no puede sustituir. Reanuda ese traspaso antes de iniciar otro.",
  },
  "alert.not_found": {
    en: "This alert no longer exists. Refresh the list.",
    es: "Este aviso ya no existe. Actualiza la lista.",
  },
  "alert.already_handled": {
    en: "This alert was already marked handled, so the note was not saved. Add it from Handled lists on the Box status page.",
    es: "Este aviso ya estaba marcado como resuelto, así que la nota no se ha guardado. Añádela desde Listas resueltas en Estado del equipo.",
  },
  "alert.note_exists": {
    en: "This alert already has a note, which cannot be changed. Close this window to see it under Handled lists.",
    es: "Este aviso ya tiene una nota, que no se puede cambiar. Cierra esta ventana para verla en Listas resueltas.",
  },
  "alert.not_handled": {
    en: "This alert has not been marked handled yet. Close this window and use Mark handled, which takes a note too.",
    es: "Este aviso aún no se ha marcado como resuelto. Cierra esta ventana y usa Marcar como resuelto, que también admite una nota.",
  },
  "fiscal.not_filing": {
    en: "This box does not send records to the tax agency.",
    es: "Este equipo no envía registros a Hacienda.",
  },
  "fiscal.awaiting_certificate": {
    en: "No record can be sent until the tax agency's certificate is installed. Install it in Venue settings.",
    es: "No se puede enviar ningún registro hasta que se instale el certificado de la AEAT. Instálalo en Ajustes del local.",
  },
  "storage.disk_full": {
    en: "Not saved: the box is out of disk space.",
    es: "No se ha guardado: el equipo no tiene espacio en disco.",
  },
  "clock.unusable": {
    en: "Not recorded: the box's clock is wrong.",
    es: "No se ha registrado: la hora del equipo es incorrecta.",
  },
  "clock.behind_chain": {
    en: "Not recorded: the box's clock reads earlier than its last sale. Sort it out on the Box status page.",
    es: "No se ha registrado: la hora del equipo es anterior a la última venta. Resuélvelo en Estado del equipo.",
  },
  "clock.unconfirmed": {
    en: "Not recorded: the box is waiting for its time to be confirmed. Use “Check the time” on a till.",
    es: "No se ha registrado: el equipo espera a que se confirme su hora. Usa «Comprobar la hora» en una caja.",
  },
  "clock.confirm_refused": {
    en: "The clock could not be confirmed. Look at the Box status page.",
    es: "No se ha podido confirmar la hora. Mira Estado del equipo.",
  },
  "clock.check_expired": {
    en: "The check took too long. Try again.",
    es: "La comprobación ha tardado demasiado. Vuelve a intentarlo.",
  },
  "clock.set_refused": {
    en: "The box's clock was not set. See the Clock row.",
    es: "No se ha puesto en hora el equipo. Mira la fila Reloj.",
  },
  "clock.set_failed": {
    en: "The box could not set its clock. See the Clock row.",
    es: "El equipo no ha podido poner su reloj en hora. Mira la fila Reloj.",
  },
  "theme.name_taken": {
    en: "A theme with this name already exists.",
    es: "Ya existe un tema con este nombre.",
  },
  "theme.not_found": {
    en: "This theme no longer exists.",
    es: "Este tema ya no existe.",
  },
  "server.internal": {
    en: "Something went wrong, try again",
    es: "Algo salió mal, inténtalo de nuevo",
  },
};

registerCodeMessages(CODE_MESSAGES);

export { codeOf };

/** The field a refusal belongs beside, by what the error carries (packages/catalogue/src/errors.ts):
 * `menu_section.translation_required` names a language, `menu_section.invalid` a field. */
export function fieldOf(error: unknown): string {
  const params = (error as { params?: { field?: unknown; language?: unknown } }).params;
  if (codeOf(error) === "menu_section.translation_required" && typeof params?.language === "string")
    return `names-${params.language}`;
  return typeof params?.field === "string" ? params.field : "_form";
}

export function codeMessage(
  code: string,
  locale: string = currentLocale(),
  params?: { reason?: unknown },
): string {
  if (code === "venue.time_zone_not_ready") return zoneAdmissionMessage(params?.reason, locale);
  return registeredCodeMessage(code, locale);
}

export function allergenRefusalText(error: unknown): string {
  const params = (error as { params?: { code?: unknown } }).params;
  return codeOf(error) === "allergen.kinds_required" && params?.code === "nuts"
    ? t("allergen.choose_nuts")
    : codeMessage(codeOf(error));
}

function zoneAdmissionMessage(reason: unknown, locale: string): string {
  const key =
    reason === "missing" || reason === "invalid"
      ? "venue.time_zone_confirm"
      : reason === "restart_required"
        ? "venue.time_zone_restart"
        : "venue.time_zone_wait";
  return pickLocale({ en: en[key], es: es[key] }, locale);
}
