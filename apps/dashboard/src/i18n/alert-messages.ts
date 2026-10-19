// English and Spanish sentences for every alert code. `{name}` slots are filled from the alert's
// params, and a `{name:money}` slot writes a decimal-string amount as euros. Kept free of imports so
// the root guard (`scripts/alert-codes.test.ts`) can load it.
//
// No sentence promises a later check by the server: the daily payments check looks at each day once,
// and the fiscal reconciliation sweep has no production caller. Only `alert.source_unavailable`,
// `fiscal.estado_desconocido` and `fiscal.respuesta_descuadrada` promise an automatic retry, the
// two fiscal ones only while no earlier record of the record's chain is on hold: an open dashboard
// asks for its alerts again every minute, and the drain puts such a record back to waiting
// (`awaitReadableAnswer`, `@waitron/fiscal-verifactu`); a sentence that asks for a retry or a
// restart asks the owner to do it.

// An open payment incident swallows later detections for the same till and code, so its figures
// are from when it was raised, and a bill payment's alert may stand for more than one payment.
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
  "fiscal.clock_drift": {
    en: "The server's last clock comparison with AEAT differed by {seconds} seconds. Check its date and time; you can continue selling.",
    es: "La última comparación del reloj del servidor con la AEAT mostró una diferencia de {seconds} segundos. Comprueba su fecha y hora; puedes seguir vendiendo.",
  },
  "alert.source_unavailable": {
    en: "One of Waitron's checks could not run. It will try again in a minute.",
    es: "Una de las comprobaciones de Waitron no se ha podido ejecutar. Lo volverá a intentar en un minuto.",
  },
  "fiscal.taxpayer_domicile_missing": {
    en: "A full invoice could not be issued because the venue's legal address is missing. Add it before retrying the sale.",
    es: "No se ha podido emitir una factura completa porque falta el domicilio fiscal del local. Añádelo antes de reintentar la venta.",
  },
  "station.printer_down": {
    en: "{station}'s printer {printer} has printed nothing since something sent to it got stuck, so {station}'s tickets may not be reaching it. Fix the printer; while {station} is open, closing it on the Prep stations page sends its new work elsewhere (the page shows where).",
    es: "La impresora {printer} de {station} no ha impreso nada desde que se atascó algo que se le envió, así que puede que las comandas de {station} no le lleguen. Arregla la impresora; mientras {station} esté abierta, cerrarla en la página de Estaciones de preparación envía su trabajo nuevo a otro sitio (la página indica adónde).",
  },
  "station.default_printer_down": {
    en: "{printer}, the printer of the default station {station}, has printed nothing since something sent to it got stuck. The default station cannot be closed: fix the printer, and until then read {station}'s tickets on its kitchen screen or on the till's station view.",
    es: "La impresora {printer} de la estación predeterminada {station} no ha impreso nada desde que se atascó algo que se le envió. La estación predeterminada no se puede cerrar: arregla la impresora y, mientras tanto, consulta las comandas de {station} en su pantalla de cocina o en la vista de estación del TPV.",
  },
  "station.screens_dark": {
    en: "{station} has dishes waiting, and none of its kitchen screens has checked in for over three minutes. Check the screen; until then, read its tickets on the till's station view. Closing {station} on the Prep stations page sends new work elsewhere, but does not move the dishes already waiting.",
    es: "{station} tiene platos pendientes y ninguna de sus pantallas de cocina se ha conectado en más de tres minutos. Revisa la pantalla; mientras tanto, consulta sus comandas en la vista de estación del TPV. Cerrar {station} en la página de Estaciones de preparación envía el trabajo nuevo a otro sitio, pero no mueve los platos que ya esperan.",
  },
  "station.default_screens_dark": {
    en: "{station}, the default station, has dishes waiting, and none of its kitchen screens has checked in for over three minutes. Check the screen; until then, read its tickets on the till's station view.",
    es: "{station}, la estación predeterminada, tiene platos pendientes y ninguna de sus pantallas de cocina se ha conectado en más de tres minutos. Revisa la pantalla; mientras tanto, consulta sus comandas en la vista de estación del TPV.",
  },
  "kitchen_screen.pass_dark": {
    en: "Pass screen {device} has dishes waiting and has not checked in for over three minutes. Check it; until then, use the till's Pass view.",
    es: "La pantalla de pase {device} tiene platos pendientes y lleva más de tres minutos sin conectarse. Revísala; mientras tanto, usa la vista de pase del TPV.",
  },
  "kitchen_screen.pass_monitor_dark": {
    en: "Pass monitor {device} has dishes waiting and has not checked in for over three minutes. Check it; until then, use the till's Pass view.",
    es: "El monitor de pase {device} tiene platos pendientes y lleva más de tres minutos sin conectarse. Revísalo; mientras tanto, usa la vista de pase del TPV.",
  },
  "backup.destination_overdue": {
    en: "Backups to “{destination}” are overdue, or the destination could not be checked. Check it on the Backups page.",
    es: "Las copias de seguridad en «{destination}» están atrasadas o no se ha podido comprobar el destino. Revísalo en la página de Copias.",
  },
  "backup.destination_failed": {
    en: "The last backup to “{destination}” failed. Open the Backups page to retry.",
    es: "La última copia de seguridad en «{destination}» falló. Abre la página de Copias para reintentar.",
  },
  "backup.run_stopped": {
    en: "The last backup stopped before reaching any destination, so no new copy was saved. Sales continue. {errorCode:backup_stop}",
    es: "La última copia de seguridad se detuvo antes de llegar a ningún destino, así que no se ha guardado ninguna copia nueva. Las ventas continúan. {errorCode:backup_stop}",
  },
  "backup.disabled": {
    en: "No copy of your data is being kept: there are no scheduled backups, and the bucket copy is off or not up to date. Set one up on the Backups page.",
    es: "No se está guardando ninguna copia de tus datos: no hay copias de seguridad programadas, y la copia en el bucket está desactivada o no está al día. Configura una en la página de Copias.",
  },
  "backup.archive_settings_unusable": {
    en: "Scheduled backups are off: this box could not use their saved settings. Sales continue. Save the backup settings again on the Backups page; if this message stays, contact support.",
    es: "Las copias de seguridad programadas están desactivadas: este equipo no ha podido usar sus ajustes guardados. Las ventas continúan. Vuelve a guardar los ajustes de copia en la página de Copias; si el mensaje sigue, contacta con soporte.",
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
  "append_only.triggers_restored": {
    en: "A record protection was missing at start and was put back.",
    es: "Faltaba una protección de registros al arrancar y se ha restablecido.",
  },
  "restore.first_start_failed": {
    en: "This box could not finish setting itself up after the restore. Sales continue, but it will not copy to a storage bucket until it does. Restart the box; if this message stays, contact support.",
    es: "Este equipo no ha podido terminar de configurarse después de la restauración. Las ventas continúan, pero no copiará a ningún bucket de almacenamiento hasta que lo consiga. Reinicia el equipo; si el mensaje sigue, contacta con soporte.",
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
    en: "The tax agency (AEAT) rejected an invoice record: {mensaje} (code {codigo}). Contact support.",
    es: "La AEAT ha rechazado un registro de facturación: {mensaje} (código {codigo}). Contacta con soporte.",
  },
  "fiscal.aceptado_con_errores": {
    en: "The tax agency (AEAT) accepted an invoice record but reported a problem: {mensaje} (code {codigo}).",
    es: "La AEAT ha aceptado un registro de facturación, pero ha indicado un problema: {mensaje} (código {codigo}).",
  },
  "fiscal.estado_desconocido": {
    en: "The tax agency (AEAT) answered for an invoice record without a status Waitron recognises, said it already holds a record for this invoice and Waitron could not confirm it is this one, or gave no answer Waitron could be sure belongs to this record, so it is not known whether AEAT kept it. Waitron will send it again unless an earlier record on its chain is on hold. AEAT's message, if any: {mensaje} (code {codigo}).",
    es: "La AEAT ha respondido sobre un registro de facturación sin un estado que Waitron reconozca, ha dicho que ya tiene un registro para esta factura y Waitron no ha podido confirmar que sea este, o no ha dado ninguna respuesta que Waitron pueda asegurar que corresponde a este registro, así que no se sabe si la AEAT lo ha guardado. Waitron lo volverá a enviar salvo que esté en espera un registro anterior de su cadena. Mensaje de la AEAT, si lo hay: {mensaje} (código {codigo}).",
  },
  "fiscal.respuesta_descuadrada": {
    en: "The tax agency (AEAT) answered a submission with a different number of lines than the invoice records Waitron sent, so Waitron applied none of them and will send each again unless an earlier record on its chain is on hold. Contact support.",
    es: "La AEAT ha respondido a un envío con un número de líneas distinto del de registros de facturación que Waitron envió, así que Waitron no ha aplicado ninguna y volverá a enviar cada uno salvo que esté en espera un registro anterior de su cadena. Contacta con soporte.",
  },
  "fiscal.duplicado_anulado": {
    en: "The tax agency (AEAT) already holds this invoice record as cancelled. Contact support.",
    es: "La AEAT ya tiene este registro de facturación como anulado. Contacta con soporte.",
  },
  "fiscal.anulacion_retenida": {
    en: "A cancellation was not sent because the tax agency (AEAT) refused the original invoice. Contact support.",
    es: "No se ha enviado una anulación porque la AEAT rechazó la factura original. Contacta con soporte.",
  },
  "fiscal.huella_divergente": {
    en: "An invoice record's fingerprint does not match the copy the tax agency (AEAT) holds. Contact support.",
    es: "La huella de un registro de facturación no coincide con la copia de la AEAT. Contacta con soporte.",
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
  "fiscal.record_flagged": {
    en: "An invoice record has a problem the tax agency (AEAT) accepts, though it may flag it. Contact support.",
    es: "Un registro de facturación tiene un problema que la AEAT acepta, aunque puede señalarlo. Contacta con soporte.",
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
  "fiscal.filing_cases_open": {
    en: "{count} fiscal record(s) need someone to decide what to do. Contact support.",
    es: "{count} registro(s) fiscal(es) necesitan que alguien decida qué hacer. Contacta con soporte.",
  },
  "fiscal.refusals_repeated": {
    en: "AEAT rejected {count} fiscal records in a row with code {codigo}. Waitron retries the first eligible stopped record hourly. An accept or a different refusal can restart sending. Contact support.",
    es: "La AEAT ha rechazado {count} registros fiscales seguidos con el código {codigo}. Waitron reintenta cada hora el primer registro detenido que puede enviar. Una aceptación o un rechazo distinto puede reanudar el envío. Contacta con soporte.",
  },
  "fiscal.awaiting_certificate": {
    en: "Fiscal records are waiting because no AEAT certificate is installed. Install it in Venue settings.",
    es: "Hay registros fiscales en espera porque no hay ningún certificado de la AEAT instalado. Instálalo en Ajustes del local.",
  },
  "fiscal.certificate_expiring": {
    en: "The AEAT certificate expires on {date:date}, in {days} day(s). Install the new one in Venue settings before then, or fiscal records will wait.",
    es: "El certificado de la AEAT caduca el {date:date}, dentro de {days} día(s). Instala el nuevo en Ajustes del local antes de esa fecha o los registros fiscales quedarán en espera.",
  },
  "fiscal.certificate_expired": {
    en: "The AEAT certificate expired on {date:date}. Sales continue, but fiscal records wait until you install a new one in Venue settings.",
    es: "El certificado de la AEAT caducó el {date:date}. Las ventas continúan, pero los registros fiscales esperan hasta que instales uno nuevo en Ajustes del local.",
  },
  "payment.offline_forward_declined": {
    en: "A card payment of {amount:money} taken while offline was declined when it was sent on (reference {paymentRef}). Collect the money another way.",
    es: "Un pago con tarjeta de {amount:money} cobrado sin conexión se rechazó al enviarlo (referencia {paymentRef}). Cobra el importe de otra forma.",
  },
  "payment.pending_outcome_unactionable": {
    en: "Waitron could not tell what happened to card payment {paymentRef}: the card provider reported {status}, and money may have moved without reaching a sale. Waitron has marked the payment as failed. Check it in the provider's own dashboard.",
    es: "Waitron no ha podido saber qué pasó con el pago con tarjeta {paymentRef}: el proveedor de pagos indicó {status}, y puede que se haya movido dinero sin llegar a una venta. Waitron ha marcado el pago como fallido. Compruébalo en el panel del proveedor.",
  },
  "payment.bill_capture_mismatch": {
    en: `The card provider charged {captured:money} for a payment towards a bill that should have been {expected:money}. Waitron has not counted it, and the bill cannot be changed or invoiced until a manager records what happened. Check the charge in the card provider's own dashboard.${MORE_EN}`,
    es: `El proveedor de pagos cobró {captured:money} por un pago a cuenta de una cuenta que debía ser de {expected:money}. Waitron no lo ha contado, y la cuenta no se puede modificar ni facturar hasta que un responsable registre lo ocurrido. Comprueba el cobro en el panel del proveedor de pagos.${MORE_ES}`,
  },
  "payment.bill_settle_failed": {
    en: `A card payment of {amount:money} towards a bill was charged, but Waitron could not record it or issue the bill's invoice. The bill cannot be changed or invoiced until it is recorded. Contact support.${MORE_EN}`,
    es: `Se cobró con tarjeta un pago de {amount:money} a cuenta de una cuenta, pero Waitron no ha podido registrarlo ni emitir la factura de la cuenta. La cuenta no se puede modificar ni facturar hasta que se registre. Contacta con soporte.${MORE_ES}`,
  },
  "payment.tender_refund_unresolved": {
    en: `A card refund of {amount:money} has been waiting for over an hour for the card provider to show what happened. Check the refund in the provider's own dashboard, and record the outcome it confirms. The original invoice is unchanged.${MORE_EN}`,
    es: `Una devolución de {amount:money} lleva más de una hora esperando a que el proveedor de pagos muestre qué pasó. Comprueba la devolución en el panel del proveedor y registra el resultado que confirme. La factura original no cambia.${MORE_ES}`,
  },
  "payment.tender_refund_outcome_conflict": {
    en: `The card provider's evidence for a refund of {amount:money} conflicts with a refund already recorded here. Check the payment and refund in the provider's own dashboard before resolving it.${MORE_EN}`,
    es: `La información del proveedor sobre una devolución de {amount:money} contradice una devolución ya registrada aquí. Comprueba el pago y la devolución en el panel del proveedor antes de resolverla.${MORE_ES}`,
  },
  "payment.refund_outcome_conflict": {
    en: `The card provider shows a refund of {amount:money} as made, which Waitron had already recorded as not made. Waitron has changed nothing: the money went back to the payer, so check the bill's payments against the provider's own dashboard.${MORE_EN}`,
    es: `El proveedor de pagos muestra como hecha una devolución de {amount:money} que Waitron ya había registrado como no hecha. Waitron no ha cambiado nada: el dinero se devolvió al cliente, así que revisa los pagos de la cuenta en el panel del proveedor.${MORE_ES}`,
  },
  "payment.refund_unresolved": {
    en: `A card refund of {amount:money} has been waiting for over an hour for the card provider to show what happened. Its bill cannot be changed or invoiced until then. Check the refund in the provider's own dashboard, and record the outcome it confirms.${MORE_EN}`,
    es: `Una devolución con tarjeta de {amount:money} lleva más de una hora esperando a que el proveedor de pagos muestre qué pasó. Hasta entonces, su cuenta no se puede modificar ni facturar. Comprueba la devolución en el panel del proveedor y registra el resultado que confirme.${MORE_ES}`,
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
  "route.dish_not_sent": {
    en: "Paid order {orderNumber} has dishes no prep station could take: {dishes}. They were not sent to the kitchen. Pass them to the kitchen by hand, and check the Prep stations page: a closed station with no replacement, or no active default station, leaves a dish nowhere to go.",
    es: "El pedido pagado {orderNumber} tiene platos que ninguna estación de preparación podía recibir: {dishes}. No se han enviado a cocina. Pásalos a cocina a mano y revisa la página de Estaciones de preparación: una estación cerrada sin sustituta, o ninguna estación predeterminada activa, deja un plato sin destino.",
  },
  "route.released_at_closed_station": {
    en: "Order {orderNumber}: {dishes} went to {station}, which is closed or disabled, and the prep station rules sent them nowhere else. If nobody is making them there, move them to another station from the till (Move to station…), or open {station} for today on the Prep stations page. Dishes left at a closed station later do not add to this alert while it is open, so there may be more.",
    es: "Pedido {orderNumber}: {dishes} se enviaron a {station}, que está cerrada o deshabilitada, y las reglas de las estaciones de preparación no los enviaron a ningún otro sitio. Si nadie los está preparando allí, pásalos a otra estación desde el TPV (Cambiar de estación…) o abre {station} por hoy en la página de Estaciones de preparación. Los platos que queden más tarde en una estación cerrada no se añaden a esta alerta mientras esté abierta, así que puede haber más.",
  },
  "agent.silent": {
    en: "Print agent “{agent}” has gone quiet — it has not checked in for several minutes. Printing may be affected.",
    es: "El agente de impresión «{agent}» está en silencio: lleva varios minutos sin dar señales. La impresión puede verse afectada.",
  },
  "printer.jobs_waiting": {
    en: "{count} print job(s) are stuck at “{printer}”. Check the printer on the Printers page.",
    es: "{count} trabajo(s) de impresión atascado(s) en «{printer}». Revisa la impresora en la página de Impresoras.",
  },
  "invoice_delivery.failed": {
    en: "Full invoice {invoice} has not reached its customer: the last attempt to send or print it failed. Send it again from the order, on the till or on the Orders page.",
    es: "La factura completa {invoice} no ha llegado a su cliente: el último intento de enviarla o imprimirla ha fallado. Vuelve a enviarla desde el pedido, en el TPV o en la página de Pedidos.",
  },
  "invoice_delivery.uncertain": {
    en: "Full invoice {invoice} may not have reached its customer. Check before sending it again.",
    es: "Puede que la factura completa {invoice} no haya llegado a su cliente. Compruébalo antes de volver a enviarla.",
  },
  "invoice_delivery.office_printer_unclaimed": {
    en: "Full invoice {invoice} is waiting for office printer “{printer}”, and no print agent has taken it. A manager can open Add a printer on the Printers page and choose “Use this agent” on the office printer's row.",
    es: "La factura completa {invoice} está esperando a la impresora de oficina «{printer}» y ningún agente de impresión la ha recogido. Un responsable puede abrir Añadir impresora en la página de Impresoras y elegir «Usar este agente» en la fila de la impresora de oficina.",
  },
  "invoice_delivery.held": {
    en: "Full invoice {invoice} is waiting at office printer “{printer}”. {hold:printer_hold} The invoice will then print by itself: do not print it again.",
    es: "La factura completa {invoice} está esperando en la impresora de oficina «{printer}». {hold:printer_hold} Después la factura se imprimirá sola: no la vuelvas a imprimir.",
  },
  "invoice_delivery.uncertain_held": {
    en: "Full invoice {invoice} may still print on office printer “{printer}”: the printer was holding it when Waitron lost track of it. Check the printer first; only if it did not print, send it again from the order, on the till or on the Orders page.",
    es: "Puede que la factura completa {invoice} aún se imprima en la impresora de oficina «{printer}»: la impresora la tenía retenida cuando Waitron perdió su rastro. Comprueba primero la impresora; solo si no se ha imprimido, vuelve a enviarla desde el pedido, en el TPV o en la página de Pedidos.",
  },
  "invoice_delivery.queued_behind_hold": {
    en: "Full invoice {invoice} is waiting for office printer “{printer}”, which is holding an earlier job. {hold:printer_hold} The invoice will then print after it. To give the customer the invoice on the receipt printer instead, open the order on the till.",
    es: "La factura completa {invoice} está esperando a la impresora de oficina «{printer}», que tiene retenido un trabajo anterior. {hold:printer_hold} Después la factura se imprimirá tras él. Para darle al cliente la factura en la impresora de tickets, abre el pedido en el TPV.",
  },
  "reader.battery_low": {
    en: "Card reader “{reader}” battery is low ({percent}%). Charge it to avoid interruptions at the till.",
    es: "La batería del lector de tarjetas «{reader}» está baja ({percent} %). Cárgalo para evitar interrupciones en la caja.",
  },
  "reader.status_unavailable": {
    en: "Waitron could not check card reader “{reader}”. Check it on the Payments page.",
    es: "Waitron no ha podido comprobar el lector de tarjetas «{reader}». Revísalo en la página de Pagos.",
  },
  "content.suggestions_ready": {
    en: "Translations ready: {count} suggestions are waiting for review.",
    es: "Traducciones listas: {count} sugerencias pendientes de revisar.",
  },
  "content.suggestions_ready_partly": {
    en: "Translations ready: {count} suggestions are waiting for review. {failed} couldn't be done this time.",
    es: "Traducciones listas: {count} sugerencias pendientes de revisar. {failed} no se han podido hacer esta vez.",
  },
};

export const ALERT_WORDS: Readonly<
  Record<
    string,
    {
      readonly words: Readonly<Record<string, { readonly en: string; readonly es: string }>>;
      readonly otherwise: { readonly en: string; readonly es: string };
    }
  >
> = {
  // What an office printer holding a job needs, by the hold code an alert's `hold` param carries
  // (`a4HoldCodes`, `@waitron/db`). The server shows these alerts with `report.view`, which a
  // supervisor holds without `printer.manage`, so each asks only for something done at the printer.
  printer_hold: {
    words: {
      paper_out: { en: "It is out of paper: load paper.", es: "No tiene papel: carga papel." },
      paper_jam: {
        en: "Paper is jammed in it: clear the jam.",
        es: "Tiene un atasco de papel: retira el papel atascado.",
      },
      cover_open: {
        en: "A cover or door is open: close it.",
        es: "Tiene una tapa o una puerta abierta: ciérrala.",
      },
      tray_missing: {
        en: "A paper tray is missing: put it back.",
        es: "Le falta una bandeja de papel: vuelve a colocarla.",
      },
      ink_or_toner_out: {
        en: "It is out of ink or toner: replace the cartridge.",
        es: "Se ha quedado sin tinta o sin tóner: cambia el cartucho.",
      },
      output_full: {
        en: "Its output tray is full or missing: empty it or put it back.",
        es: "Su bandeja de salida está llena o no está puesta: vacíala o vuelve a colocarla.",
      },
      paused: {
        en: "It is paused: resume it on the printer itself.",
        es: "Está en pausa: reanúdala en la propia impresora.",
      },
      stopped: {
        en: "It has stopped: check the printer for what it needs.",
        es: "Se ha detenido: revisa qué necesita la impresora.",
      },
    },
    otherwise: {
      en: "It is waiting for something: check the printer for what it needs.",
      es: "Está esperando algo: revisa qué necesita la impresora.",
    },
  },
  backup_stop: {
    words: {
      "backup.staging_space_low": {
        en: "The box does not have enough free disk space to prepare it. Contact support.",
        es: "El equipo no tiene espacio libre suficiente en disco para prepararla. Contacta con soporte.",
      },
      "recovery.state_incomplete": {
        en: "Some of the box's own files that every backup must include are missing. Contact support.",
        es: "Faltan algunos archivos propios del equipo que toda copia debe incluir. Contacta con soporte.",
      },
    },
    otherwise: { en: "Contact support.", es: "Contacta con soporte." },
  },
};
