import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { NonDbSource, WaitronModule } from "@waitron/module";
import {
  parseFirstSetupState,
  readDurableHostJson,
  firstSetupModuleContext,
  type FirstSetupRoots,
  type readFirstSetupRetirementArchives,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { readFirstFiscalEvidenceSnapshot } from "./first-fiscal-evidence.js";
import { readFirstFiscalDeliverySnapshot } from "./first-fiscal-delivery.js";
import { readFirstSetupRecoveryDeliverySnapshot } from "./first-setup-recovery-delivery.js";
import "./errors.js";

type Recovery = NonNullable<
  Parameters<Extract<NonDbSource, { kind: "preparation-history" }>["project"]>[0]["recovery"]
>;
export async function readFirstSetupBackupSetups(
  roots: readonly FirstSetupRoots[],
  retired: readonly Pick<
    Awaited<ReturnType<typeof readFirstSetupRetirementArchives>>[number],
    "state" | "originals"
  >[],
  module: WaitronModule,
): Promise<Pick<Recovery, "setups" | "publicEvidence">> {
  const setups: Recovery["setups"][number][] = [];
  const publicEvidence: unknown[] = [];
  const invalid = (): never => {
    throw new AppError("module.operation_invalid", { module: module.name });
  };
  const collect = async (
    state: ReturnType<typeof parseFirstSetupState> | null,
    originals: readonly { name: string; bytes: Uint8Array | null }[],
  ) => {
    publicEvidence.push(...readFirstFiscalEvidenceSnapshot(module.name, originals));
    for (const original of originals) {
      if (original.name.startsWith("outside-file:") && original.bytes !== null)
        publicEvidence.push(JSON.parse(Buffer.from(original.bytes).toString("utf8")) as unknown);
    }
    if (state === null) {
      if (originals.some((entry) => entry.name.startsWith("state/first-fiscal-documents/")))
        invalid();
      return;
    }
    const recovery = readFirstSetupRecoveryDeliverySnapshot(module.name, state, originals, [
      module,
    ]);
    const statement =
      recovery?.statement ?? (await readFirstFiscalDeliverySnapshot(module.name, state, originals));
    if (statement !== undefined) publicEvidence.push(statement);
    for (const attempt of [state, ...state.previous]) {
      if (attempt.frozen.modules.some((entry) => entry.module === module.name))
        setups.push({
          context: firstSetupModuleContext(attempt, module.name),
          input: attempt.inputs[module.name],
        });
    }
  };
  try {
    for (const root of roots) {
      for (const name of ["setup-operation.json", "restore-request.json", "reset-request.json"])
        if ((await readDurableHostJson(join(root.stateDir, name), 1024 * 1024)) !== null) invalid();
      const raw = await readDurableHostJson(join(root.stateDir, "first-setup.json"), 1024 * 1024);
      const state = raw === null ? null : parseFirstSetupState(raw, root.venueDir, root.stateDir);
      const originals: { name: string; bytes: Uint8Array | null }[] = [];
      const add = async (path: string, name: string) => {
        const value = await readDurableHostJson(path, 1024 * 1024);
        if (value !== null) originals.push({ name, bytes: Buffer.from(JSON.stringify(value)) });
      };
      await add(
        join(root.stateDir, "module-operation-public.json"),
        "state/module-operation-public.json",
      );
      const directory = join(root.stateDir, "first-fiscal-documents");
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        names = [];
      }
      for (const name of names.filter((name) => name.endsWith(".json")).sort())
        await add(join(directory, name), `state/first-fiscal-documents/${name}`);
      await collect(state, originals);
    }
    for (const entry of retired) await collect(entry.state, entry.originals);
    return { setups, publicEvidence };
  } catch {
    return invalid();
  }
}
