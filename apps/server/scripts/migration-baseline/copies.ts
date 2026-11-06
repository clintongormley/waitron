import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface CopySet {
  readonly name: string;
  /** The source folder the build copies from. */
  readonly folder: string;
}

/** A shipped tree, such as the server's `dist/` or the image's `/app`, holding `drizzle/<set>/`. */
export interface CopyRoot {
  readonly label: string;
  readonly dir: string;
}

export interface CopyDifference {
  readonly kind: "missing" | "extra" | "stale";
  readonly root: string;
  readonly path: string;
}

export interface CopiesResult {
  readonly differences: readonly CopyDifference[];
  /** Files compared, summed over the roots. */
  readonly files: number;
}

/** Every set `migrations.manifest.json` names, resolved as `scripts/copy-migrations.mjs` resolves it. */
export function manifestCopySets(): CopySet[] {
  const manifest = fileURLToPath(
    import.meta.resolve("@waitron/migrations/migrations.manifest.json"),
  );
  const sets = JSON.parse(readFileSync(manifest, "utf8")) as { name: string; from: string }[];
  return sets.map((set) => ({ name: set.name, folder: resolve(dirname(manifest), set.from) }));
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

const hashOf = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Compares every shipped migration file of every set, in every root, with its source. */
export function checkCopies(sets: readonly CopySet[], roots: readonly CopyRoot[]): CopiesResult {
  if (sets.length === 0) throw new Error("No migration sets to compare");
  const sources = sets.map((set) => {
    const files = filesUnder(set.folder);
    if (files.length === 0)
      throw new Error(`Set ${set.name}'s source ${set.folder} holds no files`);
    return { set, hashes: new Map(files.map((path) => [path, hashOf(join(set.folder, path))])) };
  });
  const differences: CopyDifference[] = [];
  let files = 0;
  for (const root of roots) {
    if (!existsSync(root.dir)) throw new Error(`${root.label} ${root.dir} does not exist`);
    const drizzle = join(root.dir, "drizzle");
    for (const { set, hashes } of sources) {
      const shipped = join(drizzle, set.name);
      const shippedFiles = new Set(filesUnder(shipped));
      for (const path of [...new Set([...hashes.keys(), ...shippedFiles])].sort()) {
        const at = { root: root.label, path: `drizzle/${set.name}/${path}` };
        const sourceHash = hashes.get(path);
        if (!shippedFiles.has(path)) differences.push({ kind: "missing", ...at });
        else if (sourceHash === undefined) differences.push({ kind: "extra", ...at });
        else {
          files += 1;
          if (sourceHash !== hashOf(join(shipped, path))) {
            differences.push({ kind: "stale", ...at });
          }
        }
      }
    }
    const named = new Set(sets.map((set) => set.name));
    const folders = existsSync(drizzle) ? readdirSync(drizzle).sort() : [];
    for (const name of folders.filter((folder) => !named.has(folder))) {
      differences.push({ kind: "extra", root: root.label, path: `drizzle/${name}` });
    }
  }
  return { differences, files };
}

export function formatCopies(
  result: CopiesResult,
  sets: readonly CopySet[],
  roots: readonly CopyRoot[],
): string {
  if (result.differences.length > 0) {
    return result.differences.map((d) => `${d.kind} ${d.root} ${d.path}`).join("\n");
  }
  const each = result.files / roots.length;
  return `EQUAL\n${sets.length} sets, ${each} files each in ${roots.map((root) => root.label).join(" and ")}`;
}
