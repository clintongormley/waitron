import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { declarationSourceFor, testProducer as producer } from "../../test/declaration.js";
import { pdfPages } from "../../test/declaration-pdf.js";
import { writeReleaseFolder } from "./folder.js";
import { renderDeclaration } from "./render.js";

const failing = vi.hoisted(() => ({ name: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      await fs.writeFile(...args);
      if (failing.name !== "" && String(args[0]).endsWith(`/${failing.name}`)) {
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      }
    },
  };
});

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "declaration-folder-"));
});

afterEach(async () => {
  failing.name = "";
  await rm(base, { recursive: true, force: true });
});

async function contents(dir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name);
    found[path.slice(dir.length)] = entry.isFile() ? await readFile(path, "utf8") : "<folder>";
  }
  return found;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  return (await pdfPages(bytes)).map((page) => page.text).join(" ");
}

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

  it("leaves no folder and no working folder when a write fails part way", async () => {
    const dir = join(base, "declaration");
    failing.name = "release.json";

    await expect(
      writeReleaseFolder(
        dir,
        declarationSourceFor("1.2.3", { date: "2026-12-03", releasable: true }),
        producer,
      ),
    ).rejects.toMatchObject({ code: "ENOSPC" });

    expect(await readdir(base)).toEqual([]);
  });

  it("refuses a folder that already holds files, and leaves it as it was", async () => {
    const dir = join(base, "declaration");
    await mkdir(join(dir, "declaration.pdf"), { recursive: true });
    await writeFile(join(dir, "declaration.html"), "older html");
    await writeFile(join(dir, "release.json"), '{"version":"0.9.0"}\n');
    const before = await contents(dir);

    await expect(
      writeReleaseFolder(
        dir,
        declarationSourceFor("1.2.3", { date: "2026-12-03", releasable: true }),
        producer,
      ),
    ).rejects.toMatchObject({ code: "declaration.folder_not_empty", params: { folder: dir } });

    expect(await contents(dir)).toEqual(before);
    expect(await readdir(base)).toEqual(["declaration"]);
  });

  it("lets the move's own error through when a file stands where the folder goes", async () => {
    const dir = join(base, "declaration");
    await writeFile(dir, "not a folder");

    await expect(
      writeReleaseFolder(
        dir,
        declarationSourceFor("1.2.3", { date: "2026-12-03", releasable: true }),
        producer,
      ),
    ).rejects.toMatchObject({ code: "ENOTDIR" });

    expect(await readFile(dir, "utf8")).toBe("not a folder");
    expect(await readdir(base)).toEqual(["declaration"]);
  });

  it("writes into an empty folder that already exists", async () => {
    const dir = join(base, "declaration");
    await mkdir(dir);
    const source = declarationSourceFor("1.2.3", { date: "2026-12-03", releasable: true });

    await writeReleaseFolder(dir, source, producer);

    expect((await readdir(dir)).sort()).toEqual([
      "declaration.html",
      "declaration.pdf",
      "declaration.txt",
      "release.json",
    ]);
    expect(await readdir(base)).toEqual(["declaration"]);
  });

  it("gives the folder the permissions a plain new folder gets", async () => {
    const dir = join(base, "declaration");
    await mkdir(join(base, "plain"));

    await writeReleaseFolder(
      dir,
      declarationSourceFor("1.2.3", { date: "2026-12-03", releasable: true }),
      producer,
    );

    expect((await stat(dir)).mode & 0o777).toBe((await stat(join(base, "plain"))).mode & 0o777);
  });

  it("lets only one of two renders into the same new folder succeed, leaving its four files", async () => {
    const dir = join(base, "declaration");
    const versions = ["1.2.3", "4.5.6"];

    const results = await Promise.allSettled(
      versions.map((version) =>
        writeReleaseFolder(
          dir,
          declarationSourceFor(version, { date: "2026-12-03", releasable: true }),
          producer,
        ),
      ),
    );

    const won = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const lost = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    expect(won).toHaveLength(1);
    expect(lost).toEqual([
      expect.objectContaining({ code: "declaration.folder_not_empty", params: { folder: dir } }),
    ]);
    const winner = won[0]!.version;
    const other = versions.find((version) => version !== winner)!;
    expect(JSON.parse(await readFile(join(dir, "release.json"), "utf8"))).toEqual(won[0]);
    for (const text of [
      await readFile(join(dir, "declaration.html"), "utf8"),
      await readFile(join(dir, "declaration.txt"), "utf8"),
      await pdfText(await readFile(join(dir, "declaration.pdf"))),
    ]) {
      expect(text).toContain(winner);
      expect(text).not.toContain(other);
    }
    expect(await readdir(base)).toEqual(["declaration"]);
  });
});
