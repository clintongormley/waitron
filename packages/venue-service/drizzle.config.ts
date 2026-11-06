import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "../db/src/schema/venue-service/index.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_venue_service" },
});
