import { isDeepStrictEqual } from "node:util";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import type { FirstSetupOriginal, FirstSetupState } from "@waitron/provisioning";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { readDeliveryManifest, readFirstFiscalDeliverySnapshot } from "./first-fiscal-delivery.js";
import { readFirstSetupStagedKey } from "./first-setup-node-key.js";

export async function firstSetupUnusedAssignment(
  state: FirstSetupState,
  originals: readonly FirstSetupOriginal[],
  modules: readonly WaitronModule[],
): Promise<boolean> {
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
              "resume",
              "recover",
              "candidates",
              "checked",
              "input",
              "import",
              "consumption-intent",
              "publication-binding",
              "abandoned",
            ].includes(event.kind),
        ),
    )
  )
    return false;
  const allowed = new Set([
    "state/first-setup.json",
    "venue/first-setup-claim.json",
    "venue/venue.db",
    "venue/venue.db-wal",
    "state/first-setup-node-key.json",
    "directory:state/first-fiscal-documents",
    "workspace:predecessor",
  ]);
  if (
    originals.some(
      (original) =>
        original.name.startsWith("outside-") ||
        original.name.startsWith("directory:outside:") ||
        (original.bytes !== null &&
          !allowed.has(original.name) &&
          !original.name.startsWith("state/first-fiscal-documents/")),
    )
  )
    return false;
  const read = (name: string) => {
    const bytes = originals.find((original) => original.name === name)?.bytes;
    return bytes == null ? null : (JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown);
  };
  try {
    const staged = read("state/first-setup-node-key.json");
    const key = staged === null ? null : readFirstSetupStagedKey(staged, state);
    let assignments = 0;
    const names = new Set<string>();
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
      if (seat.documentConfirmation === undefined) {
        assignments++;
        continue;
      }
      if (key === null) return false;
      const manifest = readDeliveryManifest(
        module.module,
        read(`state/first-fiscal-documents/${module.module}.json`),
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
    return (
      assignments > 0 &&
      originals.every(
        (original) =>
          !original.name.startsWith("state/first-fiscal-documents/") ||
          names.has(original.name.slice("state/first-fiscal-documents/".length)),
      )
    );
  } catch {
    return false;
  }
}
