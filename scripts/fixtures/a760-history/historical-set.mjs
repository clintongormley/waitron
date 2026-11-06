import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/** The frozen pre-squash history of one old migration set, named as the old manifest named it. */
export function historicalSet(name) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const set = manifest.sets.find((candidate) => candidate.name === name);
  if (!set) throw new Error(`no frozen migration history named "${name}"`);
  return { migrationsFolder: join(root, set.name), migrationsTable: set.migrationsTable };
}
