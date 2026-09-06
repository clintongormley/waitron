import type { WaitronModule } from "../module.js";

/**
 * A minimal descriptor for tests: only the seats you pass are set.
 *
 * Deep-imported (`@waitron/module/src/testing/fake-module.js`), never re-exported from the barrel —
 * the same convention `packages/fiscal/src/testing/fake-backend.ts` follows, so a test double cannot
 * reach production code through the package's public surface.
 */
export function fakeModule(
  name: string,
  seats: Partial<Pick<WaitronModule, "provisioning" | "fiscal" | "sync" | "vocabulary">> = {},
): WaitronModule {
  return {
    name,
    version: "0.0.0",
    tier: "toggleable",
    migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
    ...seats,
  };
}
