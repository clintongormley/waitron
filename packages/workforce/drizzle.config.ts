import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  // Pointed at the entrypoint, NOT a `src/schema/*.ts` glob: drizzle-kit builds its snapshot from
  // the values this module exports, so the explicit export list IS the snapshot's table list.
  schema: "./src/schema/index.ts",
  // Its own journal table: drizzle runs only migrations newer than the table's latest
  // `created_at`, so on a shared table this set's migrations older than another set's newest
  // would never run.
  migrations: { table: "__drizzle_migrations_workforce" },
});
