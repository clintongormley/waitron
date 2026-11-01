export const CONFLICT_RECOVERY_STRINGS = {
  en: {
    "conflict_recovery.title": "Recover from an invoice identity conflict",
    "conflict_recovery.key": "Current recovery key",
    "conflict_recovery.inspect": "Check conflict",
    "conflict_recovery.stop": "Stop",
    "conflict_recovery.key_required": "Enter the current recovery key.",
    "conflict_recovery.invalid": "Correct the highlighted fields to continue.",
    "conflict_recovery.key_refused":
      "The recovery key was refused. Enter the current key and try again.",
    "conflict_recovery.failed": "The request could not be completed. Try again or choose Stop.",
    "conflict_recovery.connection_refused":
      "Recovery needs a direct secure connection to this box. Open this box's HTTPS recovery address directly in your browser, then try again or choose Stop.",
    "conflict_recovery.not_primary":
      "This box cannot write invoices in its current role. Choose Stop, then open recovery on the main box your tills use.",
    "conflict_recovery.no_conflict": "This box has no active invoice identity conflict.",
    "conflict_recovery.explanation":
      "New invoices are stopped because this box's invoice identity conflicts with a filing response. A copied box, an old box still issuing invoices or another invoicing product may be using the same identity.",
    "conflict_recovery.preserved":
      "Switching keeps your orders, payments and history. The rejected record stays rejected and its case stays open. Switching does not repair missing history or stop another box.",
    "conflict_recovery.offline": "I have taken the old or copied box offline *",
    "conflict_recovery.parallel": "Nobody else is recovering this identity *",
    "conflict_recovery.confirm": "Confirm both isolation answers before continuing.",
    "conflict_recovery.compare": "Compare clocks",
    "conflict_recovery.switch": "Switch identity",
    "conflict_recovery.clock_disagrees":
      "The clocks do not agree. Check this box's clock and this device's clock, then compare again or choose Stop.",
    "conflict_recovery.clock_missing":
      "A second clock has not confirmed the box's time. Check this device's clock and compare again, or choose Stop.",
    "conflict_recovery.complete": "Identity switched. New invoice series:",
    "conflict_recovery.uncertain":
      "The switch result is not confirmed. Check the result with the current recovery key. Stop cannot undo a switch already committed.",
    "conflict_recovery.restart":
      "This attempt cannot be continued. Start a new attempt with a fresh clock comparison, or choose Stop. Invoices stay stopped until an identity switch is confirmed.",
    "conflict_recovery.again": "Start a new attempt",
    "conflict_recovery.limited":
      "Too many recovery requests are running or have arrived recently. Wait a minute and try again, or choose Stop.",
    "conflict_recovery.wait":
      "Waiting for an available minute: {seconds} seconds. The box checks every five seconds. Compare clocks again when the wait ends; switching always needs your choice.",
    "conflict_recovery.leave_title": "Leave recovery?",
    "conflict_recovery.leave_message":
      "Leaving clears the recovery key and your confirmations. It cannot undo an identity switch already committed. Reopen recovery to check its result.",
    "conflict_recovery.keep": "Keep working",
    "conflict_recovery.discard": "Leave and clear key",
  },
  es: {
    "conflict_recovery.title": "Recuperar una identidad de facturación en conflicto",
    "conflict_recovery.key": "Clave de recuperación actual",
    "conflict_recovery.inspect": "Consultar conflicto",
    "conflict_recovery.stop": "Detener",
    "conflict_recovery.key_required": "Introduce la clave de recuperación actual.",
    "conflict_recovery.invalid": "Corrige los campos señalados para continuar.",
    "conflict_recovery.key_refused":
      "La clave de recuperación se ha rechazado. Introduce la clave actual e inténtalo de nuevo.",
    "conflict_recovery.failed":
      "No se ha podido completar la solicitud. Inténtalo de nuevo o elige Detener.",
    "conflict_recovery.connection_refused":
      "La recuperación necesita una conexión segura directa con este equipo. Abre su dirección HTTPS de recuperación directamente en el navegador y vuelve a intentarlo, o elige Detener.",
    "conflict_recovery.not_primary":
      "Este equipo no puede emitir facturas con su función actual. Elige Detener y abre la recuperación en el equipo principal que usan tus terminales.",
    "conflict_recovery.no_conflict":
      "Esta caja no tiene ningún conflicto activo de identidad de facturación.",
    "conflict_recovery.explanation":
      "No se pueden emitir facturas nuevas porque la identidad de facturación de esta caja entra en conflicto con una respuesta de envío. Una copia, una caja antigua que sigue facturando u otro programa de facturación podrían estar usando la misma identidad.",
    "conflict_recovery.preserved":
      "El cambio conserva tus pedidos, pagos e historial. El registro rechazado sigue rechazado y su incidencia sigue abierta. El cambio no repara el historial que falta ni detiene otra caja.",
    "conflict_recovery.offline": "He desconectado la caja antigua o copiada *",
    "conflict_recovery.parallel": "Nadie más está recuperando esta identidad *",
    "conflict_recovery.confirm":
      "Confirma las dos respuestas sobre el aislamiento antes de continuar.",
    "conflict_recovery.compare": "Comparar relojes",
    "conflict_recovery.switch": "Cambiar identidad",
    "conflict_recovery.clock_disagrees":
      "Los relojes no coinciden. Comprueba el reloj de esta caja y el de este dispositivo y vuelve a compararlos, o elige Detener.",
    "conflict_recovery.clock_missing":
      "Un segundo reloj no ha confirmado la hora de la caja. Comprueba el reloj de este dispositivo y vuelve a compararlos, o elige Detener.",
    "conflict_recovery.complete": "Identidad cambiada. Nuevas series de facturas:",
    "conflict_recovery.uncertain":
      "No se ha confirmado el resultado del cambio. Consúltalo con la clave de recuperación actual. Detener no puede deshacer un cambio ya confirmado en la caja.",
    "conflict_recovery.restart":
      "No se puede continuar este intento. Inicia otro con una nueva comparación de relojes, o elige Detener. La facturación sigue detenida hasta que se confirme el cambio de identidad.",
    "conflict_recovery.again": "Iniciar otro intento",
    "conflict_recovery.limited":
      "Hay demasiadas solicitudes de recuperación en curso o recientes. Espera un minuto e inténtalo de nuevo, o elige Detener.",
    "conflict_recovery.wait":
      "Esperando un minuto disponible: {seconds} segundos. La caja comprueba cada cinco segundos. Vuelve a comparar los relojes cuando termine la espera; el cambio siempre requiere tu elección.",
    "conflict_recovery.leave_title": "¿Salir de la recuperación?",
    "conflict_recovery.leave_message":
      "Al salir se borran la clave de recuperación y tus confirmaciones. No se puede deshacer un cambio de identidad ya confirmado en la caja. Abre la recuperación otra vez para consultar el resultado.",
    "conflict_recovery.keep": "Seguir trabajando",
    "conflict_recovery.discard": "Salir y borrar la clave",
  },
};
export type ConflictRecoveryString = keyof typeof CONFLICT_RECOVERY_STRINGS.en;
