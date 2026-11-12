import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { declarationSourceFor, testProducer as producer } from "../../test/declaration.js";
import { writeReleaseFolder } from "./folder.js";
import { renderDeclaration } from "./render.js";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "declaration-folder-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("writeReleaseFolder", () => {
  it("writes the four files of slice 3's folder from one source", async () => {
    const source = declarationSourceFor("1.2.3", { date: "2026-12-03", releasable: true });
    const dir = join(base, "declaration");

    const written = await writeReleaseFolder(dir, source, producer);

    expect(written).toEqual({ version: "1.2.3", releasedOn: "2026-12-03" });
    expect((await readdir(dir)).sort()).toEqual([
      "declaration.html",
      "declaration.pdf",
      "declaration.txt",
      "release.json",
    ]);
    const json = await readFile(join(dir, "release.json"), "utf8");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual({ version: "1.2.3", releasedOn: "2026-12-03" });
    const rendered = renderDeclaration(source, producer);
    expect(await readFile(join(dir, "declaration.html"), "utf8")).toBe(rendered.html);
    const text = await readFile(join(dir, "declaration.txt"), "utf8");
    expect(text).toBe(rendered.text);
    const versionLines = text.split("\n").filter((line) => line.startsWith("1.c) "));
    expect(versionLines).toHaveLength(1);
    expect(versionLines[0]!.endsWith(": 1.2.3")).toBe(true);
    const pdf = await readFile(join(dir, "declaration.pdf"));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("takes the version from item 1.c)", async () => {
    const source = declarationSourceFor("4.5.6", { date: "2026-12-03", releasable: true });

    expect(await writeReleaseFolder(join(base, "d"), source, producer)).toEqual({
      version: "4.5.6",
      releasedOn: "2026-12-03",
    });
  });

  it("refuses a source with no item 1.c)", async () => {
    const dir = join(base, "unversioned");
    const source = declarationSourceFor("1.2.3", { releasable: true }).replace("**1.c)", "**1.x)");

    await expect(writeReleaseFolder(dir, source, producer)).rejects.toMatchObject({
      code: "declaration.disagrees",
      params: { item: "1.c" },
    });
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes nothing for a source with a blocker", async () => {
    const dir = join(base, "blocked");

    await expect(
      writeReleaseFolder(dir, declarationSourceFor("1.2.3"), producer),
    ).rejects.toMatchObject({ code: "declaration.release_blocked", params: { count: 2 } });
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes nothing for a source whose date cannot be read", async () => {
    const dir = join(base, "undated");
    const source = declarationSourceFor("1.2.3", { releasable: true }).replace(
      "22 de octubre de 2026",
      "‹fecha›",
    );

    await expect(writeReleaseFolder(dir, source, producer)).rejects.toMatchObject({
      code: "declaration.date_unreadable",
    });
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
