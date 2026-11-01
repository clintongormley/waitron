import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  // The entrypoint, not a glob: drizzle-kit builds its snapshot from this module's exports.
  schema: "./src/schema/index.ts",
  // Its own journal table: drizzle runs only migrations newer than the table's latest
  // `created_at`, so a shared table would skip this set's older migrations.
  migrations: { table: "__drizzle_migrations_node" },
});
