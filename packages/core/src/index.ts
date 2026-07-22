// The entire public surface of @waitron/core. Re-exports only — no logic here.
export { formatInvoiceNumber, recordSale } from "./record-sale.js";
export type { RecordSaleInput, RecordSaleLine, RecordSaleTender } from "./record-sale.js";
export { recordVoid } from "./record-void.js";
export { openIncidents, recordIncident, recordIncidentOnce } from "./incidents.js";
export type { Incident, IncidentSeverity, RecordIncidentInput } from "./incidents.js";
