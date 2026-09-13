import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_catalogue", schema: "public" },
});
