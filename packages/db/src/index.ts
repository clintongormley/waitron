import { fileURLToPath } from "node:url";

// The public surface of @waitron/db. Re-exports only — no logic here.
export { createPgliteDb, createPostgresDb } from "./client.js";
export type { Database, Driver, Schema, Transaction } from "./client.js";
export { runMigrations } from "./migrate.js";
export type { MigrationOptions } from "./migrate.js";
export * from "./schema/tenants.js";
export { invoiceSeries } from "./schema/series.js";
export { workingOrderLines, workingOrders, workingOrderStatus } from "./schema/orders.js";
export { fiscalState, saleLines, sales, tenderMethod, tenders } from "./schema/sales.js";
export { saleVoids } from "./schema/sale-voids.js";
export { incidents } from "./schema/incidents.js";
export type { IncidentSeverity } from "./schema/incidents.js";
export { allocateInvoiceNumber } from "./allocate-number.js";
export { withTenant } from "./tenancy.js";
export { isUniqueViolation } from "./unique-violation.js";

/**
 * This package's own migration set, in the same descriptor shape as
 * `packages/fiscal-verifactu`'s `FISCAL_MIGRATIONS` (Task 12). A module package composes its own
 * migrations with core's by running both descriptors, in order, against one database — ordering
 * is the RUNTIME's responsibility, never Drizzle's, so both halves of that composition are handed
 * out as plain data rather than as a function that would silently decide the order itself.
 *
 * `migrationsTable` matches `drizzle.config.ts`'s own `migrations.table` and
 * `src/testing/harness.ts`'s private `CORE_MIGRATIONS` — `__drizzle_migrations_db`, not Drizzle's
 * bare default of `__drizzle_migrations`, which this package deliberately avoids so that a
 * consumer never confuses "the journal Drizzle would use if you forgot the option" with "the
 * journal this package actually uses".
 */
export const CORE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_db",
} as const;

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
