import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/service.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_venue_service" },
});
