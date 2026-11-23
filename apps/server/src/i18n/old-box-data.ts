import type { billPayments, drawerEntries, refunds, workingOrders } from "@waitron/db";
import type { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import type { timeEntries } from "@waitron/workforce";

type OrderStatus = (typeof workingOrders.$inferSelect)["status"];
type PartPaymentState = (typeof billPayments.$inferSelect)["state"];
type RefundState = (typeof refunds.$inferSelect)["state"];
type CardRefundState = (typeof paymentRefunds.$inferSelect)["state"];
type DrawerKind = (typeof drawerEntries.$inferSelect)["kind"];
type EntryKind = (typeof timeEntries.$inferSelect)["entryKind"];
type CorrectionStatus = NonNullable<(typeof timeEntries.$inferSelect)["correctionStatus"]>;

export const OLD_BOX_DATA_WORDS = {
  en: {
    invoiceSheet: "Invoices",
    invoiceIntro:
      "Invoice records the new main box did not have at {time}, when it last told this box what it holds. This box may still send some of these to it before it is wiped.",
    uncomparedIntro:
      "Every invoice record this box holds, {time}. No comparison with the new main box was made, so some of these may already be on it.",
    chainFields: {
      nodeId: "Box",
      sifId: "System record",
      idSistemaInformatico: "System",
      numeroInstalacion: "Installation",
    } as Readonly<Record<string, string>>,
    voidedAtColumn: "Voided at",
    recordColumns: [
      "Chain",
      "Record number",
      "Record type",
      "Record created at",
      "Filing state with AEAT",
      "Whole chain listed",
    ],
    recordTypes: { issue: "Issue", cancellation: "Cancellation" },
    filingStates: {
      pendiente: "Waiting",
      enviando: "Sending",
      aceptado: "Accepted",
      aceptado_con_errores: "Accepted with errors",
      rechazado: "Refused",
      detenido: "Held",
      retenido: "Set aside",
    } as Readonly<Record<string, string>>,
    notFiled: "No filing state",
    yes: "Yes",
    no: "No",
    sinceCopyIntro:
      "Everything this box recorded from {time}, 10 minutes before the last sale or order in the copy the new main box started from. Some rows may also be on the new main box. Older orders are listed only if settled, collected, or with a line sent or served since then; other changes to older rows are not listed.",
    sinceOwnIntro:
      "Everything this box recorded from {time}, 7 days before its own last sale or order. This box has not been told the time of the last sale or order in the copy the new main box started from, and anything earlier is not listed. Some rows may also be on the new main box. Older orders are listed only if settled, collected, or with a line sent or served since then; other changes to older rows are not listed.",
    sinceAllIntro: "Everything this box recorded. Some rows may also be on the new main box.",
    paymentsCopyIntro:
      "Every payment and cash movement this box recorded from {time}, 10 minutes before the last sale or order in the copy the new main box started from, and each earlier payment or refund whose state changed from then. Some rows may also be on the new main box.",
    paymentsOwnIntro:
      "Every payment and cash movement this box recorded from {time}, 7 days before its own last sale or order, and each earlier payment or refund whose state changed from then. This box has not been told the time of the last sale or order in the copy the new main box started from. Some rows may also be on the new main box.",
    ordersSheet: "Orders",
    orderColumns: [
      "Order number",
      "Order label",
      "Order status",
      "Opened at",
      "Settled at",
      "Collected at",
      "Line",
      "Item",
      "Quantity",
      "Unit price",
      "Line total",
      "Sent at",
      "Served at",
    ],
    orderStatuses: {
      open: "Open",
      placed: "Placed",
      settled: "Settled",
      abandoned: "Abandoned",
    } satisfies Record<OrderStatus, string>,
    paymentsSheet: "Payments and cash",
    paymentColumns: [
      "Kind",
      "Recorded at",
      "Last changed at",
      "Amount",
      "Tip",
      "Method",
      "State",
      "Order number",
      "Provider",
      "Provider's reference",
      "Provider's refund reference",
      "Bill payment",
      "Refund",
      "Person",
      "Id",
    ],
    paymentKinds: {
      part: "Payment",
      card: "Card payment",
      refund: "Refund",
      cardRefund: "Card refund",
      drawer: "Cash drawer",
    },
    refundStates: { pending: "Pending", completed: "Completed", failed: "Failed" } satisfies Record<
      RefundState,
      string
    >,
    cardRefundStates: { succeeded: "Completed", failed: "Failed" } satisfies Record<
      CardRefundState,
      string
    >,
    partPaymentStates: {
      pending: "Pending",
      received: "Received",
      failed: "Failed",
      declined: "Declined",
    } satisfies Record<PartPaymentState, string>,
    drawerKinds: {
      cash_payment: "Cash payment",
      card_payment: "Card payment",
      cash_refund: "Cash refund",
      cash_in: "Cash in",
      cash_out: "Cash out",
      count: "Count",
      recount: "Recount",
      finish: "Finish",
    } satisfies Record<DrawerKind, string>,
    hoursSheet: "Working hours",
    hoursColumns: [
      "Person",
      "Entry kind",
      "Event at",
      "Recorded at",
      "Corrects entry",
      "Correction status",
      "Correction reason",
      "Id",
    ],
    entryKinds: {
      in: "In",
      out: "Out",
      break_start: "Break start",
      break_end: "Break end",
      correction: "Correction",
      confirmation: "Confirmation",
    } satisfies Record<EntryKind, string>,
    correctionStatuses: {
      requested: "Requested",
      approved: "Approved",
      declined: "Declined",
      disputed: "Disputed",
    } satisfies Record<CorrectionStatus, string>,
    activitySheet: "Activity",
    activityColumns: ["At", "Kind", "Person", "Subject kind", "Subject"],
  },
  es: {
    invoiceSheet: "Facturas",
    invoiceIntro:
      "Registros de facturación que el nuevo servidor principal no tenía el {time}, la última vez que indicó a este servidor lo que tiene. Es posible que este servidor aún le envíe algunos antes de borrarse.",
    uncomparedIntro:
      "Todos los registros de facturación de este servidor, {time}. No se ha comparado con el nuevo servidor principal, así que algunos pueden estar ya en él.",
    chainFields: {
      nodeId: "Servidor",
      sifId: "Registro del sistema",
      idSistemaInformatico: "Sistema",
      numeroInstalacion: "Instalación",
    } as Readonly<Record<string, string>>,
    voidedAtColumn: "Anulada el",
    recordColumns: [
      "Cadena",
      "Número de registro",
      "Tipo de registro",
      "Registro creado el",
      "Estado del envío a la AEAT",
      "Cadena completa listada",
    ],
    recordTypes: { issue: "Alta", cancellation: "Anulación" },
    filingStates: {
      pendiente: "Pendiente",
      enviando: "Enviándose",
      aceptado: "Aceptado",
      aceptado_con_errores: "Aceptado con errores",
      rechazado: "Rechazado",
      detenido: "Detenido",
      retenido: "Apartado",
    } as Readonly<Record<string, string>>,
    notFiled: "Sin estado de envío",
    yes: "Sí",
    no: "No",
    sinceCopyIntro:
      "Todo lo que este servidor registró desde el {time}, 10 minutos antes de la última venta o pedido de la copia con la que empezó el nuevo servidor principal. Algunas filas pueden estar también en el nuevo servidor principal. Los pedidos anteriores solo se listan si se cobraron, se recogieron o se envió o sirvió una línea desde entonces; no se listan otros cambios hechos en filas anteriores.",
    sinceOwnIntro:
      "Todo lo que este servidor registró desde el {time}, 7 días antes de su propia última venta o pedido. A este servidor no se le ha indicado la hora de la última venta o pedido de la copia con la que empezó el nuevo servidor principal, y no se lista nada anterior. Algunas filas pueden estar también en el nuevo servidor principal. Los pedidos anteriores solo se listan si se cobraron, se recogieron o se envió o sirvió una línea desde entonces; no se listan otros cambios hechos en filas anteriores.",
    sinceAllIntro:
      "Todo lo que este servidor registró. Algunas filas pueden estar también en el nuevo servidor principal.",
    paymentsCopyIntro:
      "Todos los pagos y movimientos de caja que este servidor registró desde el {time}, 10 minutos antes de la última venta o pedido de la copia con la que empezó el nuevo servidor principal, y cada pago o devolución anterior cuyo estado cambió desde entonces. Algunas filas pueden estar también en el nuevo servidor principal.",
    paymentsOwnIntro:
      "Todos los pagos y movimientos de caja que este servidor registró desde el {time}, 7 días antes de su propia última venta o pedido, y cada pago o devolución anterior cuyo estado cambió desde entonces. A este servidor no se le ha indicado la hora de la última venta o pedido de la copia con la que empezó el nuevo servidor principal. Algunas filas pueden estar también en el nuevo servidor principal.",
    ordersSheet: "Pedidos",
    orderColumns: [
      "Número de pedido",
      "Etiqueta del pedido",
      "Estado del pedido",
      "Abierto el",
      "Cobrado el",
      "Recogido el",
      "Línea",
      "Artículo",
      "Cantidad",
      "Precio unitario",
      "Total de la línea",
      "Enviado el",
      "Servido el",
    ],
    orderStatuses: {
      open: "Abierto",
      placed: "Realizado",
      settled: "Cobrado",
      abandoned: "Abandonado",
    } satisfies Record<OrderStatus, string>,
    paymentsSheet: "Pagos y caja",
    paymentColumns: [
      "Tipo",
      "Registrado el",
      "Último cambio el",
      "Importe",
      "Propina",
      "Forma de pago",
      "Estado",
      "Número de pedido",
      "Proveedor",
      "Referencia del proveedor",
      "Referencia de la devolución del proveedor",
      "Pago de la cuenta",
      "Devolución",
      "Persona",
      "Id",
    ],
    paymentKinds: {
      part: "Pago",
      card: "Pago con tarjeta",
      refund: "Devolución",
      cardRefund: "Devolución con tarjeta",
      drawer: "Cajón",
    },
    refundStates: {
      pending: "Pendiente",
      completed: "Completada",
      failed: "Fallida",
    } satisfies Record<RefundState, string>,
    cardRefundStates: { succeeded: "Completada", failed: "Fallida" } satisfies Record<
      CardRefundState,
      string
    >,
    partPaymentStates: {
      pending: "Pendiente",
      received: "Recibido",
      failed: "Fallido",
      declined: "Rechazado",
    } satisfies Record<PartPaymentState, string>,
    drawerKinds: {
      cash_payment: "Pago en efectivo",
      card_payment: "Pago con tarjeta",
      cash_refund: "Devolución en efectivo",
      cash_in: "Entrada de efectivo",
      cash_out: "Salida de efectivo",
      count: "Recuento",
      recount: "Nuevo recuento",
      finish: "Cierre",
    } satisfies Record<DrawerKind, string>,
    hoursSheet: "Horas de trabajo",
    hoursColumns: [
      "Persona",
      "Tipo de fichaje",
      "Hora del fichaje",
      "Registrado el",
      "Corrige el fichaje",
      "Estado de la corrección",
      "Motivo de la corrección",
      "Id",
    ],
    entryKinds: {
      in: "Entrada",
      out: "Salida",
      break_start: "Inicio de pausa",
      break_end: "Fin de pausa",
      correction: "Corrección",
      confirmation: "Confirmación",
    } satisfies Record<EntryKind, string>,
    correctionStatuses: {
      requested: "Solicitado",
      approved: "Aprobado",
      declined: "Rechazado",
      disputed: "En desacuerdo",
    } satisfies Record<CorrectionStatus, string>,
    activitySheet: "Actividad",
    activityColumns: ["Fecha", "Tipo", "Persona", "Tipo de elemento", "Elemento"],
  },
} as const;
