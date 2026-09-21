import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/images.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_media" },
});
