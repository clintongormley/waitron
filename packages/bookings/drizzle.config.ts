import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // The module's own schema, not a directory glob (see @waitron/db's drizzle.config.ts for why a
  // glob picks up co-located *.test.ts and fails under drizzle-kit's CJS loader).
  schema: "./src/schema/bookings.ts",
  out: "./drizzle",
  // The module owns its migration set, so it keeps its own journal table — journals never collide,
  // so the module lanes run in parallel with core's `__drizzle_migrations_db`.
  migrations: { table: "__drizzle_migrations_bookings", schema: "public" },
});
