import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { useBuiltServer } from "./built-server.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(packageRoot, "dist");

function distState(): string[] {
  if (!existsSync(dist)) return [];
  return readdirSync(dist, { recursive: true, encoding: "utf8" })
    .sort()
    .map((name) => `${name} ${statSync(join(dist, name)).mtimeMs}`);
}

let distBefore: string[];
beforeAll(() => {
  distBefore = distState();
});

let usedDirectory = "";

describe("useBuiltServer", () => {
  const builtServer = useBuiltServer();
  const otherBuiltServer = useBuiltServer();

  it("builds server.js and copies beside it the files the bundle reads at load", () => {
    const directory = dirname(builtServer());
    usedDirectory = directory;
    expect(builtServer()).toBe(join(directory, "server.js"));
    expect(statSync(builtServer()).size).toBeGreaterThan(0);
    for (const file of [
      "assets/invoice-noto-sans.ttf",
      "node_modules/@waitron/ui-core/src/tokens/colors.css",
      "node_modules/@waitron/ui-core/src/tokens/structure.css",
      "drizzle",
      "guide",
      "package.json",
    ]) {
      expect(existsSync(join(directory, file)), file).toBe(true);
    }
  });

  it("puts each caller's bundle in its own directory, outside dist, where sharp resolves", () => {
    expect(dirname(builtServer())).not.toBe(dirname(otherBuiltServer()));
    const fromPackage = relative(packageRoot, builtServer());
    expect(fromPackage.split(sep).slice(0, 2)).toEqual(["node_modules", ".cache"]);
    expect(() => createRequire(builtServer()).resolve("sharp")).not.toThrow();
  });

  it("leaves apps/server/dist unwritten", () => {
    expect(distState()).toEqual(distBefore);
  });
});

it("removes the directory once its suite has finished", () => {
  expect(usedDirectory).not.toBe("");
  expect(existsSync(usedDirectory)).toBe(false);
});
