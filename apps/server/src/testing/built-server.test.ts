import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

  it("builds server.js and copies beside it what copy-migrations.mjs writes", () => {
    const directory = dirname(builtServer());
    usedDirectory = directory;
    expect(builtServer()).toBe(join(directory, "server.js"));
    expect(statSync(builtServer()).size).toBeGreaterThan(0);
    for (const file of [
      "assets/invoice-noto-sans.ttf",
      "node_modules/@waitron/ui-core/package.json",
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

describe("useBuiltServer with named entries", () => {
  const provisioning = "../../packages/provisioning/src/bin.ts";
  const built = useBuiltServer(["src/bin.ts", provisioning]);

  it("bundles each named entry in the one directory, under its own file name", () => {
    expect(dirname(built("src/bin.ts"))).toBe(dirname(built(provisioning)));
    expect(built("src/bin.ts")).not.toBe(built(provisioning));
    const server = readFileSync(built("src/bin.ts"), "utf8");
    const command = readFileSync(built(provisioning), "utf8");
    expect(server).toContain('nameVenueHolder("server"');
    expect(server).not.toContain("writeModuleConfigTo(");
    expect(command).toContain("writeModuleConfigTo(");
    expect(command).not.toContain('nameVenueHolder("server"');
  });

  it("refuses an entry it was not asked to bundle", () => {
    expect(() => built("src/node-entry.ts")).toThrow("src/node-entry.ts");
  });
});

it("removes the directory once its suite has finished", () => {
  expect(usedDirectory).not.toBe("");
  expect(existsSync(usedDirectory)).toBe(false);
});
