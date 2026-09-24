import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  // This module owns no tables — the "no fiscal regime" slot. The migration set is deliberately
  // empty (drizzle/meta/_journal.json has zero entries), and regenerating it produces nothing, which
  // scripts/migrations-match-schema.test.ts checks.
  out: "./drizzle",
  schema: "./src/index.ts",
  // Its own journal table: drizzle runs only migrations newer than the table's latest
  // `created_at`, so on a shared table this set's migrations older than another set's newest
  // would never run.
  migrations: { table: "__drizzle_migrations_fiscal_none" },
});
