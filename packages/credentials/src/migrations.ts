import { fileURLToPath } from "node:url";

/**
 * This package's migration set, as data: ordering across sets is the caller's to state. The code
 * needs core's tables present: `credentialProvisioned` reads `tenants`, and every `withTransaction`
 * drains `change_log` (`packages/db/src/tenancy.ts`).
 */
export const CREDENTIALS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_credentials",
} as const;
