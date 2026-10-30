import { join } from "node:path";
import {
  readDurableHostJson,
  readModulePreparationHistory,
  canonicalFirstSetupDirectory,
} from "@waitron/provisioning";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";

export type RecoveryDocumentEvidence = (
  module: WaitronModule,
) => Promise<Readonly<Record<string, unknown>>>;

export async function readRecoveryDocumentEvidence(
  roots: { stateDir: string; venueDir: string },
  module: WaitronModule,
): Promise<Readonly<Record<string, unknown>>> {
  const currentStateDir = await canonicalFirstSetupDirectory(roots.stateDir);
  const preparations = await readModulePreparationHistory(roots, module.name);
  const evidence: Record<string, unknown> = {};
  for (const source of module.backup?.nonDbState ?? []) {
    if (source.kind !== "preparation-history") continue;
    if (![module.name, source.source].every((name) => /^[a-z][a-z0-9-]*$/.test(name)))
      throw new AppError("recovery.pack_invalid", { reason: "module_unsupported" });
    const value = await readDurableHostJson(
      join(currentStateDir, "module-evidence", module.name, `${source.source}.json`),
      1024 * 1024,
    );
    const retained = value === null ? [] : [value];
    evidence[source.source] = source.project({ preparations, retained });
  }
  return evidence;
}
