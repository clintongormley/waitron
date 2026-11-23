export const OLD_BOX_DATA_WORDS = {
  en: {
    invoiceSheet: "Invoices",
    invoiceIntro:
      "Invoice records the new main box did not have when this file was made, {time}. The old main box may still send some of these to it before it is wiped.",
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
      "Registros de facturación que el nuevo servidor principal no tenía cuando se creó este archivo, {time}. Es posible que el antiguo servidor principal aún le envíe algunos antes de borrarse.",
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
