import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  disabledProvisionOnly,
  enabledModules,
  isEnabled,
  parseModuleConfig,
  serializeModuleConfig,
} from "./index.js";
import type { WaitronModule } from "./module.js";

const mod = (name: string, tier: WaitronModule["tier"]): WaitronModule => ({
  name,
  version: "0.0.0",
  tier,
  migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
});
const MODULES = [
  mod("core", "mandatory"),
  mod("fiscal", "provision-only"),
  mod("payments", "toggleable"),
];

/** The AppError code `fn` throws, or `false` if it did not throw one — so a case that fails to throw
 * fails the `.toBe(<code>)` assertion rather than passing vacuously. */
function thrownCode(fn: () => unknown): string | false {
  try {
    fn();
  } catch (e) {
    return isAppError(e) && e.code;
  }
  return false;
}

describe("parseModuleConfig", () => {
  it("empty input enables everything (default-on)", () => {
    const c = parseModuleConfig({}, MODULES);
    expect(isEnabled(c, "payments")).toBe(true);
    expect(isEnabled(c, "fiscal")).toBe(true);
  });
  it("an absent key stays enabled; only explicit false disables", () => {
    const c = parseModuleConfig({ modules: { payments: false } }, MODULES);
    expect(isEnabled(c, "payments")).toBe(false);
    expect(isEnabled(c, "fiscal")).toBe(true);
  });
  it("rejects a non-object", () => {
    expect(thrownCode(() => parseModuleConfig(42, MODULES))).toBe("module.config_invalid");
  });
  it("rejects null", () => {
    expect(thrownCode(() => parseModuleConfig(null, MODULES))).toBe("module.config_invalid");
  });
  it("rejects an array as raw", () => {
    expect(thrownCode(() => parseModuleConfig([], MODULES))).toBe("module.config_invalid");
  });
  it("rejects `modules` that is not an object", () => {
    expect(thrownCode(() => parseModuleConfig({ modules: 42 }, MODULES))).toBe(
      "module.config_invalid",
    );
  });
  it("rejects `modules` that is null", () => {
    expect(thrownCode(() => parseModuleConfig({ modules: null }, MODULES))).toBe(
      "module.config_invalid",
    );
  });
  it("rejects `modules` that is an array", () => {
    expect(thrownCode(() => parseModuleConfig({ modules: [] }, MODULES))).toBe(
      "module.config_invalid",
    );
  });
  it("rejects a non-boolean value", () => {
    expect(thrownCode(() => parseModuleConfig({ modules: { payments: "no" } }, MODULES))).toBe(
      "module.config_invalid",
    );
  });
  it("rejects an unknown module name", () => {
    expect(thrownCode(() => parseModuleConfig({ modules: { nope: false } }, MODULES))).toBe(
      "module.config_unknown",
    );
  });
  it("rejects disabling a mandatory module (core: false)", () => {
    expect(thrownCode(() => parseModuleConfig({ modules: { core: false } }, MODULES))).toBe(
      "module.mandatory_not_disableable",
    );
  });
  it("accepts core: true", () => {
    const c = parseModuleConfig({ modules: { core: true } }, MODULES);
    expect(isEnabled(c, "core")).toBe(true);
  });
});

describe("serializeModuleConfig", () => {
  it("round-trips parseModuleConfig: same enabled set for every module", () => {
    // A config where the two directions visibly DIFFER: payments disabled, fiscal left default.
    const parsed = parseModuleConfig({ modules: { payments: false } }, MODULES);
    const serialized = serializeModuleConfig(parsed);
    expect(serialized).toEqual({ payments: false });

    const reparsed = parseModuleConfig({ modules: serialized }, MODULES);
    for (const m of MODULES) {
      expect(isEnabled(reparsed, m.name)).toBe(isEnabled(parsed, m.name));
    }
    expect(isEnabled(reparsed, "payments")).toBe(false);
    expect(isEnabled(reparsed, "fiscal")).toBe(true);
  });

  it("serializes an empty config to {}", () => {
    expect(serializeModuleConfig(parseModuleConfig({}, MODULES))).toEqual({});
  });
});

describe("enabledModules / disabledProvisionOnly", () => {
  it("enabledModules drops only explicitly-disabled modules, order preserved", () => {
    const c = parseModuleConfig({ modules: { payments: false } }, MODULES);
    expect(enabledModules(MODULES, c).map((m) => m.name)).toEqual(["core", "fiscal"]);
  });
  it("disabledProvisionOnly lists a disabled provision-only module and nothing else", () => {
    expect(
      disabledProvisionOnly(MODULES, parseModuleConfig({ modules: { fiscal: false } }, MODULES)),
    ).toEqual(["fiscal"]);
    expect(
      disabledProvisionOnly(MODULES, parseModuleConfig({ modules: { payments: false } }, MODULES)),
    ).toEqual([]);
  });
});
