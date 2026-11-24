/** The invoice notice the help guide describes (`guide/<language>/data-protection.md#invoice-notice`). */
export interface InvoiceEmailNoticeWords {
  readonly purpose: string;
  /** `purpose` for a sale with a filed tax record, which the box sends to the tax authority. */
  readonly purposeWithRecord: string;
  readonly addressSearch: string;
  readonly contact: string;
}

export const INVOICE_EMAIL_NOTICE_WORDS: Record<"en" | "es", InvoiceEmailNoticeWords> = {
  en: {
    purpose:
      "Data protection. {venue} uses your name, tax number and address to issue this invoice and meet its tax duties.",
    purposeWithRecord:
      "Data protection. {venue} uses your name, tax number and address to issue this invoice and meet its tax duties, including sending the Tax Agency a record of it with your name and tax number.",
    addressSearch:
      "If staff searched for your address, Waitron Cloud sent the search text and the selected suggestion to Google Maps.",
    contact: "Your rights and more information: {contacts}",
  },
  es: {
    purpose:
      "Protección de datos. {venue} trata su nombre, NIF y dirección para emitir esta factura y cumplir sus obligaciones fiscales.",
    purposeWithRecord:
      "Protección de datos. {venue} trata su nombre, NIF y dirección para emitir esta factura y cumplir sus obligaciones fiscales, incluida la remisión a la Agencia Tributaria de un registro de la factura con su nombre y su NIF.",
    addressSearch:
      "Si el personal buscó su dirección, Waitron Cloud envió el texto de la búsqueda y la sugerencia seleccionada a Google Maps.",
    contact: "Derechos y más información: {contacts}",
  },
};
