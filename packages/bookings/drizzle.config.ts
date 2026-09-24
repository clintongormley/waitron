import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  // One file, not a directory glob: see @waitron/db's drizzle.config.ts.
  schema: "./src/schema/bookings.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_bookings" },
});
