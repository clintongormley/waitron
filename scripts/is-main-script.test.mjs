import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isMainScript } from "./is-main-script.mjs";

describe("isMainScript", () => {
  let dir;
  let script;
  let moduleUrl;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "waitron-is-main-"));
    mkdirSync(join(dir, "real"));
    script = join(dir, "real", "tool.mjs");
    writeFileSync(script, "");
    writeFileSync(join(dir, "real", "other.mjs"), "");
    moduleUrl = pathToFileURL(script).href;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers true for the script's own path", () => {
    expect(isMainScript(moduleUrl, script)).toBe(true);
  });

  it("answers true for a path through a symlinked directory", () => {
    symlinkSync(join(dir, "real"), join(dir, "link"));
    expect(isMainScript(moduleUrl, join(dir, "link", "tool.mjs"))).toBe(true);
  });

  it("answers true for a symlink to the script file itself", () => {
    symlinkSync(script, join(dir, "tool-link.mjs"));
    expect(isMainScript(moduleUrl, join(dir, "tool-link.mjs"))).toBe(true);
  });

  it("answers false for another file", () => {
    expect(isMainScript(moduleUrl, join(dir, "real", "other.mjs"))).toBe(false);
  });

  it("answers false when there is no script path", () => {
    expect(isMainScript(moduleUrl, undefined)).toBe(false);
    expect(isMainScript(moduleUrl, "")).toBe(false);
  });

  it("answers false for a path that does not exist", () => {
    expect(isMainScript(moduleUrl, join(dir, "real", "missing.mjs"))).toBe(false);
  });

  it("reads process.argv[1] when no path is given", () => {
    const originalArgv1 = process.argv[1];
    try {
      process.argv[1] = script;
      expect(isMainScript(moduleUrl)).toBe(true);
    } finally {
      process.argv[1] = originalArgv1;
    }
  });
});
