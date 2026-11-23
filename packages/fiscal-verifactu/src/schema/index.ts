// drizzle-kit emits a CREATE TABLE for every table exported here, so names are listed explicitly —
// never `export *`, and never a core table (a duplicate CREATE TABLE would fail against a database
// core already created). `schema-ownership.test.ts` enforces it.
export { acks } from "./acks.js";
export { verifactuHistory } from "./verifactu-history.js";
export { declaracionesResponsables } from "./declarations.js";
export { fiscalConflictEvidence } from "./conflict-evidence.js";
export { fiscalLookupConflicts } from "./lookup-conflicts.js";
export { verifactuCertificates } from "./verifactu-certificates.js";
export { fiscalCertificateReminders } from "./certificate-reminders.js";
export { verifactuSendingState } from "./verifactu-sending-state.js";
export { verifactuSubmissions } from "./verifactu-submissions.js";
export { filingCaseEvents, filingCases } from "./filing-cases.js";
export { verifactuRecords } from "./verifactu-records.js";
export { verifactuIdentities } from "./verifactu-identities.js";

export { fiscalAllocations } from "./allocations.js";
export { fiscalReservations } from "./reservations.js";

export { verifactuSeriesConflicts } from "./verifactu-series-conflicts.js";

export { returnedInvoiceRecords } from "./returned-invoices.js";
