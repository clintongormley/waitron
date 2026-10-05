import { codeMessage, codeOf, registerCodeMessages } from "@waitron/dashboard-kit";

// Add new codes with BOTH columns.
const CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "cloud.unavailable": {
    en: "Waitron could not reach Cloud or verify its reply. Try again.",
    es: "Waitron no pudo conectar con Cloud o verificar su respuesta. Vuelve a intentarlo.",
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
    en: "Cloud services are not available on this server yet.",
    es: "Los servicios Cloud aún no están disponibles en este servidor.",
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
    en: "The saved replacement request cannot be read. Ask the local operator to inspect this server's Cloud replacement state.",
    es: "No se puede leer la solicitud de sustitución guardada. Pide al operador local que revise el estado de sustitución Cloud de este servidor.",
  },
  "cloud.replacement_refused": {
    en: "Cloud refused the replacement request. Check the approved recovery and old installation in Cloud, then check reconnection here.",
    es: "Cloud rechazó la solicitud de sustitución. Comprueba la recuperación aprobada y la instalación anterior en Cloud, y después comprueba la reconexión aquí.",
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
  "menu.layout_not_found": {
    en: "This home page layout no longer exists. Refresh the page.",
    es: "Esta página de inicio ya no existe. Actualiza la página.",
  },
  "menu.default_layout_required": {
    en: "A menu's default home page layout cannot be deleted. Make another layout the default first.",
    es: "La página de inicio predeterminada de una carta no se puede eliminar. Haz predeterminada otra antes.",
  },
  "menu.shortcut_unreachable": {
    en: "Only products and sections that are on this menu can be shortcuts on its home page.",
    es: "Solo los productos y secciones que están en esta carta pueden ser accesos directos en su página de inicio.",
  },
  "menu.clashes_unresolved": {
    en: "Resolve the price clashes before publishing this menu.",
    es: "Resuelve los conflictos de precio antes de publicar esta carta.",
  },
  "menu.changed_since_preview": {
    en: "This menu changed after the preview was shown, so it was not published. Check the new preview and publish again.",
    es: "Esta carta ha cambiado después de mostrar la vista previa, así que no se ha publicado. Revisa la nueva vista previa y vuelve a publicarla.",
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
  "printer.bluetooth_printing_unavailable": {
    en: "This printer's print agent cannot print to Bluetooth printers.",
    es: "El agente de impresión de esta impresora no puede imprimir en impresoras Bluetooth.",
  },
  "printer.unpaired": {
    en: "The printer was unpaired, so this job will not be retried.",
    es: "La impresora se desvinculó, así que este trabajo no se volverá a intentar.",
  },
  "content.language_invalid": {
    en: "Choose a recognised language.",
    es: "Elige un idioma reconocido.",
  },
  "content.languages_invalid": {
    en: "Choose a default from your enabled languages and remove any duplicates.",
    es: "Elige un idioma predeterminado entre los disponibles y elimina los duplicados.",
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
    en: "This venue's region requires that language, so it cannot be removed.",
    es: "La región del local exige ese idioma, así que no se puede quitar.",
  },
  "content.default_missing": {
    en: "Some products, units, menu sections, modifiers or images need translating before this can become the default language.",
    es: "Debes traducir algunos productos, unidades, secciones de la carta, modificadores o imágenes antes de usar este idioma como predeterminado.",
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
    en: "Could not verify the passkey, try again",
    es: "No se pudo verificar la passkey, inténtalo de nuevo",
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
    es: "No puedes desactivar tu propia cuenta. Pídeselo a otro administrador.",
  },
  "person.suspended": {
    en: "This account is disabled — ask a manager",
    es: "Esta cuenta está desactivada. Avisa a un responsable",
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
  "person.last_admin": {
    en: "Keep at least one active administrator.",
    es: "Debe quedar al menos un administrador activo.",
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
  "email.test_inbox_unavailable": {
    en: "The email inbox is unavailable because account email is not using local capture",
    es: "La bandeja de correo no está disponible porque el correo de cuentas no usa la captura local",
  },
  "management.request_invalid": {
    en: "Check the form and try again",
    es: "Revisa el formulario e inténtalo de nuevo",
  },
  "canvas.not_found": {
    en: "That canvas no longer exists",
    es: "Ese lienzo ya no existe",
  },
  "canvas.name_taken": {
    en: "A canvas with that name already exists",
    es: "Ya existe un lienzo con ese nombre",
  },
  "canvas.in_use": {
    en: "That canvas is still assigned to a device profile — reassign or remove the profile first",
    es: "Ese lienzo todavía está asignado a un perfil de dispositivo. Reasígnalo o elimina el perfil primero",
  },
  "canvas.invalid": {
    en: "The canvas isn't valid",
    es: "El lienzo no es válido",
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
    en: "This profile is still assigned to a device — reassign or remove the device first",
    es: "Este perfil todavía está asignado a un dispositivo. Reasígnalo o elimina el dispositivo primero",
  },
  "device_profile.invalid": {
    en: "The device profile isn't valid",
    es: "El perfil de dispositivo no es válido",
  },
  // Client-side pseudo-codes live here, not in `t()`, so one editor banner resolves them and the
  // server's codes through the same `codeMessage` call.
  "device_profiles.err_no_name": {
    en: "Enter a name for this device profile",
    es: "Introduce un nombre para este perfil de dispositivo",
  },
  "canvas_editor.err_no_name": {
    en: "Enter a name for this canvas",
    es: "Introduce un nombre para este lienzo",
  },
  "canvas_editor.err_no_tabs": {
    en: "Add at least one tab",
    es: "Añade al menos una pestaña",
  },
  "canvas_editor.err_duplicate_tab": {
    en: "Two tabs share the same key",
    es: "Dos pestañas comparten la misma clave",
  },
  "canvas_editor.err_bad_tab": {
    en: "Give every tab a name of 60 characters or fewer",
    es: "Da a cada pestaña un nombre de 60 caracteres o menos",
  },
  "canvas_editor.err_bad_columns": {
    en: "A tab's column count must be between 1 and 24",
    es: "El número de columnas de una pestaña debe estar entre 1 y 24",
  },
  "canvas_editor.err_bad_span": {
    en: "A card's size must fit within its tab",
    es: "El tamaño de una tarjeta debe caber en su pestaña",
  },
  "canvas_editor.err_bad_visible_when": {
    en: "A card has an unknown visibility state",
    es: "Una tarjeta tiene un estado de visibilidad desconocido",
  },
  "canvas_editor.err_bad_config": {
    en: "Check the card's settings",
    es: "Revisa los ajustes de la tarjeta",
  },
  "canvas_editor.err_missing_required": {
    en: "A till canvas must include every sale card",
    es: "Un lienzo de TPV debe incluir todas las tarjetas de venta",
  },
  "receipt.invalid": {
    en: "The receipt settings aren't valid",
    es: "Los ajustes del recibo no son válidos",
  },
  "receipt.language_fixed": {
    en: "This venue's region fixes the receipt language, so another one cannot be chosen.",
    es: "La región del local fija el idioma del recibo, así que no se puede elegir otro.",
  },
  "receipt.language_orders_open": {
    en: "Some orders at this location are still in progress in the current receipt language, so it cannot be changed yet.",
    es: "Algunos pedidos de este local siguen en curso en el idioma actual del recibo, así que todavía no se puede cambiar.",
  },
  "status.label_taken": {
    en: "A status with that name already exists",
    es: "Ya existe un estado con ese nombre",
  },
  "status.not_found": {
    en: "That status no longer exists",
    es: "Ese estado ya no existe",
  },
  "status.inactive": {
    en: "That status is deactivated",
    es: "Ese estado está desactivado",
  },
  "zone.name_taken": {
    en: "A zone with that name already exists",
    es: "Ya existe una zona con ese nombre",
  },
  "zone.not_found": {
    en: "That zone no longer exists",
    es: "Esa zona ya no existe",
  },
  "table.label_taken": {
    en: "A table with that name already exists",
    es: "Ya existe una mesa con ese nombre",
  },
  "table.not_found": {
    en: "That table no longer exists",
    es: "Esa mesa ya no existe",
  },
  "tab.already_open": {
    en: "Another party is already seated at this table. Check the floor and try again",
    es: "Ya hay clientes sentados en esta mesa. Revisa la sala e inténtalo de nuevo",
  },
  "table.needs_clearing": {
    en: "That table needs clearing first. Mark it cleared on the till, then try again",
    es: "Esa mesa está por recoger. Márcala como recogida en la caja e inténtalo de nuevo",
  },
  "placement.invalid": {
    en: "That table position isn't valid",
    es: "Esa posición de la mesa no es válida",
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
  "device.station_required": {
    en: "This profile needs a station — choose one",
    es: "Este perfil necesita una estación. Elige una",
  },
  "device.name_taken": {
    en: "An active device here already has that name. Rename the device and let it ask again",
    es: "Ya hay un dispositivo activo con ese nombre aquí. Cambia el nombre del dispositivo y que lo solicite de nuevo",
  },
  "device.binding_invalid": {
    en: "That profile is no longer available",
    es: "Ese perfil ya no está disponible",
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
  "printer.makes_and_watches": {
    en: "This printer prints station tickets. Turn its stations off first, or it would print some dishes twice.",
    es: "Esta impresora imprime comandas de estación. Desactiva primero sus estaciones, o imprimiría algunos platos dos veces.",
  },
  "watcher.not_found": {
    en: "That watcher no longer exists",
    es: "Ese punto de seguimiento ya no existe",
  },
  "working_order.not_found": {
    en: "That bill was not found",
    es: "No se encontró esa cuenta",
  },
  "printer.already_registered": {
    en: "That device is already registered as a printer",
    es: "Ese dispositivo ya está dado de alta como impresora",
  },
  "print_job.not_resendable": {
    en: "That job is still waiting to print or retry automatically",
    es: "Ese trabajo sigue pendiente de impresión o reintento automático",
  },
  "print_job.not_found": {
    en: "That print job no longer exists",
    es: "Ese trabajo de impresión ya no existe",
  },
  "agent.not_found": {
    en: "That print agent no longer exists",
    es: "Ese agente de impresión ya no existe",
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
  "product.name_taken": {
    en: "Another active product or variant already has this name.",
    es: "Ya hay otro producto o variante activo con este nombre.",
  },
  // The screen shows the names of the lists after this sentence.
  "product.offered_as_extra": {
    en: "A product offered as an extra can't have active variants. First remove it from these extras lists:",
    es: "Un producto que se ofrece como extra no puede tener variantes activas. Quítalo primero de estas listas de extras:",
  },
  "ingredient.name_required": {
    en: "Enter a name",
    es: "Introduce un nombre",
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
    en: "Configure this location's working-time rules first",
    es: "Configura primero las reglas de jornada de este local",
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
  "backup.managed_by_environment": {
    en: "Backups on this box are managed by its environment — there is nothing to change here",
    es: "Las copias de seguridad de esta caja las gestiona su entorno; aquí no hay nada que cambiar",
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
    en: "Enter a recovery key",
    es: "Introduce una clave de recuperación",
  },
  "backup.destinations_invalid": {
    en: "Check the backup destination",
    es: "Revisa el destino de la copia de seguridad",
  },
  "backup.schedule_invalid": {
    en: "Check the backup schedule",
    es: "Revisa la programación de la copia de seguridad",
  },
  "backup.request_invalid": {
    en: "Check the backup settings and try again",
    es: "Revisa los ajustes de la copia de seguridad e inténtalo de nuevo",
  },
  "backup.effective_mismatch": {
    en: "The saved key didn't take effect — try again",
    es: "La clave guardada no se aplicó; inténtalo de nuevo",
  },
  "backup.recovery_key_exists": {
    en: "This box holds a different recovery key from the one this page sent. Reload the page and try again. To replace the key, use “Change the recovery key”, which appears while backups are on.",
    es: "Este equipo tiene una clave de recuperación distinta de la que ha enviado esta página. Vuelve a cargar la página e inténtalo de nuevo. Para sustituir la clave, usa «Cambiar la clave de recuperación», que aparece mientras las copias están activadas.",
  },
  "backup.reload_in_progress": {
    en: "The box is still applying an earlier change. Wait a moment and try again.",
    es: "El equipo todavía está aplicando un cambio anterior. Espera un momento y vuelve a intentarlo.",
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
  "backup.stream_signer_missing": {
    en: "This server has no signing key, so it cannot issue a recovery kit.",
    es: "Este servidor no tiene clave de firma, así que no puede emitir un kit de recuperación.",
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
  "reader.provider_disconnected": {
    en: "Connect this payment provider before adding a reader for it",
    es: "Conecta este proveedor de pagos antes de añadirle un lector",
  },
  "payment.provider_in_use": {
    en: "Disable this provider's card readers before disconnecting it",
    es: "Desactiva los lectores de tarjetas de este proveedor antes de desconectarlo",
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
    en: "This payment is no longer stuck — the list has been refreshed.",
    es: "Este cobro ya no está pendiente; se ha actualizado la lista.",
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
    en: "This standby finished joining, so it cannot be removed.",
    es: "Este servidor en espera terminó de unirse, así que no se puede retirar.",
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
  "alert.not_found": {
    en: "This alert no longer exists. Refresh the list.",
    es: "Este aviso ya no existe. Actualiza la lista.",
  },
  "server.internal": {
    en: "Something went wrong, try again",
    es: "Algo salió mal, inténtalo de nuevo",
  },
};

registerCodeMessages(CODE_MESSAGES);

export { codeMessage, codeOf };
