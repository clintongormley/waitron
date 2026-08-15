// The management dashboard's string catalogue.
//
// English is the SOURCE of truth: `en` below is the base map, `StringKey` is
// derived from its keys, and every other locale is a translation that may only
// re-say what `en` already names. Spanish (`es`) is what the deli actually
// renders (the shipped default locale is es-ES; see t.ts), but it is a
// translation, not the origin — a key must exist in `en` first.
//
// `apps/*` is exempt from the english-only guard (packages/db/src/english-only.ts),
// so the English UI copy here is deliberate and allowed; the Spanish below is
// user-facing translation, not schema vocabulary.
//
// Later dashboard screens append keys here. Add the English base entry AND its
// Spanish translation together — `es` is typed `Record<StringKey, string>`, so a
// key added to `en` without a Spanish sibling is a compile error, which is the
// guard that keeps the two in step.
export const en = {
  // Shared actions
  "action.save": "Save",
  "action.create": "Create",
  "action.edit": "Edit",
  "action.remove": "Remove",
  "action.login": "Log in",
  "action.logout": "Log out",
  "action.move_up": "Move up",
  "action.move_down": "Move down",
  // Shell nav
  "nav.sections": "Sections",
  "nav.staff": "Users",
  "nav.catalogue": "Menu",
  "nav.layout": "Layout",
  "nav.receipt": "Receipt",
  // Login screen
  "login.roster": "User",
  "login.password": "Password",
  "login.totp": "Code (if applicable)",
  "login.with_passkey": "Log in with passkey",
  // Staff screen
  "staff.title": "Users",
  "staff.add_passkey": "Add passkey",
  "staff.add_user": "Add user",
  "staff.badge_password": "Password",
  "staff.badge_totp": "TOTP",
  // Catalogue screen
  "catalogue.title": "Menu",
  "catalogue.picker": "Catalogue",
  "catalogue.add_product": "Add product",
  "catalogue.empty_prompt": "Create a catalogue to start adding products.",
  "catalogue.new": "New catalogue",
  "catalogue.create": "Create catalogue",
  // Layout screen
  "layout.title": "Layout",
  "layout.no_config": "No settings",
  "layout.columns": "Columns (1–12)",
  "layout.no_widgets": "No widgets",
  "layout.widget_picker": "Widget",
  "layout.add_widget": "Add widget",
  "layout.region_main": "Main",
  "layout.region_aside": "Side",
  // Layout widget kinds (keys are the WidgetType values from layout-screen.ts)
  "widget.product-grid": "Product grid",
  "widget.basket": "Basket",
  "widget.total": "Total",
  "widget.tender-pay": "Checkout",
  "widget.held-orders": "Held orders",
  "widget.prep-queue": "Prep queue",
  // Receipt screen
  "receipt.title": "Receipt",
  "receipt.header_subtitle": "Header subtitle",
  "receipt.footer_message": "Footer message",
  // Person form
  "person.new": "New user",
  "person.name": "Name",
  "person.role": "Role",
  "person.pin": "PIN",
  // Person edit
  "person.edit": "Edit user",
  "person.save_role": "Save role",
  "person.status_label": "Status",
  "person.suspend": "Suspend",
  "person.reactivate": "Reactivate",
  "person.reset_pin": "Reset PIN",
  "person.password": "Password",
  "person.set_password": "Set password",
  // Allergen picker
  "allergen.reviewed": "Reviewed",
  "allergen.origin": "Origin",
  "allergen.contains": "Contains",
  "allergen.may_contain": "May contain",
  // Category manager
  "category.new": "New category",
  // Image upload
  "image.label": "Image",
  "image.preview_alt": "Product preview",
  // Product form
  "product.new": "New product",
  "product.edit": "Edit product",
  "product.description": "Description",
  "product.price": "Price",
  "product.vat": "VAT",
  "product.unit": "Unit",
  "product.category": "Category",
  "product.no_category": "— none —",
  "product.active": "Active",
  // Product list
  "product.active_badge": "Active",
  "product.inactive_badge": "Inactive",
  // Roster — shift dialog
  "roster.new_shift": "New shift",
  "roster.edit_shift": "Edit shift",
  "roster.shift_start": "Start",
  "roster.shift_end": "End",
  "roster.shift_role": "Role",
} as const;

export type StringKey = keyof typeof en;

// A full translation of the base map. Typed `Record<StringKey, string>` (not
// Partial): every base key must be translated, so an untranslated addition fails
// typecheck rather than silently falling through to English at runtime.
export const es: Record<StringKey, string> = {
  "action.save": "Guardar",
  "action.create": "Crear",
  "action.edit": "Editar",
  "action.remove": "Eliminar",
  "action.login": "Entrar",
  "action.logout": "Cerrar sesión",
  "action.move_up": "Subir",
  "action.move_down": "Bajar",
  "nav.sections": "Secciones",
  "nav.staff": "Usuarios",
  "nav.catalogue": "Carta",
  "nav.layout": "Disposición",
  "nav.receipt": "Recibo",
  "login.roster": "Usuario",
  "login.password": "Contraseña",
  "login.totp": "Código (si procede)",
  "login.with_passkey": "Entrar con passkey",
  "staff.title": "Usuarios",
  "staff.add_passkey": "Añadir passkey",
  "staff.add_user": "Añadir usuario",
  "staff.badge_password": "Contraseña",
  "staff.badge_totp": "TOTP",
  "catalogue.title": "Carta",
  "catalogue.picker": "Catálogo",
  "catalogue.add_product": "Añadir producto",
  "catalogue.empty_prompt": "Crea un catálogo para empezar a añadir productos.",
  "catalogue.new": "Nuevo catálogo",
  "catalogue.create": "Crear catálogo",
  "layout.title": "Disposición",
  "layout.no_config": "Sin ajustes",
  "layout.columns": "Columnas (1–12)",
  "layout.no_widgets": "Sin widgets",
  "layout.widget_picker": "Widget",
  "layout.add_widget": "Añadir widget",
  "layout.region_main": "Principal",
  "layout.region_aside": "Lateral",
  "widget.product-grid": "Cuadrícula de productos",
  "widget.basket": "Cesta",
  "widget.total": "Total",
  "widget.tender-pay": "Cobro",
  "widget.held-orders": "Pedidos aparcados",
  "widget.prep-queue": "Cola de preparación",
  "receipt.title": "Recibo",
  "receipt.header_subtitle": "Subtítulo de cabecera",
  "receipt.footer_message": "Mensaje de pie",
  "person.new": "Nuevo usuario",
  "person.name": "Nombre",
  "person.role": "Rol",
  "person.pin": "PIN",
  "person.edit": "Editar usuario",
  "person.save_role": "Guardar rol",
  "person.status_label": "Estado",
  "person.suspend": "Suspender",
  "person.reactivate": "Reactivar",
  "person.reset_pin": "Restablecer PIN",
  "person.password": "Contraseña",
  "person.set_password": "Establecer contraseña",
  "allergen.reviewed": "Revisado",
  "allergen.origin": "Origen",
  "allergen.contains": "Contiene",
  "allergen.may_contain": "Puede contener",
  "category.new": "Nueva categoría",
  "image.label": "Imagen",
  "image.preview_alt": "Vista previa del producto",
  "product.new": "Nuevo producto",
  "product.edit": "Editar producto",
  "product.description": "Descripción",
  "product.price": "Precio",
  "product.vat": "IVA",
  "product.unit": "Unidad",
  "product.category": "Categoría",
  "product.no_category": "— ninguna —",
  "product.active": "Activo",
  "product.active_badge": "Activo",
  "product.inactive_badge": "Inactivo",
  "roster.new_shift": "Nuevo turno",
  "roster.edit_shift": "Editar turno",
  "roster.shift_start": "Inicio",
  "roster.shift_end": "Fin",
  "roster.shift_role": "Puesto",
};

// Locale → catalogue. `en` is included as its own catalogue so an explicit
// English request resolves directly rather than only through t()'s fallback.
// Both the language tag `es` and the region tag `es-ES` map to the same Spanish
// catalogue — the dashboard's default locale is es-ES. Catalogues are typed
// Partial<Record<StringKey, string>> so a future locale may be introduced with
// only some keys translated; t() fills the gaps from the English base.
export const catalogues: Record<string, Partial<Record<StringKey, string>>> = {
  en,
  es,
  "es-ES": es,
};
