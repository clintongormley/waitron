import { codeMessage, codeOf, registerCodeMessages } from "@waitron/dashboard-kit";

// Localised copy for the raw error/status CODES the server and client emit.
//
// The dashboard's API client rejects with a bare `{ code }` (see api/client.ts) and several flows
// surface a status code directly. This module is the ONE place those codes become human copy, and it
// carries a critical guarantee: an operator must NEVER see the raw wire code. A code that isn't in
// the table below degrades to GENERIC ("Something went wrong, try again") rather than being rendered
// verbatim — an unmapped code is a copy gap, not a string to show a user. So `codeMessage` cannot
// return a code, only ever a sentence.
//
// English is the source of truth here too, and `apps/*` is exempt from the english-only guard, so the
// Spanish below is user-facing translation, not schema vocabulary. Add new codes with BOTH columns.
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

  "connection.failed": {
    en: "This browser could not connect to Waitron. Check your connection and try again.",
    es: "Este navegador no pudo conectar con Waitron. Comprueba tu conexión e inténtalo de nuevo.",
  },
  "category.not_found": {
    en: "This category no longer exists. Refresh the list.",
    es: "Esta categoría ya no existe. Actualiza la lista.",
  },
  "category.parent_cycle": {
    en: "Choose a parent outside this category and its descendants.",
    es: "Elige una categoría superior fuera de esta categoría y sus descendientes.",
  },
  "category.primary_required": {
    en: "Choose a replacement Reporting Category.",
    es: "Elige una Categoría de informes de reemplazo.",
  },
  "category.membership_invalid": {
    en: "Choose distinct categories and a Reporting Category from those selected.",
    es: "Elige categorías distintas y una Categoría de informes entre las seleccionadas.",
  },
  "category.image_not_found": {
    en: "Choose an image from your image library.",
    es: "Elige una imagen de tu biblioteca.",
  },
  "category.color_invalid": {
    en: "Choose a valid colour.",
    es: "Elige un color válido.",
  },

  "modifier.invalid": {
    en: "Check the modifier's names, choices, defaults and quantity limits.",
    es: "Revisa los nombres, las opciones, los valores predeterminados y los límites de cantidad del modificador.",
  },
  "modifier.not_found": {
    en: "This modifier could not be found. Refresh the list and try again.",
    es: "No se encontró este modificador. Actualiza la lista e inténtalo de nuevo.",
  },
  "modifier.in_use": {
    en: "This modifier is used by a product, menu or saved order. Detach it from the product or remove it from the menu before changing its type.",
    es: "Este modificador se usa en un producto, menú o pedido guardado. Desvincúlalo del producto o retíralo del menú antes de cambiar su tipo.",
  },
  "printer.probe_busy": {
    en: "Several addresses are being checked. Wait a moment and try again.",
    es: "Se están comprobando varias direcciones. Espera un momento e inténtalo de nuevo.",
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
  "content.default_missing": {
    en: "Some products, categories, units, menu sections, modifiers or images need translating before this can become the default language.",
    es: "Debes traducir algunos productos, categorías, unidades, secciones del menú, modificadores o imágenes antes de usar este idioma como predeterminado.",
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
    en: "No passkey is registered for this account",
    es: "No hay ninguna passkey registrada para esta cuenta",
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
  // Login-email management (apps/server/src/management-api staff routes). The
  // Users form's create/edit rejects with these when the address is malformed or already belongs to
  // another person in the tenant (a case-insensitive unique index on the email).
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
  "account_action.invalid": {
    en: "This link is invalid or has expired. Request a new one.",
    es: "Este enlace no es válido o ha caducado. Solicita uno nuevo.",
  },
  "account_action.rate_limited": {
    en: "Too many attempts. Wait a minute and try again.",
    es: "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
  },
  "email.test_inbox_unavailable": {
    en: "The test inbox is unavailable because account email is not using local capture",
    es: "La bandeja de pruebas no está disponible porque el correo de cuentas no usa la captura local",
  },
  "management.request_invalid": {
    en: "Check the form and try again",
    es: "Revisa el formulario e inténtalo de nuevo",
  },
  // Canvas editor (SP-B3.2) — the server's canvas create/update/get rejections the editor RENDERS
  // (it defines no new codes, only maps these): a since-deleted canvas on edit/update, a name that
  // collides with another canvas in the tenant, and a definition the server's validateCanvas refuses.
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
  // Device profiles — the server's device-profile create/update/get/delete rejections the screen
  // RENDERS (it defines no new server codes, only maps these): a since-deleted profile, a name that
  // collides with another profile in the tenant, and a body the store's validation refuses (an unknown
  // capability flag or a canvas reference that names no tenant canvas).
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
  // Device-profiles editor CLIENT-side validation banner — the pseudo-code the empty-name guard
  // returns. It lives here (not in the `t()` string table) so the ONE editor banner resolves it and
  // the server's device_profile.* codes through the same codeMessage() call, with no per-key routing.
  "device_profiles.err_no_name": {
    en: "Enter a name for this device profile",
    es: "Introduce un nombre para este perfil de dispositivo",
  },
  // Canvas editor CLIENT-side validation banners (SP-B3.2) — the pseudo-codes the light client
  // validator (validate-canvas.ts) and the empty-name guard return. They live here (rather than in the
  // `t()` string table) so the ONE editor banner resolves both these and the server's `canvas.*` codes
  // through `codeMessage`, with no per-key routing. Client-only — the server's validateCanvas stays
  // authoritative and rejects with `canvas.invalid`.
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
  // Service-status configuration (apps/server/src/tables.ts). The editor's per-item mutations reject
  // with these when a label collides, a status has been removed, or one has been deactivated.
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
  // Floor-plan zone + table configuration (apps/server/src/tables.ts, FP-1). The floor-plan editor's
  // per-item mutations reject with these when a zone name / table label collides, or when a zone or
  // table (or a `zoneId` naming no zone) can no longer be found.
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
  // A tab is already open on the target table (TS-1's one-open-tab-per-table guard).
  "tab.already_open": {
    en: "That table already has an open tab",
    es: "Esa mesa ya tiene una cuenta abierta",
  },
  // Floor-plan spatial placement (apps/server/src/tables.ts, FP-2). The Plano editor's canvas emits a
  // placement the server refuses when a coordinate is out of range, the shape/rotation is bad, or the
  // target zone is inactive — surfaced as this one code (its params name the FIELD, never the value).
  "placement.invalid": {
    en: "That table position isn't valid",
    es: "Esa posición de la mesa no es válida",
  },
  // Kitchen-station configuration (apps/server/src/kitchen.ts, KDS-1). The Cocina editor's per-item
  // mutations (and the catalogue routing selects) reject with these when a station name collides, or
  // when a station — or a routing/default target — can no longer be found (absent,
  // another venue's, or deactivated, all folded into the one code server-side).
  "station.name_taken": {
    en: "A station with that name already exists",
    es: "Ya existe una estación con ese nombre",
  },
  "station.not_found": {
    en: "That station no longer exists",
    es: "Esa estación ya no existe",
  },
  // Kitchen-course configuration (apps/server/src/kitchen.ts, KDS-2). The Cursos editor's per-item
  // mutations (and the product-course select) reject with these when a course name collides, or when a
  // course — or a product's default-course target — can no longer be found (absent,
  // another venue's, or deactivated, all folded into the one code server-side). Mirrors `station.*`.
  "course.name_taken": {
    en: "A course with that name already exists",
    es: "Ya existe un curso con ese nombre",
  },
  "course.not_found": {
    en: "That course no longer exists",
    es: "Ese curso ya no existe",
  },
  // Device management (apps/server/src/device-api.ts, device-identity-1). The revoke route rejects with
  // this when the addressed device id names no device (absent, or a malformed id).
  "device.not_found": {
    en: "That device no longer exists",
    es: "Ese dispositivo ya no existe",
  },
  // Letting a device in (apps/server/src/join-api.ts, device-join-and-accept). These are the accept
  // route's client faults; its other two (`device_profile.not_found`, `station.not_found`) are mapped
  // above. `device.join_mismatch` is the only TERMINAL one — the server DELETED the request before
  // answering, so the copy sends the operator back to the device rather than inviting a second tap.
  "device.join_mismatch": {
    en: "That number did not match, so the request was refused — the device has to ask again",
    es: "Ese número no coincide, así que se rechazó la solicitud. El dispositivo debe solicitarlo de nuevo",
  },
  "join_request.not_found": {
    en: "That request is no longer waiting",
    es: "Esa solicitud ya no está esperando",
  },
  "device.station_required": {
    en: "This profile needs a station — choose one",
    es: "Este perfil necesita una estación. Elige una",
  },
  "device.register_required": {
    en: "This profile needs a register — choose one",
    es: "Este perfil necesita una caja. Elige una",
  },
  "device.register_name_taken": {
    en: "A register with that name already exists — rename the device and let it ask again",
    es: "Ya existe una caja con ese nombre. Cambia el nombre del dispositivo y que lo solicite de nuevo",
  },
  "device.binding_invalid": {
    en: "That station or register is no longer available",
    es: "Esa estación o caja ya no está disponible",
  },
  "shared.invalid_id": {
    en: "That identifier isn't valid",
    es: "Ese identificador no es válido",
  },
  // Printing management (apps/server/src/print-api.ts, printing subsystem). The Impresoras screen's
  // printer create/edit rejects with `printer.invalid_config` (a transport short of its required
  // connection fields) or `printer.not_found` (an absent/edited-away printer, also from test-print); the
  // agent revoke and a printer's agent binding reject with `agent.not_found`.
  "printer.invalid_config": {
    en: "Check the printer's connection settings",
    es: "Revisa los ajustes de conexión de la impresora",
  },
  "printer.not_found": {
    en: "That printer no longer exists",
    es: "Esa impresora ya no existe",
  },
  // Registering a discovered USB/Bluetooth device whose stable id already names a printer in this venue
  // (the partial local_key UNIQUE, mapped friendly in packages/printing/src/printers.ts).
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
  // No route answers with this any more — the option groups it described were replaced by the extras
  // and options lists below. The sentence stays because a shipped code is never removed, only left
  // unthrown (CLAUDE.md §3).
  "options.group_invalid": {
    en: "Check the group's min/max selection settings",
    es: "Revisa los ajustes de selección mínima/máxima del grupo",
  },
  // Extras and options LISTS (the `/management-api/modifiers/{options,extras}` surface,
  // apps/server/src/catalogue-api.ts). Six codes, three per kind and the same three both times: a
  // malformed authoring body (400), an id naming no list (404), and a customer-facing name with no
  // text in the venue's default content language (400). The two order-time siblings on the same
  // STATUS map — `options.label_required` and `extras.limit_exceeded` — are deliberately absent:
  // they are thrown only by the selection validators the TILL's order path calls, never by a
  // management route, so the dashboard cannot be answered with them.
  "options.invalid": {
    en: "Check the options list's names, its labels and which label is preselected.",
    es: "Revisa los nombres de la lista de opciones, sus etiquetas y cuál está preseleccionada.",
  },
  "options.not_found": {
    en: "This options list no longer exists. Refresh the list and try again.",
    es: "Esta lista de opciones ya no existe. Actualiza la lista e inténtalo de nuevo.",
  },
  "options.translation_required": {
    en: "Enter the customer-facing name in the site's default language.",
    es: "Introduce el nombre para clientes en el idioma predeterminado del sitio.",
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
    es: "Introduce el nombre para clientes en el idioma predeterminado del sitio.",
  },
  // The ingredient form's own client-side validation message: a non-empty name is required (the column
  // is NOT NULL and a nameless ingredient is a UI error), surfaced via `codeMessage` from the form's
  // `validationError`. Client-only — the server stays authoritative.
  "ingredient.name_required": {
    en: "Enter a name",
    es: "Introduce un nombre",
  },
  "media.missing": {
    en: "No image was provided",
    es: "No se ha proporcionado ninguna imagen",
  },
  "media.read_failed": {
    en: "The image couldn't be read, try again",
    es: "No se pudo leer la imagen, inténtalo de nuevo",
  },
  "media.too_large": {
    en: "The image is too large",
    es: "La imagen es demasiado grande",
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
  // Staff self-service faults (apps/server/src/me-api.ts): you may offer only your own shift and accept
  // only what is offered to you (swap.not_permitted); a swap already accepted/decided can't be accepted
  // again (swap.not_acceptable).
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
  // Staff self-service time-off faults (apps/server/src/me-api.ts): the requested dates overlap time
  // off you already have (absence.overlaps), or the range is back to front (absence.invalid).
  "absence.overlaps": {
    en: "That time off overlaps time off you already have",
    es: "Esa ausencia se solapa con otra que ya tienes",
  },
  "absence.invalid": {
    en: "Check the time-off dates",
    es: "Revisa las fechas de la ausencia",
  },
  // Purchase invoices (facturas recibidas). The first five are the server codes the purchasing routes
  // reject with — `shared.invalid_decimal` and `shared.decimal_overflow` belong to `@waitron/shared`
  // and reach here from the amount screens in `apps/server/src/purchasing-api.ts`, and from the
  // catalogue's own price writes; the last three are the form's own client-side validation messages
  // (mirroring the op's checks for UX — the server stays authoritative).
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
  "purchase.fields_required": {
    en: "Fill in the supplier, dates and total",
    es: "Rellena el proveedor, las fechas y el total",
  },
  "purchase.lines_required": {
    en: "Add at least one VAT line",
    es: "Añade al menos una línea de IVA",
  },
  "purchase.amounts_invalid": {
    en: "Check the amounts: rates 0–100, no negatives",
    es: "Revisa los importes: tipos 0–100, sin negativos",
  },
  // Backup admin (backup-recovery-key-wizard). The apply/rotate routes reject with these when the
  // environment owns the config, this node is not the primary, the recovery key cannot be stored
  // verbatim / is too short / is missing, the destination or schedule is malformed, the request shape
  // is wrong, the box already holds a different key, or the effective key ended up different from the
  // one it should hold. The screen RENDERS these (it also reuses `backup.recovery_key_too_short` as its
  // own client-side floor message for a pasted key).
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
    en: "This box already has a different recovery key — use that key; changing it needs a key rotation",
    es: "Esta caja ya tiene otra clave de recuperación; usa esa clave o rótala para cambiarla",
  },
  // Card payments (providers + readers). The connect/pairing forms live in each provider's panel, but
  // the human copy for every code the payments feature throws lives centrally here (a panel falls back
  // to codeMessage for a rejected connect), so an operator never sees a raw wire code.
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
  "alert.not_found": {
    en: "This alert no longer exists. Refresh the list.",
    es: "Este aviso ya no existe. Actualiza la lista.",
  },
  "server.internal": {
    en: "Something went wrong, try again",
    es: "Algo salió mal, inténtalo de nuevo",
  },
};

// The resolver (codeMessage/codeOf, the GENERIC degrade and the Object.hasOwn guard) now lives in
// @waitron/dashboard-kit, shared with any module UI. This module still OWNS the dashboard's code copy:
// it registers CODE_MESSAGES at load and re-exports the kit's resolver, so the app's importers and the
// "never show a raw code" guarantee are unchanged.
registerCodeMessages(CODE_MESSAGES);

export { codeMessage, codeOf };
