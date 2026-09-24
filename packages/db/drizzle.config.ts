import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  // The barrel file, not a directory glob. drizzle-kit's own glob is not
  // test-aware: it picks up a co-located `*.test.ts` and `require()`s it as if
  // it were schema source, which fails outright because vitest is ESM-only
  // and refuses to load under drizzle-kit's CJS loader.
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_db" },
});
