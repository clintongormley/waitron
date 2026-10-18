import { join } from "node:path";
import {
  firstSetupAnchorFor,
  readDurableHostJson,
  readModulePreparationHistory,
  canonicalFirstSetupDirectory,
} from "@waitron/provisioning";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";

export async function readRecoveryDocumentEvidence(
  roots: { stateDir: string; venueDir: string },
  module: WaitronModule,
): Promise<Readonly<Record<string, unknown>>> {
  const anchor = await firstSetupAnchorFor(roots);
  const currentStateDir = await canonicalFirstSetupDirectory(roots.stateDir);
  const preparations = await readModulePreparationHistory(roots, module.name);
  const evidence: Record<string, unknown> = {};
  for (const source of module.backup?.nonDbState ?? []) {
    if (source.kind !== "preparation-history") continue;
    if (![module.name, source.source].every((name) => /^[a-z][a-z0-9-]*$/.test(name)))
      throw new AppError("recovery.pack_invalid", { reason: "module_unsupported" });
    const retained: unknown[] = [];
    for (const root of new Set([anchor.stateDir, currentStateDir])) {
      const value = await readDurableHostJson(
        join(root, "module-evidence", module.name, `${source.source}.json`),
        1024 * 1024,
      );
      if (value !== null) retained.push(value);
    }
    evidence[source.source] = source.project({ preparations, retained });
  }
  return evidence;
}
