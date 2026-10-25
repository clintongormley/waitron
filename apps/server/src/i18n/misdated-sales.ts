/** The wrongly dated sales download, in the venue's language. `text` for several sales, `one` for
 * one; `{confirmedBy}` is filled from `CLOCK_CONFIRMED_BY_WORDS`. */
export const MISDATED_SALES_WORDS = {
  en: {
    header: {
      text: "{venue}: {count} sales were recorded with a time later than the real one, from {from} to {to}. Each was made before {bound}. The clock was confirmed by {confirmedBy} on {confirmedAt}.",
      one: "{venue}: One sale was recorded with a time later than the real one, at {from}. It was made before {bound}. The clock was confirmed by {confirmedBy} on {confirmedAt}.",
    },
    columns: {
      series: "Series",
      number: "Number",
      invoiceDate: "Invoice date",
      timeRecorded: "Time recorded",
      realTime: "Real time",
      amount: "Amount (EUR)",
      differentDay: "Different day",
    },
    unknown: "Unknown",
    cancellation: "Cancellation",
    differentDay: { yes: "Yes", cannotTell: "Cannot tell", notApplicable: "Not applicable" },
  },
  es: {
    header: {
      text: "{venue}: se registraron {count} ventas con una hora posterior a la real, de {from} a {to}. Cada una se hizo antes del {bound}. La hora del equipo se confirmó con {confirmedBy} el {confirmedAt}.",
      one: "{venue}: se registró una venta con una hora posterior a la real, el {from}. Se hizo antes del {bound}. La hora del equipo se confirmó con {confirmedBy} el {confirmedAt}.",
    },
    columns: {
      series: "Serie",
      number: "Número",
      invoiceDate: "Fecha de factura",
      timeRecorded: "Hora registrada",
      realTime: "Hora real",
      amount: "Importe (EUR)",
      differentDay: "Otro día",
    },
    unknown: "Desconocida",
    cancellation: "Anulación",
    differentDay: { yes: "Sí", cannotTell: "No se sabe", notApplicable: "No aplicable" },
  },
} as const;
