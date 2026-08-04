import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/schema/index.ts",
  migrations: { table: "__drizzle_migrations_identity", schema: "public" },
});
