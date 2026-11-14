import {
  readModuleRecord,
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
    const value = (await readModuleRecord(currentStateDir, module.name)).retained[source.source];
    const retained = value === undefined ? [] : [value];
    evidence[source.source] = source.project({ preparations, retained });
  }
  return evidence;
}
