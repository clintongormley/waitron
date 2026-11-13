import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import type { FirstSetupOriginal, FirstSetupState, SetupFlowRecord } from "@waitron/provisioning";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { readDeliveryManifest, readFirstFiscalDeliverySnapshot } from "./first-fiscal-delivery.js";
import { readFirstSetupStagedKey } from "./first-setup-node-key.js";
import { readFirstSetupRecoveryDeliverySnapshot } from "./first-setup-recovery-delivery.js";

export async function firstSetupUnusedAssignment(
  state: FirstSetupState,
  originals: readonly FirstSetupOriginal[],
  modules: readonly WaitronModule[],
  /** The current attempt may also have begun activation, and have been marked uncertain. */
  cutOff: boolean,
): Promise<false | { recoveryRecordDamaged: boolean }> {
  if (
    Object.keys(state.inputs).some(
      (name) =>
        name !== "$publication" && !state.frozen.modules.some((module) => module.module === name),
    )
  )
    return false;
  if (
    [state, ...state.previous].some(
      (attempt) =>
        attempt.result !== null ||
        attempt.history.some(
          (event) =>
            ![
              "claim",
              "candidates",
              "checked",
              "input",
              "import",
              "consumption-intent",
              "publication-binding",
              "abandoned",
              ...(cutOff && attempt === state ? ["activation-started", "uncertain"] : []),
            ].includes(event.kind),
        ),
    )
  )
    return false;
  const allowed = new Set([
    "state/flows/setup/record.json",
    "venue/venue.db",
    "venue/venue.db-wal",
    "directory:state/flows/setup/documents",
  ]);
  if (
    originals.some(
      (original) =>
        original.name.startsWith("outside-") ||
        original.name.startsWith("directory:outside:") ||
        (original.bytes !== null &&
          !allowed.has(original.name) &&
          !original.name.startsWith("state/flows/setup/documents/")),
    )
  )
    return false;
  const read = (name: string) => {
    const bytes = originals.find((original) => original.name === name)?.bytes;
    return bytes == null ? null : (JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown);
  };
  try {
    const flow = read("state/flows/setup/record.json") as SetupFlowRecord | null;
    if (flow?.publicEvidence !== undefined) return false;
    const staged = flow?.nodeKey;
    const key = staged === undefined ? null : readFirstSetupStagedKey(staged, state);
    let assignments = 0;
    let recoveryRecordDamaged = false;
    const names = new Set<string>();
    const manifestModules = new Set<string>();
    for (const module of state.frozen.modules) {
      if (!Object.hasOwn(state.inputs, module.module) && module.request === null) continue;
      const installed = modules.find((entry) => entry.name === module.module);
      const seat = initialSetupFor(modules, module.module);
      if (installed?.version !== module.version || seat === undefined) return false;
      const context = firstSetupModuleContext(state, module.module);
      if (!Object.hasOwn(state.inputs, module.module)) {
        if (module.request !== null) {
          if (seat.assignmentKeys === undefined || seat.assignmentKeys(context).length === 0)
            return false;
          assignments++;
        }
        continue;
      }
      const imported = seat.inspect(context, state.inputs[module.module]);
      if (seat.recoveryDocument !== undefined) {
        manifestModules.add(module.module);
        let manifest: ReturnType<typeof readFirstSetupRecoveryDeliverySnapshot>;
        try {
          manifest = readFirstSetupRecoveryDeliverySnapshot(
            module.module,
            state,
            originals,
            modules,
          );
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            originals.find((original) => original.name === "state/flows/setup/record.json")
              ?.bytes == null
          )
            throw error;
          // A damaged recovery record proves nothing about this attempt, so the caller requires that
          // the page showed the warning. Every other check here still decides, the staged node key
          // included; only the record's stage comparison is skipped.
          if (key === null) return false;
          recoveryRecordDamaged = true;
          assignments++;
          continue;
        }
        if (manifest !== null) {
          if (key === null || !isDeepStrictEqual(manifest.stage, key)) return false;
        }
        assignments++;
        continue;
      }
      if (seat.documentConfirmation === undefined) {
        assignments++;
        continue;
      }
      if (key === null) return false;
      const manifest = readDeliveryManifest(
        module.module,
        read(`state/flows/setup/documents/${module.module}.json`),
      );
      if (
        manifest === null ||
        !isDeepStrictEqual(manifest.stage, key) ||
        manifest.revision > state.revision ||
        manifest.ownerGeneration > state.ownerGeneration
      )
        return false;
      const statement = await readFirstFiscalDeliverySnapshot(module.module, state, originals);
      seat.documentConfirmation(context, imported, {
        statement,
        historyDigest: manifest.historyDigest,
        documentDigest: manifest.documentDigest,
        prior: null,
      });
      names.add(`${module.module}.json`);
      for (let index = 0; index < manifest.chunks; index++)
        names.add(`${manifest.id}-${index}.json`);
      assignments++;
    }
    return assignments > 0 &&
      Object.keys(flow?.recoveryManifests ?? {}).every((module) => manifestModules.has(module)) &&
      originals.every(
        (original) =>
          !original.name.startsWith("state/flows/setup/documents/") ||
          names.has(original.name.slice("state/flows/setup/documents/".length)),
      )
      ? { recoveryRecordDamaged }
      : false;
  } catch {
    return false;
  }
}
