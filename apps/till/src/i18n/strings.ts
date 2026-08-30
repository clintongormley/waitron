// The till's string catalogue.
//
// English is the SOURCE of truth: `en` below is the base map, `StringKey` is
// derived from its keys, and every other locale is a translation that may only
// re-say what `en` already names. Spanish (`es`) is what a Spanish venue
// renders (the shipped default is en-GB; a venue is driven to es-ES at boot;
// see t.ts), but it is a translation, not the origin — a key must exist in
// `en` first.
//
// `apps/*` is exempt from the english-only guard (packages/db/src/english-only.ts),
// so the English UI copy here is deliberate and allowed; the Spanish below is
// user-facing translation, not schema vocabulary.
//
// Later till screens (Tasks 10-19) append keys here. Add the English base entry
// AND its Spanish translation together — `es` is typed `Record<StringKey,string>`,
// so a key added to `en` without a Spanish sibling is a compile error, which is
// the guard that keeps the two in step.
export const en = {
  // Primary actions
  "action.pay": "Pay",
  "action.confirm_payment": "Confirm payment",
  "action.new_sale": "New sale",
  // Counter receipt/drawer (§5): the ticket screen's reprint-the-paper and open-the-cash-drawer levers.
  "action.reprint": "Reprint",
  "action.open_drawer": "Open drawer",
  "action.logout": "Log out",
  "action.remove": "Remove",
  "action.add": "Add",
  "action.login": "Log in",
  "action.back": "Back",
  "action.cancel": "Cancel",
  "action.hold": "Hold",
  // The confirm verb of the reusable supervisor-override dialog (cash-drawer-authorization §5).
  "action.authorize": "Authorize",
  // Tenders
  "tender.cash": "Cash",
  "tender.card": "Card",
  "tender.card_ref": "Operation number (optional)",
  // Numeric keypad (accessible names for the non-alphanumeric keys)
  "pad.decimal": "Decimal point",
  "pad.backspace": "Backspace",
  // Money labels
  "label.change": "Change",
  "label.total": "Total",
  "label.tendered": "Tendered",
  // Basket
  "basket.empty": "Basket is empty",
  // Login / operator selection
  "login.enter_pin": "Enter PIN",
  "login.pick_operator": "Choose your name",
  "login.loading": "Loading…",
  "login.no_staff": "No staff available",
  "login.load_failed": "Could not load staff, try again",
  "login.error": "Could not log in, try again",
  // Supervisor-override dialog (cash-drawer-authorization §5) — the reusable "authorize this action"
  // modal a non-permitted operator gets under a gated policy: pick an eligible supervisor, then enter
  // their PIN. `override.error` is the generic in-dialog failure (a wrong PIN surfaces the shared
  // `pin.invalid` copy instead); `override.no_supervisors` is the empty-picker state.
  "override.title": "Supervisor authorization",
  "override.pick_supervisor": "Choose a supervisor",
  "override.enter_pin": "Enter the supervisor's PIN",
  "override.no_supervisors": "No supervisors available",
  "override.error": "Could not authorize, try again",
  // Weight entry (priced-by-weight products)
  "weigh.prompt": "Enter weight (kg)",
  // Held (parked) orders
  "held.label_prompt": "Name this order (optional)",
  "held.title": "Held orders",
  "held.empty": "No held orders",
  "held.retrieve": "Retrieve",
  "held.discard": "Discard",
  // Placing & prep (7c prepare & collect)
  "action.place": "Place order",
  "action.send_to_prep": "Send to prep",
  "action.collect": "Collect",
  // Station display (KDS-1) — the kitchen screen + the counter's default-station queue widget. `station.open`
  // is the counter's nav control (mirrors `floor.open`); `station.title` names the screen. The two view
  // toggle labels name the view they SWITCH TO (like `floor.view_*`): shown in kanban → offer the rail,
  // shown in rail → offer the board. `station.state.*` name the three kitchen states (also the kanban column
  // headers). `station.min` is a suffix word, not a sentence (t() takes no params, so a count-bearing
  // label is `${n} ${t(key)}` — the age "N min"; the dish label "qty× name" is DATA, not a translated
  // key). Spanish per design §6 (UI copy localised, identifiers English).
  "station.open": "Kitchen",
  "station.title": "Kitchen",
  "station.back": "Back to counter",
  "station.pick": "Station",
  "station.no_stations": "No stations",
  "station.empty": "Nothing in the kitchen",
  "station.view_kanban": "Board",
  "station.view_rail": "Tickets",
  "station.min": "min",
  "station.advance": "Advance",
  "station.bump_ticket": "Advance ticket",
  // The per-order Mode-P handover control on the rail card — hand a settled, fired order to the customer,
  // which drops it off the station display (KDS-1 §3e). A rail-card action, shown only for a collectable
  // (settled) order.
  "station.collect": "Collect",
  // The kitchen-fire action on a HELD course's rail section (KDS-2 §5a) — release this held course to the
  // kitchen, shown only when `fire_control = 'kitchen'` (the station display owns the fire; under `waiter`
  // the tab screen does, Task 7). A per-order/per-course action, so it lives on the rail card like the
  // collect handover, not on the cross-order kanban board.
  "station.fire_course": "Start course",
  // The per-order REPRINT action on the rail card (KDS-4 §3d) — re-send this order's current kitchen
  // tickets after a paper jam / lost print. Shown on the station display only in OPERATOR (session) mode:
  // the reprint route is session-guarded, so an enrolled DEVICE display (no session) hides it. A
  // per-order card-foot action beside the collect handover, like `station.collect`.
  "station.reprint": "Reprint",
  "station.state.queued": "New",
  "station.state.preparing": "Preparing",
  "station.state.ready": "Ready",
  // Device mode (device-identity-1 §5a) — the always-on KDS station display. `device.setup` is the lock
  // screen's affordance that routes a FRESH (unenrolled) display to the station screen in device mode;
  // the `device.enrol_*` keys are the enrol view shown there when no device cookie is present (a labelled
  // pairing-code field → enrol). The pairing-code redemption ERRORS (`device.pairing_invalid`/
  // `_expired`/`unauthorized`) are surfaced via `i18n/codes.ts`, not here — these are static UI copy.
  "device.setup": "Set up as kitchen display",
  "device.enrol_title": "Set up this kitchen display",
  "device.enrol_hint": "Enter the pairing code shown on the dashboard",
  "device.enrol_code": "Pairing code",
  "device.enrol_submit": "Set up",
  // Handheld enrol (handheld-tableside Task 8) — the twin of `device.setup`/the `device.enrol_*` keys
  // above, for a waiter's PHONE rather than a kitchen display. `device.setup_handheld` is the lock
  // screen's second affordance (beside `device.setup`) that routes a FRESH phone to the handheld enrol
  // view; `device.handheld_enrol_*` are that view's title/hint/submit (the code-field label reuses
  // `device.enrol_code`, which names no device type). A refused code shows the ONE generic
  // `device.enrol_failed` — the phone shell has no per-code recovery, so "invalid" vs "expired" would
  // read the same to the waiter (contrast the station screen, which maps codes via i18n/codes.ts).
  "device.setup_handheld": "Set up as waiter handheld",
  "device.handheld_enrol_title": "Set up this waiter handheld",
  "device.handheld_enrol_hint": "Enter the pairing code shown on the dashboard",
  "device.handheld_enrol_submit": "Set up",
  "device.enrol_failed": "That pairing code was not accepted. Ask a manager for a new one.",
  // Expo / pass display (KDS-3) — the expediter's cross-station board: a card per open order, its items
  // grouped by course. `expo.open` is the counter's nav control (mirrors `station.open`); `expo.title`
  // names the screen. The three per-course levers name the state they ADVANCE the course to: `expo.fire`
  // releases a HELD course (shown only when `fire_control = 'expo'`), `expo.ready` bumps a FIRED course to
  // ready ("all plated"), `expo.away` dispatches a READY course to the floor. Item station names + the
  // "N min" age reuse DATA / `station.min`; item states reuse `station.state.*`. Spanish per design §6.
  "expo.open": "Pass",
  "expo.title": "Pass",
  "expo.back": "Back to counter",
  "expo.empty": "Nothing on the pass",
  "expo.fire": "Fire",
  "expo.ready": "Course ready",
  "expo.away": "Away",
  // The per-order REPRINT action on an expo card (KDS-4 §3d) — re-send this order's current kitchen
  // tickets after a paper jam / lost print. The expo/pass ALWAYS runs in a logged-in session, so this is
  // shown on every card (unlike the station display, which hides it in device mode). Same verb as
  // `station.reprint`, kept in its own screen namespace like the other KDS action keys.
  "expo.reprint": "Reprint",
  "cancel.reason_prompt": "Reason for cancelling",
  // Integrated card terminal (sub-project 7 Task 9)
  "card.collecting": "Tap or insert card…",
  "card.cancel": "Cancel",
  "card.declined": "Card declined",
  "card.retry": "Retry card",
  "card.switch_tender": "Use another tender",
  "card.wait": "Keep waiting",
  "card.tip": "Tip (optional)",
  "card.offline_consent": "Accept offline if the network is down",
  // Allergens (menu & allergens) — UI chrome for the till allergen screen. `may_contain` follows the
  // snake_case sibling convention every other multi-word key here uses (card_ref, switch_tender, …),
  // not the camelCase the task brief spelled it; the allergen CODES/name strings are elsewhere
  // (i18n/allergen-names.ts), so these are screen chrome only.
  "allergens.open": "Allergens",
  "allergens.title": "Allergens",
  "allergens.notice": "Allergen information is available — please ask staff.",
  "allergens.pending": "Allergen info pending",
  "allergens.contains": "Contains",
  "allergens.may_contain": "May contain",
  "allergens.print": "Print",
  "allergens.close": "Close",
  // Staff schedule (the staff-facing swap/absence request path)
  "schedule.open": "My schedule",
  "schedule.title": "My schedule",
  "schedule.back": "Back to counter",
  "schedule.loading": "Loading…",
  "schedule.load_failed": "Could not load your schedule, try again",
  "schedule.shifts_title": "My upcoming shifts",
  "schedule.shifts_empty": "No upcoming shifts",
  "schedule.swaps_title": "Swaps offered to me",
  "schedule.swaps_empty": "No swaps offered to you",
  "schedule.accept": "Accept",
  "schedule.cover_title": "Offer a shift to a colleague",
  "schedule.cover_shift": "Which shift",
  "schedule.cover_colleague": "Offer to",
  "schedule.cover_submit": "Request cover",
  "schedule.absences_title": "My time off",
  "schedule.absences_empty": "No time off booked",
  "schedule.absence_title": "Request time off",
  "schedule.absence_kind": "Type",
  "schedule.absence_from": "From",
  "schedule.absence_to": "To",
  "schedule.absence_note": "Note (optional)",
  "schedule.absence_submit": "Request time off",
  "schedule.kind.holiday": "Holiday",
  "schedule.kind.sick_leave": "Sick leave",
  "schedule.kind.leave": "Leave",
  "schedule.kind.unpaid": "Unpaid leave",
  "schedule.status.requested": "Requested",
  "schedule.status.accepted": "Accepted",
  "schedule.status.approved": "Approved",
  "schedule.status.rejected": "Rejected",
  // Live floor (FP-1) — the till floor screen's chrome + occupancy copy. `t()` takes no params, so a
  // count-bearing label is rendered as `${n} ${t(key)}` (the value + the suffix word), which is why
  // these are suffix words rather than whole sentences. `floor.open` is the counter's nav control
  // (mirrors `schedule.open`); `floor.title` names the screen itself.
  "floor.open": "Floor",
  "floor.title": "Floor",
  "floor.back": "Back to counter",
  "floor.zones": "Zones",
  "floor.no_zone": "No zone",
  "floor.capacity": "pax",
  "floor.to_serve": "to serve",
  "floor.ready": "ready",
  "floor.en_route": "en route",
  "floor.line_count": "items",
  "floor.pending_delivery": "to deliver",
  "floor.free": "Free",
  // Spatial floor plan (FP-2): the map/list toggle, the manager-only edit toggle, the unplaced tray,
  // and the edit-mode inspector copy threaded into `<wt-floor-canvas>`. `floor.view_map`/`view_list`
  // label the toggle with the view it SWITCHES TO. `floor.shape_*` name the three canvas shapes.
  "floor.view_map": "Map",
  "floor.view_list": "List",
  "floor.edit_plan": "Edit plan",
  "floor.unplaced": "Unplaced",
  "floor.zone": "Zone",
  "floor.rotate": "Rotate",
  "floor.remove": "Remove from plan",
  "floor.shape": "Shape",
  "floor.shape_round": "Round",
  "floor.shape_square": "Square",
  "floor.shape_rect": "Rectangular",
  // Table-ordering screen (FP-1) — one open table's tab: the round bar, the pull-out tab drawer, and
  // its actions. `table.open_drawer` names the badged drawer handle; `table.pay_title`/`action.pay` both
  // render "Cobrar" (the reused tender-pay's own Pay button carries the tender). Spanish per design §5b.
  "table.title": "Table order",
  "table.back": "Back to floor",
  "table.open_drawer": "Tab",
  "table.send_round": "Send round",
  "table.pending_title": "To serve",
  "table.served_title": "Served",
  "table.none_pending": "Nothing to serve",
  "table.none_served": "Nothing served yet",
  "table.serve": "Mark served",
  "table.pay_title": "Charge",
  "table.status_title": "Status",
  "table.status_clear": "No status",
  // KDS-2 (§5b): the round bar's per-line course picker + the waiter-fire drawer section.
  // `table.course_label` labels each round line's course select; `table.course_default` is its
  // "use the product's default" placeholder (there is no explicit "no course" option). `table.fire_title`
  // heads the held-course section; `table.fire_course` is the per-course fire verb (course name appended).
  "table.course_label": "Course",
  "table.course_default": "Default",
  "table.fire_title": "Courses to fire",
  "table.fire_course": "Fire",
  // Table actions (TS-3/TS-4): the in-drawer move/join/merge/transfer flow. `table.actions_title` heads
  // the flow and labels its trigger (replacing the old disabled "Move · Split" placeholder). The
  // `table.action_*` keys name the four verbs + the disabled Split placeholder (Back/Cancel reuse the
  // shared `action.back`/`action.cancel`). The empty-state keys cover a picker with no valid targets;
  // the transfer keys head the line-picker step.
  "table.actions_title": "Table actions",
  "table.action_move": "Move to table",
  "table.action_join": "Join a table",
  "table.action_merge": "Merge a bill",
  "table.action_transfer": "Transfer items",
  "table.action_split": "Split (soon)",
  "table.no_free_tables": "No free tables",
  "table.no_other_tabs": "No other open tabs",
  "table.transfer_pick_lines": "Choose items to transfer",
  "table.transfer_confirm": "Transfer",
  "table.transfer_no_lines": "No items to transfer",
  // Errors
  "pin.invalid": "Wrong PIN, try again",
  "person.suspended": "Account suspended, ask a manager",
  "sale.error": "Could not complete the sale, try again",
  // Counter receipt/drawer (§5): a failed reprint or a failed drawer-open is NON-FATAL — the ticket
  // stays on screen and the operator retries. `drawer.error` covers both a `drawer.no_printer` (no
  // receipt printer set on this till) and a transient failure, staying generic like the sale/table
  // errors (never the raw domain code), since the fix in either case is the same to the operator.
  "reprint.error": "Could not reprint the receipt, try again",
  "drawer.error": "Could not open the cash drawer, try again",
  "held.park_error": "Could not hold the order, try again",
  "held.product_gone": "A product was removed and dropped from the order",
  "held.stale": "That order is no longer available",
  "place.error": "Could not place the order, try again",
  "station.advance_error": "Could not update the ticket, try again",
  // A failed per-user language write (PUT /api/session/locale) is non-fatal — the UI stays in the
  // current language and the operator can retry (per-user-language-preference, Task 9).
  "locale.save_failed": "Could not save your language, try again",
  // A failed Mode-P handover (markCollected) is non-fatal — the operator retries; the queue reload reconciles.
  "station.collect_error": "Could not mark the order collected, try again",
  // Table-ordering (FP-1): a failed round/serve/status write is non-fatal — the operator retries.
  "table.error": "Could not update the table, try again",
  // Boot: `getTill` failed — the server unreachable, or a non-2xx `{ code }` (e.g. `server.internal`).
  // Unlike the retryable errors above, the only recovery is a page reload — `#boot` runs once from
  // `firstUpdated` with no in-UI retry — so the copy says "reload", not "try again", and stays neutral
  // about the cause ("could not load") rather than naming only the unreachable case.
  "boot.error": "Could not load the till, reload to try again",
  // Multi-menu till: the accessible name of the menu switcher (the segmented control above the product
  // grid that picks which of the location's accessible menus the grid shows). The individual menu names
  // are DATA from the server (`GET /api/products` `menus[].name`, localised at seed time), not keys here.
  "menu.switcher": "Menu",
} as const;

export type StringKey = keyof typeof en;

// A full translation of the base map. Typed `Record<StringKey, string>` (not
// Partial): every base key must be translated, so an untranslated addition fails
// typecheck rather than silently falling through to English at runtime.
export const es: Record<StringKey, string> = {
  "action.pay": "Cobrar",
  "action.confirm_payment": "Confirmar cobro",
  "action.new_sale": "Nueva venta",
  "action.reprint": "Reimprimir",
  "action.open_drawer": "Abrir cajón",
  "action.logout": "Cerrar sesión",
  "action.remove": "Quitar",
  "action.add": "Añadir",
  "action.login": "Entrar",
  "action.back": "Atrás",
  "action.cancel": "Cancelar",
  "action.hold": "Aparcar",
  "action.authorize": "Autorizar",
  "tender.cash": "Efectivo",
  "tender.card": "Tarjeta",
  "tender.card_ref": "Número de operación (opcional)",
  "pad.decimal": "Punto decimal",
  "pad.backspace": "Borrar",
  "label.change": "Cambio",
  "label.total": "Total",
  "label.tendered": "Entregado",
  "basket.empty": "La cesta está vacía",
  "login.enter_pin": "Introduce el PIN",
  "login.pick_operator": "Elige tu nombre",
  "login.loading": "Cargando…",
  "login.no_staff": "No hay personal disponible",
  "login.load_failed": "No se pudo cargar el personal, inténtalo de nuevo",
  "login.error": "No se pudo iniciar sesión, inténtalo de nuevo",
  "override.title": "Autorización de un responsable",
  "override.pick_supervisor": "Elige a un responsable",
  "override.enter_pin": "Introduce el PIN del responsable",
  "override.no_supervisors": "No hay responsables disponibles",
  "override.error": "No se pudo autorizar, inténtalo de nuevo",
  "weigh.prompt": "Introduce el peso (kg)",
  "held.label_prompt": "Nombra este pedido (opcional)",
  "held.title": "Pedidos aparcados",
  "held.empty": "No hay pedidos aparcados",
  "held.retrieve": "Recuperar",
  "held.discard": "Descartar",
  "action.place": "Enviar pedido",
  "action.send_to_prep": "Enviar a cocina",
  "action.collect": "Entregar",
  "station.open": "Cocina",
  "station.title": "Cocina",
  "station.back": "Volver al mostrador",
  "station.pick": "Estación",
  "station.no_stations": "Sin estaciones",
  "station.empty": "Nada en cocina",
  "station.view_kanban": "Tablero",
  "station.view_rail": "Comandas",
  "station.min": "min",
  "station.advance": "Avanzar",
  "station.bump_ticket": "Avanzar comanda",
  "station.collect": "Entregar",
  "station.fire_course": "Empezar curso",
  "station.reprint": "Reimprimir",
  "station.state.queued": "Nuevo",
  "station.state.preparing": "Preparando",
  "station.state.ready": "Listo",
  "device.setup": "Configurar como pantalla de cocina",
  "device.enrol_title": "Configurar esta pantalla de cocina",
  "device.enrol_hint": "Introduce el código de emparejamiento que aparece en el panel",
  "device.enrol_code": "Código de emparejamiento",
  "device.enrol_submit": "Configurar",
  "device.setup_handheld": "Configurar como terminal de camarero",
  "device.handheld_enrol_title": "Configurar este terminal de camarero",
  "device.handheld_enrol_hint": "Introduce el código de emparejamiento que aparece en el panel",
  "device.handheld_enrol_submit": "Configurar",
  "device.enrol_failed":
    "No se aceptó ese código de emparejamiento. Pide uno nuevo a un responsable.",
  "expo.open": "Pase",
  "expo.title": "Pase",
  "expo.back": "Volver al mostrador",
  "expo.empty": "Nada en el pase",
  "expo.fire": "Marchar",
  "expo.ready": "Curso listo",
  "expo.away": "En camino",
  "expo.reprint": "Reimprimir",
  "cancel.reason_prompt": "Motivo de la cancelación",
  "card.collecting": "Acerca o inserta la tarjeta…",
  "card.cancel": "Cancelar",
  "card.declined": "Tarjeta rechazada",
  "card.retry": "Reintentar tarjeta",
  "card.switch_tender": "Usar otro método de pago",
  "card.wait": "Seguir esperando",
  "card.tip": "Propina (opcional)",
  "card.offline_consent": "Aceptar sin conexión si la red no funciona",
  "allergens.open": "Alérgenos",
  "allergens.title": "Alérgenos",
  "allergens.notice": "Hay información sobre alérgenos disponible — pregunta al personal.",
  "allergens.pending": "Información de alérgenos pendiente",
  "allergens.contains": "Contiene",
  "allergens.may_contain": "Puede contener",
  "allergens.print": "Imprimir",
  "allergens.close": "Cerrar",
  "schedule.open": "Mi horario",
  "schedule.title": "Mi horario",
  "schedule.back": "Volver a la caja",
  "schedule.loading": "Cargando…",
  "schedule.load_failed": "No se pudo cargar tu horario, inténtalo de nuevo",
  "schedule.shifts_title": "Mis próximos turnos",
  "schedule.shifts_empty": "No tienes turnos próximos",
  "schedule.swaps_title": "Cambios que me ofrecen",
  "schedule.swaps_empty": "No te ofrecen ningún cambio",
  "schedule.accept": "Aceptar",
  "schedule.cover_title": "Ofrecer un turno a un compañero",
  "schedule.cover_shift": "Qué turno",
  "schedule.cover_colleague": "Ofrecer a",
  "schedule.cover_submit": "Pedir cambio",
  "schedule.absences_title": "Mis ausencias",
  "schedule.absences_empty": "No tienes ausencias",
  "schedule.absence_title": "Solicitar ausencia",
  "schedule.absence_kind": "Tipo",
  "schedule.absence_from": "Desde",
  "schedule.absence_to": "Hasta",
  "schedule.absence_note": "Nota (opcional)",
  "schedule.absence_submit": "Solicitar ausencia",
  "schedule.kind.holiday": "Vacaciones",
  "schedule.kind.sick_leave": "Baja",
  "schedule.kind.leave": "Permiso",
  "schedule.kind.unpaid": "Permiso sin sueldo",
  "schedule.status.requested": "Solicitado",
  "schedule.status.accepted": "Aceptado",
  "schedule.status.approved": "Aprobado",
  "schedule.status.rejected": "Rechazado",
  "floor.open": "Sala",
  "floor.title": "Sala",
  "floor.back": "Volver a la caja",
  "floor.zones": "Zonas",
  "floor.no_zone": "Sin zona",
  "floor.capacity": "pax",
  "floor.to_serve": "por servir",
  "floor.ready": "listos",
  "floor.en_route": "en camino",
  "floor.line_count": "art.",
  "floor.pending_delivery": "por entregar",
  "floor.free": "Libre",
  "floor.view_map": "Mapa",
  "floor.view_list": "Lista",
  "floor.edit_plan": "Editar plano",
  "floor.unplaced": "Sin colocar",
  "floor.zone": "Zona",
  "floor.rotate": "Girar",
  "floor.remove": "Quitar del plano",
  "floor.shape": "Forma",
  "floor.shape_round": "Redonda",
  "floor.shape_square": "Cuadrada",
  "floor.shape_rect": "Rectangular",
  "table.title": "Comanda",
  "table.back": "Volver a la sala",
  "table.open_drawer": "Cuenta",
  "table.send_round": "Enviar ronda",
  "table.pending_title": "Pendiente de servir",
  "table.served_title": "Servido",
  "table.none_pending": "Nada por servir",
  "table.none_served": "Nada servido todavía",
  "table.serve": "Marcar servido",
  "table.pay_title": "Cobrar",
  "table.status_title": "Estado",
  "table.status_clear": "Sin estado",
  "table.course_label": "Curso",
  "table.course_default": "Por defecto",
  "table.fire_title": "Cursos por marchar",
  "table.fire_course": "Marchar",
  "table.actions_title": "Acciones de mesa",
  "table.action_move": "Mover a mesa",
  "table.action_join": "Unir una mesa",
  "table.action_merge": "Combinar cuenta",
  "table.action_transfer": "Transferir artículos",
  "table.action_split": "Dividir (próximamente)",
  "table.no_free_tables": "No hay mesas libres",
  "table.no_other_tabs": "No hay otras cuentas abiertas",
  "table.transfer_pick_lines": "Elige artículos para transferir",
  "table.transfer_confirm": "Transferir",
  "table.transfer_no_lines": "No hay artículos para transferir",
  "pin.invalid": "PIN incorrecto, inténtalo de nuevo",
  "person.suspended": "Cuenta suspendida, avisa a un responsable",
  "sale.error": "No se pudo completar la venta, inténtalo de nuevo",
  "reprint.error": "No se pudo reimprimir el recibo, inténtalo de nuevo",
  "drawer.error": "No se pudo abrir el cajón, inténtalo de nuevo",
  "held.park_error": "No se pudo aparcar el pedido, inténtalo de nuevo",
  "held.product_gone": "Se quitó un producto y se eliminó del pedido",
  "held.stale": "Ese pedido ya no está disponible",
  "place.error": "No se pudo enviar el pedido, inténtalo de nuevo",
  "station.advance_error": "No se pudo actualizar la comanda, inténtalo de nuevo",
  "locale.save_failed": "No se pudo guardar tu idioma, inténtalo de nuevo",
  "station.collect_error": "No se pudo marcar el pedido como entregado, inténtalo de nuevo",
  "table.error": "No se pudo actualizar la mesa, inténtalo de nuevo",
  "boot.error": "No se pudo cargar la caja, recarga para reintentar",
  "menu.switcher": "Menú",
};

// Locale → catalogue. `en` is included as its own catalogue so an explicit
// English request resolves directly rather than only through t()'s fallback.
// Both the language tag `es` and the region tag `es-ES` map to the same Spanish
// catalogue — the language a Spanish venue is driven to. Catalogues are typed
// Partial<Record<StringKey, string>> so a future locale may be introduced with
// only some keys translated; t() fills the gaps from the English base.
export const catalogues: Record<string, Partial<Record<StringKey, string>>> = {
  en,
  "en-GB": en,
  es,
  "es-ES": es,
};
