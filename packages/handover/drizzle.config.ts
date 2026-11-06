import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  // The entrypoint, not a glob: drizzle-kit builds its snapshot from what this module exports.
  schema: "../db/src/schema/handover/index.ts",
  // Its own journal table: drizzle runs only migrations newer than the table's latest
  // `created_at`, so on a shared table this set's older migrations would never run.
  migrations: { table: "__drizzle_migrations_handover" },
});
