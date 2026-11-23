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
    recordColumns: [
      "Chain",
      "Record number",
      "Record type",
      "Record created at (UTC)",
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
      "Everything this box recorded from {time}, 10 minutes before the last sale or order in the copy the new main box started from. Some rows may also be on the new main box, and changes made to older rows are not listed.",
    sinceOwnIntro:
      "Everything this box recorded from {time}, 7 days before its own last sale or order. This box has not been told when the copy the new main box started from was taken, and anything earlier is not listed. Some rows may also be on the new main box, and changes made to older rows are not listed.",
    sinceAllIntro: "Everything this box recorded. Some rows may also be on the new main box.",
    activitySheet: "Activity",
    activityColumns: ["At (UTC)", "Kind", "Person", "Subject kind", "Subject"],
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
    recordColumns: [
      "Cadena",
      "Número de registro",
      "Tipo de registro",
      "Registro creado el (UTC)",
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
      "Todo lo que este servidor registró desde el {time}, 10 minutos antes de la última venta o pedido de la copia con la que empezó el nuevo servidor principal. Algunas filas pueden estar también en el nuevo servidor principal, y no se listan los cambios hechos en filas anteriores.",
    sinceOwnIntro:
      "Todo lo que este servidor registró desde el {time}, 7 días antes de su propia última venta o pedido. A este servidor no se le ha indicado cuándo se hizo la copia con la que empezó el nuevo servidor principal, y no se lista nada anterior. Algunas filas pueden estar también en el nuevo servidor principal, y no se listan los cambios hechos en filas anteriores.",
    sinceAllIntro:
      "Todo lo que este servidor registró. Algunas filas pueden estar también en el nuevo servidor principal.",
    activitySheet: "Actividad",
    activityColumns: ["Fecha (UTC)", "Tipo", "Persona", "Tipo de elemento", "Elemento"],
  },
} as const;
