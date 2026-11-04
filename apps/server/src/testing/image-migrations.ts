import { cp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestSets } from "@waitron/migrations";

/**
 * This image's migrations under `root`, laid out as `scripts/copy-migrations.mjs` lays out a built
 * box's, to be named as `migrationsRoot`. `behind` names a set whose last migration is left out, as
 * an older release would ship it.
 */
export async function copyImageMigrations(root: string, behind?: string): Promise<void> {
  const manifest = fileURLToPath(
    import.meta.resolve("@waitron/migrations/migrations.manifest.json"),
  );
  for (const set of manifestSets()) {
    const folder = join(root, set.name);
    await cp(resolve(dirname(manifest), set.from), folder, { recursive: true });
    if (set.name !== behind) continue;
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: unknown[] };
    journal.entries.pop();
    await writeFile(journalPath, JSON.stringify(journal));
  }
}
