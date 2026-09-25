// English and Spanish sentences for every alert code. `{name}` slots are filled from the alert's
// params. Kept free of imports so the root guard (`scripts/alert-codes.test.ts`) can load it.
//
// No sentence promises a later check by the server: the daily payments check looks at each day once,
// and the fiscal reconciliation sweep has no production caller. The one retry promised, in
// `alert.source_unavailable`, is an open dashboard asking for its alerts again every minute.

// An open payment incident swallows later detections for the same till and code, so its figures
// are from when it was raised.
const MORE_EN = " Later checks do not add to this alert while it is open, so there may be more.";
const MORE_ES =
  " Mientras esta alerta esté abierta, las comprobaciones posteriores no la amplían, así que puede haber más.";
const NOT_RECHECKED_EN =
  " Marking it handled does not fix it, and Waitron may not check these payments again.";
const NOT_RECHECKED_ES =
  " Marcarla como resuelta no lo soluciona, y es posible que Waitron no vuelva a comprobar estos pagos.";

export const ALERT_MESSAGES: Readonly<
  Record<string, { readonly en: string; readonly es: string }>
> = {
  "alert.source_unavailable": {
    en: "One of Waitron's checks could not run. It will try again in a minute.",
    es: "Una de las comprobaciones de Waitron no se ha podido ejecutar. Lo volverá a intentar en un minuto.",
  },
  "backup.destination_overdue": {
    en: "Backups to “{destination}” are overdue — no recent good backup. Check the destination on the Backups page.",
    es: "Las copias de seguridad en «{destination}» están atrasadas: no hay ninguna correcta reciente. Revisa el destino en la página de Copias.",
  },
  "backup.destination_failed": {
    en: "The last backup to “{destination}” failed. Open the Backups page to retry.",
    es: "La última copia de seguridad en «{destination}» falló. Abre la página de Copias para reintentar.",
  },
  "backup.disabled": {
    en: "No copy of your data is being kept: there are no scheduled backups, and the bucket copy is off or not up to date. Set one up on the Backups page.",
    es: "No se está guardando ninguna copia de tus datos: no hay copias de seguridad programadas, y la copia en el bucket está desactivada o no está al día. Configura una en la página de Copias.",
  },
  "backup.stream_behind": {
    en: "The bucket copy is {minutes} minutes behind: your most recent sales are not in it yet. Sales continue. Check the box's internet connection, and the bucket on the Backups page.",
    es: "La copia en el bucket lleva {minutes} minutos de retraso: tus ventas más recientes aún no están en ella. Las ventas continúan. Revisa la conexión a internet del equipo y el bucket en la página de Copias.",
  },
  "backup.stream_paused": {
    en: "The bucket copy is paused: the bucket could not be reached for so long that the box stopped copying to protect its disk. Sales continue. Check the box's internet connection, and the bucket on the Backups page.",
    es: "La copia en el bucket está en pausa: no se ha podido contactar con el bucket durante tanto tiempo que el equipo ha dejado de copiar para proteger su disco. Las ventas continúan. Revisa la conexión a internet del equipo y el bucket en la página de Copias.",
  },
  "backup.stream_refused": {
    en: "The bucket copy has stopped because another box is writing this venue's copy to the same bucket. Two boxes must never sell for one venue. Contact support.",
    es: "La copia en el bucket se ha detenido porque otro equipo está escribiendo la copia de este local en el mismo bucket. Nunca deben vender dos equipos para un mismo local. Contacta con soporte.",
  },
  "backup.stream_settings_unusable": {
    en: "The bucket copy has not started because its settings cannot be used safely. Check the bucket settings on the Backups page, and contact support if they look right.",
    es: "La copia en el bucket no se ha iniciado porque sus ajustes no se pueden usar de forma segura. Revisa los ajustes del bucket en la página de Copias y, si parecen correctos, contacta con soporte.",
  },
  "backup.stream_bucket_unusable": {
    en: "Your bucket is refusing this box: its access key may no longer work, or the bucket may no longer support the check Waitron uses to stop two boxes overwriting each other's copy. Check the bucket settings on the Backups page.",
    es: "Tu bucket está rechazando este equipo: puede que su clave de acceso ya no funcione, o que el bucket ya no admita la comprobación que usa Waitron para evitar que dos equipos sobrescriban la copia del otro. Revisa los ajustes del bucket en la página de Copias.",
  },
  "backup.stream_stopped": {
    en: "The bucket copy is not running, so new changes are not reaching your bucket. Sales continue. Contact support.",
    es: "La copia en el bucket no está en marcha, así que los cambios nuevos no llegan a tu bucket. Las ventas continúan. Contacta con soporte.",
  },
  "backup.sealed_state_failed": {
    en: "The box could not update the locked copy of its own keys and settings that it keeps with your data. A box rebuilt from your bucket might come back with out-of-date keys and settings, or without them if none were ever saved. Sales continue. Contact support.",
    es: "El equipo no ha podido actualizar la copia cifrada de sus propias claves y ajustes que guarda junto con tus datos. Un equipo reconstruido desde tu bucket podría volver con claves y ajustes desactualizados, o sin ellos si nunca se llegaron a guardar. Las ventas continúan. Contacta con soporte.",
  },
  "chain.verification_failed": {
    en: "The invoice record chain failed its integrity check on a sale. Contact support.",
    es: "La cadena de registros de facturación no ha superado su comprobación de integridad en una venta. Contacta con soporte.",
  },
  "clock.degraded": {
    en: "This device's clock has not been checked against a trusted time source for {anchorAgeSeconds} seconds. Sales continue.",
    es: "La hora de este equipo no se ha comprobado con una fuente de hora fiable desde hace {anchorAgeSeconds} segundos. Las ventas continúan.",
  },
  "clock.jump_detected": {
    en: "This device's clock went backwards: it changed by {wallClockDeltaSeconds} seconds. Check its date and time.",
    es: "La hora de este equipo ha retrocedido: ha cambiado {wallClockDeltaSeconds} segundos. Revisa su fecha y hora.",
  },
  "fiscal.registro_rechazado": {
    en: "The tax agency (AEAT) rejected an invoice record: {mensaje} (code {codigo}). Later records on the same chain are on hold. Contact support.",
    es: "La AEAT ha rechazado un registro de facturación: {mensaje} (código {codigo}). Los registros posteriores de la misma cadena están en espera. Contacta con soporte.",
  },
  "fiscal.aceptado_con_errores": {
    en: "The tax agency (AEAT) accepted an invoice record but reported a problem: {mensaje} (code {codigo}).",
    es: "La AEAT ha aceptado un registro de facturación, pero ha indicado un problema: {mensaje} (código {codigo}).",
  },
  "fiscal.duplicado_anulado": {
    en: "The tax agency (AEAT) already holds this invoice record as cancelled. Sending on this chain is on hold. Contact support.",
    es: "La AEAT ya tiene este registro de facturación como anulado. El envío de esta cadena está en espera. Contacta con soporte.",
  },
  "fiscal.huella_divergente": {
    en: "An invoice record's fingerprint does not match the copy the tax agency (AEAT) holds. Sending on this chain is on hold. Contact support.",
    es: "La huella de un registro de facturación no coincide con la copia de la AEAT. El envío de esta cadena está en espera. Contacta con soporte.",
  },
  "fiscal.environment_mismatch": {
    en: "An invoice record was made for the tax agency's {recordEnvironment} service, but this box sends to {hostEnvironment}. It has not been sent. Contact support.",
    es: "Un registro de facturación se creó para el servicio de {recordEnvironment} de la AEAT, pero este equipo envía a {hostEnvironment}. No se ha enviado. Contacta con soporte.",
  },
  "fiscal.environment_unknown": {
    en: "An invoice record does not say which tax agency service it was made for, so it has not been sent. Contact support.",
    es: "Un registro de facturación no indica para qué servicio de la AEAT se creó, así que no se ha enviado. Contacta con soporte.",
  },
  "fiscal.record_totals_disagree": {
    en: "An invoice's totals do not match its tax lines. The tax agency accepts it, but check that sale's prices.",
    es: "Los totales de una factura no coinciden con sus líneas de impuestos. La AEAT la acepta, pero revisa los precios de esa venta.",
  },
  "fiscal.reconcile_no_trace": {
    en: "Invoice {numSerieFactura} was sent, but the tax agency (AEAT) has no record of it. Contact support.",
    es: "La factura {numSerieFactura} se envió, pero la AEAT no tiene constancia de ella. Contacta con soporte.",
  },
  "fiscal.reconcile_drift_errores": {
    en: "The tax agency (AEAT) now lists invoice {numSerieFactura} as accepted with errors, though it was recorded here as accepted. Waitron has updated its own record to match.",
    es: "La AEAT indica ahora que la factura {numSerieFactura} se aceptó con errores, aunque aquí constaba como aceptada. Waitron ha actualizado su registro para que coincida.",
  },
  "fiscal.reconcile_drift_anulada": {
    en: "The tax agency (AEAT) lists invoice {numSerieFactura} as cancelled, but it was not voided here. Contact support.",
    es: "La AEAT indica que la factura {numSerieFactura} está anulada, pero aquí no se anuló. Contacta con soporte.",
  },
  "fiscal.submission_delayed": {
    en: "{count} fiscal record(s) have been waiting {hours}h to reach the tax agency. If this persists, check that the fiscal certificate is valid.",
    es: "{count} registro(s) fiscal(es) llevan {hours} h esperando para llegar a la Agencia Tributaria. Si continúa, comprueba que el certificado fiscal sea válido.",
  },
  "fiscal.submission_stopped": {
    en: "{count} fiscal record(s) have stopped submitting and need attention.",
    es: "{count} registro(s) fiscal(es) han detenido su envío y requieren atención.",
  },
  "fiscal.awaiting_certificate": {
    en: "Fiscal records are waiting because no valid tax certificate is installed. Upload the certificate to resume submitting.",
    es: "Hay registros fiscales en espera porque no hay un certificado tributario válido instalado. Sube el certificado para reanudar los envíos.",
  },
  "payment.offline_forward_declined": {
    en: "A card payment of {amount} taken while offline was declined when it was sent on (reference {paymentRef}). Collect the money another way.",
    es: "Un pago con tarjeta de {amount} cobrado sin conexión se rechazó al enviarlo (referencia {paymentRef}). Cobra el importe de otra forma.",
  },
  "payment.pending_outcome_unactionable": {
    en: "Waitron could not tell what happened to card payment {paymentRef}: the card provider reported {status}, and money may have moved without reaching a sale. Waitron has marked the payment as failed. Check it in the provider's own dashboard.",
    es: "Waitron no ha podido saber qué pasó con el pago con tarjeta {paymentRef}: el proveedor de pagos indicó {status}, y puede que se haya movido dinero sin llegar a una venta. Waitron ha marcado el pago como fallido. Compruébalo en el panel del proveedor.",
  },
  "payment.reconcile_unsettled": {
    en: `A check found {count} card payments that the card provider had not paid out.${MORE_EN}${NOT_RECHECKED_EN}`,
    es: `Una comprobación encontró {count} pagos con tarjeta que el proveedor de pagos no había liquidado.${MORE_ES}${NOT_RECHECKED_ES}`,
  },
  "payment.reconcile_lost_settlement": {
    en: `A check found {count} payments the card provider says were paid, but that never finished here. Check those orders.${MORE_EN}${NOT_RECHECKED_EN}`,
    es: `Una comprobación encontró {count} pagos que el proveedor de pagos indica como cobrados, pero que aquí no se completaron. Revisa esos pedidos.${MORE_ES}${NOT_RECHECKED_ES}`,
  },
  "payment.reconcile_orphan": {
    en: `A check found {count} card payments taken for orders that were already closed or abandoned. Waitron tries to refund some of these itself; check the rest.${MORE_EN}${NOT_RECHECKED_EN}`,
    es: `Una comprobación encontró {count} pagos con tarjeta de pedidos ya cerrados o abandonados. Waitron intenta devolver algunos por sí mismo; revisa el resto.${MORE_ES}${NOT_RECHECKED_ES}`,
  },
  "payment.reconcile_missing_local": {
    en: `A check found {count} payments reported by the card provider that are not recorded here.${MORE_EN}${NOT_RECHECKED_EN}`,
    es: `Una comprobación encontró {count} pagos indicados por el proveedor de pagos que no están registrados aquí.${MORE_ES}${NOT_RECHECKED_ES}`,
  },
  "payment.reconcile_drift": {
    en: `A check found {count} card payments paid out for a different amount than was charged.${MORE_EN}${NOT_RECHECKED_EN}`,
    es: `Una comprobación encontró {count} pagos con tarjeta liquidados por un importe distinto del cobrado.${MORE_ES}${NOT_RECHECKED_ES}`,
  },
  "payment.reconcile_remediation_failed": {
    en: `Automatic refunds failed for {count} card payments. Waitron will not try them again; refund them in the card provider's own dashboard.${MORE_EN}`,
    es: `Las devoluciones automáticas han fallado en {count} pagos con tarjeta. Waitron no las volverá a intentar; devuélvelos desde el panel del proveedor.${MORE_ES}`,
  },
  "agent.silent": {
    en: "Print agent “{agent}” has gone quiet — it has not checked in for several minutes. Printing may be affected.",
    es: "El agente de impresión «{agent}» está en silencio: lleva varios minutos sin dar señales. La impresión puede verse afectada.",
  },
  "printer.jobs_waiting": {
    en: "{count} print job(s) are stuck at “{printer}”. Check the printer on the Printers page.",
    es: "{count} trabajo(s) de impresión atascado(s) en «{printer}». Revisa la impresora en la página de Impresoras.",
  },
  "reader.battery_low": {
    en: "Card reader “{reader}” battery is low ({percent}%). Charge it to avoid interruptions at the till.",
    es: "La batería del lector de tarjetas «{reader}» está baja ({percent} %). Cárgalo para evitar interrupciones en la caja.",
  },
};
