import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuiltRelease } from "@waitron/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDeclarationFolder } from "./declaration-pages.js";
import { checkRelease } from "./release-command.js";
import { TEST_RELEASE, writeDeclarationFolder } from "./testing/declaration-folder.js";
import { TEST_PRODUCER } from "./testing/test-producer.js";

const VERSION = TEST_RELEASE.version;
const STAMPED: BuiltRelease = { bundled: true, version: VERSION };

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "release-command-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function output() {
  const log: string[] = [];
  const error: string[] = [];
  return {
    log,
    error,
    out: { log: (line: string) => log.push(line), error: (line: string) => error.push(line) },
  };
}

async function releaseFolder(
  release: { version: string; releasedOn: string } = TEST_RELEASE,
  declared: string = release.version,
) {
  const dir = join(root, "declaration");
  await writeDeclarationFolder(dir, release, undefined, declared);
  return readDeclarationFolder(dir);
}

describe("checkRelease", () => {
  it("answers 0 when the bundle and the folder both carry the version asked for", async () => {
    const { out, log, error } = output();
    expect(checkRelease(VERSION, STAMPED, await releaseFolder(), out)).toBe(0);
    expect(log).toEqual(["release: the bundle and the declaration folder match"]);
    expect(error).toEqual([]);
    for (const value of Object.values(TEST_PRODUCER)) expect(log.join("\n")).not.toContain(value);
  });

  it.each<[string, BuiltRelease, string]>([
    ["a bundle run from source", { bundled: false }, "bundle version none"],
    ["a bundle that is not a release", { bundled: true, version: null }, "bundle version none"],
    ["a bundle of another release", { bundled: true, version: "1.2.4" }, "bundle version 1.2.4"],
  ])("answers 1 for %s, naming its version", async (_case, release, line) => {
    const { out, log, error } = output();
    expect(checkRelease(VERSION, release, await releaseFolder(), out)).toBe(1);
    expect(log).toEqual([]);
    expect(error).toEqual([line]);
  });

  it("answers 1 when there is no declaration folder", async () => {
    const { out, log, error } = output();
    const folder = await readDeclarationFolder(join(root, "absent"));
    expect(checkRelease(VERSION, STAMPED, folder, out)).toBe(1);
    expect(log).toEqual([]);
    expect(error).toEqual(["declaration folder none"]);
  });

  it("answers 1 when the folder is damaged, naming the file", async () => {
    await writeDeclarationFolder(join(root, "declaration"));
    await rm(join(root, "declaration", "declaration.pdf"));
    const { out, log, error } = output();
    const folder = await readDeclarationFolder(join(root, "declaration"));
    expect(checkRelease(VERSION, STAMPED, folder, out)).toBe(1);
    expect(log).toEqual([]);
    expect(error).toEqual(["declaration folder damaged declaration.pdf"]);
  });

  it("answers 1 when the folder is another release's, naming its version", async () => {
    const { out, log, error } = output();
    const folder = await releaseFolder({ version: "1.2.4", releasedOn: TEST_RELEASE.releasedOn });
    expect(checkRelease(VERSION, STAMPED, folder, out)).toBe(1);
    expect(log).toEqual([]);
    expect(error).toEqual(["declaration folder version 1.2.4"]);
  });

  it("names both the bundle and the folder when both are wrong", async () => {
    const { out, error } = output();
    const folder = await readDeclarationFolder(join(root, "absent"));
    expect(checkRelease(VERSION, { bundled: true, version: null }, folder, out)).toBe(1);
    expect(error).toEqual(["bundle version none", "declaration folder none"]);
  });
});
