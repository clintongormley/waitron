import {
  makeT,
  registerCatalogue,
  registerCodeMessages,
  resolveNameTable,
  type NameTable,
} from "@waitron/dashboard-kit";

// Registers its catalogue and code messages at load, so importing `t` is enough to resolve them.

const en = {
  "nav.adjustment_reasons": "Voids and comps",
  "adjustments.title": "Voids and comps",
  "adjustments.intro": "The reasons staff choose when they void or comp an item.",
  "adjustments.add": "Add reason",
  "adjustments.empty": "No reasons yet.",
  "adjustments.column.name": "Name",
  "adjustments.column.kind": "Kind",
  "adjustments.column.apply_roles": "Who can apply it",
  "adjustments.column.approver_roles": "Who can approve it",
  "adjustments.column.limits": "Limits",
  "adjustments.column.actions": "Actions",
  "adjustments.customise_columns": "Customise columns",
  "adjustments.customise": "Customise",
  "adjustments.restore_columns": "Restore defaults",
  "adjustments.done": "Done",
  "adjustments.move_column": "Move",
  "adjustments.show_column": "Show",
  "adjustments.hide_column": "Hide",
  "adjustments.column_always_shown": "Always shown",
  "adjustments.column_last_shown": "Keep at least one shown",
  "adjustments.column_position": "{position} of {total}",
  "adjustments.limit_percent": "{percent}% an item",
  "adjustments.limit_amount": "{amount} a bill",
  "adjustments.none": "—",
  "adjustments.no_limit": "No limit",
  "adjustments.everyone": "Everyone",
  "adjustments.note_required": "Note required",
  "adjustments.order_note": "Drag ⋮⋮ to set the order the till lists them in.",
  "adjustments.order_note_searching": "Clear the search to change the order.",
  "adjustments.reorder": "Move reason",
  "adjustments.reordered": "{item} is now {index} of {total}.",
  "adjustments.search": "Search",
  "adjustments.edit": "Edit",
  "adjustments.new": "Add reason",
  "adjustments.edit_heading": "Edit reason",
  "adjustments.field.kind": "Kind",
  "adjustments.field.name": "Name",
  "adjustments.field.names": "Name in each language",
  "adjustments.field.name_in": "Name in {language}",
  "adjustments.field.apply_roles": "Who can apply it",
  "adjustments.field.apply_roles_hint": "They use it straight away, up to its limits.",
  "adjustments.field.approver_roles": "Who can approve it",
  "adjustments.field.approver_roles_hint":
    "They enter their PIN when anyone else asks, or above a limit.",
  "adjustments.field.actions": "How it can be taken off",
  "adjustments.field.max_percent": "Most off one item",
  "adjustments.field.max_percent_hint": "Everything this reason took off the item counts.",
  "adjustments.field.max_amount": "Most off one bill",
  "adjustments.field.max_amount_hint":
    "The venue's own amount. Above it, someone who can approve it is asked.",
  "adjustments.field.note_required": "Note required",
  "adjustments.field.note_required_void_hint": "The till asks for the note with “Say why”.",
  "adjustments.void_rule": "Who may cancel is set by the refund permission, not by the reason.",
  "adjustments.save": "Save",
  "adjustments.cancel": "Cancel",
  "adjustments.delete": "Delete",
  "adjustments.delete_heading": "Delete reason",
  "adjustments.delete_refusals": "Why this cannot be deleted",
  "adjustments.delete_ends": "Work that ends",
  "adjustments.delete_removes": "Settings removed",
  "adjustments.delete_irreversible": "Past voids and comps keep its name. This cannot be undone.",
  "adjustments.delete_retry": "Try again",
  "adjustments.delete_loading": "Checking whether this reason can be deleted…",
  "adjustments.delete_load_error": "Could not check whether it can be deleted: {reason}",
  "adjustments.delete_error": "Could not delete the reason: {reason}",
  "adjustments.delete_item": "{names} ({count})",
  "adjustments.fix_fields": "Correct the highlighted fields to continue.",
  "adjustments.error.name": "Enter a name.",
  "adjustments.error.names": "Check the names in each language.",
  "adjustments.error.actions": "Choose at least one action.",
  "adjustments.error.maxPercent":
    "Enter a percentage above 0 and up to 100, with at most two decimals.",
  "adjustments.error.maxAmount":
    "Enter an amount above 0 with at most two decimals, such as 30.00.",
  "adjustments.error.kind": "Choose Void or Comp.",
  "adjustments.error.applyRoles": "Choose at least one role.",
  "adjustments.error.approverRoles": "Choose at least one role.",
  "adjustments.error.free_over_limit": "Free takes 100% off: raise this limit or untick Free.",
  "adjustments.error.noteRequired": "Choose whether staff must write a note.",
  "adjustments.error.void_required": "A venue keeps at least one Void reason.",
  "adjustments.error.void_required_note":
    "A venue keeps at least one Void reason that asks for a note.",
  "adjustments.load_error": "The voids and comps could not be loaded.",
  "adjustments.no_matches": "Nothing matches your search.",
  "adjustments.reorder_error": "The new order could not be saved.",
  "adjustments.limit.heading": "Limit on a bill's comps",
  "adjustments.limit.field": "Most comped on one bill",
  "adjustments.limit.hint":
    "Every comp on the bill counts, whatever its reason. Above it, someone on the next list enters their PIN.",
  "adjustments.limit.approvers": "Who can approve past it",
  "adjustments.limit.save": "Save limit",
  "adjustments.limit.saved": "Limit saved.",
  "adjustments.limit.load_error": "The bill's comp limit could not be loaded.",
  "adjustments.limit.invalid": "Enter an amount above 0 with at most two decimals, such as 40.00.",
  "nav.adjustment_report": "Adjustment report",
  "adjustment_report.title": "Adjustment report",
  "adjustment_report.intro":
    "Counts the voids and comps on the bills opened on these business days. A person's rate is what their own adjustments took off, as a share of the sales credited to them at prices before any adjustment.",
  "adjustment_report.from": "From",
  "adjustment_report.to": "To",
  "adjustment_report.range_backwards": "Choose a first day on or before the last day.",
  "adjustment_report.load_error": "The adjustment report could not be loaded: {reason}",
  "adjustment_report.loading": "Loading the report",
  "adjustment_report.summary": "All adjustments",
  "adjustment_report.none": "No adjustments on these days.",
  "adjustment_report.show_all": "List every adjustment",
  "adjustment_report.figure.count": "Adjustments",
  "adjustment_report.figure.reduction": "Taken off the bills",
  "adjustment_report.figure.sales": "Sales before adjustments",
  "adjustment_report.figure.rate": "Rate",
  "adjustment_report.figure.cancelled": "List value of cancelled items",
  "adjustment_report.people": "By person",
  "adjustment_report.people_hint": "Choose a name to list that person's adjustments.",
  "adjustment_report.guests": "Guests",
  "adjustment_report.unknown_person": "Unknown person",
  "adjustment_report.open_person": "List {name}'s adjustments",
  "adjustment_report.open_guests": "List the guests' adjustments",
  "adjustment_report.column.name": "Name",
  "adjustment_report.column.count": "Adjustments",
  "adjustment_report.column.reduction": "Taken off",
  "adjustment_report.column.sales": "Credited sales",
  "adjustment_report.column.rate": "Rate",
  "adjustment_report.column.cancelled": "List value cancelled",
  "adjustment_report.column.approved_by": "Approved by",
  "adjustment_report.column.approvals_given": "Approvals given",
  "adjustment_report.by_action": "By action",
  "adjustment_report.by_stage": "By stage",
  "adjustment_report.by_reason": "By reason",
  "adjustment_report.column.action": "Action",
  "adjustment_report.column.stage": "Stage",
  "adjustment_report.column.reason": "Reason",
  "adjustment_report.no_reasons": "No reason was used on these days.",
  "adjustment_report.person_by_action": "{name}'s adjustments by action",
  "adjustment_report.person_by_stage": "{name}'s adjustments by stage",
  "adjustment_report.person_by_reason": "{name}'s adjustments by reason",
  "adjustment_report.guests_by_action": "Guests' adjustments by action",
  "adjustment_report.guests_by_stage": "Guests' adjustments by stage",
  "adjustment_report.guests_by_reason": "Guests' adjustments by reason",
  "adjustment_report.entries.person": "Adjustments by {name}",
  "adjustment_report.entries.guests": "Adjustments by guests",
  "adjustment_report.entries.everyone": "Every adjustment",
  "adjustment_report.entries.all_reasons": "All reasons",
  "adjustment_report.entries.close": "Close the list",
  "adjustment_report.entries.error": "These adjustments could not be loaded: {reason}",
  "adjustment_report.entries.time": "Time",
  "adjustment_report.entries.when": "When",
  "adjustment_report.entries.note": "Note",
  "adjustment_report.entries.item": "Item",
  "adjustment_report.entries.quantity": "Quantity",
  "adjustment_report.entries.list_value": "List value",
  "adjustment_report.entries.requested_by": "Requested by",
  "adjustment_report.entries.void": "Void",
  "adjustment_report.entries.comp": "Comp {amount}",
  "adjustment_report.entries.credited_to": "Credited to",
  "adjustment_report.entries.order": "Order",
  "adjustment_report.entries.guest": "Guest",
  "adjustment_report.entries.show_more": "Show more",
  "adjustment_report.entries.more_error": "More adjustments could not be loaded: {reason}",
} as const;

const es: Record<keyof typeof en, string> = {
  "nav.adjustment_reasons": "Cancelaciones y descuentos",
  "adjustments.title": "Cancelaciones y descuentos",
  "adjustments.intro":
    "Los motivos que elige el personal al cancelar un artículo o hacerle un descuento.",
  "adjustments.add": "Añadir motivo",
  "adjustments.empty": "Todavía no hay motivos.",
  "adjustments.column.name": "Nombre",
  "adjustments.column.kind": "Tipo",
  "adjustments.column.apply_roles": "Quién puede aplicarlo",
  "adjustments.column.approver_roles": "Quién puede autorizarlo",
  "adjustments.column.limits": "Límites",
  "adjustments.column.actions": "Acciones",
  "adjustments.customise_columns": "Personalizar columnas",
  "adjustments.customise": "Personalizar",
  "adjustments.restore_columns": "Restaurar valores predeterminados",
  "adjustments.done": "Listo",
  "adjustments.move_column": "Mover",
  "adjustments.show_column": "Mostrar",
  "adjustments.hide_column": "Ocultar",
  "adjustments.column_always_shown": "Siempre visible",
  "adjustments.column_last_shown": "Deja al menos una visible",
  "adjustments.column_position": "{position} de {total}",
  "adjustments.limit_percent": "{percent}% por artículo",
  "adjustments.limit_amount": "{amount} por cuenta",
  "adjustments.none": "—",
  "adjustments.no_limit": "Sin límite",
  "adjustments.everyone": "Todos",
  "adjustments.note_required": "Nota obligatoria",
  "adjustments.order_note": "Arrastra ⋮⋮ para fijar el orden en que la caja los muestra.",
  "adjustments.order_note_searching": "Borra la búsqueda para cambiar el orden.",
  "adjustments.reorder": "Mover motivo",
  "adjustments.reordered": "{item} está ahora en la posición {index} de {total}.",
  "adjustments.search": "Buscar",
  "adjustments.edit": "Editar",
  "adjustments.new": "Añadir motivo",
  "adjustments.edit_heading": "Editar motivo",
  "adjustments.field.kind": "Tipo",
  "adjustments.field.name": "Nombre",
  "adjustments.field.names": "Nombre en cada idioma",
  "adjustments.field.name_in": "Nombre en {language}",
  "adjustments.field.apply_roles": "Quién puede aplicarlo",
  "adjustments.field.apply_roles_hint": "Lo usan directamente, hasta sus límites.",
  "adjustments.field.approver_roles": "Quién puede autorizarlo",
  "adjustments.field.approver_roles_hint":
    "Introducen su PIN cuando lo pide otra persona o se pasa un límite.",
  "adjustments.field.actions": "Cómo se descuenta",
  "adjustments.field.max_percent": "Máximo por artículo",
  "adjustments.field.max_percent_hint": "Cuenta todo lo que este motivo ha quitado del artículo.",
  "adjustments.field.max_amount": "Máximo por cuenta",
  "adjustments.field.max_amount_hint":
    "Lo fija el local. Por encima, se pide a alguien que pueda autorizarlo.",
  "adjustments.field.note_required": "Pide una nota",
  "adjustments.field.note_required_void_hint": "La caja pide la nota con «Indica el motivo».",
  "adjustments.void_rule": "Quién puede cancelar lo decide el permiso de devolución, no el motivo.",
  "adjustments.save": "Guardar",
  "adjustments.cancel": "Cancelar",
  "adjustments.delete": "Eliminar",
  "adjustments.delete_heading": "Eliminar motivo",
  "adjustments.delete_refusals": "Por qué no se puede eliminar",
  "adjustments.delete_ends": "Trabajo que termina",
  "adjustments.delete_removes": "Ajustes eliminados",
  "adjustments.delete_irreversible":
    "Las cancelaciones y descuentos ya hechos conservan su nombre. Esta acción no se puede deshacer.",
  "adjustments.delete_retry": "Reintentar",
  "adjustments.delete_loading": "Comprobando si se puede eliminar este motivo…",
  "adjustments.delete_load_error": "No se pudo comprobar si se puede eliminar: {reason}",
  "adjustments.delete_error": "No se pudo eliminar el motivo: {reason}",
  "adjustments.delete_item": "{names} ({count})",
  "adjustments.fix_fields": "Corrige los campos marcados para continuar.",
  "adjustments.error.name": "Escribe un nombre.",
  "adjustments.error.names": "Revisa los nombres en cada idioma.",
  "adjustments.error.actions": "Elige al menos una acción.",
  "adjustments.error.maxPercent":
    "Escribe un porcentaje mayor que 0 y hasta 100, con dos decimales como máximo.",
  "adjustments.error.maxAmount":
    "Escribe un importe mayor que 0 con dos decimales como máximo, como 30,00.",
  "adjustments.error.kind": "Elige Cancelar o Descuento.",
  "adjustments.error.applyRoles": "Elige al menos un rol.",
  "adjustments.error.approverRoles": "Elige al menos un rol.",
  "adjustments.error.free_over_limit": "Gratis quita el 100 %: sube este límite o desmarca Gratis.",
  "adjustments.error.noteRequired": "Elige si el personal debe escribir una nota.",
  "adjustments.error.void_required": "El local necesita al menos un motivo de cancelación.",
  "adjustments.error.void_required_note":
    "El local necesita al menos un motivo de cancelación que pida una nota.",
  "adjustments.load_error": "No se pudieron cargar las cancelaciones y descuentos.",
  "adjustments.no_matches": "Nada coincide con tu búsqueda.",
  "adjustments.reorder_error": "No se pudo guardar el nuevo orden.",
  "adjustments.limit.heading": "Límite de descuentos por cuenta",
  "adjustments.limit.field": "Máximo descontado en una cuenta",
  "adjustments.limit.hint":
    "Cuenta cada descuento de la cuenta, sea cual sea su motivo. Por encima, alguien de la lista siguiente introduce su PIN.",
  "adjustments.limit.approvers": "Quién puede autorizar más",
  "adjustments.limit.save": "Guardar límite",
  "adjustments.limit.saved": "Límite guardado.",
  "adjustments.limit.load_error": "No se pudo cargar el límite de descuento por cuenta.",
  "adjustments.limit.invalid":
    "Escribe un importe mayor que 0 con dos decimales como máximo, como 40,00.",
  "nav.adjustment_report": "Informe de ajustes",
  "adjustment_report.title": "Informe de ajustes",
  "adjustment_report.intro":
    "Cuenta las cancelaciones y descuentos de las cuentas abiertas en estas jornadas. La tasa de cada persona es lo que descontaron sus propios ajustes, en proporción a las ventas que se le atribuyen a precios anteriores a cualquier ajuste.",
  "adjustment_report.from": "Desde",
  "adjustment_report.to": "Hasta",
  "adjustment_report.range_backwards": "Elige un primer día igual o anterior al último.",
  "adjustment_report.load_error": "No se pudo cargar el informe de ajustes: {reason}",
  "adjustment_report.loading": "Cargando el informe",
  "adjustment_report.summary": "Todos los ajustes",
  "adjustment_report.none": "No hay ajustes en estas jornadas.",
  "adjustment_report.show_all": "Ver todos los ajustes",
  "adjustment_report.figure.count": "Ajustes",
  "adjustment_report.figure.reduction": "Descontado de las cuentas",
  "adjustment_report.figure.sales": "Ventas antes de ajustes",
  "adjustment_report.figure.rate": "Tasa",
  "adjustment_report.figure.cancelled": "Valor de carta de lo anulado",
  "adjustment_report.people": "Por persona",
  "adjustment_report.people_hint": "Elige un nombre para ver los ajustes de esa persona.",
  "adjustment_report.guests": "Clientes",
  "adjustment_report.unknown_person": "Persona desconocida",
  "adjustment_report.open_person": "Ver los ajustes de {name}",
  "adjustment_report.open_guests": "Ver los ajustes de los clientes",
  "adjustment_report.column.name": "Nombre",
  "adjustment_report.column.count": "Ajustes",
  "adjustment_report.column.reduction": "Descontado",
  "adjustment_report.column.sales": "Ventas atribuidas",
  "adjustment_report.column.rate": "Tasa",
  "adjustment_report.column.cancelled": "Valor de carta anulado",
  "adjustment_report.column.approved_by": "Aprobado por",
  "adjustment_report.column.approvals_given": "Aprobaciones dadas",
  "adjustment_report.by_action": "Por acción",
  "adjustment_report.by_stage": "Por momento",
  "adjustment_report.by_reason": "Por motivo",
  "adjustment_report.column.action": "Acción",
  "adjustment_report.column.stage": "Momento",
  "adjustment_report.column.reason": "Motivo",
  "adjustment_report.no_reasons": "No se usó ningún motivo en estas jornadas.",
  "adjustment_report.person_by_action": "Ajustes de {name} por acción",
  "adjustment_report.person_by_stage": "Ajustes de {name} por momento",
  "adjustment_report.person_by_reason": "Ajustes de {name} por motivo",
  "adjustment_report.guests_by_action": "Ajustes de los clientes por acción",
  "adjustment_report.guests_by_stage": "Ajustes de los clientes por momento",
  "adjustment_report.guests_by_reason": "Ajustes de los clientes por motivo",
  "adjustment_report.entries.person": "Ajustes de {name}",
  "adjustment_report.entries.guests": "Ajustes de los clientes",
  "adjustment_report.entries.everyone": "Todos los ajustes",
  "adjustment_report.entries.all_reasons": "Todos los motivos",
  "adjustment_report.entries.close": "Cerrar la lista",
  "adjustment_report.entries.error": "No se pudieron cargar estos ajustes: {reason}",
  "adjustment_report.entries.time": "Hora",
  "adjustment_report.entries.when": "Momento",
  "adjustment_report.entries.note": "Nota",
  "adjustment_report.entries.item": "Artículo",
  "adjustment_report.entries.quantity": "Cantidad",
  "adjustment_report.entries.list_value": "Valor de carta",
  "adjustment_report.entries.requested_by": "Solicitado por",
  "adjustment_report.entries.void": "Cancelado",
  "adjustment_report.entries.comp": "Descuento {amount}",
  "adjustment_report.entries.credited_to": "Atribuido a",
  "adjustment_report.entries.order": "Pedido",
  "adjustment_report.entries.guest": "Cliente",
  "adjustment_report.entries.show_more": "Mostrar más",
  "adjustment_report.entries.more_error": "No se pudieron cargar más ajustes: {reason}",
};

export const ADJUSTMENTS_STRINGS = { en, es };

export const ADJUSTMENTS_CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "adjustment_reason.name_taken": {
    en: "Another reason already has this name",
    es: "Ya hay otro motivo con este nombre",
  },
  "adjustment_reason.not_found": {
    en: "That reason could not be found. It may have been removed",
    es: "No se ha encontrado ese motivo. Puede que se haya eliminado",
  },
};

registerCatalogue(ADJUSTMENTS_STRINGS);
registerCodeMessages(ADJUSTMENTS_CODE_MESSAGES);

export type StringKey = keyof typeof en;
export const t = makeT<StringKey>();

/** `t` with each `{name}` in the text replaced by its value. */
export function tf(key: StringKey, values: Record<string, string>, locale?: string): string {
  return t(key, locale).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** How the editor's checkboxes name a Comp reason's offers. */
const ACTION_CHOICES: NameTable = {
  comp: { en: "Free (100%)", es: "Gratis (100 %)" },
  discount_percent: { en: "A percentage", es: "Un porcentaje" },
  discount_amount: { en: "An amount", es: "Un importe" },
};

const KIND_NAMES: NameTable = {
  void: { en: "Void", es: "Cancelar" },
  comp: { en: "Comp", es: "Descuento" },
};

/** How a report heads each kind's total. */
const KIND_TOTALS: NameTable = {
  void: { en: "Voids", es: "Cancelaciones" },
  comp: { en: "Comps", es: "Descuentos" },
};

/** How far an item had got when it was adjusted; a whole-bill discount has no item. */
const STAGE_NAMES: NameTable = {
  beforeFiring: { en: "Before firing", es: "Antes de marchar" },
  afterFiring: { en: "After firing", es: "Después de marchar" },
  afterServing: { en: "After serving", es: "Después de servir" },
  billDiscount: { en: "Whole bill", es: "Toda la cuenta" },
};

const ROLE_NAMES: NameTable = {
  staff: { en: "Staff", es: "Empleado" },
  supervisor: { en: "Supervisor", es: "Supervisor" },
  manager: { en: "Manager", es: "Encargado" },
  admin: { en: "Admin", es: "Administrador" },
};

export function actionChoice(action: string, locale?: string): string {
  return resolveNameTable(ACTION_CHOICES, action, locale);
}

export function kindName(kind: string, locale?: string): string {
  return resolveNameTable(KIND_NAMES, kind, locale);
}

export function roleName(role: string, locale?: string): string {
  return resolveNameTable(ROLE_NAMES, role, locale);
}

export function kindTotalName(kind: string, locale?: string): string {
  return resolveNameTable(KIND_TOTALS, kind, locale);
}

export function stageName(stage: string, locale?: string): string {
  return resolveNameTable(STAGE_NAMES, stage, locale);
}
