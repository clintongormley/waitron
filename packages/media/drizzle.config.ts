import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "../db/src/schema/media/index.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_media" },
});
