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
  // Unwrap the file envelope and validate the inner map. The envelope shape (`{ modules: … }`) is the
  // on-disk file's; the validation is shared with the bare-map entry point below.
  return parseModuleOverrides((raw as Record<string, unknown>).modules, modules);
}

/**
 * Validate a sparse override MAP directly — the modules.json inner object, or a MirrorBundle's
 * `moduleOverrides` wire value — against the known module set, returning a ModuleConfig. This is the
 * bare-map entry point: unlike `parseModuleConfig` it takes the overrides with NO `{ modules: … }`
 * file envelope, so a non-file caller (adopt, validating a bundle's `moduleOverrides`) needs no
 * fabricated wrapper — and it is the true inverse of `serializeModuleConfig`
 * (`parseModuleOverrides(serializeModuleConfig(c), M)` round-trips). `undefined` (absent overrides) →
 * everything enabled. Validates rather than trusts — the value is operator-editable / bundle-borne
 * external input (CLAUDE.md §3).
 */
export function parseModuleOverrides(
  overrides: unknown,
  modules: readonly WaitronModule[],
): ModuleConfig {
  if (overrides === undefined) return { overrides: new Map() };
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    // Generic wording: this validates the bare override map, reached both from the file envelope
    // (`parseModuleConfig`) and directly from a bundle's `moduleOverrides` (adopt) — so the reason
    // must not name a `modules.` file path the bare-map caller's input does not have.
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

/** The enabled subset, in the input list's order (the migration order, SP-1a §4). */
export function enabledModules(
  modules: readonly WaitronModule[],
  config: ModuleConfig,
): WaitronModule[] {
  return modules.filter((m) => isEnabled(config, m.name));
}

/**
 * Serialize a ModuleConfig back to the sparse override object (the modules.json inner map). The true
 * inverse of `parseModuleOverrides`: `parseModuleOverrides(serializeModuleConfig(c), M)` yields the
 * same enabled set as c for every module in M (the file-envelope form is
 * `parseModuleConfig({ modules: serializeModuleConfig(c) }, M)`). Generic — no module name, no
 * vocabulary.
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
