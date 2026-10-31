import { fileURLToPath } from "node:url";

/** node.db's migration set. It declares no append-only tables. */
export const NODE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_node",
  database: "node",
} as const;
