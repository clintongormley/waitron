import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "../workforce/src/schema/staffing/index.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_staffing" },
});
