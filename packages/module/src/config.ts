import { AppError } from "@waitron/shared";
import type { WaitronModule } from "./module.js";
import "./errors.js";

/**
 * The desired module set from modules.json: a SPARSE override map — a module is enabled unless it
 * appears here with `false`. A `mandatory` module never appears `false`.
 */
export interface ModuleConfig {
  readonly overrides: ReadonlyMap<string, boolean>;
}

/** Parse modules.json (`{ modules: … }`); the file is operator-editable, so it is validated. */
export function parseModuleConfig(raw: unknown, modules: readonly WaitronModule[]): ModuleConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("module.config_invalid", { reason: "not an object" });
  }
  return parseModuleOverrides((raw as Record<string, unknown>).modules, modules);
}

/**
 * Validate a bare override map, with no `{ modules: … }` envelope — as a mirror bundle carries it.
 * The inverse of `serializeModuleConfig`. `undefined` enables everything.
 */
export function parseModuleOverrides(
  overrides: unknown,
  modules: readonly WaitronModule[],
): ModuleConfig {
  if (overrides === undefined) return { overrides: new Map() };
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    // The reason names no `modules` file path: a bundle-borne map has none.
    throw new AppError("module.config_invalid", { reason: "module overrides are not an object" });
  }
  const byName = new Map(modules.map((m) => [m.name, m]));
  const result = new Map<string, boolean>();
  for (const [name, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (typeof value !== "boolean") {
      throw new AppError("module.config_invalid", {
        reason: `module override \`${name}\` is not a boolean`,
      });
    }
    const module = byName.get(name);
    if (module === undefined) {
      throw new AppError("module.config_unknown", { module: name });
    }
    if (module.tier === "mandatory" && value === false) {
      throw new AppError("module.mandatory_not_disableable", { module: name });
    }
    result.set(name, value);
  }
  return { overrides: result };
}

/** Whether a module is enabled — default-on: only an explicit `false` disables it. */
export function isEnabled(config: ModuleConfig, name: string): boolean {
  return config.overrides.get(name) ?? true;
}

/** The enabled subset, in the input list's order. */
export function enabledModules(
  modules: readonly WaitronModule[],
  config: ModuleConfig,
): WaitronModule[] {
  return modules.filter((m) => isEnabled(config, m.name));
}

/** The sparse override map (modules.json's inner object); the inverse of `parseModuleOverrides`. */
export function serializeModuleConfig(config: ModuleConfig): Record<string, boolean> {
  return Object.fromEntries(config.overrides);
}

/**
 * The disabled `provision-only` modules, which refuse venue provisioning. Fiscal-slot members are
 * excluded: with two members one is always disabled, and `fiscalSlot`'s exactly-one rule governs them.
 */
export function disabledProvisionOnly(
  modules: readonly WaitronModule[],
  config: ModuleConfig,
): string[] {
  return modules
    .filter(
      (m) => m.tier === "provision-only" && m.fiscal === undefined && !isEnabled(config, m.name),
    )
    .map((m) => m.name);
}
