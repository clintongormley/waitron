import type { WaitronModule } from "../module.js";

/**
 * A minimal descriptor for tests: only the seats you pass are set. Deep-imported, never re-exported
 * from the barrel, so a test double cannot reach production code through the public surface.
 */
export function fakeModule(
  name: string,
  seats: Partial<Pick<WaitronModule, "provisioning" | "fiscal" | "vocabulary" | "operations">> = {},
): WaitronModule {
  return {
    name,
    version: "0.0.0",
    tier: "toggleable",
    migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
    ...seats,
  };
}

/** {@link fakeModule} for a module whose tables live in `tablesIn`'s set: no set or classification of its own. */
export function fakeSetlessModule(
  name: string,
  tablesIn: string,
  seats: Partial<
    Pick<WaitronModule, "version" | "requires" | "configurationTransfer" | "tableRemoval">
  > = {},
): WaitronModule {
  return { name, version: "0.0.0", tier: "toggleable", tablesIn, ...seats };
}
