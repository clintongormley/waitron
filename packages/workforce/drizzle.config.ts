import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  // Pointed at the entrypoint, NOT a `src/schema/*.ts` glob: drizzle-kit builds its snapshot from
  // the values this module exports, so the explicit export list IS the snapshot's table list.
  schema: "./src/schema/index.ts",
  migrations: { table: "__drizzle_migrations_workforce" },
});
