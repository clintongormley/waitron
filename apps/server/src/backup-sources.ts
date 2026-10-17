import { readArchiveStateFile, type ArchiveReadBudget } from "./archive-read-budget.js";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { WaitronModule } from "@waitron/module";
import type { ArchiveEntry } from "./backup-archive.js";
import "./errors.js";

/** Bounds open files, so a store of thousands of blobs cannot exhaust file descriptors. */
const CONCURRENCY = 64;

export function readModuleRecoveryEvidence(
  modules: readonly WaitronModule[],
  entries: readonly ArchiveEntry[],
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const evidence: Record<string, Record<string, unknown>> = {};
  for (const module of modules) {
    for (const source of module.backup?.nonDbState ?? []) {
      if (source.kind !== "preparation-history") continue;
      const entry = entries.find(
        (value) => value.name === `secrets/module-evidence/${module.name}/${source.source}.json`,
      );
      if (entry === undefined) continue;
      let retained: unknown;
      try {
        retained = JSON.parse(Buffer.from(entry.bytes).toString("utf8"));
      } catch {
        throw new AppError("backup.archive_invalid", { reason: "module_evidence_invalid" });
      }
      evidence[module.name] ??= {};
      evidence[module.name]![source.source] = source.project({
        preparations: [],
        retained: [retained],
      });
    }
  }
  return evidence;
}

export async function collectModuleNonDbState(
  modules: readonly WaitronModule[],
  resolvers: Record<string, string>,
  budget?: ArchiveReadBudget,
  preparation?: {
    read(module: string): Promise<readonly unknown[]>;
    readRetained(name: string): Promise<readonly unknown[]>;
  },
): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  for (const mod of modules) {
    for (const ref of mod.backup?.nonDbState ?? []) {
      const kind = ref.kind;
      if (kind === "preparation-history") {
        if (!preparation) throw new AppError("backup.source_unresolved", { source: ref.source });
        if (![mod.name, ref.source].every((name) => /^[a-z][a-z0-9-]*$/.test(name)))
          throw new AppError("backup.source_unresolved", { source: ref.source });
        const name = `secrets/module-evidence/${mod.name}/${ref.source}.json`;
        const values = await preparation.read(mod.name);
        const retained = await preparation.readRetained(name.slice("secrets/".length));
        if (values.length === 0 && retained.length === 0) continue;
        const bytes = Buffer.from(JSON.stringify(ref.project({ preparations: values, retained })));
        budget?.addEntry(name, bytes.length);
        entries.push({ name, bytes });
        continue;
      }
      if (kind !== "content-addressed-dir") {
        // The capture below is right only for a flat content-addressed directory.
        const _never: never = kind;
        throw new AppError("backup.source_kind_unsupported", { kind: _never });
      }
      const dir = resolvers[ref.source];
      if (!dir) {
        throw new AppError("backup.source_unresolved", { source: ref.source });
      }

      let dirents: import("node:fs").Dirent[];
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      // A stray subdirectory must not reach `readFile` or be captured as a blob.
      const names = dirents
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .sort();
      if (budget) {
        for (const name of names)
          entries.push({
            name: `${ref.source}/${name}`,
            bytes: await readArchiveStateFile(join(dir, name), budget, `${ref.source}/${name}`),
          });
        continue;
      }
      for (let i = 0; i < names.length; i += CONCURRENCY) {
        const chunk = names.slice(i, i + CONCURRENCY);
        const blobs = await Promise.all(chunk.map((name) => readFile(join(dir, name))));
        chunk.forEach((name, j) => {
          entries.push({ name: `${ref.source}/${name}`, bytes: blobs[j]! });
        });
      }
    }
  }
  return entries;
}
