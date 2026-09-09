import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/service.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_venue_service", schema: "public" },
});
