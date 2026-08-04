import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./index.js";

describe("@waitron/identity barrel", () => {
  it("exports the migration descriptor with the identity journal table", () => {
    expect(IDENTITY_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_identity");
  });
});
