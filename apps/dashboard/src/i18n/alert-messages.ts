// English and Spanish sentences for every alert code. `{name}` slots are filled from the alert's
// params. Kept free of imports so the root guard (`scripts/alert-codes.test.ts`) can load it.
const RETURNS_EN =
  " If the next check still finds it after you mark it handled, it will appear again.";
const RETURNS_ES =
  " Si la próxima comprobación lo sigue encontrando después de marcarlo como resuelto, volverá a aparecer.";

export const ALERT_MESSAGES: Readonly<
  Record<string, { readonly en: string; readonly es: string }>
> = {
  "alert.source_unavailable": {
    en: "One of Waitron's checks could not run. It will try again in a minute.",
    es: "Una de las comprobaciones de Waitron no se ha podido ejecutar. Lo volverá a intentar en un minuto.",
  },
  "chain.verification_failed": {
    en: "The invoice record chain failed its integrity check on a sale. Contact support.",
    es: "La cadena de registros de facturación no ha superado su comprobación de integridad en una venta. Contacta con soporte.",
  },
  "clock.degraded": {
    en: "The till's clock has not been checked against a trusted time source for {anchorAgeSeconds} seconds. Sales continue; check the box's internet connection.",
    es: "La hora de la caja no se ha comprobado con una fuente fiable desde hace {anchorAgeSeconds} segundos. Las ventas continúan; revisa la conexión a internet del equipo.",
  },
  "clock.jump_detected": {
    en: "The till's clock jumped by {wallClockDeltaSeconds} seconds. Check the date and time on the box.",
    es: "La hora de la caja ha saltado {wallClockDeltaSeconds} segundos. Revisa la fecha y la hora del equipo.",
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
    en: `Invoice {numSerieFactura} was sent, but the tax agency (AEAT) has no record of it. Contact support.${RETURNS_EN}`,
    es: `La factura {numSerieFactura} se envió, pero la AEAT no tiene constancia de ella. Contacta con soporte.${RETURNS_ES}`,
  },
  "fiscal.reconcile_drift_errores": {
    en: "The tax agency (AEAT) now lists invoice {numSerieFactura} as accepted with errors, though it was recorded here as accepted. Waitron has updated its own record to match.",
    es: "La AEAT indica ahora que la factura {numSerieFactura} se aceptó con errores, aunque aquí constaba como aceptada. Waitron ha actualizado su registro para que coincida.",
  },
  "fiscal.reconcile_drift_anulada": {
    en: `The tax agency (AEAT) lists invoice {numSerieFactura} as cancelled, but it was not voided here. Contact support.${RETURNS_EN}`,
    es: `La AEAT indica que la factura {numSerieFactura} está anulada, pero aquí no se anuló. Contacta con soporte.${RETURNS_ES}`,
  },
  "payment.offline_forward_declined": {
    en: "A card payment of {amount} taken while offline was declined when it was sent on (reference {paymentRef}). Collect the money another way.",
    es: "Un pago con tarjeta de {amount} cobrado sin conexión se rechazó al enviarlo (referencia {paymentRef}). Cobra el importe de otra forma.",
  },
  "payment.pending_outcome_unactionable": {
    en: "The card provider did not confirm whether payment {paymentRef} went through (status {status}). Check it in the provider's own dashboard.",
    es: "El proveedor de pagos no ha confirmado si el pago {paymentRef} se completó (estado {status}). Compruébalo en el panel del proveedor.",
  },
  "payment.reconcile_unsettled": {
    en: `{count} card payments have not been paid out by the card provider yet.${RETURNS_EN}`,
    es: `El proveedor de pagos aún no ha liquidado {count} pagos con tarjeta.${RETURNS_ES}`,
  },
  "payment.reconcile_lost_settlement": {
    en: `The card provider says {count} payments were paid, but they never finished here. Check those orders.${RETURNS_EN}`,
    es: `El proveedor de pagos indica que {count} pagos se cobraron, pero aquí no se completaron. Revisa esos pedidos.${RETURNS_ES}`,
  },
  "payment.reconcile_orphan": {
    en: `{count} card payments were taken for orders that were already closed or abandoned. Waitron refunds some of these by itself; check the rest.${RETURNS_EN}`,
    es: `Se cobraron {count} pagos con tarjeta de pedidos ya cerrados o abandonados. Waitron devuelve algunos por sí mismo; revisa el resto.${RETURNS_ES}`,
  },
  "payment.reconcile_missing_local": {
    en: `The card provider reports {count} payments that are not recorded here.${RETURNS_EN}`,
    es: `El proveedor de pagos indica {count} pagos que no están registrados aquí.${RETURNS_ES}`,
  },
  "payment.reconcile_drift": {
    en: `{count} card payments were paid out for a different amount than was charged.${RETURNS_EN}`,
    es: `Se liquidaron {count} pagos con tarjeta por un importe distinto del cobrado.${RETURNS_ES}`,
  },
  "payment.reconcile_remediation_failed": {
    en: "Automatic refunds failed for {count} card payments. Refund them in the card provider's own dashboard.",
    es: "Las devoluciones automáticas han fallado en {count} pagos con tarjeta. Devuélvelos desde el panel del proveedor.",
  },
};
