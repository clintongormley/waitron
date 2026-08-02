import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // One config produces exactly one migration folder — this package's first, for `convenio_config`.
  // Same reasoning as packages/workforce/drizzle.config.ts.
  out: "./drizzle",
  // Pointed at the schema entrypoint, NOT a glob: drizzle-kit builds its snapshot from the values
  // this module exports, so the explicit export list IS the snapshot's table list.
  schema: "./src/schema/index.ts",
  // Its own journal table, so this Spain lane stays migration-isolated from the workforce and fiscal
  // sequences — journals never collide, so the lanes run in parallel with no shared bookkeeping.
  migrations: { table: "__drizzle_migrations_workforce_es", schema: "public" },
});
