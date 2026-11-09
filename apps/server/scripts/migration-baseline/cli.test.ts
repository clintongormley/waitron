import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { manifestCopySets } from "./copies.js";
import { runCli } from "./cli.js";
import { fixtureEntry, writeReference } from "./test-reference.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wt-baseline-cli-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function captured() {
  const lines: string[] = [];
  return { lines, print: (text: string) => lines.push(text) };
}

describe("the migration-baseline command line", () => {
  it.each(["rebuild", "rebuild-check"])(
    "%s refuses a set outside the manifest",
    async (command) => {
      await expect(runCli([command, "--set", "nowhere"], () => {})).rejects.toThrow(
        "The manifest has no set named nowhere",
      );
    },
  );
  it("rebuild takes only its required and optional flags", async () => {
    await expect(runCli(["rebuild"], () => {})).rejects.toThrow("Usage:");
    await expect(
      runCli(["rebuild", "--set", "nowhere", "--fold-generated", "0001_x"], () => {}),
    ).rejects.toThrow("The manifest has no set named nowhere");
    await expect(runCli(["rebuild", "--set", "core", "--bogus", "x"], () => {})).rejects.toThrow(
      "Usage:",
    );
  });
  it("refuses relative paths and an unknown command", async () => {
    await expect(
      runCli(["preserve", "--reference", "ref", "--set", "core", "--from", "core"], () => {}),
    ).rejects.toThrow("--reference must be an absolute path");
    await expect(
      runCli(["controls", "--reference", dir, "--out", "out"], () => {}),
    ).rejects.toThrow("--out must be an absolute path");
    await expect(
      runCli(["copies", "--dist", dir, "--image-root", dir, "--report", "r.txt"], () => {}),
    ).rejects.toThrow("--report must be an absolute path");
    await expect(runCli(["inventory"], () => {})).rejects.toThrow("Usage:");
  });

  it("refuses a set the manifest does not name, before reading anything", async () => {
    await expect(
      runCli(["preserve", "--reference", dir, "--set", "nowhere", "--from", "core"], () => {}),
    ).rejects.toThrow("The manifest has no set named nowhere");
  });

  it("refuses a controls output folder that already holds files", async () => {
    const out = join(dir, "occupied");
    mkdirSync(out);
    writeFileSync(join(out, "x"), "x");
    await expect(runCli(["controls", "--reference", dir, "--out", out], () => {})).rejects.toThrow(
      "is not empty",
    );
  });

  it("refuses a reference that lacks a phase the real controls change", async () => {
    const reference = writeReference(join(dir, "fixture-ref"), [
      fixtureEntry(join(dir, "fixture-ref"), [{ name: "core", sql: "CREATE TABLE t (id);" }]),
    ]);
    await expect(
      runCli(["controls", "--reference", reference, "--out", join(dir, "controls-out")], () => {}),
    ).rejects.toThrow("no entry for composition=fiscal-verifactu phase=change-feed database=venue");
  });

  it("checks every manifest set in both roots, writes the report and answers 1", async () => {
    const dist = join(dir, "dist");
    const image = join(dir, "image");
    mkdirSync(join(dist, "drizzle"), { recursive: true });
    mkdirSync(join(image, "drizzle"), { recursive: true });
    const report = join(dir, "copies.txt");
    const out = captured();
    const status = await runCli(
      ["copies", "--dist", dist, "--image-root", image, "--report", report],
      out.print,
    );
    expect(status).toBe(1);
    const text = out.lines.join("\n");
    for (const set of manifestCopySets()) {
      expect(text).toContain(`missing dist drizzle/${set.name}/meta/_journal.json`);
      expect(text).toContain(`missing image drizzle/${set.name}/meta/_journal.json`);
    }
    expect(readFileSync(report, "utf8")).toBe(`${text}\n`);
  });
});
