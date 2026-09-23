import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/schema/index.ts",
  migrations: { table: "__drizzle_migrations_identity" },
});
