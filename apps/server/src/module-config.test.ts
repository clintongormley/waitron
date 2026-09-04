import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { isEnabled } from "@waitron/module";
import { readModuleConfig } from "./module-config.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waitron-modcfg-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readModuleConfig", () => {
  it("absent file → everything enabled", async () => {
    const c = await readModuleConfig(dir);
    expect(isEnabled(c, "fiscal")).toBe(true);
    expect(isEnabled(c, "payments")).toBe(true);
  });
  it("reads and validates a present file", async () => {
    writeFileSync(join(dir, "modules.json"), JSON.stringify({ modules: { payments: false } }));
    const c = await readModuleConfig(dir);
    expect(isEnabled(c, "payments")).toBe(false);
  });
  it("a malformed (non-JSON) file throws module.config_invalid, not a bare SyntaxError", async () => {
    writeFileSync(join(dir, "modules.json"), "{ not json");
    const err = await readModuleConfig(dir).catch((e) => e);
    expect(isAppError(err) && err.code).toBe("module.config_invalid");
  });
  it("an unknown module name in the file throws module.config_unknown", async () => {
    writeFileSync(join(dir, "modules.json"), JSON.stringify({ modules: { nope: false } }));
    const err = await readModuleConfig(dir).catch((e) => e);
    expect(isAppError(err) && err.code).toBe("module.config_unknown");
  });
  it("rethrows a non-ENOENT read error (e.g. modules.json is a directory)", async () => {
    mkdirSync(join(dir, "modules.json"));
    const err = await readModuleConfig(dir).catch((e) => e);
    // Not an AppError: a non-ENOENT read failure is rethrown unclassified (EISDIR here).
    expect(isAppError(err)).toBe(false);
    expect((err as NodeJS.ErrnoException).code).toBe("EISDIR");
  });
});
