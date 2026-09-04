import { AppError } from "@waitron/shared";
import type { WaitronModule } from "./module.js";
import "./errors.js";

/**
 * The desired module set, parsed from the on-box modules.json. A SPARSE OVERRIDE map: a module is
 * enabled unless it appears here with `false` (default-on, spec §2). `core` never appears false
 * (the parser refuses it). Absent file → an empty map → everything enabled.
 */
export interface ModuleConfig {
  readonly overrides: ReadonlyMap<string, boolean>;
}

const CORE = "core";

/**
 * Parse and validate raw modules.json content. `known` is the set of valid module names (the
 * composition root passes ALL_MODULES' names) so this pure parser needs no import of the module list.
 * Validates rather than trusts — the file is operator-editable (CLAUDE.md §3).
 */
export function parseModuleConfig(raw: unknown, known: readonly string[]): ModuleConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("module.config_invalid", { reason: "not an object" });
  }
  const modules = (raw as Record<string, unknown>).modules;
  if (modules === undefined) return { overrides: new Map() };
  if (modules === null || typeof modules !== "object" || Array.isArray(modules)) {
    throw new AppError("module.config_invalid", { reason: "`modules` is not an object" });
  }
  const knownSet = new Set(known);
  const overrides = new Map<string, boolean>();
  for (const [name, value] of Object.entries(modules as Record<string, unknown>)) {
    if (typeof value !== "boolean") {
      throw new AppError("module.config_invalid", {
        reason: `\`modules.${name}\` is not a boolean`,
      });
    }
    if (!knownSet.has(name)) {
      throw new AppError("module.config_unknown", { module: name });
    }
    if (name === CORE && value === false) {
      throw new AppError("module.core_not_disableable", {});
    }
    overrides.set(name, value);
  }
  return { overrides };
}

/** Whether a module is enabled — default-on: only an explicit `false` disables it. */
export function isEnabled(config: ModuleConfig, name: string): boolean {
  return config.overrides.get(name) ?? true;
}

/** The enabled subset, in the input list's order (the migration order, SP-1a §4). */
export function enabledModules(
  modules: readonly WaitronModule[],
  config: ModuleConfig,
): WaitronModule[] {
  return modules.filter((m) => isEnabled(config, m.name));
}

/**
 * The `provision-only` modules that are disabled. Generic — it names no module, it iterates the
 * `tier`, so this stays free of the token "fiscal". The composition root refuses venue provisioning
 * when this is non-empty (spec §4): a provision-only module mints unrecoverable state at provision.
 */
export function disabledProvisionOnly(
  modules: readonly WaitronModule[],
  config: ModuleConfig,
): string[] {
  return modules
    .filter((m) => m.tier === "provision-only" && !isEnabled(config, m.name))
    .map((m) => m.name);
}
