// The public surface of @waitron/db. Re-exports only — no logic here.
export { createPgliteDb, createPostgresDb } from "./client.js";
export type { Database, Driver, Schema, Transaction } from "./client.js";
export { runMigrations } from "./migrate.js";
export type { MigrationOptions } from "./migrate.js";
export * from "./schema/tenants.js";
export { nodes } from "./schema/nodes.js";
export { invoiceSeries } from "./schema/series.js";
export { workingOrderLines, workingOrders, workingOrderStatus } from "./schema/orders.js";
export { orderAmendmentKind, orderAmendments } from "./schema/order-amendments.js";
export { appendOrderAmendment } from "./append-order-amendment.js";
export type { AppendAmendmentInput } from "./append-order-amendment.js";
export { computeAmendmentHash, verifyAmendmentChain } from "./order-amendment-hash.js";
export type {
  AmendmentHashInput,
  AmendmentVerification,
  VerifiableAmendment,
} from "./order-amendment-hash.js";
export { orderPrep, prepState } from "./schema/order-prep.js";
export { diningTables } from "./schema/dining-tables.js";
export { catalogues, categories, products } from "./schema/catalogue.js";
export { ingredients, recipeLines } from "./schema/recipes.js";
export {
  purchaseInvoiceVat,
  purchaseInvoices,
  purchaseRegime,
  purchaseVatKind,
} from "./schema/purchase-invoices.js";
export { tillLayouts } from "./schema/layouts.js";
export { tableServiceStatuses } from "./schema/table-service-statuses.js";
export { workingOrderCounters } from "./schema/working-order-counters.js";
export {
  fiscalState,
  saleLines,
  sales,
  saleSettlements,
  saleSubstitutions,
  tenderMethod,
  tenders,
} from "./schema/sales.js";
export { saleVoids } from "./schema/sale-voids.js";
export { dailyCloseChain, dailyCloses } from "./schema/daily-closes.js";
export type { DailyCloseSnapshot } from "./schema/daily-closes.js";
export { incidents } from "./schema/incidents.js";
export type { IncidentSeverity } from "./schema/incidents.js";
export { readDeploymentEnvironment, stampDeployment } from "./deployment.js";
export type { DeploymentEnvironment } from "./deployment.js";
export * from "./schema/deployment.js";
export { allocateInvoiceNumber } from "./allocate-number.js";
export { allocateOrderNumber } from "./allocate-order-number.js";
export { withTenant, type TenantTxOptions } from "./tenancy.js";
export { isUniqueViolation } from "./unique-violation.js";
export { CORE_MIGRATIONS } from "./migrations.js";

/**
 * Testing infrastructure exported for reuse by a module package's OWN test suite — not test-only
 * dependency-heavy internals like `describeEachTarget` (which pulls in `@testcontainers/postgresql`
 * and would make it a transitive dependency of the production surface for every consumer of this
 * package), but the three small, dependency-light primitives every immutability suite in this
 * repo is built from. `packages/fiscal-verifactu`'s `inmutabilidad.test.ts` (Task 12) is the first
 * consumer outside this package: it reproduces `immutability.test.ts`'s pattern against its own
 * module-owned table and needs the same non-owner-role switch and the same wrapped-driver-error
 * readers this package's own suite uses.
 */
export { asAppUser } from "./testing/roles.js";
export { captureError, pgErrorCode, pgErrorMessage } from "./testing/errors.js";

// english-only.ts's GENERIC_PACKAGES/EXEMPT_PACKAGES/findSpanish/sourceFilesIn are deliberately
// NOT re-exported here, despite costing nothing at runtime in isolation. `english-only.ts`
// computes `PACKAGES_ROOT` from `import.meta.dirname` at MODULE LOAD TIME (a top-level const,
// not inside a function), and `drizzle-kit generate` loads this barrel transitively — any
// downstream package whose Drizzle schema imports a core table from `@waitron/db` (every module
// package does) pulls this file in through `drizzle-kit`'s own CJS-transformed loader, where
// `import.meta.dirname` is `undefined` and the top-level `join(undefined, "..", "..")` throws
// immediately, breaking `drizzle-kit generate` for that package. Verified live: adding this
// export broke `pnpm --filter @waitron/fiscal-verifactu exec drizzle-kit generate` outright.
// `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` reads english-only.ts's source text
// directly instead — the same "prove it by inspecting source, not by importing it" shape
// `packages/fiscal/src/no-regime-vocabulary.test.ts` already uses for the analogous problem.
