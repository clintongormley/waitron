import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCopies, formatCopies, manifestCopySets, type CopySet } from "./copies.js";

let dir: string;
let sets: CopySet[];
let roots: { label: string; dir: string }[];

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wt-copies-"));
  sets = ["core", "node"].map((name) => ({ name, folder: join(dir, "source", name) }));
  for (const set of sets) {
    write(join(set.folder, "0000_baseline.sql"), `create table ${set.name} (id);`);
    write(join(set.folder, "meta", "_journal.json"), `{"set":"${set.name}"}`);
  }
  roots = ["dist", "image"].map((label) => ({ label, dir: join(dir, label) }));
  for (const root of roots) {
    for (const set of sets)
      cpSync(set.folder, join(root.dir, "drizzle", set.name), { recursive: true });
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const kinds = () =>
  checkCopies(sets, roots).differences.map((d) => `${d.kind} ${d.root} ${d.path}`);

describe("checkCopies", () => {
  it("finds nothing wrong with exact copies, and counts what it compared", () => {
    const result = checkCopies(sets, roots);
    expect(result.differences).toEqual([]);
    expect(result.files).toBe(8);
    expect(formatCopies(result, sets, roots)).toBe("EQUAL\n2 sets, 4 files each in dist and image");
  });

  it("reports a file changed by one byte, in the root that holds it", () => {
    write(join(dir, "image", "drizzle", "node", "meta", "_journal.json"), `{"set":"nodf"}`);
    expect(kinds()).toEqual(["stale image drizzle/node/meta/_journal.json"]);
  });

  it("reports a missing and an extra file", () => {
    rmSync(join(dir, "dist", "drizzle", "core", "0000_baseline.sql"));
    write(join(dir, "dist", "drizzle", "core", "0001_old.sql"), "select 1;");
    expect(kinds()).toEqual([
      "missing dist drizzle/core/0000_baseline.sql",
      "extra dist drizzle/core/0001_old.sql",
    ]);
  });

  it("reports a whole set missing, and a folder no set names", () => {
    rmSync(join(dir, "image", "drizzle", "core"), { recursive: true });
    write(join(dir, "image", "drizzle", "catalogue", "0000_x.sql"), "x");
    expect(kinds()).toEqual([
      "missing image drizzle/core/0000_baseline.sql",
      "missing image drizzle/core/meta/_journal.json",
      "extra image drizzle/catalogue",
    ]);
  });

  it("prints each difference", () => {
    rmSync(join(dir, "dist", "drizzle", "core", "0000_baseline.sql"));
    expect(formatCopies(checkCopies(sets, roots), sets, roots)).toBe(
      "missing dist drizzle/core/0000_baseline.sql",
    );
  });

  it("refuses no sets, an empty source set and a root that does not exist", () => {
    expect(() => checkCopies([], roots)).toThrow("No migration sets");
    const empty = join(dir, "source", "empty");
    mkdirSync(empty);
    expect(() => checkCopies([{ name: "empty", folder: empty }], roots)).toThrow("holds no files");
    expect(() => checkCopies(sets, [{ label: "dist", dir: join(dir, "nowhere") }])).toThrow(
      "does not exist",
    );
  });
});

describe("manifestCopySets", () => {
  it("names every set in the manifest, not only core", () => {
    const names = manifestCopySets().map((set) => set.name);
    expect(names).toContain("core");
    expect(names).toContain("node");
    expect(names).toContain("fiscal-verifactu");
    expect(names).toContain("fiscal-none");
    const manifest = JSON.parse(
      readFileSync(
        new URL("../../../../packages/migrations/migrations.manifest.json", import.meta.url),
        "utf8",
      ),
    ) as { name: string }[];
    expect(manifest.length).toBeGreaterThan(1);
    expect(names).toEqual(manifest.map((set) => set.name));
  });
});
