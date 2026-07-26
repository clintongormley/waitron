import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // One config produces exactly one migration folder, which is why this package needs its own
  // rather than an entry in core's. Same reasoning as packages/scheduler/drizzle.config.ts.
  out: "./drizzle",
  // Pointed at the entrypoint, NOT a `src/schema/*.ts` glob: drizzle-kit builds its snapshot from
  // the values this module exports, so the explicit export list IS the snapshot's table list.
  schema: "./src/schema/index.ts",
  // Its own journal table. Sharing core's would make each package's `generate` see the other's
  // applied migrations as unknown and silently re-apply its own from zero.
  migrations: { table: "__drizzle_migrations_credentials", schema: "public" },
});
