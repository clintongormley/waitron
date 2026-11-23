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
  },
} as const;
