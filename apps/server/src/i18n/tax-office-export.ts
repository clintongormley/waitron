/** The month's export for the tax office: its CSV headings and its README, in the person's language. */
export const TAX_OFFICE_EXPORT_WORDS = {
  en: {
    columns: {
      number: "Invoice number",
      kind: "Type",
      issueDate: "Issue date",
      issueTime: "Issue time",
      operationDate: "Operation date",
      customerName: "Customer",
      customerTaxId: "Customer tax number",
      vatRate: "VAT rate (%)",
      base: "Base (EUR)",
      vat: "VAT (EUR)",
      total: "Invoice total (EUR)",
      corrects: "Corrects or replaces",
      cancelledOn: "Cancelled on",
    },
    readme: (args: { venue: string | null; month: string; timeZone: string; date: string }) =>
      [
        `Invoices issued${args.venue === null ? "" : ` by ${args.venue}`} in ${args.month}, by the venue's calendar (${args.timeZone}).`,
        "",
        "invoices.csv: one row for each VAT rate of each invoice. An invoice's other columns, its total included, repeat on each of its rows. Amounts are in euros. Amounts and VAT rates use a decimal point. The operation date is shown only where it differs from the issue date.",
        "",
        "invoices/: a duplicate copy of each invoice, named by its number. A simplified invoice (ticket) is laid out as its receipt printer prints it, or on A4 when it does not fit on one page; any other invoice is on A4.",
        "",
        "failed.txt, if present: the invoices whose copy could not be made. Their rows are in invoices.csv.",
        "",
        `Prepared on ${args.date}.`,
        "",
      ].join("\r\n"),
    failed: (numbers: readonly string[]) =>
      ["The copy of each of these invoices could not be made:", ...numbers, ""].join("\r\n"),
  },
  es: {
    columns: {
      number: "Número de factura",
      kind: "Tipo",
      issueDate: "Fecha de expedición",
      issueTime: "Hora de expedición",
      operationDate: "Fecha de operación",
      customerName: "Cliente",
      customerTaxId: "NIF del cliente",
      vatRate: "Tipo de IVA (%)",
      base: "Base imponible (EUR)",
      vat: "Cuota de IVA (EUR)",
      total: "Total de la factura (EUR)",
      corrects: "Rectifica o sustituye",
      cancelledOn: "Anulada el",
    },
    readme: (args: { venue: string | null; month: string; timeZone: string; date: string }) =>
      [
        `Facturas expedidas${args.venue === null ? "" : ` por ${args.venue}`} en ${args.month}, según el calendario del local (${args.timeZone}).`,
        "",
        "invoices.csv: una fila por cada tipo de IVA de cada factura. Las demás columnas de una factura, su total incluido, se repiten en cada una de sus filas. Los importes están en euros. Los importes y los tipos de IVA llevan coma decimal. La fecha de operación solo aparece cuando es distinta de la de expedición.",
        "",
        "invoices/: un duplicado de cada factura, con su número como nombre. Una factura simplificada (ticket) aparece como la imprime su impresora de tickets, o en A4 cuando no cabe en una página; las demás, en A4.",
        "",
        "failed.txt, si existe: las facturas cuya copia no se pudo hacer. Sus filas están en invoices.csv.",
        "",
        `Preparado el ${args.date}.`,
        "",
      ].join("\r\n"),
    failed: (numbers: readonly string[]) =>
      ["No se pudo hacer la copia de estas facturas:", ...numbers, ""].join("\r\n"),
  },
} as const;
