import { AppError } from "@waitron/shared";
import type { WaitronModule } from "./module.js";
import "./errors.js";

/**
 * The desired module set, parsed from the on-box modules.json. A SPARSE OVERRIDE map: a module is
 * enabled unless it appears here with `false` (default-on, spec §2). A `mandatory`-tier module (core)
 * never appears false (the parser refuses it). Absent file → an empty map → everything enabled.
 */
export interface ModuleConfig {
  readonly overrides: ReadonlyMap<string, boolean>;
}

/**
 * Parse and validate raw modules.json content. `modules` is the known module set (the composition
 * root passes ALL_MODULES); the parser reads each descriptor's `name` (to reject an unknown key) and
 * `tier` (to refuse disabling a `mandatory` module) — the same tier-driven, module-name-free approach
 * `disabledProvisionOnly` uses, so this generic package never hardcodes a module name. Validates
 * rather than trusts — the file is operator-editable (CLAUDE.md §3).
 */
export function parseModuleConfig(raw: unknown, modules: readonly WaitronModule[]): ModuleConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("module.config_invalid", { reason: "not an object" });
  }
  const entries = (raw as Record<string, unknown>).modules;
  if (entries === undefined) return { overrides: new Map() };
  if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
    throw new AppError("module.config_invalid", { reason: "`modules` is not an object" });
  }
  const byName = new Map(modules.map((m) => [m.name, m]));
  const overrides = new Map<string, boolean>();
  for (const [name, value] of Object.entries(entries as Record<string, unknown>)) {
    if (typeof value !== "boolean") {
      throw new AppError("module.config_invalid", {
        reason: `\`modules.${name}\` is not a boolean`,
      });
    }
    const module = byName.get(name);
    if (module === undefined) {
      throw new AppError("module.config_unknown", { module: name });
    }
    if (module.tier === "mandatory" && value === false) {
      throw new AppError("module.mandatory_not_disableable", { module: name });
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
 * Serialize a ModuleConfig back to the sparse override object (the modules.json inner map). The
 * inverse of parseModuleConfig: parseModuleConfig({ modules: serializeModuleConfig(c) }, M) yields
 * the same enabled set as c for every module in M. Generic — no module name, no vocabulary.
 */
export function serializeModuleConfig(config: ModuleConfig): Record<string, boolean> {
  return Object.fromEntries(config.overrides);
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
