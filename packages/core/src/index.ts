// The entire public surface of @waitron/core. Re-exports only — no logic here.
export { formatInvoiceNumber, recordSale } from "./record-sale.js";
export type { RecordSaleInput, RecordSaleLine, RecordSaleTender } from "./record-sale.js";
export { settleSale } from "./settle-sale.js";
export type { SettleSaleInput } from "./settle-sale.js";
export { recordVoid } from "./record-void.js";
export { recordCorrection } from "./record-correction.js";
export type { RecordCorrectionInput } from "./record-correction.js";
export { recordSubstitution } from "./record-substitution.js";
export type { RecordSubstitutionInput } from "./record-substitution.js";
export { listOutstandingSales } from "./list-outstanding-sales.js";
export type { OutstandingSale } from "./list-outstanding-sales.js";
export { openIncidents, recordIncident, recordIncidentOnce } from "./incidents.js";
export type { Incident, IncidentSeverity, RecordIncidentInput } from "./incidents.js";
