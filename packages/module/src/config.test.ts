import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { disabledProvisionOnly, enabledModules, isEnabled, parseModuleConfig } from "./index.js";
import type { WaitronModule } from "./module.js";

const KNOWN = ["core", "fiscal", "payments"];
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

describe("parseModuleConfig", () => {
  it("empty input enables everything (default-on)", () => {
    const c = parseModuleConfig({}, KNOWN);
    expect(isEnabled(c, "payments")).toBe(true);
    expect(isEnabled(c, "fiscal")).toBe(true);
  });
  it("an absent key stays enabled; only explicit false disables", () => {
    const c = parseModuleConfig({ modules: { payments: false } }, KNOWN);
    expect(isEnabled(c, "payments")).toBe(false);
    expect(isEnabled(c, "fiscal")).toBe(true);
  });
  it("rejects a non-object", () => {
    const err = (() => {
      try {
        parseModuleConfig(42, KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects null", () => {
    const err = (() => {
      try {
        parseModuleConfig(null, KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects an array as raw", () => {
    const err = (() => {
      try {
        parseModuleConfig([], KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects `modules` that is not an object", () => {
    const err = (() => {
      try {
        parseModuleConfig({ modules: 42 }, KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects `modules` that is null", () => {
    const err = (() => {
      try {
        parseModuleConfig({ modules: null }, KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects `modules` that is an array", () => {
    const err = (() => {
      try {
        parseModuleConfig({ modules: [] }, KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects a non-boolean value", () => {
    const err = (() => {
      try {
        parseModuleConfig({ modules: { payments: "no" } }, KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("rejects an unknown module name", () => {
    const err = (() => {
      try {
        parseModuleConfig({ modules: { nope: false } }, KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.config_unknown");
  });
  it("rejects core: false", () => {
    const err = (() => {
      try {
        parseModuleConfig({ modules: { core: false } }, KNOWN);
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.core_not_disableable");
  });
  it("accepts core: true", () => {
    const c = parseModuleConfig({ modules: { core: true } }, KNOWN);
    expect(isEnabled(c, "core")).toBe(true);
  });
});

describe("enabledModules / disabledProvisionOnly", () => {
  it("enabledModules drops only explicitly-disabled modules, order preserved", () => {
    const c = parseModuleConfig({ modules: { payments: false } }, KNOWN);
    expect(enabledModules(MODULES, c).map((m) => m.name)).toEqual(["core", "fiscal"]);
  });
  it("disabledProvisionOnly lists a disabled provision-only module and nothing else", () => {
    expect(
      disabledProvisionOnly(MODULES, parseModuleConfig({ modules: { fiscal: false } }, KNOWN)),
    ).toEqual(["fiscal"]);
    expect(
      disabledProvisionOnly(MODULES, parseModuleConfig({ modules: { payments: false } }, KNOWN)),
    ).toEqual([]);
  });
});
