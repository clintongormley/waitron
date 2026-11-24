import {
  codeMessage as registeredCodeMessage,
  codeOf,
  registerCodeMessages,
} from "@waitron/dashboard-kit";
import { formatBytes } from "@waitron/shared";
import { formatRecentMinute } from "../date-utils.js";
import { t, currentLocale, pickLocale } from "./t.js";
import { en, es } from "./strings.js";

// Add new codes with BOTH columns.
export const CODE_MESSAGES: Readonly<Record<string, { en: string; es: string }>> = {
  "diet.invalid_contains_tag": {
    en: "Choose a valid dietary contains tag",
    es: "Elige una etiqueta dietética válida",
  },
  "box_network.not_saved": {
    en: "The box no longer has this network saved. Stop and check the latest network display before trying again.",
    es: "El servidor ya no tiene guardada esta red. Pulsa Parar y consulta la información de red actual antes de reintentar.",
  },
  "box_network.no_wifi": {
    en: "No Wi-Fi adapter is available. Connect an adapter and scan again.",
    es: "No hay adaptador Wi-Fi disponible. Conecta uno y busca de nuevo.",
  },
  "box_network.password_invalid": {
    en: "Check the password format and try Join again.",
    es: "Revisa el formato de la contraseña y pulsa Conectar de nuevo.",
  },
  "box_network.busy": {
    en: "A network change is already running. Wait for Last change before trying again.",
    es: "Ya hay un cambio de red en curso. Espera a Último cambio antes de reintentar.",
  },
  "box_host.busy": {
    en: "The box is busy. Try again shortly.",
    es: "El servidor está ocupado. Inténtalo de nuevo en breve.",
  },
  "box_host.unavailable": {
    en: "The box cannot change its network here. Use its local screen.",
    es: "El servidor no puede cambiar su red desde aquí. Usa su pantalla local.",
  },
  "box_network.join_connection_insecure": {
    en: "Open this dashboard over HTTPS at the box’s own address before entering a Wi-Fi password.",
    es: "Abre este panel por HTTPS en la dirección del servidor antes de introducir una contraseña Wi-Fi.",
  },
  "payment.test_providers_prepare_only": {
    en: "You can use test accounts on a Prepare box only. Your changes were not saved.",
    es: "Solo puedes usar cuentas de prueba en un servidor configurado para Preparar. No se han guardado tus cambios.",
  },
  "module.providers_enabled": {
    en: "Turn off all card providers before turning Payments off. Open Card providers and remove or unpair each provider's readers first.",
    es: "Desactiva todos los proveedores de tarjeta antes de desactivar Pagos. Abre Proveedores de tarjeta y elimina o desvincula sus lectores primero.",
  },
  "module.disabled": {
    en: "Payments is off or waiting for restart. Open Modules, turn Payments on and restart the box before adding readers or turning a provider on.",
    es: "Pagos está desactivado o pendiente de reinicio. Abre Módulos, activa Pagos y reinicia el servidor antes de añadir lectores o activar un proveedor.",
  },
  "module.not_prepared": {
    en: "This box is not prepared to turn this module on. The change was not saved. Install the current Waitron version, restart the box and try again.",
    es: "Este servidor no está preparado para activar este módulo. No se ha guardado el cambio. Instala la versión actual de Waitron, reinicia el servidor e inténtalo de nuevo.",
  },
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
    es: "Este es el servidor de reserva. Abre la dirección del servidor principal para acceder a las pantallas y los datos del local.",
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
    en: "This box is no longer the main box, so it cannot add new records for the tax agency. Open this page on the main box.",
    es: "Este servidor ya no es el servidor principal, así que no puede añadir registros nuevos para Hacienda. Abre esta página en el servidor principal.",
  },
  "tax_office.export_running": {
    en: "Invoices for a month are already being prepared on the box. Try again once that file is ready.",
    es: "Ya se están preparando las facturas de un mes en el servidor. Vuelve a intentarlo cuando ese archivo esté listo.",
  },
  "tax_office.space_low": {
    en: "The box's disk is nearly full: it has {free} free, and preparing this file needs {needed}. Keeping fewer backups on the box, under Backups, frees space; then try again.",
    es: "El disco del servidor está casi lleno: tiene {free} libres y preparar este archivo necesita {needed}. Guardar menos copias de seguridad en el servidor, en Copias de seguridad, libera espacio; después vuelve a intentarlo.",
  },
  "tax_office.space_ran_out": {
    en: "The box ran short of disk space while preparing this file, so it stopped and deleted it. The file had already reached {written}; free more space than that on the box, for example by keeping fewer backups under Backups, then try again.",
    es: "El servidor se quedó sin espacio en disco mientras preparaba este archivo, así que lo detuvo y lo borró. El archivo ya ocupaba {written}; libera más espacio que eso en el servidor, por ejemplo guardando menos copias de seguridad en Copias de seguridad, y vuelve a intentarlo.",
  },
  "tax_office.download_missing": {
    en: "This file is no longer on the box. Choose Download again to prepare it.",
    es: "Este archivo ya no está en el servidor. Elige Descargar para prepararlo de nuevo.",
  },
  "invoice_customer.not_found": {
    en: "No full invoice names that tax number.",
    es: "Ninguna factura completa lleva ese NIF.",
  },
  "vat_rate.area_unsupported": {
    en: `Waitron has no VAT rates for this venue's country and fiscal territory, which were fixed when the box was set up, so trying again will not help. This is a fault in Waitron; choose ${en["problem_report.title"]} at the top of the page to report it.`,
    es: `Waitron no tiene tipos de IVA para el país y el territorio fiscal de este local, que quedaron fijados al configurar el servidor, así que reintentarlo no servirá. Es un fallo de Waitron; elige ${es["problem_report.title"]} en la parte superior de la página para comunicarlo.`,
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
  "cloud.owner_recovery_admin_required": {
    en: "A box administrator must sign in to load or decide a recovery request.",
    es: "Debe iniciar sesión un administrador del servidor para cargar o decidir una solicitud de recuperación.",
  },
  "cloud.owner_recovery_not_available": {
    en: "Owner recovery is not available in Cloud yet. Load requests again later.",
    es: "La recuperación de propietarios aún no está disponible en Cloud. Vuelve a cargar las solicitudes más tarde.",
  },
  "cloud.unavailable": {
    en: "Waitron could not reach Cloud or verify its reply. Try again.",
    es: "Waitron no pudo conectar con Cloud o verificar su respuesta. Vuelve a intentarlo.",
  },
  "cloud.emergency_hosting_closed": {
    en: "Emergency start is unavailable. Open your Cloud account to check its settings.",
    es: "El inicio de emergencia no está disponible. Abre tu cuenta de Cloud para revisar la configuración.",
  },
  "cloud.emergency_code_rate_limited": {
    en: "Too many code requests. Wait {seconds} seconds, then try again.",
    es: "Demasiadas solicitudes de código. Espera {seconds} segundos y vuelve a intentarlo.",
  },
  "cloud.tunnel_unavailable": {
    en: "The staff tunnel could not be configured on this box. Check its tunnel configuration and refresh status to try again.",
    es: "No se pudo configurar el túnel del personal en este servidor. Revisa su configuración del túnel y actualiza el estado para volver a intentarlo.",
  },
  "cloud.tunnel_conflict": {
    en: "This tunnel setup conflicts with a connection already saved in Cloud. Automatic attempts have stopped. You can stop Cloud access here; local trading continues.",
    es: "Esta configuración del túnel entra en conflicto con una conexión ya guardada en Cloud. Los intentos automáticos se han detenido. Puedes detener el acceso a Cloud aquí; las ventas locales siguen funcionando.",
  },
  "cloud.tunnel_plan_required": {
    en: "Remote access needs a Cloud plan that includes it. Start the venue’s free trial in Waitron Cloud Billing.",
    es: "El acceso remoto requiere un plan de Cloud que lo incluya. Inicia la prueba gratuita del local en Facturación de Waitron Cloud.",
  },
  "cloud.tunnel_refused": {
    en: "Waitron Cloud refused remote access for this box. Open Waitron Cloud to check the box’s connection.",
    es: "Waitron Cloud rechazó el acceso remoto para este servidor. Abre Waitron Cloud para revisar la conexión del servidor.",
  },
  "cloud.request_unavailable": {
    en: "This request is unavailable. Start again to get a new code.",
    es: "Esta solicitud no está disponible. Empieza de nuevo para obtener otro código.",
  },
  "cloud.state_invalid": {
    en: "The saved Cloud connection cannot be read. Check this box’s Cloud configuration.",
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
    en: "Open this page on your serving primary box to connect the venue.",
    es: "Abre esta página en el servidor principal activo para conectar el local.",
  },
  "cloud.not_configured": {
    en: "This box is not connected to Waitron Cloud",
    es: "Este servidor no está conectado a Waitron Cloud",
  },
  "cloud.request_invalid": {
    en: "Check the connection details and try again.",
    es: "Revisa los datos de conexión y vuelve a intentarlo.",
  },
  "cloud.request_not_found": {
    en: "This box has no Cloud connection request waiting to finish. Choose Connect to Cloud to start again.",
    es: "Este servidor no tiene ninguna solicitud de conexión con Cloud pendiente de terminar. Elige Conectar con Cloud para empezar de nuevo.",
  },
  "cloud.replacement_not_restored": {
    en: "Finish restoring and reporting the approved Cloud snapshot on this box, then request reconnection.",
    es: "Termina la restauración de la instantánea aprobada de Cloud en este servidor y comunícala antes de solicitar la reconexión.",
  },
  "cloud.replacement_state_invalid": {
    en: "The saved Cloud reconnection request on this box cannot be read. Choose “Get a fresh reconnection request” to set it aside and ask Cloud for a new one; the Cloud owner then approves it as before.",
    es: "No se puede leer la solicitud guardada de reconexión con Cloud de este servidor. Elige «Obtener una nueva solicitud de reconexión» para apartarla y pedir una nueva a Cloud; después, el propietario de Cloud la aprueba como antes.",
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
    en: "A Bluetooth request is already running. Wait for its answer, then try again.",
    es: "Ya hay una solicitud Bluetooth en curso. Espera su respuesta e inténtalo de nuevo.",
  },
  "printer.bluetooth_not_discovered": {
    en: "This print agent has not found that Bluetooth device recently. Scan for printers, then try again.",
    es: "Este agente de impresión no ha encontrado ese dispositivo Bluetooth recientemente. Pulsa Buscar impresoras e inténtalo de nuevo.",
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
  "printer.deleted": {
    en: "The printer was deleted, so this job will not be retried.",
    es: "La impresora se eliminó, así que este trabajo no se volverá a intentar.",
  },
  "print_job.moved": {
    en: "Reprinted on another printer, so this job will not be retried.",
    es: "Se reimprimió en otra impresora, así que este trabajo no se volverá a intentar.",
  },
  "receipt.out_of_date": {
    en: "A later payment could not be added to this receipt, so it was not printed. Reprint it to list every payment.",
    es: "No se pudo añadir un pago posterior a este recibo, así que no se imprimió. Reimprímelo para que muestre todos los pagos.",
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
  "content.suggestion_languages_limit": {
    en: "Translate all supports up to 20 content languages. Reduce the enabled languages in Content languages and try again.",
    es: "Traducir todo admite hasta 20 idiomas de contenido. Reduce los idiomas activados en Idiomas de contenido e inténtalo de nuevo.",
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
  "unit.target_not_found": {
    en: "The unit you chose no longer exists. Choose another unit.",
    es: "La unidad que elegiste ya no existe. Elige otra unidad.",
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
    es: "Este servidor se ha restablecido.",
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
    en: "You cannot disable the account you are signed in with. To disable it, sign out, then sign in with another account that can manage it.",
    es: "No puedes deshabilitar la cuenta con la que has iniciado sesión. Para deshabilitarla, cierra la sesión e inicia sesión con otra cuenta que pueda gestionarla.",
  },
  "person.suspended": {
    en: "The account you were signed in with is disabled. Log in with another account. An account that can manage it can enable it again under Users and send it a new invitation.",
    es: "La cuenta con la que habías iniciado sesión está deshabilitada. Inicia sesión con otra cuenta. Una cuenta con permiso para gestionarla puede volver a habilitarla en Usuarios y enviarle una nueva invitación.",
  },
  "person.not_found": {
    en: "That person could not be found",
    es: "No se ha encontrado a esa persona",
  },
  "menu.deleted": {
    en: "This menu was deleted. Reload the menu list and choose another menu.",
    es: "Ya se ha eliminado. Vuelve a cargar la lista y elige otra opción.",
  },
  "menu.delete_default": {
    en: "The venue default menu changed or its replacement is no longer available. Close this window and open Delete again.",
    es: "La carta predeterminada del local cambió o su sustituta ya no está disponible. Cierra esta ventana y vuelve a pulsar Eliminar.",
  },
  "menu_period.delete_replacement": {
    en: "The period or the available menus changed. Close this window and open Delete again.",
    es: "El periodo o las cartas disponibles han cambiado. Cierra esta ventana y vuelve a pulsar Eliminar.",
  },
  "menu.not_found": {
    en: "That menu could not be found",
    es: "No se ha encontrado esa carta",
  },
  "menu_item.not_found": {
    en: "This item is no longer on the menu. Check the current menu before saving.",
    es: "Este artículo ya no está en la carta. Revisa la carta actual antes de guardar.",
  },
  "set_menu.not_found": {
    en: "That set menu could not be found. Reload the menu list and choose a set menu.",
    es: "No se ha encontrado ese menú. Recarga la lista y elige un menú.",
  },
  "set_menu.invalid": {
    en: "Check the set-menu details and try again.",
    es: "Revisa los datos del menú e inténtalo de nuevo.",
  },
  "set_menu.dishes_only": {
    en: "A set menu lists dishes only. Add products to it. To group them, set each product's course.",
    es: "Un menú solo admite platos. Añade productos y asigna un curso a cada uno para agruparlos.",
  },
  "set_menu.not_publishable": {
    en: "Fix the problems in the set menu before publishing this menu.",
    es: "Corrige los problemas del menú antes de publicar esta carta.",
  },
  "set_menu.wrong_place": {
    en: "A set menu is sold by placing it in a menu. Open that menu's Structure and add the set menu there.",
    es: "Para vender un menú, abre la Estructura de la carta que quieres publicar y añádelo allí.",
  },
  "node.operation_page_required": {
    en: "This operation needs an encrypted connection from this box's own page. Open the box's HTTPS address, then try again.",
    es: "Esta operación necesita una conexión cifrada desde la página del propio servidor. Abre la dirección HTTPS del servidor y vuelve a intentarlo.",
  },
  "authorization.not_permitted": {
    en: "You don't have permission to do that",
    es: "No tienes permiso para hacer eso",
  },
  "authorization.inspection_only": {
    en: "This sign-in can only see Invoices for the tax office.",
    es: "Esta sesión solo puede ver Facturas para Hacienda.",
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
  "person.email_missing": {
    en: "This user has no email address, so no invitation can be sent and nothing was changed. Choose Cancel, add their email address, and their first and last names if missing, with Edit…, then try again.",
    es: "Este usuario no tiene correo electrónico, así que no se le puede enviar una invitación y no se ha cambiado nada. Elige Cancelar, añade su correo, y su nombre y apellidos si faltan, con Editar… y vuelve a intentarlo.",
  },
  "person.telephone_invalid": {
    en: "Enter a valid telephone number or leave it blank. Start foreign numbers with + and the country code.",
    es: "Introduce un teléfono válido o déjalo en blanco. Empieza los números extranjeros con + y el prefijo del país.",
  },
  "person.display_name_taken": {
    en: "That display name is already in use. Add a surname or nickname.",
    es: "Ese nombre visible ya está en uso. Añade un apellido o apodo.",
  },
  "role.name_required": {
    en: "Enter a name for this access role.",
    es: "Introduce un nombre para este rol de acceso.",
  },
  "role.name_taken": {
    en: "That access role name is already in use. Choose another name.",
    es: "Ese nombre de rol de acceso ya está en uso. Elige otro nombre.",
  },
  "role.permission_unknown": {
    en: "This permission is no longer available. Reload to see the current permissions.",
    es: "Este permiso ya no está disponible. Recarga para ver los permisos actuales.",
  },
  "role.changed": {
    en: "Someone changed this access role while you were editing. Reload to see the current role.",
    es: "Alguien cambió este rol de acceso mientras editabas. Recarga para ver el rol actual.",
  },
  "role.built_in": {
    en: "Built-in role names cannot change and built-in roles cannot be deleted. Admin's permissions are fixed.",
    es: "Los roles integrados no se pueden renombrar ni eliminar. Los permisos de Admin son fijos.",
  },
  "role.not_found": {
    en: "This access role is no longer available. Reload to choose from the current roles.",
    es: "Este rol de acceso ya no está disponible. Recarga para elegir entre los roles actuales.",
  },
  "role.not_permitted": {
    en: "You can only create, change, give or take away a role if you hold all of its permissions.",
    es: "Solo puedes crear, cambiar, dar o quitar un rol si tienes todos sus permisos.",
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
  "mail.relay_refused": {
    en: "Waitron Cloud could not accept this email. Check that Cloud email is enabled, then request a new email.",
    es: "Waitron Cloud no ha podido aceptar este correo. Comprueba que el correo de Cloud esté activado y solicita un correo nuevo.",
  },
  "mail.relay_unknown": {
    en: "Waitron Cloud could not confirm whether this email was sent. It may still arrive. Request a new email if you need another link or code.",
    es: "Waitron Cloud no ha podido confirmar si se ha enviado este correo. Aún puede llegar. Solicita un correo nuevo si necesitas otro enlace o código.",
  },
  "email.settings_invalid": {
    en: "Check the mail server settings, then try again.",
    es: "Revisa la configuración de correo y vuelve a intentarlo.",
  },
  "email.test_recipient_missing": {
    en: "Your own account has no email address to send the test to. Add one to your account, then send the test again.",
    es: "Tu cuenta no tiene una dirección de correo a la que enviar la prueba. Añade una a tu cuenta y vuelve a enviar la prueba.",
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
    en: "That table is off today's plan. Put it back from the till, then try again",
    es: "Esa mesa está quitada hoy. Vuelve a ponerla desde la caja e inténtalo de nuevo",
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
  "service_zone.mode_incompatible": {
    en: "That table's area has no table service. Edit the booking and choose a table in an area with table service",
    es: "La zona de esa mesa no tiene servicio de mesa. Edita la reserva y elige una mesa de una zona con servicio de mesa",
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
  "kitchen_screen.not_allowed": {
    en: "This device's profile does not offer that screen. Choose one it offers",
    es: "El perfil de este dispositivo no ofrece esa pantalla. Elige una de las que ofrece",
  },
  "kitchen_screen.zone_not_allowed": {
    en: "This device's profile does not list that zone. Choose one it lists",
    es: "El perfil de este dispositivo no incluye esa zona. Elige una de las que incluye",
  },
  "kitchen_screen.invalid": {
    en: "Something this device's station screens name is no longer available. Check them and save again",
    es: "Algo que nombran las pantallas de estación de este dispositivo ya no está disponible. Revísalas y vuelve a guardar",
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
  "drawer.close_not_found": {
    en: "This drawer close is unavailable. Choose another close.",
    es: "Este cierre de caja no está disponible. Elige otro cierre.",
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
    en: "That printer is unavailable. Choose another printer.",
    es: "Esa impresora no está disponible. Elige otra impresora.",
  },
  "invoice_delivery.email_unavailable": {
    en: "Invoice email is unavailable. Check the mail server in System → Email and the Email field on the department's Receipts tab in Departments and zones.",
    es: "No se puede enviar la factura por correo. Revisa el servidor de correo en Sistema → Correo y el campo Correo electrónico de la pestaña Recibos del departamento en Departamentos y zonas.",
  },
  "invoice_delivery.full_invoice_required": {
    en: "Only a full invoice can be sent this way.",
    es: "Solo una factura completa se puede enviar así.",
  },
  "invoice_delivery.not_found": {
    en: "That invoice was not found.",
    es: "No se encontró esa factura.",
  },
  "deferred_close.ineligible": {
    en: "This bill can't be closed as a deferred payment: it has already been paid, changed or cancelled, it belongs to another box, or its total is zero",
    es: "Esta cuenta no se puede cerrar como pago aplazado: ya se ha pagado, modificado o anulado, pertenece a otro servidor o su total es cero",
  },
  "deferred_close.conflict": {
    en: "This bill's total or invoice details have changed since you opened it. Reload the bill, check them and try again",
    es: "El total o los datos de factura de esta cuenta han cambiado desde que la abriste. Vuelve a cargarla, revísalos e inténtalo de nuevo",
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
  "print_job.sale_payload_expired": {
    en: "Saved print data is removed after a week. Reprint this receipt or invoice from Orders in the dashboard.",
    es: "Los datos de impresión guardados se eliminan al cabo de una semana. Vuelve a imprimir este recibo o factura desde Pedidos en el panel.",
  },
  "print_job.payload_expired": {
    en: "Saved print data is removed after a week. This printout can no longer be reprinted, including station tickets, refund receipts, payment slips and reports.",
    es: "Los datos de impresión guardados se eliminan al cabo de una semana. Ya no se puede reimprimir este documento, incluidos los comandas de estación, recibos de devolución, comprobantes de pago e informes.",
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
  "swap.return_shift_not_owned": {
    en: "The shift offered in return is not that colleague's. Choose one of their shifts",
    es: "El turno ofrecido a cambio no es de ese compañero. Elige uno de sus turnos",
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
  // it is also true of a product price write, which answers the same code.
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
    en: "That backup encryption key can't be stored safely — remove any spaces or line breaks",
    es: "Esa clave de cifrado de copias no se puede guardar de forma segura; quita los espacios o saltos de línea",
  },
  "backup.recovery_key_too_short": {
    en: "The backup encryption key is too short",
    es: "La clave de cifrado de copias es demasiado corta",
  },
  "backup.new_recovery_key_too_short": {
    en: "That backup encryption key is too short",
    es: "Esa clave de cifrado de copias es demasiado corta",
  },
  "backup.recovery_key_missing": {
    en: "This box holds no backup encryption key.",
    es: "Este servidor no tiene clave de cifrado de copias.",
  },
  "backup.destinations_invalid": {
    en: "Check the backup destination",
    es: "Revisa el destino de la copia de seguridad",
  },
  "backup.cloud_needs_daily": {
    en: "Waitron Cloud keeps one copy a day, so it needs a backup every day.",
    es: "Waitron Cloud guarda una copia al día, así que necesita una copia de seguridad cada día.",
  },
  "backup.cloud_unavailable": {
    en: "Waitron Cloud backups are not available on this box yet.",
    es: "Las copias en Waitron Cloud aún no están disponibles en este servidor.",
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
    en: "This box holds a different backup encryption key from the one this page sent. Reload the page and try again. To replace the key, use “Change the backup encryption key”, which appears while backups are on.",
    es: "Este servidor tiene una clave de cifrado de copias distinta de la que ha enviado esta página. Vuelve a cargar la página e inténtalo de nuevo. Para sustituir la clave, usa «Cambiar la clave de cifrado de copias», que aparece mientras las copias están activadas.",
  },
  "backup.not_enabled": {
    en: "Turn on scheduled backups before starting a backup.",
    es: "Activa las copias programadas antes de iniciar una copia.",
  },
  "backup.run_in_progress": {
    en: "A backup was already running. Try again once it finishes.",
    es: "Ya había una copia de seguridad en curso. Vuelve a intentarlo cuando termine.",
  },
  "backup.reload_in_progress": {
    en: "The box is still applying an earlier change. Wait a moment and try again.",
    es: "El servidor todavía está aplicando un cambio anterior. Espera un momento y vuelve a intentarlo.",
  },
  "backup.stream_held_by_another_box": {
    en: "Another box was found writing this venue's copy to the same bucket, so this box will not copy over it. Two boxes must never sell for one venue: if that box replaced this one, switch this box off.",
    es: "Se ha visto a otro servidor escribiendo la copia de este local en el mismo bucket, así que este servidor no copiará encima. Nunca deben vender dos servidores para un mismo local: si ese servidor sustituyó a este, apaga este servidor.",
  },
  "backup.spare_stream_active": {
    en: "This venue has a spare box, listed on the Servers page, that receives the venue's copy or is about to, and a venue copies its data to one place at a time. Nothing was saved. To save the bucket here, choose Remove from venue on its row on the Servers page, then save again.",
    es: "Este local tiene un servidor de reserva, en la lista de Servidores, que recibe la copia del local o la recibirá pronto, y un local copia sus datos en un solo sitio a la vez. No se ha guardado nada. Para guardar aquí el bucket, elige Retirar del local en su fila de Servidores y vuelve a guardar.",
  },
  "backup.stream_config_unsafe": {
    en: "The bucket copy cannot use one of these settings as written.",
    es: "La copia en el bucket no puede usar uno de estos ajustes tal como está escrito.",
  },
  "backup.stream_test_failed": {
    en: "The bucket failed the test. Check the address, the key and the bucket's permissions.",
    es: "El bucket no ha superado la prueba. Revisa la dirección, la clave y los permisos del bucket.",
  },
  "backup.not_configured": {
    en: "This box has no backup settings yet. Reload the page, then choose Turn on backups.",
    es: "Este servidor aún no tiene ajustes de copia de seguridad. Recarga la página y elige Activar las copias.",
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
    es: "El destino de las copias ha tardado demasiado en responder, así que el servidor ha dejado de esperarlo.",
  },
  "backup.destination_cancelled": {
    en: "The backup was stopped part-way because backups were restarting or switching off.",
    es: "La copia se ha detenido a medias porque las copias se estaban reiniciando o apagando.",
  },
  "backup.destination_key_invalid": {
    en: "A file or folder name at the backup destination is not one the box can safely use.",
    es: "Un nombre de archivo o de carpeta en el destino de las copias no es uno que el servidor pueda usar con seguridad.",
  },
  "backup.destination_object_too_large": {
    en: "A file sent to or read from the backup destination was larger than the box allows.",
    es: "Un archivo enviado al destino de las copias o leído de él superaba el tamaño que admite el servidor.",
  },
  "backup.rotation_metadata_failed": {
    en: "The new backup encryption key is in use, but the box could not record the change in the backup settings.",
    es: "La nueva clave de cifrado de copias ya está en uso, pero el servidor no ha podido anotar el cambio en los ajustes de las copias.",
  },
  "backup.archive_settings_invalid": {
    en: "The saved settings for scheduled backups are not valid. Choosing the destinations again and using “Turn on backups” replaces them.",
    es: "Los ajustes guardados de las copias programadas no son válidos. Elegir de nuevo los destinos y usar «Activar las copias» los sustituye.",
  },
  "backup.archive_settings_unusable": {
    en: "Scheduled backups are off because their saved settings could not be used. What the box recorded shows what the box found. Turn on backups replaces the saved choices; leave without applying to keep them. Sales continue.",
    es: "Las copias programadas están desactivadas porque no se han podido usar sus ajustes guardados. Lo que ha registrado el servidor muestra lo que encontró el servidor. Activar las copias sustituye los ajustes guardados; sal sin aplicarlos para conservarlos. Las ventas continúan.",
  },
  "backup.archive_settings_unreadable": {
    en: "The saved settings for scheduled backups can't be read. Choosing the destinations again with “Change destination or schedule” and “Save changes”, or with “Turn on backups” while backups are off, replaces them.",
    es: "No se pueden leer los ajustes guardados de las copias programadas. Elegir de nuevo los destinos con «Cambiar el destino o la programación» y «Guardar cambios», o con «Activar las copias» si las copias están desactivadas, los sustituye.",
  },
  "recovery.pack_connection_insecure": {
    en: "Open the dashboard at its secure address (https://…) to make a recovery pack.",
    es: "Abre el panel en su dirección segura (https://…) para hacer un paquete de recuperación.",
  },
  // A fault in Waitron: `makeRecoveryPack` sends the make route's exact JSON, and no screen shows
  // the received route's answer.
  "recovery.pack_invalid": {
    en: "The box could not read the request to make a recovery pack. This is a fault in Waitron. Reload the page and make the pack again.",
    es: "El servidor no pudo leer la solicitud para hacer un paquete de recuperación. Es un fallo de Waitron. Recarga la página y vuelve a hacer el paquete.",
  },
  "management.origin_refused": {
    en: "The box did not make this change because this page's address is not one it trusts. Open the dashboard at the box's own address and make the change again.",
    es: "El servidor no ha hecho este cambio porque no confía en la dirección de esta página. Abre el panel en la propia dirección del servidor y vuelve a hacer el cambio.",
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
    en: "This box has no signing key, so it cannot put the bucket copy in a recovery pack.",
    es: "Este servidor no tiene clave de firma, así que no puede incluir la copia en el bucket en un paquete de recuperación.",
  },
  "backup.stream_request_failed": {
    en: "The bucket did not answer. Check this box's internet connection and the bucket's address.",
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
  "reader.unpair_unsupported": {
    en: "This card provider cannot unpair readers from Waitron. Delete the reader here; it stays registered with the provider until you remove it there.",
    es: "Este proveedor de pagos no permite desvincular lectores desde Waitron. Elimina el lector aquí; seguirá registrado en el proveedor hasta que lo quites allí.",
  },
  "reader.removed_while_adding": {
    en: "That card reader was being unpaired or deleted while it was being added. Check the list and try again.",
    es: "Ese lector de tarjetas se estaba desvinculando o eliminando mientras se añadía. Revisa la lista e inténtalo de nuevo.",
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
  "bill.allocation_changed": {
    en: "The amounts changed. Check the refreshed amounts and confirm again.",
    es: "Los importes han cambiado. Revisa los importes actualizados y confirma de nuevo.",
  },
  "bill.tip_not_allowed": {
    en: "Tips are off. Refund the excess at the card provider, then check the remaining money again.",
    es: "Las propinas están desactivadas. Devuelve el exceso en el proveedor de tarjetas y vuelve a comprobar el dinero restante.",
  },
  "bill.nothing_outstanding": {
    en: "This bill has nothing left to pay. Refund the remaining money at the card provider, then confirm the full refund.",
    es: "Esta cuenta no tiene nada pendiente de pago. Devuelve el dinero restante en el proveedor de tarjetas y confirma la devolución completa.",
  },
  "order.payment_in_flight": {
    en: "Another card payment is still unresolved. Check its outcome before trying again.",
    es: "Otro pago con tarjeta sigue sin resolverse. Comprueba su resultado antes de intentarlo de nuevo.",
  },
  "bill.refund_in_progress": {
    en: "A refund is still unresolved. Check its outcome before trying again.",
    es: "Una devolución sigue sin resolverse. Comprueba su resultado antes de intentarlo de nuevo.",
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
  "membership.self_reset_failed": {
    en: "The box couldn’t start the reset. Try again.",
    es: "El servidor no pudo iniciar el restablecimiento. Inténtalo de nuevo.",
  },
  "membership.node_not_found": {
    en: "That box is not on this venue's list of boxes. Refresh the list.",
    es: "Ese servidor no está en la lista de servidores del local. Actualiza la lista.",
  },
  "membership.not_primary": {
    en: "Only the main box can remove a box or clear it from the list. Open this page on the main box.",
    es: "Solo el servidor principal puede retirar un servidor o quitarlo de la lista. Abre esta página en el servidor principal.",
  },
  "membership.node_is_primary": {
    en: "The main box cannot be removed or cleared from the list.",
    es: "El servidor principal no se puede retirar ni quitar de la lista.",
  },
  "membership.reset_statement_required": {
    en: "This box was the main box before and has not returned its invoice records and working hours, so it was not removed. Confirm that it has been wiped or will never be switched on again: switched on with its data, it could sell beside the main box.",
    es: "Este servidor fue el servidor principal y no ha devuelto sus registros de facturación y horas trabajadas, así que no se ha retirado. Confirma que se ha borrado o que no se volverá a encender nunca: encendido con sus datos, podría vender a la vez que el servidor principal.",
  },
  "membership.standby_joined": {
    en: "Confirm that this spare is switched off, and that nobody is restoring this venue from a backup or switching it to another box right now.",
    es: "Confirma que este servidor de reserva está apagado y que nadie está restaurando este local desde una copia de seguridad ni pasándolo a otro servidor en este momento.",
  },
  "membership.node_not_removed": {
    en: "This box has not been removed, so it cannot be cleared from the list.",
    es: "Este servidor no está retirado, así que no se puede quitar de la lista.",
  },
  "membership.chart_too_large": {
    en: "The list of boxes has reached its size limit, so this change cannot be made.",
    es: "La lista de servidores ha llegado a su tamaño máximo, así que no se puede hacer este cambio.",
  },
  "membership.cleared_list_full": {
    en: "The list of cleared boxes has reached its size limit, so this box cannot be cleared.",
    es: "La lista de servidores que se han quitado ha llegado a su tamaño máximo, así que este servidor no se puede quitar.",
  },
  "membership.revoked_duplicate": {
    en: "The list of boxes this box holds is not valid, so it cannot be changed here.",
    es: "La lista de servidores que tiene este servidor no es válida, así que no se puede cambiar aquí.",
  },
  "membership.revoked_node_listed": {
    en: "The list of boxes this box holds is not valid, so it cannot be changed here.",
    es: "La lista de servidores que tiene este servidor no es válida, así que no se puede cambiar aquí.",
  },
  "membership.held_untrusted": {
    en: "This box cannot check its own list of boxes, so it cannot add a box. Nothing was changed.",
    es: "Este servidor no puede comprobar su propia lista de servidores, así que no puede añadir otro. No se ha cambiado nada.",
  },
  "mirror.join_not_found": {
    en: "This box is no longer asking to join: it was added from another page, it ran out of time, or someone chose No or Start again.",
    es: "Este servidor ya no está pidiendo unirse: se añadió desde otra página, se agotó el tiempo o alguien eligió No o Empezar de nuevo.",
  },
  "mirror.join_not_confirmed": {
    en: "The new box has not chosen Join yet. Choose Join on the new box, then Add as spare here.",
    es: "El servidor nuevo aún no ha elegido Unirse. Elige Unirse en el servidor nuevo y después Añadir como reserva aquí.",
  },
  "mirror.join_in_progress": {
    en: "This box's copy is already being prepared. Wait a moment.",
    es: "Ya se está preparando la copia para este servidor. Espera un momento.",
  },
  "mirror.join_other_approved": {
    en: "Another box is being added as a spare, or was added a moment ago. Wait for it to finish joining, then try this one again in a few minutes.",
    es: "Se está añadiendo otro servidor como reserva, o se añadió hace un momento. Espera a que termine de unirse y vuelve a intentarlo con este dentro de unos minutos.",
  },
  "mirror.join_stopped_after_listing": {
    en: "This join stopped while the new box's copy was being prepared, so nothing was sent, but this page now lists the new box. Choose Remove from venue in its row, then Clear from list, then choose Start again on the new box.",
    es: "Esta unión se detuvo mientras se preparaba la copia del servidor nuevo, así que no se ha enviado nada, pero esta página ya muestra el servidor nuevo. Elige Retirar del local en su fila y después Quitar de la lista; luego elige Empezar de nuevo en el servidor nuevo.",
  },
  "mirror.spare_already_joined": {
    en: "This venue already has a spare box. Remove it on this page before adding another.",
    es: "Este local ya tiene un servidor de reserva. Retíralo en esta página antes de añadir otro.",
  },
  "mirror.bucket_stream_active": {
    en: "Continuous copy to your bucket is on. Turn it off under Backups to add a spare; your bucket then stops receiving the venue's changes.",
    es: "La copia continua a tu bucket está activada. Desactívala en Copias de seguridad para añadir un servidor de reserva; tu bucket dejará de recibir los cambios del local.",
  },
  "mirror.clocks_apart": {
    en: "The two boxes' clocks are more than 10 minutes apart (this box {primaryAt}, the new box {standbyAt}). If the new box's time is wrong, connect it to the internet for a minute so it sets its clock, then choose No on it and Join again.",
    es: "Los relojes de los dos servidores se separan más de 10 minutos (este {primaryAt}, el nuevo {standbyAt}). Si la hora del servidor nuevo es incorrecta, conéctalo a internet un minuto para que ajuste su reloj y elige No en él y después Unirse otra vez.",
  },
  "mirror.standby_name_taken": {
    en: "Another box here has the same short name as the new box. Choose No on the new box, then Join again; it picks a new name.",
    es: "Otro servidor de este local tiene el mismo nombre corto que el nuevo. Elige No en el servidor nuevo y después Unirse otra vez; tomará otro nombre.",
  },
  "mirror.membership_full": {
    en: "This venue's list of boxes already holds {limit} boxes, the most it can hold. Clear a removed box from the list on this page before adding another.",
    es: "La lista de servidores de este local ya tiene {limit} servidores, el máximo que admite. Quita de la lista en esta página un servidor retirado antes de añadir otro.",
  },
  "mirror.standby_removed": {
    en: "The new box asked under the name of a box removed from this venue. Choose No on the new box, then Join again; it picks a new name.",
    es: "El servidor nuevo lo pidió con el nombre de un servidor retirado de este local. Elige No en el servidor nuevo y después Unirse otra vez; tomará otro nombre.",
  },
  "mirror.standby_invalid": {
    en: "The new box's request could not be read, so nothing was sent. Choose Start again on the new box.",
    es: "No se ha podido leer la solicitud del servidor nuevo, así que no se ha enviado nada. Elige Empezar de nuevo en el servidor nuevo.",
  },
  // Setting up a venue (`apps/server/src/provision.ts`) and joining as a spare
  // (`apps/server/src/adopt.ts`) both record whether it is a preparation or the real venue; the
  // development demo seed (`apps/server/scripts/dev-setup.ts`) does not.
  "mirror.not_provisioned": {
    en: "This box does not record whether this venue is a preparation venue or the real one, so it cannot be copied to a spare. Nothing was changed. This is a fault in Waitron.",
    es: "Este servidor no tiene registrado si este local es de preparación o el real, así que no se puede copiar a un servidor de reserva. No se ha cambiado nada. Es un fallo de Waitron.",
  },
  "module.config_invalid": {
    en: "A module's settings on this box could not be read, so this could not be done. Nothing was changed.",
    es: "No se han podido leer los ajustes de un módulo en este servidor, así que no se ha podido hacer. No se ha cambiado nada.",
  },
  "membership.write_contended": {
    en: "The list of boxes was being changed at the same moment. Try again.",
    es: "La lista de servidores se estaba cambiando en ese mismo momento. Vuelve a intentarlo.",
  },
  "handover.request_invalid": {
    en: "The request to hand the work over to another box was not valid, so nothing was changed. Start the handover again.",
    es: "La solicitud para pasar el trabajo a otro servidor no era válida, así que no se ha cambiado nada. Vuelve a empezar el traspaso.",
  },
  "handover.step_out_of_order": {
    en: "The handover is at a different stage, so this step cannot be taken now. Refresh the page to see where it stands.",
    es: "El traspaso está en otra fase, así que este paso no se puede dar ahora. Actualiza la página para ver en qué punto está.",
  },
  "handover.operation_conflict": {
    en: "This handover was already started with different details, so nothing was changed. Start a new handover.",
    es: "Este traspaso ya se empezó con otros datos, así que no se ha cambiado nada. Empieza un traspaso nuevo.",
  },
  "promotion.from_box_only": {
    en: "In this version a standby box cannot be switched on from another device. Nothing was changed.",
    es: "En esta versión, un servidor en espera no se puede activar desde otro dispositivo. No se ha cambiado nada.",
  },
  "handover.operation_in_progress": {
    en: "A handover is already in progress. Keep both boxes connected, and wait for it to finish before starting another handover or removing a box.",
    es: "Ya hay un traspaso en curso. Mantén los dos servidores conectados y espera a que termine antes de iniciar otro traspaso o retirar un servidor.",
  },
  "handover.return_outstanding": {
    en: "The last handover is still waiting for the old main box to return its invoice records and working hours. Switch it on, or choose Will not return for it on the Servers page. Will not return stops the wait; invoice records and working hours the old main box recorded after the copy this main box started from stay only on it. Or choose Wipe and remove on its row to wipe it once it is on, accepting that what it has not returned stays set aside on it.",
    es: "El último traspaso sigue esperando a que el servidor principal anterior devuelva sus registros de facturación y horas trabajadas. Enciéndelo, o elige No volverá en su fila de Servidores. No volverá deja de esperar; los registros de facturación y horas trabajadas que el servidor principal anterior hizo después de la copia con la que empezó este servidor principal se quedan solo en él. O elige Borrar y retirar en su fila para borrarlo cuando esté encendido, aceptando que lo que no ha devuelto se quede apartado en él.",
  },
  "handover.reset_loss_unaccepted": {
    en: "The old main box has not returned all its invoice records and working hours, so it was not asked to wipe itself. Keep it switched on and connected while it returns them, then choose Wipe and remove again. Or choose Wipe and remove now and tick that you accept that what it has not returned stays set aside on it.",
    es: "El servidor principal anterior no ha devuelto todos sus registros de facturación y horas trabajadas, así que no se le ha pedido que se borre. Mantenlo encendido y conectado mientras los devuelve y luego vuelve a elegir Borrar y retirar. O elige ahora Borrar y retirar y marca que aceptas que lo que no ha devuelto se quede apartado en él.",
  },
  "handover.reset_not_previous_main": {
    en: "This main box did not take over directly from that old main box, so it cannot send it the wipe, and it was not asked to wipe itself. Choose Remove from venue on its row, then wipe that box from a terminal.",
    es: "Este servidor principal no sustituyó directamente a ese servidor principal anterior, así que no puede enviarle el borrado y no se le ha pedido que se borre. Elige Retirar del local en su fila y luego borra ese servidor desde un terminal.",
  },
  "handover.old_box_data_unavailable": {
    en: "That box is not listed as the old main box any more, so nothing was downloaded. Refresh the list to see where it stands.",
    es: "Ese servidor ya no figura como el servidor principal anterior, así que no se ha descargado nada. Actualiza la lista para ver en qué punto está.",
  },
  "handover.old_box_data_wipe_ordered": {
    en: "The old main box has already been asked to wipe itself, so its data can no longer be downloaded from here.",
    es: "Ya se ha pedido al servidor principal anterior que se borre, así que sus datos ya no se pueden descargar desde aquí.",
  },
  "handover.old_box_unreachable": {
    en: "This box could not reach the old main box, so nothing was downloaded. Download the data from the old main box's own page, at the address above, or switch it on, connect it to the venue's network and try again.",
    es: "Este servidor no ha podido comunicarse con el servidor principal anterior, así que no se ha descargado nada. Descarga los datos desde la propia página del servidor principal anterior, en la dirección de arriba, o enciéndelo, conéctalo a la red del local y vuelve a intentarlo.",
  },
  "handover.old_box_data_refused": {
    en: "The old main box did not send a file this box could check, so nothing was downloaded. Try again in a minute, or download the data from the old main box's own page, at the address above.",
    es: "El servidor principal anterior no ha enviado un archivo que este servidor pueda comprobar, así que no se ha descargado nada. Vuelve a intentarlo dentro de un minuto o descarga los datos desde la propia página del servidor principal anterior, en la dirección de arriba.",
  },
  "handover.old_box_data_busy": {
    en: "Another download of the old main box's data is running, so nothing was downloaded this time. Try again in a minute.",
    es: "Ya hay otra descarga de los datos del servidor principal anterior en curso, así que esta vez no se ha descargado nada. Vuelve a intentarlo dentro de un minuto.",
  },
  "handover.old_box_data_too_large": {
    en: "The old main box's file is too large to pass on through this box, so nothing was downloaded. Download it from the old main box's own page, at the address above.",
    es: "El archivo del servidor principal anterior es demasiado grande para pasarlo por este servidor, así que no se ha descargado nada. Descárgalo desde la propia página del servidor principal anterior, en la dirección de arriba.",
  },
  "membership.node_not_replaced": {
    en: "That box is not listed as a replaced main box any more, so it was not asked to wipe itself. Refresh the list to see where it stands.",
    es: "Ese servidor ya no figura como un servidor principal sustituido, así que no se le ha pedido que se borre. Actualiza la lista para ver en qué punto está.",
  },
  "handover.return_not_outstanding": {
    en: "No handover here is waiting for that box to return its invoice records and working hours, so nothing was changed. Refresh the list.",
    es: "Ningún traspaso de este servidor está esperando a que ese servidor devuelva sus registros de facturación y horas trabajadas, así que no se ha cambiado nada. Actualiza la lista.",
  },
  // A fault in Waitron: a box records one restriction, a repeat carries the same values, and nothing
  // rewrites one.
  "handover.restriction_conflict": {
    en: "This box has already recorded that it handed over its work, with different details, so the record was not changed. This is a fault in Waitron.",
    es: "Este servidor ya registró que pasó su trabajo a otro, con otros datos, así que el registro no se ha cambiado. Es un fallo de Waitron.",
  },
  "provisioning.database_ahead": {
    en: "The database contains changes this version of Waitron does not recognise. Install the same or a newer version of Waitron before trying again.",
    es: "La base de datos contiene cambios que esta versión de Waitron no reconoce. Instala la misma versión de Waitron o una más reciente antes de volver a intentarlo.",
  },
  "handover.stepping_down": {
    en: "This box is handing over or has handed over the venue, so it refused this action. Use the main box’s address once that box is taking sales.",
    es: "Este servidor está traspasando el local o ya lo ha traspasado, así que ha rechazado esta acción. Usa la dirección del servidor principal cuando ese servidor acepte ventas.",
  },
  "handover.known_handover": {
    en: "This box has already handed over the venue. Open the current main box’s address to continue.",
    es: "Este servidor ya ha traspasado el local. Abre la dirección del servidor principal actual para continuar.",
  },
  "handover.peer_unknown": {
    en: "The sending box is not trusted for this request. Check the list of boxes on the current main box before trying again.",
    es: "El servidor que envía la solicitud no está autorizado para hacerla. Revisa la lista de servidores en el servidor principal actual antes de volver a intentarlo.",
  },
  "handover.not_stepped_down": {
    en: "The old box has not confirmed that it stopped for this handover. Keep both boxes connected and check the handover’s progress on the old box.",
    es: "El servidor antiguo no ha confirmado que se haya detenido para este traspaso. Mantén ambos servidores conectados y consulta el progreso del traspaso en el servidor antiguo.",
  },
  "handover.operation_unknown": {
    en: "That box has no record of this handover. Open the Servers page on the current main box to check the current handover.",
    es: "Ese servidor no tiene constancia de este traspaso. Abre la página Servidores en el servidor principal actual para consultar el traspaso actual.",
  },
  "handover.final_copy_changed": {
    en: "The old box’s venue data changed after its final copy was made. Keep both boxes connected while the copy is requested again.",
    es: "Los datos del local en el servidor antiguo han cambiado después de hacer su copia final. Mantén ambos servidores conectados mientras se vuelve a pedir la copia.",
  },
  "handover.source_unreachable": {
    en: "This box could not complete this handover step. It retries by itself. Check both boxes’ power, connections and free disk space, and the old box’s entry in the list of boxes.",
    es: "Este servidor no ha podido completar este paso del traspaso. Lo reintenta solo. Comprueba la alimentación, las conexiones y el espacio libre de ambos servidores, y la entrada del servidor antiguo en la lista de servidores.",
  },
  "handover.not_a_spare": {
    en: "This box is not a spare and cannot accept this handover. Open the Servers page on the main box and choose a joined spare.",
    es: "Este servidor no es de reserva y no puede aceptar este traspaso. Abre la página Servidores en el servidor principal y elige un servidor de reserva que ya se haya unido.",
  },
  "handover.promotion_running": {
    en: "This box is being made the main box right now, so it did not accept this handover. Nothing was changed. If that does not finish, start the handover again.",
    es: "Este servidor está pasando a ser el servidor principal en este momento, así que no ha aceptado el traspaso. No se ha cambiado nada. Si eso no termina, vuelve a empezar el traspaso.",
  },
  "handover.membership_mismatch": {
    en: "The boxes disagree about the venue or its list of boxes, or the sender is not listed as main. Check the Servers page on the current main box before trying again.",
    es: "Los servidores no coinciden en el local o en su lista de servidores, o el remitente no figura como principal. Revisa la página Servidores en el servidor principal actual antes de volver a intentarlo.",
  },
  "handover.not_main_box": {
    en: "This box is not the main box. Open the Servers page at the main box’s address to start a handover.",
    es: "Este servidor no es el principal. Abre la página Servidores en la dirección del servidor principal para iniciar un traspaso.",
  },
  "handover.venue_not_supported": {
    en: "This venue’s way of filing invoices does not support handover yet. Choose Stop and keep using the main box.",
    es: "La forma de presentar facturas de este local aún no admite el traspaso. Elige Parar y sigue usando el servidor principal.",
  },
  "handover.destination_not_spare": {
    en: "That box is not listed as a spare. Choose Stop and check the list on the Servers page before choosing a spare.",
    es: "Ese servidor no figura como reserva. Elige Parar y revisa la lista actual de Servidores antes de elegir un servidor de reserva.",
  },
  "handover.destination_not_joined": {
    en: "That spare has not finished joining this venue. Choose Stop and finish joining it before handing over.",
    es: "Ese servidor de reserva no ha terminado de unirse a este local. Elige Parar y termina de incorporarlo antes de traspasar el local.",
  },
  "handover.destination_unaddressable": {
    en: "The spare has no separate address on this box’s list. Choose Stop and finish the spare’s network setup before handing over.",
    es: "El servidor de reserva no tiene una dirección propia en la lista de este servidor. Elige Parar y termina de configurar su red antes de traspasar el local.",
  },
  "handover.destination_unreachable": {
    en: "The spare did not give a verifiable answer. Check its power and network connection, then try the handover again.",
    es: "El servidor de reserva no ha dado una respuesta verificable. Comprueba su alimentación y su conexión de red y vuelve a intentar el traspaso.",
  },
  "handover.restarted_before_stepdown": {
    en: "This handover was cancelled before this box handed over. Check the list on the Servers page, then start a new handover if the spare is still listed.",
    es: "Este traspaso se canceló antes de que este servidor cediera el local. Revisa la lista actual de Servidores e inicia otro traspaso si el servidor de reserva sigue en ella.",
  },
  "handover.superseded_during_start": {
    en: "Another box took over or the venue’s list of boxes changed. Open the current main box’s address to continue.",
    es: "Otro servidor ha pasado a llevar el local o ha cambiado la lista de servidores. Abre la dirección del servidor principal actual para continuar.",
  },
  "handover.membership_changed": {
    en: "The venue’s details or its list of boxes changed during this handover. Check the Servers page on the current main box before starting a new handover.",
    es: "Los datos del local o su lista de servidores han cambiado durante el traspaso. Revisa la página Servidores en el servidor principal actual antes de iniciar otro.",
  },
  "handover.backup_settings_differ": {
    en: "The spare does not hold this box's backup settings, so it did not accept the handover. This box keeps selling, and sends the spare its settings by itself. Try again in a minute.",
    es: "El servidor de reserva no tiene los ajustes de copia de seguridad de este servidor, así que no ha aceptado el traspaso. Este servidor sigue vendiendo y le envía sus ajustes solo. Vuelve a intentarlo dentro de un minuto.",
  },
  "handover.modules_differ": {
    en: "The two boxes have different software or enabled modules. Choose Stop and bring both boxes to the same software and module selection before handing over.",
    es: "Los dos servidores tienen programas o módulos activados distintos. Elige Parar y pon en ambos los mismos programas y módulos antes de traspasar el local.",
  },
  "handover.key_ring_mismatch": {
    en: "The spare has a missing or different encryption key needed for this venue. Choose Stop and join the spare again before handing over.",
    es: "Al servidor de reserva le falta una clave de cifrado necesaria para este local o tiene una distinta. Elige Parar y vuelve a unirlo al local antes de traspasarlo.",
  },
  "handover.source_check_failed": {
    en: "This box could not verify the venue data for handover. You can keep selling here. Choose Stop and follow the handover guide before trying again.",
    es: "Este servidor no ha podido verificar los datos del local para el traspaso. Puedes seguir vendiendo aquí. Elige Parar y sigue la guía de traspaso antes de volver a intentarlo.",
  },
  "handover.settings_unreadable": {
    en: "This box could not read the settings needed for handover. Choose Stop, restart this box and check its start page before trying again.",
    es: "Este servidor no ha podido leer los ajustes necesarios para el traspaso. Elige Parar, reinícialo y revisa su página de inicio antes de volver a intentarlo.",
  },
  "handover.destination_settings_unreadable": {
    en: "The spare could not read the settings needed for handover. Choose Stop, restart the spare and check its start page before trying again.",
    es: "El servidor de reserva no ha podido leer los ajustes necesarios para el traspaso. Elige Parar, reinícialo y revisa su página de inicio antes de volver a intentarlo.",
  },
  "handover.settings_changed": {
    en: "This box’s settings changed during the handover. Check the Servers page on the current main box before starting a new handover.",
    es: "Los ajustes de este servidor han cambiado durante el traspaso. Revisa la página Servidores en el servidor principal actual antes de iniciar otro.",
  },
  "handover.indicator_untrusted": {
    en: "The final copy’s description could not be verified as coming from the old box. Check the list of boxes on the current main box before trying again.",
    es: "No se ha podido verificar que la descripción de la copia final venga del servidor antiguo. Revisa la lista de servidores en el servidor principal actual antes de volver a intentarlo.",
  },
  "handover.copy_mismatch": {
    en: "This copy has not been confirmed for this handover. A controlled handover fetches it again. After an emergency restart, the switch page checks the copy again; a changed copy cannot start a saved switch.",
    es: "Esta copia no está confirmada para este traspaso. Un traspaso controlado vuelve a pedirla. Tras reiniciar durante una emergencia, la página de cambio vuelve a comprobar la copia; una copia que haya cambiado no puede iniciar un cambio guardado.",
  },
  "handover.copy_damaged": {
    en: "This copy failed its database check. A controlled handover requests another copy, but that cannot repair invalid data on the old box. If the checks keep failing, use the emergency procedure with a working backup.",
    es: "Esta copia no ha superado la comprobación de su base de datos. Un traspaso controlado pide otra copia, pero eso no repara datos inválidos en el servidor antiguo. Si las comprobaciones siguen fallando, usa el procedimiento de emergencia con una copia de seguridad válida.",
  },
  "handover.chain_broken": {
    en: "The records in this copy failed their check, so this box has not taken over. Use the emergency procedure with a backup that passes its checks.",
    es: "Los registros de esta copia no han superado su comprobación, así que este servidor no ha tomado el relevo. Usa el procedimiento de emergencia con una copia de seguridad que supere las comprobaciones.",
  },
  "handover.preparation_state_too_large": {
    en: "The saved module preparations leave too little room to accept this handover. This is a fault in Waitron; retrying the same copy will not make that file smaller.",
    es: "Los preparativos de módulos guardados dejan demasiado poco espacio para aceptar este traspaso. Es un fallo de Waitron; reintentar con la misma copia no reduce ese archivo.",
  },
  "handover.summary_mismatch": {
    en: "The copy’s contents do not match the old box’s description. Repeating the check does not repair that copy. Use the emergency procedure with a working backup.",
    es: "El contenido de la copia no coincide con la descripción del servidor antiguo. Repetir la comprobación no repara esa copia. Usa el procedimiento de emergencia con una copia de seguridad válida.",
  },
  "handover.summary_unreadable": {
    en: "This box could not read the copy’s contents to check them. Keep both boxes connected while it retries. If it keeps failing, use the emergency procedure with a working backup.",
    es: "Este servidor no ha podido leer el contenido de la copia para comprobarlo. Mantén ambos servidores conectados mientras lo reintenta. Si sigue fallando, usa el procedimiento de emergencia con una copia de seguridad válida.",
  },
  "handover.copy_lacks_destination": {
    en: "This copy has no usable record of this spare. Check the list of boxes on the old box; a controlled handover needs a spare that has finished joining.",
    es: "Esta copia no tiene un registro válido de este servidor de reserva. Revisa la lista de servidores en el servidor antiguo; un traspaso controlado necesita un servidor de reserva que haya terminado de unirse.",
  },
  "handover.authoriser_not_permitted": {
    en: "The person who authorised this handover lacks Manage boxes permission in this copy. Check their permissions on the main box before starting another handover.",
    es: "La persona que autorizó este traspaso no tiene permiso de Gestionar servidores en esta copia. Revisa sus permisos en el servidor principal antes de iniciar otro traspaso.",
  },
  "handover.preparation_state_unusable": {
    en: "This box cannot read or add to its module preparation file, so it has not placed the accepted copy. This is a fault in Waitron or this box’s disk. Retry a normal boot only after that file is repaired.",
    es: "Este servidor no puede leer o ampliar su archivo de preparación de módulos, así que no ha colocado la copia aceptada. Es un fallo de Waitron o del disco de este servidor. Reintenta un arranque normal solo después de reparar ese archivo.",
  },
  "handover.placement_failed": {
    en: "This box could not put the copy of the venue it accepted in place. The copy is kept, and Retry tries again.",
    es: "Este servidor no pudo poner en su sitio la copia del local que aceptó. La copia se conserva, y Reintentar lo vuelve a intentar.",
  },
  "handover.placement_no_room": {
    en: "This box's disk has no room for the copy of the venue it accepted: it needs room for one more whole copy. The copy is kept, and Retry tries again.",
    es: "El disco de este servidor no tiene sitio para la copia del local que aceptó: necesita sitio para otra copia entera. La copia se conserva, y Reintentar lo vuelve a intentar.",
  },
  "handover.no_room_at_offer": {
    en: "The spare could not confirm room for two whole copies of the venue plus space kept free so the box can start. This attempt has ended while the main box keeps selling. Choose Stop, make room on the spare, then hand over again.",
    es: "El servidor de reserva no ha podido confirmar sitio para dos copias enteras del local y el espacio que se mantiene libre para que el servidor pueda arrancar. Este intento ha terminado y el servidor principal sigue vendiendo. Elige Parar, haz sitio en el servidor de reserva y vuelve a traspasar el local.",
  },
  "handover.no_room_to_place": {
    en: "This box's disk has no room to put the accepted copy of the venue in place. It asks the old box to give up filing once there is room. The old box stays stopped.",
    es: "El disco de este servidor no tiene sitio para poner en su sitio la copia aceptada del local. Pedirá al servidor antiguo que ceda el envío de registros cuando haya sitio. El servidor antiguo sigue detenido.",
  },
  "handover.accepted_copy_missing": {
    en: "The accepted copy is no longer on this box’s disk. This is a fault in Waitron or this box’s disk. Retry a normal boot only if that copy has been put back.",
    es: "La copia aceptada ya no está en el disco de este servidor. Es un fallo de Waitron o del disco de este servidor. Reintenta un arranque normal solo si esa copia ha vuelto a su sitio.",
  },
  "handover.source_no_longer_main": {
    en: "This box's list of boxes no longer has the old box as the main box, so this box has not taken over from it. If a newer list names the old box again, a waiting box carries on by itself, and an activation that was refused has to be sent again.",
    es: "La lista de servidores de este servidor ya no tiene al servidor antiguo como servidor principal, así que este servidor no ha asumido sus funciones. Si una lista más reciente vuelve a nombrar al servidor antiguo, un servidor en espera sigue por sí solo, y una activación rechazada hay que enviarla de nuevo.",
  },
  "handover.relinquishment_invalid": {
    en: "The old box's answer did not hand filing to this box for the copy it accepted, so this box has not taken over. It keeps asking the old box.",
    es: "La respuesta del servidor antiguo no le cede a este servidor el envío de registros de la copia que aceptó, así que este servidor no ha asumido el envío. Sigue preguntando al servidor antiguo.",
  },
  "handover.summary_failed": {
    en: "The old box could not read part of the venue's data from its final copy, so it sent neither the copy nor its description. Its venue data is unchanged. Asking again makes it take a new copy and read that.",
    es: "El servidor antiguo no ha podido leer parte de los datos del local en su copia final, así que no ha enviado ni la copia ni su descripción. Sus datos del local no han cambiado. Si se vuelve a pedir, hará una copia nueva y la leerá.",
  },
  "handover.indicator_mismatch": {
    en: "The final copy’s description cannot be read or does not match this handover. Check the handover’s progress on both boxes before trying again.",
    es: "La descripción de la copia final no se puede leer o no corresponde a este traspaso. Consulta el progreso del traspaso en ambos servidores antes de volver a intentarlo.",
  },
  "handover.copy_check_failed": {
    en: "This box could not finish checking the copy, so it has not taken over. A controlled handover retries by itself. In an emergency, choose Try again on the switch page, or use a working backup.",
    es: "Este servidor no ha podido terminar de comprobar la copia, así que no ha tomado el relevo. Un traspaso controlado lo reintenta solo. En una emergencia, elige Volver a intentarlo en la página de cambio o usa una copia de seguridad válida.",
  },
  "handover.source_still_answering": {
    en: "The old box still answers. Switch it off before an emergency switch, or use a controlled handover. Before activation, it must be off or confirm that this box replaces it.",
    es: "El servidor antiguo sigue respondiendo. Apágalo antes de un cambio de emergencia o usa un traspaso controlado. Antes de activar, debe estar apagado o confirmar que este servidor lo sustituye.",
  },
  "handover.source_not_established": {
    en: "The old box's status could not be established. Switch it off at the plug, check its address and connection, then try again.",
    es: "No se ha podido determinar el estado del servidor antiguo. Desenchúfalo, comprueba su dirección y conexión y vuelve a intentarlo.",
  },
  "handover.controlled_unresolved": {
    en: "This box has an unfinished handover that an emergency switch cannot replace. Resume that handover before starting another.",
    es: "Este servidor tiene un traspaso sin terminar que un cambio de emergencia no puede sustituir. Reanuda ese traspaso antes de iniciar otro.",
  },
  "alert.not_found": {
    en: "This alert no longer exists. Refresh the list.",
    es: "Este aviso ya no existe. Actualiza la lista.",
  },
  "fiscal.not_filing": {
    en: "This box does not send records to the tax agency.",
    es: "Este servidor no envía registros a Hacienda.",
  },
  "fiscal.awaiting_certificate": {
    en: "No record can be sent until the tax agency's certificate is installed. Install it in Venue settings.",
    es: "No se puede enviar ningún registro hasta que se instale el certificado de la AEAT. Instálalo en Ajustes del local.",
  },
  "storage.disk_full": {
    en: "Not saved: the box is out of disk space.",
    es: "No se ha guardado: el servidor no tiene espacio en disco.",
  },
  "clock.unusable": {
    en: "Not recorded: the box's clock is wrong.",
    es: "No se ha registrado: la hora del servidor es incorrecta.",
  },
  "clock.unconfirmed": {
    en: "Not recorded: the box is waiting for its time to be confirmed. Confirm it on the Box status page, or with “Check the time” on a till.",
    es: "No se ha registrado: el servidor espera a que se confirme su hora. Confírmala en Estado del servidor o con «Comprobar la hora» en una caja.",
  },
  "clock.check_expired": {
    en: "The check took too long. Try again.",
    es: "La comprobación ha tardado demasiado. Vuelve a intentarlo.",
  },
  "clock.set_refused": {
    en: "The box's clock was not set. See the Clock row.",
    es: "No se ha puesto en hora el servidor. Mira la fila Reloj.",
  },
  "clock.set_failed": {
    en: "The box could not set its clock. See the Clock row.",
    es: "El servidor no ha podido poner su reloj en hora. Mira la fila Reloj.",
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

export const SET_MENU_FIELDS: Record<string, { en: string; es: string }> = {
  setPrice: {
    en: "Enter a set-menu price from 0.00 to 10,000.00.",
    es: "Indica un precio entre 0,00 y 10.000,00 para el menú.",
  },
  surcharge: {
    en: "Enter a surcharge from 0.00 to 10,000.00.",
    es: "Indica un suplemento de 0,00 a 10.000,00.",
  },
  setVatClass: {
    en: "Choose an eat-in VAT rate.",
    es: "Elige un tipo de IVA para consumo en el local.",
  },
  setTakeawayVatClass: {
    en: "Choose a takeaway VAT rate or clear it to use the Eat-in VAT.",
    es: "Elige un tipo de IVA para llevar o quítalo para usar el IVA para comer aquí.",
  },
  lines: {
    en: "A set menu can have up to 20 inclusion lines. Combine courses in one line or remove a line.",
    es: "Un menú puede tener hasta 20 líneas. Combina varios cursos en una línea o elimina una.",
  },
  count: {
    en: "Enter a whole number from 1 to 99.",
    es: "Indica un número entero del 1 al 99.",
  },
  courseId: {
    en: "Choose a course that is still available.",
    es: "Elige un curso que siga disponible.",
  },
  courseIds: {
    en: "Choose at least one available course and select each course only once per line.",
    es: "Elige al menos un curso disponible y selecciona cada curso solo una vez por línea.",
  },
  variants: {
    en: "Reload the dish and review the choices for its current variants.",
    es: "Vuelve a cargar el plato y revisa las opciones de sus variantes actuales.",
  },
};

registerCodeMessages(CODE_MESSAGES);

export { codeOf };

/** The field a refusal belongs beside, by what the error carries (packages/menu/src/errors.ts):
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
  params?: {
    reason?: unknown;
    field?: unknown;
    name?: unknown;
    count?: unknown;
    seconds?: unknown;
    kind?: unknown;
    freeBytes?: unknown;
    neededBytes?: unknown;
    writtenBytes?: unknown;
    primaryAt?: unknown;
    standbyAt?: unknown;
    limit?: unknown;
  },
): string {
  if (
    code === "mirror.clocks_apart" &&
    typeof params?.primaryAt === "string" &&
    typeof params.standbyAt === "string"
  )
    return registeredCodeMessage(code, locale)
      .replace("{primaryAt}", formatRecentMinute(params.primaryAt))
      .replace("{standbyAt}", formatRecentMinute(params.standbyAt));
  if (code === "mirror.membership_full" && typeof params?.limit === "number")
    return registeredCodeMessage(code, locale).replace("{limit}", String(params.limit));
  if (
    code === "printer.bluetooth_command_busy" &&
    typeof params?.seconds === "number" &&
    (params.kind === "pair" || params.kind === "forget")
  ) {
    const operation = pickLocale(
      {
        en: params.kind === "pair" ? "Pairing" : "Unpairing",
        es: params.kind === "pair" ? "El emparejamiento" : "La desvinculación",
      },
      locale,
    );
    return pickLocale(
      {
        en: "{operation} is still running. Its request expires in about {seconds} seconds; try again then.",
        es: "{operation} sigue en curso. La solicitud vence en unos {seconds} segundos; inténtalo de nuevo entonces.",
      },
      locale,
    )
      .replace("{operation}", operation)
      .replace("{seconds}", String(params.seconds));
  }
  if (code === "cloud.emergency_code_rate_limited" && typeof params?.seconds === "number")
    return registeredCodeMessage(code, locale).replace("{seconds}", String(params.seconds));
  if (
    code === "cloud.emergency_hosting_closed" &&
    ["setting_off", "level_inactive", "no_payment_method", "not_provisioned"].includes(
      params?.reason as string,
    )
  ) {
    const key = `cloud.emergency_${params!.reason}` as "cloud.emergency_setting_off";
    return pickLocale({ en: en[key], es: es[key] }, locale);
  }
  if (code === "tax_office.space_low")
    return registeredCodeMessage(code, locale)
      .replace("{free}", formatBytes(params?.freeBytes, locale))
      .replace("{needed}", formatBytes(params?.neededBytes, locale));
  if (code === "tax_office.space_ran_out")
    return registeredCodeMessage(code, locale).replace(
      "{written}",
      formatBytes(params?.writtenBytes, locale),
    );
  if (
    code === "set_menu.invalid" &&
    typeof params?.field === "string" &&
    Object.hasOwn(SET_MENU_FIELDS, params.field)
  )
    return pickLocale(SET_MENU_FIELDS[params.field]!, locale);
  if (
    code === "set_menu.not_publishable" &&
    typeof params?.name === "string" &&
    typeof params.count === "number"
  ) {
    const { name, count } = params;
    return pickLocale(
      {
        en: `${name} has ${count} ${count === 1 ? "problem" : "problems"}. Correct the set-menu draft before publishing this menu.`,
        es: `${name} tiene ${count} ${count === 1 ? "problema" : "problemas"}. Corrige el borrador del menú antes de publicar esta carta.`,
      },
      locale,
    );
  }
  if (code === "venue.time_zone_not_ready") return zoneAdmissionMessage(params?.reason, locale);
  if (code === "receipt.language_orders_open" && typeof params?.count === "number")
    return ordersOpenMessage(params.count, locale);
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

function ordersOpenMessage(count: number, locale: string): string {
  const key = count === 1 ? "receipts.language_orders_open_one" : "receipts.language_orders_open";
  return pickLocale({ en: en[key], es: es[key] }, locale).replace("{count}", String(count));
}
