import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { resolve } from "path";

// Only load .env if DATABASE_URL is not already set (e.g. in CI it's already in the environment)
if (!process.env.DATABASE_URL) {
  config({ path: resolve(__dirname, "../../.env") });
}

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
