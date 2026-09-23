import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  // This module owns no tables — the "no fiscal regime" slot. The migration set is deliberately
  // empty (drizzle/meta/_journal.json has zero entries), and regenerating it produces nothing, which
  // scripts/migrations-match-schema.test.ts checks.
  out: "./drizzle",
  schema: "./src/index.ts",
  // Its own journal table, so the no-regime lane stays migration-isolated from every other sequence:
  // journals never collide, so the lanes run in parallel with no shared bookkeeping.
  migrations: { table: "__drizzle_migrations_fiscal_none" },
});
