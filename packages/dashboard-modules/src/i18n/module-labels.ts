import { registerCatalogue } from "@waitron/dashboard-kit";
export const MODULE_LABEL_KEYS: Readonly<Record<string, string>> = {
  workforce: "modules.workforce",
  "workforce-es": "modules.workforce_es",
  payments: "nav.payments",
  bookings: "modules.bookings",
  staffing: "modules.staffing",
};
registerCatalogue({
  en: {
    "modules.loading": "Loading modules…",
    "modules.retry": "Try again",
    "nav.modules": "Modules",
    "modules.workforce": "Workforce",
    "modules.workforce_es": "Spanish workforce rules",
    "modules.bookings": "Bookings",
    "modules.staffing": "Staffing",
    "modules.add": "Add a module",
    "modules.category": "Category",
    "modules.all_categories": "All categories",
    "modules.providers": "Card providers",
    "modules.state": "State",
    "modules.enabled": "Enabled",
    "modules.disabled": "Disabled",
    "modules.all": "All",
    "modules.name": "Module",
    "modules.configuration": "Configuration",
    "modules.configuration_unavailable": "Configuration unavailable",
    "modules.configured": "Configured",
    "modules.needs_setup": "Needs setup",
    "modules.configure": "Configure",
    "modules.turn_on": "Turn on",
    "modules.turn_off": "Turn off",
    "modules.off_explanation":
      "Stop adding readers for this provider. Saved credentials stay available for earlier payments and refunds.",
    "modules.on_explanation":
      "Allow readers to be added for this provider. Configure its credentials separately if needed.",
    "modules.remove_readers": "Remove or unpair these readers before turning the provider off:",
    "modules.open_readers": "Open Card payments",
    "modules.restart_pending": "Waiting for restart",
    "modules.bookings_explanation":
      "Save this change, then open Box status in Settings and choose Restart the box when service can pause. Bookings stay saved. The tills reconnect; a kitchen send during restart may need resending.",
    "modules.payments_explanation":
      "Turn every card provider off first. Save this change, then open Box status in Settings and restart when service can pause. Earlier payments and refunds remain available; connected card collection is off after restart. The tills reconnect; a kitchen send during restart may need resending.",
    "modules.workforce_es_explanation":
      "Save this change, then open Box status in Settings and restart when service can pause. While off, Spanish workforce checks and the Spain time-record export are unavailable. Ordinary rotas and clock records stay available. Personal-data downloads keep clock records as JSON, but omit the Spanish-format time-record PDF and CSV while off. The tills reconnect; a kitchen send during restart may need resending.",
    "modules.configure_providers": "Configure card providers",
    "modules.guide": "How to set up modules",
  },
  es: {
    "modules.loading": "Cargando módulos…",
    "modules.retry": "Intentar de nuevo",
    "nav.modules": "Módulos",
    "modules.workforce": "Control horario",
    "modules.workforce_es": "Normativa laboral española",
    "modules.bookings": "Reservas",
    "modules.staffing": "Planificación de personal",
    "modules.add": "Añadir un módulo",
    "modules.category": "Categoría",
    "modules.all_categories": "Todas las categorías",
    "modules.providers": "Proveedores de tarjeta",
    "modules.state": "Estado",
    "modules.enabled": "Habilitado",
    "modules.disabled": "Deshabilitado",
    "modules.all": "Todos",
    "modules.name": "Módulo",
    "modules.configuration": "Configuración",
    "modules.configuration_unavailable": "Configuración no disponible",
    "modules.configured": "Configurado",
    "modules.needs_setup": "Necesita configuración",
    "modules.configure": "Configurar",
    "modules.turn_on": "Activar",
    "modules.turn_off": "Desactivar",
    "modules.off_explanation":
      "Deja de añadir lectores de este proveedor. Las credenciales guardadas siguen disponibles para pagos anteriores y reembolsos.",
    "modules.on_explanation":
      "Permite añadir lectores de este proveedor. Configura sus credenciales por separado si hace falta.",
    "modules.remove_readers":
      "Elimina o desvincula estos lectores antes de desactivar el proveedor:",
    "modules.open_readers": "Abrir Pagos con tarjeta",
    "modules.restart_pending": "Pendiente de reinicio",
    "modules.bookings_explanation":
      "Guarda el cambio y abre Estado del servidor en Ajustes; elige Reiniciar el servidor cuando puedas pausar el servicio. Las reservas se conservan. Las cajas se reconectan; puede que debas repetir un envío a cocina durante el reinicio.",
    "modules.payments_explanation":
      "Desactiva primero todos los proveedores de tarjeta. Guarda el cambio y abre Estado del servidor en Ajustes para reiniciar cuando puedas pausar el servicio. Los pagos anteriores y sus reembolsos siguen disponibles; el cobro con tarjeta conectada queda desactivado tras reiniciar. Las cajas se reconectan; puede que debas repetir un envío a cocina.",
    "modules.workforce_es_explanation":
      "Guarda el cambio y abre Estado del servidor en Ajustes para reiniciar cuando puedas pausar el servicio. Mientras está desactivado, no están disponibles las comprobaciones laborales españolas ni la exportación española del registro horario. Los turnos y fichajes siguen disponibles. La descarga de datos personales conserva los fichajes en JSON, pero omite los archivos PDF y CSV del registro horario en formato español mientras está desactivado. Las cajas se reconectan; puede que debas repetir un envío a cocina.",
    "modules.configure_providers": "Configurar proveedores de tarjeta",
    "modules.guide": "Cómo configurar los módulos",
  },
});
